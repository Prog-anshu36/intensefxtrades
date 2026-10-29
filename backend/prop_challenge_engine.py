"""Server-authoritative historical XAUUSD prop challenge sessions.

Only the Prop Firm Session uses this engine. Each session is assigned a random
real month 48–60 months in the past and reveals one candle at a time.
"""
import json
import os
import random
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

from flask import Blueprint, jsonify, request, session

UTC = timezone.utc
LOCK = threading.RLock()
MAX_TRADING_DAYS = 15
RULES = {
    "standard": {"daily_loss_pct": 5, "max_loss_pct": 10, "targets": {"1": 8, "2": 5}, "min_days": 3},
    "pro": {"daily_loss_pct": 3, "max_loss_pct": 6, "targets": {"1": 6, "2": 6}, "min_days": 0},
}


def iso(ms):
    return datetime.fromtimestamp(ms / 1000, UTC).isoformat()


def month_bounds(year, month):
    start = datetime(year, month, 1, tzinfo=UTC)
    end = datetime(year + (month == 12), 1 if month == 12 else month + 1, 1, tzinfo=UTC)
    return int(start.timestamp() * 1000), int(end.timestamp() * 1000) - 1


def candle_day(ms):
    return datetime.fromtimestamp(ms / 1000, UTC).date().isoformat()


