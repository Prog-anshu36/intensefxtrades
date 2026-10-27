"""
intensefxTRADES — Flask backend
Provides persistence (JSON-file store) for the simulated trading account:
trades, journal entries, and UI session state (selected symbol/timeframe/etc).
XAUUSD price data is loaded from the project-local CSV provider; other demo
symbols retain their existing fixture/cache behavior. The backend stores and
serves the state created by the user.
"""
import json
import os
import threading
import csv
import io
import sqlite3
import zipfile
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

from flask import Flask, jsonify, request, send_from_directory, session, Response, has_request_context
from flask_cors import CORS
from werkzeug.security import check_password_hash, generate_password_hash
try:
    from .xauusd_data_provider import LocalXAUUSDDataProvider
    from .trade_importer import parse_trades, inspect_columns
except ImportError:
    from xauusd_data_provider import LocalXAUUSDDataProvider
    from trade_importer import parse_trades, inspect_columns

local_xauusd = LocalXAUUSDDataProvider()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.join(BASE_DIR, "..", "frontend")
DATA_FILE = os.environ.get("TRADEFXBOOK_STATE_FILE") or os.path.join(BASE_DIR, "store.json")
MARKET_CACHE_DIR = os.path.join(BASE_DIR, "market_cache")

app = Flask(
    __name__,
    static_folder=os.path.join(FRONTEND_DIR, "static"),
    template_folder=os.path.join(FRONTEND_DIR, "templates"),
)
CORS(app)
app.secret_key = os.environ.get("TRADEFXBOOK_SECRET", "tradefxbook-local-secret")

_lock = threading.Lock()


@app.before_request
def hosted_owner_access():
    """Optional owner gate for this single-workspace application when hosted."""
    import hmac
    password = os.environ.get('TRADEFXBOOK_OWNER_PASSWORD')
    if request.path == '/healthz' or not password:
        return None
    auth = request.authorization
    if not auth or not hmac.compare_digest(auth.username or '', os.environ.get('TRADEFXBOOK_OWNER_USER', 'trader')) or not hmac.compare_digest(auth.password or '', password):
        return Response('Owner authentication required.', 401, {'WWW-Authenticate': 'Basic realm="TradeFXBook", charset="UTF-8"'})


@app.get('/healthz')
def health_check():
    return jsonify(status='ok')

CONTRACT_SIZE = {
    "EURUSD": 100000, "GBPUSD": 100000, "USDJPY": 100000,
    "XAUUSD": 100,    # 1 lot = 100 troy oz
    "BTCUSD": 1,      # 1 lot = 1 BTC
}

YAHOO_SYMBOLS = {
    "EURUSD": "EURUSD=X",
    "GBPUSD": "GBPUSD=X",
    "USDJPY": "JPY=X",
    "XAUUSD": "GC=F",
    "BTCUSD": "BTC-USD",
    "ETHUSD": "ETH-USD",
    "SILVER": "SI=F",
    "GOLD": "GC=F",
}

YAHOO_INTERVALS = {
    "1m": "1d",
    "5m": "5d",
    "15m": "5d",
    "1h": "730d",
    "4h": "730d",
    "1d": "3y",
}



TIMEFRAME_MINUTES = {
    "1m": 1,
    "3m": 3,
    "5m": 5,
    "15m": 15,
    "30m": 30,
    "1h": 60,
    "4h": 240,
    "1d": 1440,
}


def _contract_size(symbol):
    return CONTRACT_SIZE.get(symbol, 100000)


def _cache_file(symbol, timeframe, provider="market"):
    os.makedirs(MARKET_CACHE_DIR, exist_ok=True)
    safe = f"{provider}_{symbol}_{timeframe}".replace("/", "_")
    return os.path.join(MARKET_CACHE_DIR, f"{safe}.json")


def _legacy_cache_file(symbol, timeframe):
    os.makedirs(MARKET_CACHE_DIR, exist_ok=True)
    safe = f"{symbol}_{timeframe}".replace("/", "_")
    return os.path.join(MARKET_CACHE_DIR, f"{safe}.json")






def _download_yahoo_history(symbol, timeframe):
    if symbol.upper() in ("XAUUSD", "GOLD"):
        raise ValueError("XAUUSD history is local CSV only")
    yahoo_symbol = YAHOO_SYMBOLS.get(symbol, symbol)
    interval = "60m" if timeframe in ("1h", "4h") else timeframe
    query = urllib.parse.urlencode({
        "range": YAHOO_INTERVALS.get(timeframe, "3y"),
        "interval": interval,
        "includePrePost": "false",
        "events": "history",
    })
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(yahoo_symbol)}?{query}"
    req = urllib.request.Request(url, headers={"User-Agent": "intensefxTRADES/1.0"})
    with urllib.request.urlopen(req, timeout=15) as response:
        payload = json.loads(response.read().decode("utf-8"))
    result = payload.get("chart", {}).get("result", [None])[0]
    if not result:
        raise ValueError("No market data returned")
    timestamps = result.get("timestamp", [])
    quote = result.get("indicators", {}).get("quote", [{}])[0]
    rows = []
    for i, ts in enumerate(timestamps):
        values = {k: quote.get(k, [None] * len(timestamps))[i] for k in ("open", "high", "low", "close", "volume")}
        if any(values[k] is None for k in ("open", "high", "low", "close")):
            continue
        rows.append({
            "time": int(ts * 1000),
            "open": round(float(values["open"]), 5),
            "high": round(float(values["high"]), 5),
            "low": round(float(values["low"]), 5),
            "close": round(float(values["close"]), 5),
            "volume": int(values.get("volume") or 0),
        })
    if timeframe == "4h":
        rows = _resample_rows(rows, 4)
    return rows


