"""Historical prop challenge assignment and monotonic candle cursor API."""
import json, os, random, sqlite3, threading, uuid
from datetime import datetime, timezone
from pathlib import Path
from flask import Blueprint, jsonify, request

UTC = timezone.utc
LOCK = threading.RLock()
RULES = {
    "standard": {"daily_loss_pct": 5, "max_loss_pct": 10, "targets": {"1": 8, "2": 5}, "min_days": 3},
    "pro": {"daily_loss_pct": 3, "max_loss_pct": 6, "targets": {"1": 6, "2": 6}, "min_days": 0},
}

def iso(ms):
    return datetime.fromtimestamp(ms / 1000, UTC).isoformat()

def month_bounds(year, month):
    start = datetime(year, month, 1, tzinfo=UTC)
    end = datetime(year + (month == 12), 1 if month == 12 else month + 1, 1, tzinfo=UTC)
    return int(start.timestamp()*1000), int(end.timestamp()*1000)-1

class HistoricalChallengeStore:
    def __init__(self, db_path, provider, rng=None):
        self.path, self.provider = Path(db_path), provider
        self.rng = rng or random.SystemRandom()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.execute("""CREATE TABLE IF NOT EXISTS challenges(
              id TEXT PRIMARY KEY, owner TEXT NOT NULL, model TEXT NOT NULL, balance REAL NOT NULL,
              phase INTEGER NOT NULL, status TEXT NOT NULL, rules TEXT NOT NULL, start_ms INTEGER NOT NULL,
              end_ms INTEGER NOT NULL, cursor_ms INTEGER NOT NULL, trading_days TEXT NOT NULL,
              reason TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)""")
            db.execute("CREATE INDEX IF NOT EXISTS challenge_owner_idx ON challenges(owner, created_at)")
    def connect(self):
        db=sqlite3.connect(str(self.path), timeout=15); db.row_factory=sqlite3.Row; return db
    def owner(self):
        value=str(request.headers.get("X-Practice-Owner","")).strip()
        if not value or len(value)>160: raise ValueError("Sign in before creating a historical challenge.")
        return value
    def pick_month(self):
        info=self.provider.info(); frame=info.get("timeframes",{}).get("1m")
        if not frame or frame.get("first_timestamp") is None or frame.get("last_timestamp") is None:
            raise ValueError("Verified local XAUUSD 1-minute data is unavailable.")
        now=datetime.now(UTC); candidates=[]
        # Months 48–60 months old; never synthesize or substitute market candles.
        for offset in range(48,61):
            y=now.year-(now.month- offset - 1)//12
            # Use month arithmetic without relying on locale or date parsing.
            total=now.year*12+(now.month-1)-offset
            y,m=divmod(total,12); m+=1
            lo,hi=month_bounds(y,m)
            if lo>=frame["first_timestamp"] and hi<=frame["last_timestamp"] and hi<int(now.timestamp()*1000):
                candidates.append((lo,hi))
        self.rng.shuffle(candidates)
        for lo,hi in candidates:
            try: rows=self.provider.history("1m", start=lo, end=hi, limit=2).get("candles",[])
            except (ValueError,OSError): continue
            if rows: return lo,hi
        raise ValueError("No eligible month exists in the 4–5 year window. Import a verified XAUUSD dataset with coverage for that period.")
    def public(self,row):
        return {"id":row["id"],"model":row["model"],"starting_balance":row["balance"],"phase":row["phase"],
          "status":row["status"],"rules":json.loads(row["rules"]),"assigned_start":iso(row["start_ms"]),
          "assigned_end":iso(row["end_ms"]),"cursor":iso(row["cursor_ms"]),
          "trading_days":json.loads(row["trading_days"]),"breach_reason":row["reason"],
          "created_at":row["created_at"],"progress_pct":round(max(0,min(100,(row["cursor_ms"]-row["start_ms"])/max(1,row["end_ms"]-row["start_ms"])*100)),2)}
    def row_for(self, db, challenge_id):
        row=db.execute("SELECT * FROM challenges WHERE id=?",(challenge_id,)).fetchone()
        return row if row and row["owner"]==self.owner() else None
    def create(self,payload):
        owner=self.owner(); model=str(payload.get("model","standard")).lower()
        if model not in RULES: raise ValueError("Unsupported challenge model.")
        try: balance=float(payload.get("starting_balance",5000))
        except (TypeError,ValueError): raise ValueError("Starting balance must be numeric.")
        allowed=[5000,10000,25000,50000,100000] + ([200000] if model=="pro" else [])
        if balance not in allowed: raise ValueError("Unsupported account size for this model.")
        lo,hi=self.pick_month(); now=iso(int(datetime.now(UTC).timestamp()*1000)); cid=str(uuid.uuid4())
        rules=json.dumps(RULES[model])
        with LOCK,self.connect() as db:
            db.execute("INSERT INTO challenges(id,owner,model,balance,phase,status,rules,start_ms,end_ms,cursor_ms,trading_days,created_at,updated_at) VALUES(?,?,?,?,1,'active',?,?,?,?,?,?,?)",
              (cid,owner,model,balance,rules,lo,hi,lo,"[]",now,now))
            row=db.execute("SELECT * FROM challenges WHERE id=?",(cid,)).fetchone()
            return self.public(row)
    def get(self,cid):
        with LOCK,self.connect() as db:
            row=self.row_for(db,cid); return self.public(row) if row else None
    def candles(self,cid,limit):
        try: limit=max(1,min(500,int(limit)))
        except (ValueError,TypeError): limit=500
        with LOCK,self.connect() as db:
            row=self.row_for(db,cid)
            if not row: return None
            if row["status"]!="active": return {**self.public(row),"candles":[]}
            result=self.provider.history("1m",start=row["cursor_ms"],end=row["end_ms"],limit=limit)
            candles=result.get("candles",[])
            if candles:
                # Monotonic cursor; clients cannot supply a timestamp or rewind.
                cursor=min(row["end_ms"],int(candles[-1]["time"])+1)
                db.execute("UPDATE challenges SET cursor_ms=?,updated_at=? WHERE id=?",(cursor,iso(int(datetime.now(UTC).timestamp()*1000)),cid))
                row=db.execute("SELECT * FROM challenges WHERE id=?",(cid,)).fetchone()
            return {**self.public(row),"candles":candles,"source":"local-csv","timeframe":"1m"}
    def record_day(self,cid,market_time):
        try: t=int(market_time)
        except (TypeError,ValueError): raise ValueError("market_time must be a timestamp in milliseconds.")
        with LOCK,self.connect() as db:
            row=self.row_for(db,cid)
            if not row: return None
            if t<row["start_ms"] or t>=row["cursor_ms"] or t>row["end_ms"]:
                raise ValueError("Trading time must be within the already revealed historical timeline.")
            days=json.loads(row["trading_days"]); day=datetime.fromtimestamp(t/1000,UTC).date().isoformat()
            if day not in days: days.append(day)
            db.execute("UPDATE challenges SET trading_days=?,updated_at=? WHERE id=?",(json.dumps(days),iso(int(datetime.now(UTC).timestamp()*1000)),cid))
            return self.public(db.execute("SELECT * FROM challenges WHERE id=?",(cid,)).fetchone())
    def result(self,cid,passed):
        with LOCK,self.connect() as db:
            row=self.row_for(db,cid)
            if not row: return None
            if row["status"]!="active": raise ValueError("This challenge is already closed.")
            if passed is True and row["phase"]==1:
                db.execute("UPDATE challenges SET phase=2,updated_at=? WHERE id=?",(iso(int(datetime.now(UTC).timestamp()*1000)),cid))
            else:
                status="passed" if passed is True else "failed"
                reason="" if passed is True else "Challenge failed its objective check."
                db.execute("UPDATE challenges SET status=?,reason=?,updated_at=? WHERE id=?",(status,reason,iso(int(datetime.now(UTC).timestamp()*1000)),cid))
            return self.public(db.execute("SELECT * FROM challenges WHERE id=?",(cid,)).fetchone())