class HistoricalChallengeStore:
    def __init__(self, db_path, provider, rng=None):
        self.path, self.provider = Path(db_path), provider
        self.rng = rng or random.SystemRandom()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.execute("""CREATE TABLE IF NOT EXISTS prop_challenge_sessions(
                id TEXT PRIMARY KEY, owner TEXT NOT NULL, model TEXT NOT NULL,
                balance REAL NOT NULL, phase INTEGER NOT NULL, status TEXT NOT NULL,
                rules TEXT NOT NULL, start_ms INTEGER NOT NULL, end_ms INTEGER NOT NULL,
                cursor_ms INTEGER NOT NULL, trading_days TEXT NOT NULL DEFAULT '[]',
                phase_days TEXT NOT NULL DEFAULT '[]', reason TEXT NOT NULL DEFAULT '',
                realized_pnl REAL NOT NULL DEFAULT 0, position_json TEXT NOT NULL DEFAULT 'null',
                trades_json TEXT NOT NULL DEFAULT '[]', current_day TEXT NOT NULL DEFAULT '',
                daily_start_equity REAL NOT NULL DEFAULT 0, last_candle_json TEXT NOT NULL DEFAULT 'null',
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL)""")
            db.execute("CREATE INDEX IF NOT EXISTS prop_challenge_owner_idx ON prop_challenge_sessions(owner, created_at)")
            db.execute("""CREATE TABLE IF NOT EXISTS prop_challenge_revealed(
                challenge_id TEXT NOT NULL, time INTEGER NOT NULL, candle_json TEXT NOT NULL,
                PRIMARY KEY(challenge_id,time))""")
    def connect(self):
        db = sqlite3.connect(str(self.path), timeout=15)
        db.row_factory = sqlite3.Row
        return db

    def owner(self):
        # Never trust a client-supplied owner header. Use the authenticated Flask
        # session or the configured single-owner Basic Auth identity.
        value = session.get("user_id")
        if not value and request.authorization:
            expected_user = os.environ.get("TRADEFXBOOK_OWNER_USER", "trader")
            if request.authorization.username == expected_user and os.environ.get("TRADEFXBOOK_OWNER_PASSWORD"):
                value = request.authorization.username
        if not value and not os.environ.get("TRADEFXBOOK_OWNER_PASSWORD"):
            value = "local"
        if not value:
            raise ValueError("Sign in before creating a historical challenge.")
        return str(value)[:160]

    def pick_month(self, owner):
        info = self.provider.info()
        frame = info.get("timeframes", {}).get("1m")
        if not frame or frame.get("first_timestamp") is None or frame.get("last_timestamp") is None:
            raise ValueError("Verified local XAUUSD 1-minute data is unavailable.")
        now = datetime.now(UTC)
        with self.connect() as db:
            used = {(int(r[0]), int(r[1])) for r in db.execute("SELECT start_ms,end_ms FROM prop_challenge_sessions WHERE owner=?", (owner,)).fetchall()}
        candidates = []
        for offset in range(48, 61):
            total = now.year * 12 + (now.month - 1) - offset
            year, month0 = divmod(total, 12)
            lo, hi = month_bounds(year, month0 + 1)
            if lo >= frame["first_timestamp"] and hi <= frame["last_timestamp"] and hi < int(now.timestamp() * 1000) and (lo, hi) not in used:
                candidates.append((lo, hi))
        self.rng.shuffle(candidates)
        for lo, hi in candidates:
            try:
                rows = self.provider.history("1m", start=lo, end=hi, limit=2).get("candles", [])
            except (ValueError, OSError):
                continue
            if rows:
                return lo, hi
        raise ValueError("No eligible month exists in the 4–5 year window. Import verified XAUUSD data for that period.")

    def public(self, row):
        position = json.loads(row["position_json"])
        trades = json.loads(row["trades_json"])
        last = json.loads(row["last_candle_json"])
        equity = row["balance"] + row["realized_pnl"] + self.floating(position, last)
        return {
            "id": row["id"], "model": row["model"], "starting_balance": row["balance"],
            "phase": row["phase"], "status": row["status"], "rules": json.loads(row["rules"]),
            "assigned_start": iso(row["start_ms"]), "assigned_end": iso(row["end_ms"]),
            "cursor": iso(row["cursor_ms"]), "trading_days": json.loads(row["trading_days"]),
            "phase_days": json.loads(row["phase_days"]), "trading_day_limit": MAX_TRADING_DAYS,
            "breach_reason": row["reason"], "realized_pnl": round(row["realized_pnl"], 2),
            "equity": round(equity, 2), "daily_start_equity": round(float(row["daily_start_equity"] or row["balance"]), 2),
            "position": position, "trades": trades,
            "last_candle": last, "created_at": row["created_at"],
            "progress_pct": round(max(0, min(100, len(json.loads(row["trading_days"])) / MAX_TRADING_DAYS * 100)), 2),
        }

    @staticmethod
    def floating(position, candle):
        if not position or not candle:
            return 0.0
        delta = float(candle["close"]) - float(position["entry"])
        if position["side"] == "sell":
            delta = -delta
        return delta * 100.0 * float(position["lots"])

    def row_for(self, db, challenge_id):
        row = db.execute("SELECT * FROM prop_challenge_sessions WHERE id=?", (challenge_id,)).fetchone()
        return row if row and row["owner"] == self.owner() else None

    def create(self, payload):
        owner = self.owner()
        model = str(payload.get("model", "standard")).lower()
        if model not in RULES:
            raise ValueError("Unsupported challenge model.")
        try:
            balance = float(payload.get("starting_balance", 5000))
        except (TypeError, ValueError):
            raise ValueError("Starting balance must be numeric.")
        allowed = [5000, 10000, 25000, 50000, 100000] + ([200000] if model == "pro" else [])
        if balance not in allowed:
            raise ValueError("Unsupported account size for this model.")
        lo, hi = self.pick_month(owner)
        now_ms = int(datetime.now(UTC).timestamp() * 1000)
        now = iso(now_ms)
        cid = str(uuid.uuid4())
        with LOCK, self.connect() as db:
            db.execute("""INSERT INTO prop_challenge_sessions
                (id,owner,model,balance,phase,status,rules,start_ms,end_ms,cursor_ms,
                 trading_days,phase_days,realized_pnl,position_json,trades_json,current_day,
                 daily_start_equity,last_candle_json,created_at,updated_at)
                VALUES(?,?,?,?,1,'active',?,?,?,?, '[]','[]',0,'null','[]','',?, 'null',?,?)""",
                (cid, owner, model, balance, json.dumps(RULES[model]), lo, hi, lo, balance, now, now))
            return self.public(db.execute("SELECT * FROM prop_challenge_sessions WHERE id=?", (cid,)).fetchone())

    def list(self):
        owner = self.owner()
        with LOCK, self.connect() as db:
            rows = db.execute("SELECT * FROM prop_challenge_sessions WHERE owner=? ORDER BY created_at DESC", (owner,)).fetchall()
            return [self.public(row) for row in rows]

    def recent_candles(self, cid, limit=120):
        try:
            limit = max(1, min(500, int(limit)))
        except (TypeError, ValueError):
            limit = 120
        with LOCK, self.connect() as db:
            row = self.row_for(db, cid)
            if not row:
                return None
            found = db.execute("SELECT candle_json FROM prop_challenge_revealed WHERE challenge_id=? ORDER BY time DESC LIMIT ?", (cid, limit)).fetchall()
            return list(reversed([json.loads(item["candle_json"]) for item in found]))

    def get(self, cid):
        with LOCK, self.connect() as db:
            row = self.row_for(db, cid)
            return self.public(row) if row else None

    def _save(self, db, row, **values):
        values["updated_at"] = iso(int(datetime.now(UTC).timestamp() * 1000))
        assignments = ",".join(f"{key}=?" for key in values)
        db.execute(f"UPDATE prop_challenge_sessions SET {assignments} WHERE id=?",
                   (*values.values(), row["id"]))
        return db.execute("SELECT * FROM prop_challenge_sessions WHERE id=?", (row["id"],)).fetchone()

    def _close_position(self, row, price, when, trades, position):
        if not position:
            return row["realized_pnl"], trades, None
        delta = float(price) - float(position["entry"])
        if position["side"] == "sell":
            delta = -delta
        pnl = delta * 100.0 * float(position["lots"])
        trades.append({**position, "exit": float(price), "closed_at": iso(when), "pnl": round(pnl, 2)})
        return row["realized_pnl"] + pnl, trades, None

    def _evaluate(self, row, realized, position, candle, phase_days, daily_start, current_day):
        rules = json.loads(row["rules"])
        equity = row["balance"] + realized + self.floating(position, candle)
        # Evaluate floating risk at the adverse extreme of each revealed candle,
        # not only at its close, so a temporary intrabar breach cannot be hidden.
        risk_candle = candle
        if position and candle:
            adverse = candle["low"] if position["side"] == "buy" else candle["high"]
            risk_candle = {**candle, "close": adverse}
        risk_equity = row["balance"] + realized + self.floating(position, risk_candle)
        daily_floor = daily_start * (1 - rules["daily_loss_pct"] / 100)
        max_floor = row["balance"] * (1 - rules["max_loss_pct"] / 100)
        if risk_equity <= max_floor:
            return "failed", f"Maximum loss limit breached. Adverse equity {risk_equity:.2f} reached floor {max_floor:.2f}."
        if risk_equity <= daily_floor:
            return "failed", f"Daily loss limit breached on {current_day}. Adverse equity {risk_equity:.2f} reached floor {daily_floor:.2f}."
        target = row["balance"] * rules["targets"][str(row["phase"])] / 100
        if position is None and realized >= target and len(phase_days) >= rules["min_days"]:
            return ("passed" if row["phase"] == 2 else "phase-ready"), ""
        return "active", ""

    def next_candle(self, cid):
        with LOCK, self.connect() as db:
            row = self.row_for(db, cid)
            if not row:
                return None
            if row["status"] != "active":
                return {**self.public(row), "new_candle": None}
            found = self.provider.history("1m", start=row["cursor_ms"], end=row["end_ms"], limit=1).get("candles", [])
            if not found:
                updated = self._save(db, row, status="failed", reason="The assigned historical month ended before the challenge was passed.")
                return {**self.public(updated), "new_candle": None}
            candle = found[0]
            t = int(candle["time"])
            day = candle_day(t)
            days = json.loads(row["trading_days"])
            phase_days = json.loads(row["phase_days"])
            if day not in days and len(days) >= MAX_TRADING_DAYS:
                updated = self._save(db, row, status="failed", reason=f"Challenge not passed within {MAX_TRADING_DAYS} trading days.")
                return {**self.public(updated), "new_candle": None}
            position = json.loads(row["position_json"])
            trades = json.loads(row["trades_json"])
            realized = float(row["realized_pnl"])
            current_day = row["current_day"]
            daily_start = float(row["daily_start_equity"] or row["balance"])
            if day != current_day:
                current_day = day
                daily_start = row["balance"] + realized + self.floating(position, row and json.loads(row["last_candle_json"]))
                if day not in days:
                    days.append(day)
            # Stop/target execution is conservative if both levels fall inside one candle.
            if position:
                stop = position.get("stop_loss")
                take = position.get("take_profit")
                hit_stop = stop is not None and (candle["low"] <= stop if position["side"] == "buy" else candle["high"] >= stop)
                hit_take = take is not None and (candle["high"] >= take if position["side"] == "buy" else candle["low"] <= take)
                if hit_stop or hit_take:
                    exit_price = float(stop if hit_stop else take)
                    realized, trades, position = self._close_position(row, exit_price, t, trades, position)
            status, reason = self._evaluate(row, realized, position, candle, phase_days, daily_start, current_day)
            if status == "failed" and position:
                realized, trades, position = self._close_position(row, float(candle["close"]), t, trades, position)
            cursor = t + 1
            db.execute("INSERT OR IGNORE INTO prop_challenge_revealed(challenge_id,time,candle_json) VALUES(?,?,?)", (cid, t, json.dumps(candle)))
            updated = self._save(db, row, cursor_ms=cursor, trading_days=json.dumps(days),
                phase_days=json.dumps(phase_days), current_day=current_day, daily_start_equity=daily_start,
                realized_pnl=realized, position_json=json.dumps(position), trades_json=json.dumps(trades),
                last_candle_json=json.dumps(candle), status=status, reason=reason)
            return {**self.public(updated), "new_candle": candle}

    def place_order(self, cid, payload):
        side = str(payload.get("side", "")).lower()
        if side not in ("buy", "sell"):
            raise ValueError("Order side must be buy or sell.")
        try:
            lots = float(payload.get("lots", 0.01))
        except (TypeError, ValueError):
            raise ValueError("Lot size must be numeric.")
        if not 0 < lots <= 100:
            raise ValueError("Lot size must be greater than 0 and no more than 100.")
        with LOCK, self.connect() as db:
            row = self.row_for(db, cid)
            if not row:
                return None
            if row["status"] != "active":
                raise ValueError("This challenge is not active.")
            position = json.loads(row["position_json"])
            candle = json.loads(row["last_candle_json"])
            if not candle:
                raise ValueError("Wait until the historical market starts before placing an order.")
            if position:
                raise ValueError("Only one open XAUUSD position is allowed. Close it before opening another.")
            price = float(candle["close"])
            stop = self._optional_price(payload.get("stop_loss"))
            take = self._optional_price(payload.get("take_profit"))
            if stop is not None and ((side == "buy" and stop >= price) or (side == "sell" and stop <= price)):
                raise ValueError("Stop loss must be below entry for Buy and above entry for Sell.")
            if take is not None and ((side == "buy" and take <= price) or (side == "sell" and take >= price)):
                raise ValueError("Take profit must be above entry for Buy and below entry for Sell.")
            position = {"side": side, "lots": lots, "entry": price, "opened_at": iso(int(candle["time"])),
                        "stop_loss": stop, "take_profit": take}
            phase_days = json.loads(row["phase_days"])
            trade_day = candle_day(int(candle["time"]))
            if trade_day not in phase_days:
                phase_days.append(trade_day)
            updated = self._save(db, row, position_json=json.dumps(position), phase_days=json.dumps(phase_days))
            return self.public(updated)

    @staticmethod
    def _optional_price(value):
        if value is None or str(value).strip() == "":
            return None
        try:
            price = float(value)
        except (TypeError, ValueError):
            raise ValueError("Stop loss and take profit must be valid prices.")
        if price <= 0:
            raise ValueError("Stop loss and take profit must be positive prices.")
        return price

    def close_position(self, cid):
        with LOCK, self.connect() as db:
            row = self.row_for(db, cid)
            if not row:
                return None
            if row["status"] != "active":
                raise ValueError("This challenge is not active.")
            position = json.loads(row["position_json"])
            candle = json.loads(row["last_candle_json"])
            if not position or not candle:
                raise ValueError("There is no open position to close.")
            trades = json.loads(row["trades_json"])
            realized, trades, position = self._close_position(row, float(candle["close"]), int(candle["time"]), trades, position)
            days = json.loads(row["phase_days"])
            status, reason = self._evaluate(row, realized, position, candle, days, float(row["daily_start_equity"] or row["balance"]), row["current_day"])
            updated = self._save(db, row, realized_pnl=realized, position_json="null", trades_json=json.dumps(trades), status=status, reason=reason)
            return self.public(updated)

    def advance_phase(self, cid):
        with LOCK, self.connect() as db:
            row = self.row_for(db, cid)
            if not row:
                return None
            if row["status"] != "phase-ready" or row["phase"] != 1:
                raise ValueError("Phase 1 objectives must be completed before Phase 2.")
            updated = self._save(db, row, phase=2, status="active", realized_pnl=0.0,
                position_json="null", phase_days="[]", current_day="", daily_start_equity=row["balance"], reason="")
            return self.public(updated)


