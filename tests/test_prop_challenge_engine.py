import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from flask import Flask
from backend.prop_challenge_engine import HistoricalChallengeStore, register_historical_challenge_routes

class FakeProvider:
    def __init__(self):
        self.first = int(datetime(2020, 1, 1, tzinfo=timezone.utc).timestamp()*1000)
        self.last = int(datetime(2026, 12, 31, tzinfo=timezone.utc).timestamp()*1000)
    def info(self):
        return {"source":"local-csv","timeframes":{"1m":{"first_timestamp":self.first,"last_timestamp":self.last}}}
    def history(self, timeframe, start=None, end=None, limit=5000, anchor=None):
        start = self.first if start is None else start
        if end is not None and start > end: return {"candles":[]}
        return {"candles":[{"time":start,"open":2000,"high":2001,"low":1999,"close":2000,"volume":1}]}

class HistoricalChallengeTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.provider=FakeProvider()
        self.store=HistoricalChallengeStore(Path(self.temp.name)/"challenges.sqlite3",self.provider)
        self.app=Flask(__name__); self.app.secret_key="test"
        register_historical_challenge_routes(self.app,self.provider)
        self.client=self.app.test_client()
    def tearDown(self): self.temp.cleanup()
    def create_as(self, owner="owner-a"):
        with self.app.test_request_context(headers={"X-Practice-Owner":owner}):
            return self.store.create({"model":"standard","starting_balance":5000})
    def test_assignment_is_historical_month_in_four_to_five_year_window(self):
        with self.app.test_request_context(headers={"X-Practice-Owner":"owner-a"}):
            item=self.store.create({"model":"standard","starting_balance":5000})
        start=datetime.fromisoformat(item["assigned_start"])
        now=datetime.now(timezone.utc)
        months=(now.year-start.year)*12+now.month-start.month
        self.assertGreaterEqual(months,48); self.assertLessEqual(months,60)
        self.assertEqual(item["status"],"active")
    def test_owner_isolation(self):
        item=self.create_as()
        response=self.client.get("/api/prop-challenge/"+item["id"],headers={"X-Practice-Owner":"owner-b"})
        self.assertEqual(response.status_code,404)
    def test_candle_cursor_only_moves_forward(self):
        with self.app.test_request_context(headers={"X-Practice-Owner":"owner-a"}):
            item=self.store.create({"model":"standard","starting_balance":5000})
            before=datetime.fromisoformat(item["cursor"]).timestamp()
            batch=self.store.candles(item["id"],10)
        self.assertEqual(len(batch["candles"]),1)
        self.assertGreater(datetime.fromisoformat(batch["cursor"]).timestamp(),before)
    def test_unsupported_model_rejected(self):
        with self.app.test_request_context(headers={"X-Practice-Owner":"owner-a"}):
            with self.assertRaises(ValueError): self.store.create({"model":"bogus","starting_balance":5000})
    def test_unsupported_balance_rejected(self):
        with self.app.test_request_context(headers={"X-Practice-Owner":"owner-a"}):
            with self.assertRaises(ValueError): self.store.create({"model":"standard","starting_balance":200000})

if __name__ == "__main__": unittest.main()