def _resample_rows(rows, group_size):
    grouped = []
    for i in range(0, len(rows), group_size):
        chunk = rows[i:i + group_size]
        if len(chunk) < group_size:
            continue
        grouped.append({
            "time": chunk[0]["time"],
            "open": chunk[0]["open"],
            "high": max(c["high"] for c in chunk),
            "low": min(c["low"] for c in chunk),
            "close": chunk[-1]["close"],
            "volume": sum(c.get("volume", 0) for c in chunk),
        })
    return grouped


def _resample_rows_to_minutes(rows, source_minutes, target_minutes):
    if not rows or target_minutes <= source_minutes or target_minutes % source_minutes:
        return []
    bucket_ms = target_minutes * 60 * 1000
    buckets = {}
    for row in sorted(rows, key=lambda item: item["time"]):
        bucket_time = (int(row["time"]) // bucket_ms) * bucket_ms
        bucket = buckets.setdefault(bucket_time, [])
        bucket.append(row)
    grouped = []
    for bucket_time in sorted(buckets):
        chunk = sorted(buckets[bucket_time], key=lambda item: item["time"])
        if not chunk:
            continue
        grouped.append({
            "time": bucket_time,
            "open": chunk[0]["open"],
            "high": max(c["high"] for c in chunk),
            "low": min(c["low"] for c in chunk),
            "close": chunk[-1]["close"],
            "volume": sum(c.get("volume", 0) for c in chunk),
        })
    return grouped


def _read_cached_history(symbol, timeframe):
    candidates = [
        ("yahoo-cache", _cache_file(symbol, timeframe, "yahoo")),
        ("legacy-cache", _legacy_cache_file(symbol, timeframe)),
    ]
    for source, path in candidates:
        if not os.path.exists(path):
            continue
        try:
            with open(path, "r") as f:
                rows = json.load(f)
            if rows:
                return source, sorted(rows, key=lambda row: row["time"])
        except (OSError, json.JSONDecodeError, KeyError):
            continue
    return None, None


def _derive_history_from_lower_timeframe(symbol, timeframe, count):
    target_minutes = TIMEFRAME_MINUTES.get(timeframe)
    if not target_minutes:
        return None, None
    candidates = []
    for lower_tf, source_minutes in TIMEFRAME_MINUTES.items():
        if not source_minutes or source_minutes >= target_minutes or target_minutes % source_minutes:
            continue
        source, rows = _read_cached_history(symbol, lower_tf)
        if rows:
            newest = rows[-1].get("time", 0)
            candidates.append((newest, source_minutes, lower_tf, source, rows))
    for _, source_minutes, lower_tf, source, rows in sorted(candidates, reverse=True):
        derived = _resample_rows_to_minutes(rows, source_minutes, target_minutes)
        if derived:
            return f"{source}-derived-{lower_tf}", derived[-int(count or 5000):]
    return None, None


DEFAULT_ACCOUNT = {
    "id": "demo",
    "name": "Demo Account",
    "type": "Demo",
    "currency": "USD",
    "currency_symbol": "$",
    "archived": False,
    "created_at": None,
    "balance": 10000.0,
    "initial_balance": 10000.0,
    "active_trades": [],   # open positions (list, supports multiple symbols)
    "pending_orders": [],  # limit/stop orders waiting to trigger
    "history": [],         # closed trades
    "journal": [],         # journal entries (notes per trade or freeform)
    "settings": {
        "symbol": "EURUSD",
        "timeframe": "1h",
        "current_idx": 200,
        "theme": "dark",
    },
}


def _new_account(account_id, name, account_type="Demo", starting_balance=10000.0, currency="USD", currency_symbol="$"):
    account = json.loads(json.dumps(DEFAULT_ACCOUNT))
    account["id"] = account_id
    account["name"] = name
    account["type"] = account_type
    account["currency"] = currency
    account["currency_symbol"] = currency_symbol
    account["balance"] = float(starting_balance)
    account["initial_balance"] = float(starting_balance)
    account["created_at"] = datetime.now(timezone.utc).isoformat()
    return account


DEFAULT_STATE = {
    "active_user_id": "local",
    "users": [{
        "id": "local",
        "email": "local@tradefxbook.app",
        "name": "Local User",
        "password_hash": generate_password_hash("password"),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "settings": {"theme": "dark", "email_alerts": False, "sms_alerts": False},
    }],
    "active_account_id": "demo",
    "accounts": [_new_account("demo", "Demo Account")],
    "notifications": [],
    "sessions": [],
}


ACCOUNT_KEYS = set(DEFAULT_ACCOUNT.keys()) - {"id", "name", "type", "currency", "currency_symbol", "archived", "created_at"}


def _account_summary(account):
    return {
        "id": account["id"],
        "name": account.get("name", "Account"),
        "type": account.get("type", "Demo"),
        "currency": account.get("currency", "USD"),
        "currency_symbol": account.get("currency_symbol", "$"),
        "archived": bool(account.get("archived", False)),
        "balance": account.get("balance", 0),
        "initial_balance": account.get("initial_balance", 0),
    }


def _state_response(data):
    account = _active_account(data)
    response = json.loads(json.dumps({k: v for k, v in account.items() if k != 'prop_practice'}))
    response["active_account_id"] = account["id"]
    response["accounts"] = [_account_summary(a) for a in data["accounts"]]
    response["user"] = _public_user(_active_user(data))
    response["notifications"] = data.get("notifications", [])
    return response


def _public_user(user):
    if not user:
        return None
    return {
        "id": user.get("id"),
        "email": user.get("email"),
        "name": user.get("name"),
        "settings": user.get("settings", {}),
    }


def _active_user(data):
    user_id = session.get("user_id") or data.get("active_user_id") or "local"
    user = next((u for u in data.get("users", []) if u.get("id") == user_id), None)
    if user:
        data["active_user_id"] = user["id"]
        return user
    users = data.get("users", [])
    return users[0] if users else None


def _active_account(data):
    account = _primary_account(data)
    practice = request.headers.get('X-Practice-Id') if has_request_context() else None
    if practice and request.path != '/api/prop-practice':
        account = next(a for a in data['accounts'] if a['id'] == request.headers.get('X-Practice-Owner'))
        return account['prop_practice'][practice]
    return account


def _primary_account(data):
    active_id = data.get("active_account_id")
    account = next((a for a in data.get("accounts", []) if a.get("id") == active_id), None)
    if account:
        return account
    if data.get("accounts"):
        data["active_account_id"] = data["accounts"][0]["id"]
        return data["accounts"][0]
    data["accounts"] = [_new_account("demo", "Demo Account")]
    data["active_account_id"] = "demo"
    return data["accounts"][0]


def _normalize_account(account):
    for k, v in DEFAULT_ACCOUNT.items():
        account.setdefault(k, json.loads(json.dumps(v)))
    if account.get("created_at") is None:
        account["created_at"] = datetime.now(timezone.utc).isoformat()
    return account


def _normalize_state(data):
    data.setdefault("users", json.loads(json.dumps(DEFAULT_STATE["users"])))
    data.setdefault("active_user_id", data["users"][0]["id"] if data["users"] else "local")
    data.setdefault("notifications", [])
    data.setdefault("sessions", [])
    return data


def _migrate_legacy(data):
    if "accounts" in data:
        data = _normalize_state(data)
        data.setdefault("active_account_id", data["accounts"][0]["id"] if data["accounts"] else "demo")
        data["accounts"] = [_normalize_account(a) for a in data.get("accounts", [])]
        _primary_account(data)
        return data

    account = _new_account("demo", "Demo Account")
    for key in ACCOUNT_KEYS:
        if key in data:
            account[key] = data[key]
    data = {
        "active_user_id": "local",
        "users": json.loads(json.dumps(DEFAULT_STATE["users"])),
        "active_account_id": account["id"],
        "accounts": [_normalize_account(account)],
        "notifications": [],
        "sessions": [],
    }
    return data


def _load():
    if not os.path.exists(DATA_FILE):
        return json.loads(json.dumps(DEFAULT_STATE))
    try:
        with open(DATA_FILE, "r") as f:
            data = json.load(f)
        return _migrate_legacy(data)
    except (json.JSONDecodeError, OSError):
        return json.loads(json.dumps(DEFAULT_STATE))


def _save(data):
    os.makedirs(os.path.dirname(os.path.abspath(DATA_FILE)), exist_ok=True)
    tmp = DATA_FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, DATA_FILE)


