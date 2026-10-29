import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from flask import Flask, session

from backend.prop_challenge_engine import HistoricalChallengeStore, register_historical_challenge_routes


DAY_MS = 86_400_000


class FakeProvider:
    def __init__(self):
        self.first = int(datetime(2020, 1, 1, tzinfo=timezone.utc).timestamp() * 1000)
        self.last = int(datetime(2026, 12, 31, tzinfo=timezone.utc).timestamp() * 1000)

    def info(self):
        return {"source": "local-csv", "timeframes": {"1m": {"first_timestamp": self.first, "last_timestamp": self.last}}}

    def history(self, timeframe, start=None, end=None, limit=5000, anchor=None):
        start = self.first if start is None else int(start)
        candle_time = ((start + DAY_MS - 1) // DAY_MS) * DAY_MS
        if end is not None and candle_time > int(end):
            return {"candles": []}
        return {"candles": [{"time": candle_time, "open": 2000, "high": 2001, "low": 1999, "close": 2000, "volume": 1}]}


class HistoricalChallengeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.provider = FakeProvider()
        self.store = HistoricalChallengeStore(Path(self.temp.name) / "challenges.sqlite3", self.provider)
        self.app = Flask(__name__)
        self.app.secret_key = "test"
        register_historical_challenge_routes(self.app, self.provider)
        self.client = self.app.test_client()

    def tearDown(self):
        self.temp.cleanup()

    def create_as(self, owner="owner-a"):
        with self.app.test_request_context():
            session["user_id"] = owner
            return self.store.create({"model": "standard", "starting_balance": 5000})

    def test_assignment_is_historical_month_in_four_to_five_year_window(self):
        item = self.create_as()
        start = datetime.fromisoformat(item["assigned_start"])
        now = datetime.now(timezone.utc)
        months = (now.year - start.year) * 12 + now.month - start.month
        self.assertGreaterEqual(months, 48)
        self.assertLessEqual(months, 60)
        self.assertEqual(item["status"], "active")

    def test_new_challenge_gets_a_different_month(self):
        first = self.create_as()
        second = self.create_as()
        self.assertNotEqual(first["assigned_start"][:7], second["assigned_start"][:7])

    def test_owner_isolation_uses_session_identity_not_header(self):
        item = self.create_as("owner-a")
        with self.client.session_transaction() as sess:
            sess["user_id"] = "owner-b"
        response = self.client.get("/api/prop-challenge/" + item["id"], headers={"X-Practice-Owner": "owner-a"})
        self.assertEqual(response.status_code, 404)

    def test_only_one_candle_is_revealed_and_cursor_moves_forward(self):
        item = self.create_as()
        with self.app.test_request_context():
            session["user_id"] = "owner-a"
            before = datetime.fromisoformat(item["cursor"]).timestamp()
            batch = self.store.next_candle(item["id"])
            self.assertEqual(len(self.store.recent_candles(item["id"], 120)), 1)
        self.assertIsNotNone(batch["new_candle"])
        self.assertGreater(datetime.fromisoformat(batch["cursor"]).timestamp(), before)

    def test_challenge_fails_after_fifteen_trading_days(self):
        item = self.create_as()
        with self.app.test_request_context():
            session["user_id"] = "owner-a"
            result = None
            for _ in range(16):
                result = self.store.next_candle(item["id"])
                if result["status"] != "active":
                    break
        self.assertEqual(result["status"], "failed")
        self.assertIn("15 trading days", result["breach_reason"])

    def test_market_order_and_close_use_only_revealed_price(self):
        item = self.create_as()
        with self.app.test_request_context():
            session["user_id"] = "owner-a"
            self.store.next_candle(item["id"])
            opened = self.store.place_order(item["id"], {"side": "buy", "lots": 0.01})
            self.assertEqual(opened["position"]["entry"], 2000)
            closed = self.store.close_position(item["id"])
            self.assertIsNone(closed["position"])
            self.assertEqual(len(closed["trades"]), 1)

    def test_unsupported_model_and_balance_rejected(self):
        with self.app.test_request_context():
            session["user_id"] = "owner-a"
            with self.assertRaises(ValueError):
                self.store.create({"model": "bogus", "starting_balance": 5000})
            with self.assertRaises(ValueError):
                self.store.create({"model": "standard", "starting_balance": 200000})


if __name__ == "__main__":
    unittest.main()