def register_historical_challenge_routes(app, provider):
    path=os.environ.get("TRADEFXBOOK_CHALLENGE_DB") or os.path.join(os.path.dirname(__file__),"market_cache","historical_challenges.sqlite3")
    store=HistoricalChallengeStore(path,provider); bp=Blueprint("historical_challenges",__name__)
    @bp.get("/api/prop-challenge/coverage")
    def coverage():
        try:
            info=provider.info()
            return jsonify({"symbol":"XAUUSD","source":info.get("source","local-csv"),"timeframes":info.get("timeframes",{}),"first_timestamp":info.get("first_timestamp"),"last_timestamp":info.get("last_timestamp")})
        except (OSError,ValueError) as exc: return jsonify({"error":str(exc)}),503
    @bp.post("/api/prop-challenge")
    def create():
        try: return jsonify(store.create(request.get_json(silent=True) or {})),201
        except ValueError as exc: return jsonify({"error":str(exc)}),409
        except (OSError,sqlite3.Error):
            app.logger.exception("Could not create historical challenge"); return jsonify({"error":"Historical challenge could not be created."}),503
    @bp.get("/api/prop-challenge/<cid>")
    def get_challenge(cid):
        item=store.get(cid); return (jsonify(item),200) if item else (jsonify({"error":"Challenge not found."}),404)
    @bp.get("/api/prop-challenge/<cid>/candles")
    def candles(cid):
        try:
            item=store.candles(cid,request.args.get("limit",500))
            return (jsonify(item),200) if item else (jsonify({"error":"Challenge not found."}),404)
        except (ValueError,OSError) as exc: return jsonify({"error":str(exc)}),409
    @bp.post("/api/prop-challenge/<cid>/trading-day")
    def trading_day(cid):
        try:
            item=store.record_day(cid,(request.get_json(silent=True) or {}).get("market_time"))
            return (jsonify(item),200) if item else (jsonify({"error":"Challenge not found."}),404)
        except ValueError as exc: return jsonify({"error":str(exc)}),409
    @bp.post("/api/prop-challenge/<cid>/result")
    def result(cid):
        try:
            item=store.result(cid,(request.get_json(silent=True) or {}).get("passed") is True)
            return (jsonify(item),200) if item else (jsonify({"error":"Challenge not found."}),404)
        except ValueError as exc: return jsonify({"error":str(exc)}),409
    app.register_blueprint(bp)
    return store
