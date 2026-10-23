"""Streaming local CSV ingestion and persistent, bounded SQLite candle queries.

Naive CSV timestamps are interpreted as UTC; no vendor timezone is inferred.
The index is rebuilt atomically when the recursive file manifest changes.
"""
import csv
import hashlib
import itertools
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import threading
import time
from collections import Counter
from contextlib import closing
from datetime import datetime, timezone

TF = {"1m": 60000, "3m": 180000, "5m": 300000, "15m": 900000,
      "30m": 1800000, "1h": 3600000, "4h": 14400000, "1d": 86400000,
      "1w": 604800000, "1M": 0}
FIELDS = ("open", "high", "low", "close", "volume")


def timestamp(value):
    value = str(value).strip()
    if re.fullmatch(r"\d+(\.\d+)?", value):
        number = float(value)
        return int(number * 1000 if number < 100000000000 else number)
    value = re.sub(r"^(\d{4})\.(\d{2})\.(\d{2})", r"\1-\2-\3", value)
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        # Dukascopy export, explicitly day-first rather than locale dependent.
        dt = datetime.strptime(value, "%d.%m.%Y %H:%M:%S.%f")
    return int(dt.replace(tzinfo=dt.tzinfo or timezone.utc).timestamp() * 1000)


def row_time(row):
    for key in ("datetime", "timestamp", "gmt_time", "local_time", "date", "time"):
        if row.get(key):
            value = row[key]
            if key == "date" and row.get("time"):
                value += " " + row["time"]
            return timestamp(value)
    raise ValueError("Missing datetime/date/time/timestamp column")


def timeframe_for(path, sample):
    name = str(path).lower()
    matches = set()
    for count, unit in re.findall(r"(?<![a-z0-9])(\d+)\s*(minutes?|mins?|m|hours?|h|days?|d|weeks?|w|months?)(?![a-z0-9])", name):
        unit = "M" if unit.startswith("month") else unit[0]
        matches.add(count + unit)
    for unit, count in re.findall(r"(?<![a-z0-9])([mhdw])(\d+)(?![a-z0-9])", name):
        matches.add(count + unit)
    if len(matches) > 1:
        raise ValueError(f"Conflicting timeframe labels: {matches}")
    if matches:
        tf = matches.pop()
        if tf not in TF:
            raise ValueError(f"Unsupported timeframe {tf}")
        times = sorted(set(row_time(r) for r in sample))
        if TF[tf] and any((b - a) < TF[tf] for a, b in zip(times, times[1:])):
            raise ValueError(f"Timestamps contradict timeframe {tf}")
        return tf
    times = sorted(set(row_time(r) for r in sample))
    deltas = Counter(b - a for a, b in zip(times, times[1:]))
    if deltas:
        delta, frequency = deltas.most_common(1)[0]
        candidates = [tf for tf, ms in TF.items() if ms == delta]
        if candidates and frequency >= 3 and frequency >= sum(deltas.values()) * .8:
            return candidates[0]
    raise ValueError("Ambiguous timeframe; add an explicit timeframe to the filename")