def register_historical_challenge_routes(app, provider):
    path = os.environ.get("TRADEFXBOOK_CHALLENGE_DB") or os.path.join(os.path.dirname(__file__), "market_cache", "historical_challenges.sqlite3")
    store = HistoricalChallengeStore(path, provider)
    bp = Blueprint("historical_challenges", __name__)

    @bp.get("/api/prop-challenge/coverage")
    def coverage():
        try:
            info = provider.info()
            return jsonify({"symbol": "XAUUSD", "source": info.get("source", "local-csv"),
                            "timeframes": info.get("timeframes", {}), "first_timestamp": info.get("first_timestamp"),
                            "last_timestamp": info.get("last_timestamp")})
        except (OSError, ValueError) as exc:
            return jsonify({"error": str(exc)}), 503

    @bp.get("/api/prop-challenge")
    def list_challenges():
        try:
            return jsonify({"challenges": store.list()})
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 401

    @bp.post("/api/prop-challenge")
    def create():
        try:
            return jsonify(store.create(request.get_json(silent=True) or {})), 201
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 401 if "Sign in" in str(exc) else 409
        except (OSError, sqlite3.Error):
            app.logger.exception("Could not create historical challenge")
            return jsonify({"error": "Historical challenge could not be created."}), 503

    @bp.get("/api/prop-challenge/<cid>")
    def get_challenge(cid):
        try:
            item = store.get(cid)
            return (jsonify(item), 200) if item else (jsonify({"error": "Challenge not found."}), 404)
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 401

    @bp.get("/api/prop-challenge/<cid>/candles")
    def recent_candles(cid):
        try:
            items = store.recent_candles(cid, request.args.get("limit", 120))
            return (jsonify({"candles": items}), 200) if items is not None else (jsonify({"error": "Challenge not found."}), 404)
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 401

    @bp.post("/api/prop-challenge/<cid>/next-candle")
    def next_candle(cid):
        try:
            item = store.next_candle(cid)
            return (jsonify(item), 200) if item else (jsonify({"error": "Challenge not found."}), 404)
        except (ValueError, OSError) as exc:
            return jsonify({"error": str(exc)}), 409

    @bp.post("/api/prop-challenge/<cid>/order")
    def order(cid):
        try:
            item = store.place_order(cid, request.get_json(silent=True) or {})
            return (jsonify(item), 200) if item else (jsonify({"error": "Challenge not found."}), 404)
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 409

    @bp.post("/api/prop-challenge/<cid>/close")
    def close(cid):
        try:
            item = store.close_position(cid)
            return (jsonify(item), 200) if item else (jsonify({"error": "Challenge not found."}), 404)
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 409

    @bp.post("/api/prop-challenge/<cid>/advance-phase")
    def advance_phase(cid):
        try:
            item = store.advance_phase(cid)
            return (jsonify(item), 200) if item else (jsonify({"error": "Challenge not found."}), 404)
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 409

    app.register_blueprint(bp)
    return store