# ---------------------------------------------------------------- frontend

@app.before_request
def practice_workspace_guard():
    practice = request.headers.get('X-Practice-Id')
    if not practice:
        return None
    allowed = request.path in ('/api/state', '/api/settings', '/api/prop-practice') or request.path.startswith('/api/trades/')
    if not allowed or len(practice) > 120 or not all(c.isalnum() or c in '-_' for c in practice):
        return jsonify(error='Invalid practice workspace request.'), 400
    with _lock:
        owner = _primary_account(_load())
        if request.headers.get('X-Practice-Owner') != owner['id']:
            return jsonify(error='Account changed. Reopen the prop practice workspace.'), 409
        if request.path != '/api/prop-practice' and practice not in owner.get('prop_practice', {}):
            return jsonify(error='Start this prop practice phase first.'), 404
    payload = request.get_json(silent=True) or {}
    if payload.get('symbol', 'XAUUSD') != 'XAUUSD' or any(s != 'XAUUSD' for s in payload.get('ticks', {})):
        return jsonify(error='Prop practice supports XAUUSD only.'), 400
    return None


@app.route('/api/prop-practice', methods=['POST'])
def initialize_practice_workspace():
    practice = request.headers.get('X-Practice-Id')
    payload = request.get_json(silent=True) or {}
    if not practice or payload.get('model') not in ('standard', 'pro'):
        return jsonify(error='Choose a valid prop practice round.'), 400
    sizes = [5000, 10000, 25000, 50000, 100000] + ([200000] if payload['model'] == 'pro' else [])
    if payload.get('balance') not in sizes:
        return jsonify(error='Choose a supported practice balance.'), 400
    with _lock:
        data = _load()
        owner = _primary_account(data)
        ledgers = owner.setdefault('prop_practice', {})
        if practice not in ledgers:
            ledger = _new_account('prop-' + practice, 'Prop Firm Practice', starting_balance=payload['balance'])
            ledger['settings'].update(symbol='XAUUSD', timeframe='1m')
            ledgers[practice] = ledger
            _save(data)
        return jsonify(ledgers[practice])

@app.route("/")
def index():
    return send_from_directory(app.template_folder, "index.html")


# ---------------------------------------------------------------- state

@app.route("/api/state", methods=["GET"])
def get_state():
    with _lock:
        return jsonify(_state_response(_load()))