class LocalXAUUSDDataProvider:
    def __init__(self, root=None, cache_dir=None):
        self.root = Path(root or Path(__file__).resolve().parent.parent)
        folder = Path(os.environ.get("TRADEFXBOOK_DATA_DIR", "XAUUSD_Data")).expanduser()
        self.folder = (folder if folder.is_absolute() else self.root / folder).resolve()
        self.cache_dir = Path(cache_dir or os.environ.get('TRADEFXBOOK_CACHE_DIR') or self.root / "backend" / "market_cache")
        key = hashlib.sha256(str(self.folder).encode()).hexdigest()[:16]
        self.db = self.cache_dir / f"local_xauusd_{key}.sqlite3"
        self.lock = threading.Lock()
        self.checked = 0

    def ensure_index(self):
        with self.lock:
            if self.db.exists() and time.monotonic() - self.checked < 30:
                return
            files = sorted(p for p in self.folder.rglob("*") if p.is_file() and p.suffix.lower() == ".csv")
            if not files:
                raise FileNotFoundError(f"No CSV files in {self.folder}")
            manifest = [[str(p.relative_to(self.folder)), p.stat().st_size, p.stat().st_mtime_ns] for p in files]
            signature = json.dumps([3, manifest])
            if self.db.exists():
                with closing(sqlite3.connect(self.db)) as db:
                    saved = db.execute("SELECT value FROM meta WHERE key='signature'").fetchone()
                if saved and saved[0] == signature:
                    self.checked = time.monotonic()
                    return
            self.cache_dir.mkdir(parents=True, exist_ok=True)
            temporary = self.db.with_suffix(".building")
            if temporary.exists():
                temporary.unlink()
            try:
                with closing(sqlite3.connect(temporary)) as db:
                    db.executescript("""
                        PRAGMA journal_mode=OFF;
                        CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT);
                        CREATE TABLE candles(tf TEXT,side TEXT,time INTEGER,open REAL,high REAL,low REAL,close REAL,volume REAL,
                          PRIMARY KEY(tf,side,time)) WITHOUT ROWID;
                        CREATE TABLE ticks(time INTEGER,bid REAL,ask REAL,bid_volume REAL,ask_volume REAL,
                          PRIMARY KEY(time,bid,ask,bid_volume,ask_volume)) WITHOUT ROWID;
                    """)
                    report = []
                    for file in files:
                        try:
                            report.append(self._ingest(db, file))
                        except Exception as exc:
                            raise ValueError(f"{file.name}: {exc}") from exc
                    self._tick_candles(db)
                    native = {r[0] for r in db.execute("SELECT DISTINCT tf FROM candles")}
                    derived = {}
                    for tf, ms in TF.items():
                        if tf in native or not ms or tf == "1w":
                            continue
                        lower = sorted((TF[t], t) for t in native if TF[t] and TF[t] < ms and ms % TF[t] == 0)
                        if lower:
                            self._aggregate(db, lower[0][1], tf, ms)
                            derived[tf] = lower[0][1]
                    info = self._metadata(db, report, derived)
                    db.executemany("INSERT INTO meta VALUES (?,?)", [("signature", signature), ("info", json.dumps(info))])
                    db.commit()
                os.replace(temporary, self.db)
                self.checked = time.monotonic()
            except Exception:
                if temporary.exists():
                    temporary.unlink()
                raise

    def _ingest(self, db, file):
        with file.open(encoding="utf-8-sig", newline="") as stream:
            head = stream.read(8192)
            stream.seek(0)
            dialect = csv.Sniffer().sniff(head, delimiters=",;\t")
            reader = csv.DictReader(stream, dialect=dialect)
            reader.fieldnames = [re.sub(r"[^a-z0-9]+", "_", k.strip().lower()).strip("_") for k in reader.fieldnames]
            sample = list(itertools.islice(reader, 1000))
            if not sample:
                raise ValueError("Empty CSV")
            tick = "bid" in sample[0] and "ask" in sample[0] and "open" not in sample[0]
            tf = "tick" if tick else timeframe_for(file.relative_to(self.folder), sample)
            side = "ask" if re.search(r"(?i)(?:^|[^a-z])ask(?:[^a-z]|$)", str(file)) else "bid" if re.search(r"(?i)(?:^|[^a-z])bid(?:[^a-z]|$)", str(file)) else "ohlc"
            sides = [s for s in ("bid", "ask") if s + "_open" in sample[0]] or [side]
            rows = 0
            first_ts, last_ts = None, None
            batch = []
            for row in itertools.chain(sample, reader):
                rows += 1
                ts = row_time(row)
                first_ts = ts if first_ts is None else first_ts
                last_ts = ts
                if tick:
                    values = [float(row.get(k) or 0) for k in ("bid", "ask", "bid_volume", "ask_volume")]
                    if not all(math.isfinite(v) and v >= 0 for v in values) or values[0] <= 0 or values[1] < values[0]:
                        raise ValueError(f"Invalid tick at row {rows + 1}")
                    batch.append((ts, *values))
                else:
                    for s in sides:
                        prefix = s + "_" if s + "_open" in row else ""
                        values = [float(row.get(prefix + k) or (row.get("volume", 0) if k == "volume" else "nan")) for k in FIELDS]
                        o, h, l, c, v = values
                        if not all(math.isfinite(n) for n in values) or l <= 0 or l > min(o, c) or h < max(o, c) or v < 0:
                            raise ValueError(f"Invalid OHLCV at row {rows + 1}")
                        batch.append((tf, s, ts, *values))
                if len(batch) >= 10000:
                    db.executemany("INSERT OR IGNORE INTO ticks VALUES (?,?,?,?,?)" if tick else "INSERT OR IGNORE INTO candles VALUES (?,?,?,?,?,?,?,?)", batch)
                    batch.clear()
            if batch:
                db.executemany("INSERT OR IGNORE INTO ticks VALUES (?,?,?,?,?)" if tick else "INSERT OR IGNORE INTO candles VALUES (?,?,?,?,?,?,?,?)", batch)
            return {"file": str(file.relative_to(self.folder)), "timeframe": tf, "rows": rows,
                    "first_timestamp": first_ts, "last_timestamp": last_ts,
                    "sides": ["bid", "ask"] if tick else sides}

    def _tick_candles(self, db):
        for side, col, vol in (("bid", "bid", "bid_volume"), ("ask", "ask", "ask_volume")):
            rows = db.execute(f"SELECT time,{col},{col},{col},{col},{vol} FROM ticks ORDER BY time,bid,ask,bid_volume,ask_volume")
            self._reduce(db, rows, "1m", side, 60000)

    def _aggregate(self, db, source, target, ms):
        for (side,) in db.execute("SELECT DISTINCT side FROM candles WHERE tf=?", (source,)).fetchall():
            rows = db.execute("SELECT time,open,high,low,close,volume FROM candles WHERE tf=? AND side=? ORDER BY time", (source, side))
            self._reduce(db, rows, target, side, ms)

    def _reduce(self, db, rows, tf, side, ms):
        batch, current = [], None
        for ts, o, h, l, c, v in rows:
            bucket = ts // ms * ms
            if current is None or current[2] != bucket:
                if current:
                    batch.append(current)
                current = [tf, side, bucket, o, h, l, c, v]
            else:
                current[4] = max(current[4], h)
                current[5] = min(current[5], l)
                current[6] = c
                current[7] += v
            if len(batch) >= 10000:
                db.executemany("INSERT OR IGNORE INTO candles VALUES (?,?,?,?,?,?,?,?)", batch)
                batch.clear()
        if current:
            batch.append(current)
        db.executemany("INSERT OR IGNORE INTO candles VALUES (?,?,?,?,?,?,?,?)", batch)

    def _metadata(self, db, files, derived):
        frames = {}
        for tf in TF:
            sides = {s: {"rows": n, "first_timestamp": first, "last_timestamp": last} for s, n, first, last in db.execute(
                "SELECT side,count(*),min(time),max(time) FROM candles WHERE tf=? GROUP BY side", (tf,))}
            if not sides:
                continue
            side = next(s for s in ("bid", "ohlc", "ask") if s in sides)
            matches = [f for f in files if f["timeframe"] == derived.get(tf, tf)]
            frames[tf] = {**sides[side], "files": len(matches), "input_rows": sum(f["rows"] for f in matches),
                          "price_side": side, "sides": sides, "derived_from": derived.get(tf)}
        return {"symbol": "XAUUSD", "available": bool(frames), "source": "local-csv", "folder": self.folder.name,
                "timezone": "UTC (assumed for timestamps without an offset)", "timeframes": frames, "files": files,
                "tick_rows": db.execute("SELECT count(*) FROM ticks").fetchone()[0],
                "first_timestamp": min((v["first_timestamp"] for v in frames.values()), default=None),
                "last_timestamp": max((v["last_timestamp"] for v in frames.values()), default=None)}

    def info(self):
        self.ensure_index()
        with closing(sqlite3.connect(self.db)) as db:
            return json.loads(db.execute("SELECT value FROM meta WHERE key='info'").fetchone()[0])

    def history(self, timeframe, start=None, end=None, limit=5000, anchor=None):
        if timeframe not in TF:
            raise ValueError("Unsupported timeframe")
        limit = max(1, min(int(limit), 10000))
        info = self.info()
        frame = info["timeframes"].get(timeframe)
        if not frame:
            raise ValueError(f"No real dataset can supply {timeframe}; cannot upsample candles")
        start = timestamp(start) if start is not None else None
        end = timestamp(end) + (86400000 - 1 if re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(end)) else 0) if end is not None else None
        if start is not None and end is not None and start > end:
            raise ValueError("start must not exceed end")
        side = frame["price_side"]
        with closing(sqlite3.connect(self.db)) as db:
            def query(lo, hi, size, descending=False):
                clauses, args = ["tf=?", "side=?"], [timeframe, side]
                if lo is not None:
                    clauses.append("time>=?"); args.append(lo)
                if hi is not None:
                    clauses.append("time<=?"); args.append(hi)
                args.append(size)
                return db.execute("SELECT time,open,high,low,close,volume FROM candles WHERE " + " AND ".join(clauses) + " ORDER BY time " + ("DESC" if descending else "ASC") + " LIMIT ?", args).fetchall()
            if anchor is not None:
                at = timestamp(anchor)
                before = query(start, min(at, end) if end is not None else at, max(1, limit // 2), True)
                after = query(max(at + 1, start) if start is not None else at + 1, end, limit - len(before))
                rows = list(reversed(before)) + after
            else:
                rows = query(start, end, limit, start is None)
                if start is None:
                    rows.reverse()
            candles = [dict(zip(("time", *FIELDS), r)) for r in rows]
            for s in ("bid", "ask"):
                if s not in frame["sides"] or not rows:
                    continue
                values = {r[0]: r[1:] for r in db.execute("SELECT time,open,high,low,close,volume FROM candles WHERE tf=? AND side=? AND time BETWEEN ? AND ?", (timeframe, s, rows[0][0], rows[-1][0]))}
                for candle in candles:
                    if candle["time"] in values:
                        candle[s] = dict(zip(FIELDS, values[candle["time"]]))
        return {"symbol": "XAUUSD", "timeframe": timeframe, "source": "local-csv", "candles": candles,
                "total_candles": frame["rows"], "first_timestamp": frame["first_timestamp"], "last_timestamp": frame["last_timestamp"],
                "price_side": side, "derived_from": frame["derived_from"], "returned_candles": len(candles)}