@app.route("/api/auth/signup", methods=["POST"])
def signup():
    payload = request.get_json(force=True) or {}
    email = (payload.get("email") or "").strip().lower()
    password = payload.get("password") or ""
    name = (payload.get("name") or email.split("@")[0] or "Trader").strip()
    if "@" not in email or len(password) < 4:
        return jsonify({"error": "valid email and password required"}), 400
    with _lock:
        data = _load()
        if any(u["email"].lower() == email for u in data["users"]):
            return jsonify({"error": "email already exists"}), 409
        user_id = f"user_{int(datetime.now(timezone.utc).timestamp() * 1000)}"
        data["users"].append({
            "id": user_id,
            "email": email,
            "name": name,
            "password_hash": generate_password_hash(password),
            "created_at": datetime.now(timezone.utc).isoformat(),
            "settings": {"theme": "dark", "email_alerts": False, "sms_alerts": False},
        })
        data["active_user_id"] = user_id
        session["user_id"] = user_id
        data["sessions"].append({"user_id": user_id, "event": "signup", "created_at": datetime.now(timezone.utc).isoformat()})
        _save(data)
        return jsonify(_state_response(data))


@app.route("/api/auth/login", methods=["POST"])
def login():
    payload = request.get_json(force=True) or {}
    email = (payload.get("email") or "").strip().lower()
    password = payload.get("password") or ""
    with _lock:
        data = _load()
        user = next((u for u in data["users"] if u["email"].lower() == email), None)
        if not user or not check_password_hash(user["password_hash"], password):
            return jsonify({"error": "invalid email or password"}), 401
        data["active_user_id"] = user["id"]
        session["user_id"] = user["id"]
        data["sessions"].append({"user_id": user["id"], "event": "login", "created_at": datetime.now(timezone.utc).isoformat()})
        _save(data)
        return jsonify(_state_response(data))


@app.route("/api/auth/logout", methods=["POST"])
def logout():
    session.pop("user_id", None)
    return jsonify({"ok": True})


@app.route("/api/auth/forgot-password", methods=["POST"])
def forgot_password():
    payload = request.get_json(force=True) or {}
    email = (payload.get("email") or "").strip().lower()
    with _lock:
        data = _load()
        user = next((u for u in data["users"] if u["email"].lower() == email), None)
        if user:
            data["notifications"].insert(0, {
                "id": f"notif_{int(datetime.now(timezone.utc).timestamp() * 1000)}",
                "type": "Password Reset",
                "message": f"Password reset requested for {email}. Local desktop mode stores this as a notification.",
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
            _save(data)
        return jsonify({"ok": True})


@app.route("/api/accounts", methods=["POST"])
def create_account():
    payload = request.get_json(force=True) or {}
    name = (payload.get("name") or "New Account").strip()[:40] or "New Account"
    # Until a trusted subscription backend is connected, this endpoint serves
    # the Blue plan and its single demo account only. Never accept a client plan.
    account_type = "Demo"
    starting_balance = payload.get("starting_balance") or 10000
    currency = payload.get("currency") or "USD"
    currency_symbol = payload.get("currency_symbol") or "$"
    with _lock:
        data = _load()
        # Local/GitHub Pages workspaces have no trusted paid-plan session yet.
        # Apply the Blue account limit server-side as well as in the UI; archived
        # accounts remain in this collection and cannot be used to bypass it.
        if len(data.get("accounts", [])) >= 1:
            return jsonify({"error": "Blue Free includes one trading account. Archived accounts still count. Connect a paid subscription to add more accounts."}), 403
        account_id = f"acct_{int(datetime.now(timezone.utc).timestamp() * 1000)}"
        data["accounts"].append(_new_account(account_id, name, account_type, starting_balance, currency, currency_symbol))
        data["active_account_id"] = account_id
        _save(data)
        return jsonify(_state_response(data))


@app.route("/api/accounts/archive", methods=["POST"])
def archive_account():
    payload = request.get_json(force=True) or {}
    account_id = payload.get("id")
    with _lock:
        data = _load()
        account = next((a for a in data["accounts"] if a["id"] == account_id), None)
        if not account:
            return jsonify({"error": "account not found"}), 404
        account["archived"] = True
        account["archived_at"] = datetime.now(timezone.utc).isoformat()
        live = [a for a in data["accounts"] if not a.get("archived")]
        if data["active_account_id"] == account_id and live:
            data["active_account_id"] = live[0]["id"]
        _save(data)
        return jsonify(_state_response(data))


@app.route("/api/accounts/restore", methods=["POST"])
def restore_account():
    payload = request.get_json(force=True) or {}
    account_id = payload.get("id")
    with _lock:
        data = _load()
        account = next((a for a in data["accounts"] if a["id"] == account_id), None)
        if not account:
            return jsonify({"error": "account not found"}), 404
        if account.get("archived") and sum(1 for item in data["accounts"] if not item.get("archived")) >= 1:
            return jsonify({"error": "Blue Free allows one active trading account. Archive the current account before restoring another."}), 403
        account["archived"] = False
        account.pop("archived_at", None)
        data["active_account_id"] = account_id
        _save(data)
        return jsonify(_state_response(data))


@app.route("/api/accounts/delete", methods=["POST"])
def delete_account():
    payload = request.get_json(force=True) or {}
    account_id = payload.get("id")
    with _lock:
        data = _load()
        if len(data["accounts"]) <= 1:
            return jsonify({"error": "cannot delete the only account"}), 400
        data["accounts"] = [a for a in data["accounts"] if a["id"] != account_id]
        if data["active_account_id"] == account_id:
            data["active_account_id"] = data["accounts"][0]["id"]
        _save(data)
        return jsonify(_state_response(data))


@app.route("/api/accounts/switch", methods=["POST"])
def switch_account():
    payload = request.get_json(force=True) or {}
    account_id = payload.get("id")
    with _lock:
        data = _load()
        if not any(a["id"] == account_id for a in data["accounts"]):
            return jsonify({"error": "account not found"}), 404
        data["active_account_id"] = account_id
        _save(data)
        return jsonify(_state_response(data))


@app.route("/api/accounts/reset", methods=["POST"])
def reset_account():
    with _lock:
        data = _load()
        account = _active_account(data)
        reset = _new_account(
            account["id"],
            account.get("name", "Account"),
            account.get("type", "Demo"),
            account.get("initial_balance", 10000.0),
            account.get("currency", "USD"),
            account.get("currency_symbol", "$"),
        )
        reset["created_at"] = account.get("created_at")
        reset["archived"] = account.get("archived", False)
        data["accounts"] = [reset if a["id"] == account["id"] else a for a in data["accounts"]]
        _save(data)
        return jsonify(_state_response(data))


@app.route("/api/settings", methods=["POST"])
def update_settings():
    payload = request.get_json(force=True) or {}
    with _lock:
        data = _load()
        account = _active_account(data)
        account["settings"].update(payload)
        _save(data)
        return jsonify(account["settings"])


# ---------------------------------------------------------------- market data

@app.route("/api/market/dataset-info", methods=["GET"])
def market_dataset_info():
    symbol = (request.args.get("symbol") or "XAUUSD").upper()
    if symbol not in ("XAUUSD", "GOLD"):
        return jsonify({"symbol": symbol, "available": False, "source": "unavailable"}), 404
    try:
        return jsonify(local_xauusd.info())
    except (ValueError, OSError, sqlite3.Error) as exc:
        return jsonify({"symbol": symbol, "available": False, "source": "local-csv",
                        "error": "XAUUSD historical dataset could not be loaded.", "detail": str(exc)}), 503

@app.route("/api/market/history", methods=["GET"])
def market_history():
    symbol = (request.args.get("symbol") or "EURUSD").upper()
    timeframe = request.args.get("timeframe") or "1d"
    if symbol in ("XAUUSD", "GOLD"):
        try:
            result = local_xauusd.history(timeframe, start=request.args.get("start"), end=request.args.get("end"),
                                          limit=request.args.get("limit", request.args.get("count", 5000)),
                                          anchor=request.args.get("anchor"))
            result["symbol"] = symbol
            return jsonify(result)
        except ValueError as exc:
            return jsonify({"error": "XAUUSD historical dataset could not be loaded.", "detail": str(exc), "source": "local-csv", "candles": []}), 400
        except (OSError, sqlite3.Error) as exc:
            return jsonify({"error": "XAUUSD historical dataset could not be loaded.", "detail": str(exc), "source": "local-csv", "candles": []}), 503
    count = request.args.get("count") or 5000
    try:
        count = max(100, min(int(count), 60000))
    except Exception:
        count = 5000
    # Additional demo symbols may use already available local caches only.
    # No broker connection or remote download is needed by the backtester.
    source, rows = _read_cached_history(symbol, timeframe)
    if not rows:
        source, rows = _derive_history_from_lower_timeframe(symbol, timeframe, count)
    if not rows:
        return jsonify({"symbol": symbol, "timeframe": timeframe,
                        "error": "No local historical dataset is configured for this symbol.",
                        "candles": [], "source": "unavailable"}), 503

    return jsonify({
        "symbol": symbol,
        "timeframe": timeframe,
        "source": source,
        "candles": rows[-count:],
        "years_requested": 3,
    })


# ---------------------------------------------------------------- trades

@app.route('/api/trades/record', methods=['POST'])
def save_trade_record():
    payload = request.get_json(silent=True) or {}
    if not isinstance(payload, dict) or not isinstance(payload.get('trade'), dict):
        return jsonify({'error': 'Provide a trade record.'}), 400
    with _lock:
        data = _load()
        account = _active_account(data)
        if payload.get('account_id') != account['id']:
            return jsonify({'error': 'Account changed. Reopen the editor.'}), 409
        record = payload['trade']
        old = next((t for t in account['history'] if t['id'] == payload.get('id')), None)
        if payload.get('id') is not None and old is None:
            return jsonify({'error': 'Trade not found.'}), 404
        merged = {**(old or {}), **record}
        # Reuse the import adapter's validated decimal financial calculations.
        fields = ['symbol', 'type', 'opened_at', 'closed_at', 'entry', 'exit', 'lots', 'commission', 'swap', 'sl', 'tp', 'strategy', 'notes', 'tags']
        stream = io.StringIO()
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        row = {key: merged.get(key, '') for key in fields}
        if not isinstance(row['tags'], (list, str)):
            return jsonify({'error': 'Tags must be text or a list.'}), 400
        if isinstance(row['tags'], list):
            row['tags'] = '|'.join(str(t) for t in row['tags'])
        writer.writerow(row)
        try:
            parsed = parse_trades(stream.getvalue(), [], CONTRACT_SIZE)
        except ValueError as error:
            return jsonify({'error': str(error)}), 400
        if parsed['errors'] or not parsed['trades']:
            return jsonify({'error': parsed['errors'][0]['error'] if parsed['errors'] else 'Invalid trade.'}), 400
        trade = parsed['trades'][0]
        trade.update(id=old['id'] if old else _next_id(account), reason=(old or {}).get('reason', 'MANUAL_RECORD'))
        account['balance'] += trade['pnl'] - (old['pnl'] if old else 0)
        if old:
            old.update(trade)
        else:
            account['history'].append(trade)
        _save(data)
        return jsonify({'ok': True, 'trade': trade})


@app.route('/api/trades/archive', methods=['POST'])
def archive_trade_record():
    payload = request.get_json(silent=True) or {}
    if not isinstance(payload, dict):
        return jsonify({'error': 'Invalid request.'}), 400
    with _lock:
        data = _load()
        account = _active_account(data)
        if payload.get('account_id') != account['id']:
            return jsonify({'error': 'Account changed. Reload trades.'}), 409
        archived = account.setdefault('deleted_trades', [])
        restoring = payload.get('restore') is True
        source, target = (archived, account['history']) if restoring else (account['history'], archived)
        trade = next((t for t in source if t['id'] == payload.get('id')), None)
        if not trade:
            return jsonify({'error': 'Trade not found.'}), 404
        source.remove(trade)
        target.append(trade)
        account['balance'] += trade['pnl'] * (1 if restoring else -1)
        _save(data)
        return jsonify({'ok': True})

@app.route('/api/trades/import', methods=['POST'])
def import_trades():
    payload = request.get_json(silent=True) or {}
    if not isinstance(payload, dict) or not isinstance(payload.get('csv'), str) or not isinstance(payload.get('mapping', {}), dict):
        return jsonify({'error': 'Provide CSV text and an optional column mapping.'}), 400
    with _lock:
        data = _load()
        account = _active_account(data)
        if payload.get('account_id') != account['id']:
            return jsonify({'error': 'Account changed. Preview this import again.'}), 409
        try:
            if payload.get('inspect') is True:
                return jsonify({**inspect_columns(payload['csv']), 'account_id': account['id']})
            report = parse_trades(payload['csv'], account['history'] + account['active_trades'], CONTRACT_SIZE, payload.get('mapping'))
        except (ValueError, csv.Error) as error:
            return jsonify({'error': str(error)}), 400
        summary = {k: v for k, v in report.items() if k != 'trades'}
        summary.update(valid=len(report['trades']), preview=report['trades'][:20], imported=0,
                       timezone='UTC for timestamps without an offset', quantity_unit='lots',
                       account_id=account['id'])
        if payload.get('commit') is True:
            if report['errors']:
                return jsonify({**summary, 'error': 'Fix all invalid rows before importing. Nothing was saved.'}), 422
            next_id = _next_id(account)
            for offset, trade in enumerate(report['trades']):
                trade['id'] = next_id + offset
                account['history'].append(trade)
            account['balance'] += sum(t['pnl'] for t in report['trades'])
            if report['trades']:
                _save(data)
            summary['imported'] = len(report['trades'])
        return jsonify(summary)

@app.route("/api/trades/open", methods=["POST"])
def open_trade():
    payload = request.get_json(force=True) or {}
    required = ["symbol", "type", "entry", "lots"]
    if not all(k in payload for k in required):
        return jsonify({"error": "missing fields"}), 400

    with _lock:
        data = _load()
        account = _active_account(data)
        trade = {
            "id": _next_id(account),
            "symbol": payload["symbol"],
            "type": payload["type"],
            "entry": float(payload["entry"]),
            "lots": float(payload["lots"]),
            "sl": payload.get("sl"),
            "tp": payload.get("tp"),
            "floating_pnl": 0.0,
            "opened_at": payload.get("opened_at", datetime.now(timezone.utc).isoformat()),
        }
        account["active_trades"].append(trade)
        _save(data)
        return jsonify(trade)


@app.route('/api/trades/review', methods=['POST'])
def review_trade():
    payload = request.get_json(silent=True) or {}
    if not isinstance(payload, dict):
        return jsonify({'error': 'Invalid trade review.'}), 400
    notes, strategy, tags = payload.get('notes', ''), payload.get('strategy', ''), payload.get('tags', [])
    if not isinstance(notes, str) or len(notes) > 50000 or not isinstance(strategy, str) or len(strategy) > 200 or not isinstance(tags, list) or len(tags) > 50 or any(not isinstance(t, str) or len(t) > 100 for t in tags):
        return jsonify({'error': 'Invalid notes, strategy or tags.'}), 400
    with _lock:
        data = _load()
        account = _active_account(data)
        if payload.get('account_id') != account['id']:
            return jsonify({'error': 'Account changed. Reopen this trade.'}), 409
        trade = next((t for t in account['history'] + account['active_trades'] if t['id'] == payload.get('id')), None)
        if not trade:
            return jsonify({'error': 'Trade not found.'}), 404
        trade.update(notes=notes, strategy=strategy.strip(), tags=list(dict.fromkeys(t.strip() for t in tags if t.strip())))
        _save(data)
        return jsonify({'ok': True, 'trade': trade})


@app.route("/api/trades/close", methods=["POST"])
def close_trade():
    payload = request.get_json(force=True) or {}
    trade_id = payload.get("id")
    exit_price = payload.get("exit")
    reason = payload.get("reason", "MANUAL")

    if trade_id is None or exit_price is None:
        return jsonify({"error": "missing fields"}), 400

    with _lock:
        data = _load()
        account = _active_account(data)
        idx = next((i for i, t in enumerate(account["active_trades"]) if t["id"] == trade_id), None)
        if idx is None:
            return jsonify({"error": "trade not found"}), 404

        t = account["active_trades"].pop(idx)
        exit_price = float(exit_price)
        contract_size = _contract_size(t["symbol"])

        if t["type"] == "BUY":
            pnl = (exit_price - t["entry"]) * t["lots"] * contract_size
        else:
            pnl = (t["entry"] - exit_price) * t["lots"] * contract_size

        account["balance"] += pnl

        record = {
            "id": t["id"],
            "symbol": t["symbol"],
            "type": t["type"],
            "entry": t["entry"],
            "exit": exit_price,
            "lots": t["lots"],
            "pnl": pnl,
            "result": "WIN" if pnl > 0 else "LOSS",
            "reason": reason,
            "sl": t.get("sl"), "tp": t.get("tp"),
            "commission": t.get("commission", 0), "swap": t.get("swap", 0),
            "opened_at": t.get("opened_at"),
            "closed_at": payload.get("closed_at") or datetime.now(timezone.utc).isoformat(),
        }
        account["history"].append(record)
        _save(data)
        return jsonify(record)


@app.route("/api/trades/pending", methods=["POST"])
def create_pending_order():
    payload = request.get_json(force=True) or {}
    required = ["symbol", "type", "order_type", "entry", "lots"]
    if not all(k in payload for k in required) or str(payload.get("order_type")).lower() not in ("limit", "stop"):
        return jsonify({"error": "missing or invalid pending order fields"}), 400
    with _lock:
        data = _load()
        account = _active_account(data)
        order = {
            "id": _next_id(account),
            "symbol": str(payload["symbol"]).upper(),
            "type": str(payload["type"]).upper(),
            "order_type": str(payload["order_type"]).lower(),
            "entry": float(payload["entry"]),
            "lots": float(payload["lots"]),
            "sl": payload.get("sl"),
            "tp": payload.get("tp"),
            "created_at": payload.get("created_at") or datetime.now(timezone.utc).isoformat(),
        }
        account.setdefault("pending_orders", []).append(order)
        _save(data)
        return jsonify(order)


@app.route('/api/trades/pending/cancel-all', methods=['POST'])
def cancel_pending_orders():
    with _lock:
        data = _load()
        account = _active_account(data)
        count = len(account.get('pending_orders', []))
        account['pending_orders'] = []
        _save(data)
        return jsonify(ok=True, cancelled=count)


@app.route('/api/trades/protection', methods=['POST'])
def update_trade_protection():
    import math
    payload = request.get_json(force=True) or {}
    with _lock:
        data = _load()
        account = _active_account(data)
        if payload.get('account_id') != account['id']:
            return jsonify(error='Account changed. Reload the position.'), 409
        trade = next((t for t in account['active_trades'] if t['id'] == payload.get('id')), None)
        if not trade:
            return jsonify(error='Position is no longer open.'), 404
        try:
            mark = float(payload['mark'])
            levels = {k: None if payload.get(k) is None else float(payload[k]) for k in ('sl', 'tp')}
            if not math.isfinite(mark) or mark <= 0:
                raise ValueError()
            for key, price in levels.items():
                if price is None:
                    continue
                below = (trade['type'] == 'BUY') == (key == 'sl')
                if not math.isfinite(price) or price <= 0 or (price >= mark if below else price <= mark):
                    raise ValueError()
        except (ValueError, TypeError, KeyError):
            return jsonify(error='SL and TP must be positive and on the correct side of the current execution price.'), 400
        trade.update(levels)
        _save(data)
        return jsonify(trade)


@app.route("/api/trades/update", methods=["POST"])
def update_floating():
    """Bulk-update floating PnL / auto-close on SL or TP hit, given latest price ticks."""
    payload = request.get_json(force=True) or {}
    ticks = payload.get("ticks", {})  # {symbol: {high, low, close}}

    closed = []
    with _lock:
        data = _load()
        account = _active_account(data)
        # Trigger limit/stop orders from the current completed candle. The
        # order is then evaluated by the same SL/TP engine as a market trade.
        pending = []
        for order in account.get("pending_orders", []):
            tick = ticks.get(order["symbol"])
            if not tick:
                pending.append(order)
                continue
            high, low = float(tick.get("high", tick.get("close", 0))), float(tick.get("low", tick.get("close", 0)))
            entry = float(order["entry"])
            side = order["type"]
            kind = order["order_type"]
            triggered = (side == "BUY" and ((kind == "limit" and low <= entry) or (kind == "stop" and high >= entry))) or (side == "SELL" and ((kind == "limit" and high >= entry) or (kind == "stop" and low <= entry)))
            if triggered:
                account["active_trades"].append({
                    "id": order["id"], "symbol": order["symbol"], "type": side,
                    "entry": entry, "lots": order["lots"], "sl": order.get("sl"), "tp": order.get("tp"),
                    "floating_pnl": 0.0, "opened_at": datetime.fromtimestamp((tick.get("time") or int(datetime.now(timezone.utc).timestamp() * 1000)) / 1000, tz=timezone.utc).isoformat(),
                })
            else:
                pending.append(order)
        account["pending_orders"] = pending
        still_open = []
        for t in account["active_trades"]:
            tick = ticks.get(t["symbol"])
            if not tick:
                still_open.append(t)
                continue

            contract_size = _contract_size(t["symbol"])
            # Evaluate only a candle completed after entry, never its pre-entry range.
            if tick.get("time") is not None and t.get("opened_at"):
                opened = datetime.fromisoformat(t["opened_at"].replace("Z", "+00:00"))
                opened_ms = opened.replace(tzinfo=opened.tzinfo or timezone.utc).timestamp() * 1000
                if tick["time"] < opened_ms:
                    still_open.append(t)
                    continue
            quote = tick.get("bid" if t["type"] == "BUY" else "ask") or tick
            high, low, close = quote["high"], quote["low"], quote["close"]

            if t["type"] == "BUY":
                t["floating_pnl"] = (close - t["entry"]) * t["lots"] * contract_size
                hit_sl = t["sl"] and low <= t["sl"]
                hit_tp = t["tp"] and high >= t["tp"]
            else:
                t["floating_pnl"] = (t["entry"] - close) * t["lots"] * contract_size
                hit_sl = t["sl"] and high >= t["sl"]
                hit_tp = t["tp"] and low <= t["tp"]

            if hit_sl or hit_tp:
                exit_price = t["sl"] if hit_sl else t["tp"]
                contract_size = _contract_size(t["symbol"])
                if t["type"] == "BUY":
                    pnl = (exit_price - t["entry"]) * t["lots"] * contract_size
                else:
                    pnl = (t["entry"] - exit_price) * t["lots"] * contract_size
                account["balance"] += pnl
                record = {
                    "id": t["id"], "symbol": t["symbol"], "type": t["type"],
                    "entry": t["entry"], "exit": exit_price, "lots": t["lots"],
                    "pnl": pnl, "result": "WIN" if pnl > 0 else "LOSS",
                    "reason": "SL" if hit_sl else "TP",
                    "sl": t.get("sl"), "tp": t.get("tp"),
                    "commission": t.get("commission", 0), "swap": t.get("swap", 0),
                    "opened_at": t.get("opened_at"),
                    "closed_at": datetime.fromtimestamp(tick["closed_time"] / 1000, tz=timezone.utc).isoformat() if tick.get("closed_time") else datetime.now(timezone.utc).isoformat(),
                }
                account["history"].append(record)
                closed.append(record)
            else:
                still_open.append(t)

        account["active_trades"] = still_open
        _save(data)
        return jsonify({"active_trades": account["active_trades"], "closed": closed, "balance": account["balance"]})


def _next_id(data):
    ids = [t['id'] for group in ('active_trades', 'history', 'deleted_trades') for t in data.get(group, [])]
    return (max(ids) + 1) if ids else 1


# ---------------------------------------------------------------- journal

@app.route("/api/journal", methods=["GET"])
def get_journal():
    with _lock:
        data = _load()
        return jsonify(_active_account(data)["journal"])


@app.route("/api/journal", methods=["POST"])
def add_journal():
    payload = request.get_json(force=True) or {}
    with _lock:
        data = _load()
        account = _active_account(data)
        entry = {
            "id": (max([j["id"] for j in account["journal"]], default=0) + 1),
            "trade_id": payload.get("trade_id"),
            "title": payload.get("title", "Untitled entry"),
            "note": payload.get("note", ""),
            "mood": payload.get("mood", "neutral"),
            "tags": payload.get("tags", []),
            "emotion": payload.get("emotion", payload.get("mood", "neutral")),
            "strategy": payload.get("strategy", ""),
            "session": payload.get("session", ""),
            "confidence": payload.get("confidence", 0),
            "execution_rating": payload.get("execution_rating", 0),
            "trade_rating": payload.get("trade_rating", 0),
            "risk_reward": payload.get("risk_reward", ""),
            "market_condition": payload.get("market_condition", ""),
            "lesson": payload.get("lesson", ""),
            "mistake": payload.get("mistake", ""),
            "checklist": payload.get("checklist", {}),
            "screenshots": payload.get("screenshots", []),
            "attachments": payload.get("attachments", []),
            "timeline": payload.get("timeline", []),
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        account["journal"].insert(0, entry)
        _save(data)
        return jsonify(entry)


@app.route("/api/journal/<int:entry_id>", methods=["DELETE"])
def delete_journal(entry_id):
    with _lock:
        data = _load()
        account = _active_account(data)
        account["journal"] = [j for j in account["journal"] if j["id"] != entry_id]
        _save(data)
        return jsonify({"ok": True})


# ---------------------------------------------------------------- export

EXPORT_COLUMNS = ["id", "symbol", "type", "entry", "exit", "lots", "pnl", "result", "reason", "opened_at", "closed_at"]


def _trade_rows(account):
    return [{col: trade.get(col, "") for col in EXPORT_COLUMNS} for trade in account.get("history", [])]


@app.route("/api/export/trades.csv", methods=["GET"])
def export_trades_csv():
    with _lock:
        data = _load()
        account = _active_account(data)
        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=EXPORT_COLUMNS)
        writer.writeheader()
        writer.writerows(_trade_rows(account))
        filename = f"{account['name'].replace(' ', '_')}_trades.csv"
        return Response(output.getvalue(), mimetype="text/csv", headers={"Content-Disposition": f"attachment; filename={filename}"})


def _xlsx_cell(ref, value):
    value = "" if value is None else str(value)
    escaped = value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return f'<c r="{ref}" t="inlineStr"><is><t>{escaped}</t></is></c>'


@app.route("/api/export/trades.xlsx", methods=["GET"])
def export_trades_xlsx():
    with _lock:
        data = _load()
        account = _active_account(data)
        rows = [EXPORT_COLUMNS] + [[row[col] for col in EXPORT_COLUMNS] for row in _trade_rows(account)]
        sheet_rows = []
        for r_idx, row in enumerate(rows, start=1):
            cells = []
            for c_idx, value in enumerate(row):
                col = chr(ord("A") + c_idx)
                cells.append(_xlsx_cell(f"{col}{r_idx}", value))
            sheet_rows.append(f'<row r="{r_idx}">{"".join(cells)}</row>')
        sheet_xml = f'<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>{"".join(sheet_rows)}</sheetData></worksheet>'
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>')
            z.writestr("_rels/.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
            z.writestr("xl/workbook.xml", '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Trades" sheetId="1" r:id="rId1"/></sheets></workbook>')
            z.writestr("xl/_rels/workbook.xml.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
            z.writestr("xl/worksheets/sheet1.xml", sheet_xml)
        filename = f"{account['name'].replace(' ', '_')}_trades.xlsx"
        return Response(output.getvalue(), mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": f"attachment; filename={filename}"})


# ---------------------------------------------------------------- reset

@app.route("/api/reset", methods=["POST"])
def reset_all():
    with _lock:
        _save(json.loads(json.dumps(DEFAULT_STATE)))
        return jsonify({"ok": True})


if __name__ == "__main__":
    app.run(host=os.environ.get('HOST', '127.0.0.1'), port=int(os.environ.get('PORT', '5050')), debug=False)
