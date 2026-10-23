"""Regression checks use values copied from the user's CSVs, never a price generator."""
import csv
import json
import os
from pathlib import Path
import tempfile
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from backend.xauusd_data_provider import LocalXAUUSDDataProvider, timestamp, timeframe_for
from backend import app as backend

ROOT = Path(__file__).resolve().parents[1]


class LocalHistoryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.provider = LocalXAUUSDDataProvider()
        cls.info = cls.provider.info()

    def test_native_csv_values_and_order(self):
        for tf in ("1m", "5m", "30m"):
            with (ROOT / "XAUUSD_Data" / f"XAU_{tf}_data.csv").open() as stream:
                reader = csv.DictReader(stream, delimiter=";")
                expected = [next(reader) for _ in range(100)]
            result = self.provider.history(tf, start=self.info["timeframes"][tf]["first_timestamp"], limit=100)
            candles = result["candles"]
            self.assertEqual(len(candles), 100)
            for source, candle in zip(expected, candles):
                self.assertEqual(candle["time"], timestamp(source["Date"]))
                for field in ("open", "high", "low", "close", "volume"):
                    self.assertEqual(candle[field], float(source[field.title()]))
            times = [c["time"] for c in candles]
            self.assertEqual(times, sorted(set(times)))
            self.assertIsNone(result["derived_from"])

    def test_aggregation_uses_real_minutes(self):
        minute = self.provider.history("1m", start="2025-01-02", end="2025-01-02", limit=10000)["candles"]
        derived = self.provider.history("3m", start="2025-01-02", end="2025-01-02", limit=10000)["candles"]
        groups = {}
        for candle in minute:
            groups.setdefault(candle["time"] // 180000 * 180000, []).append(candle)
        self.assertEqual(len(groups), len(derived))
        for candle in derived:
            rows = groups[candle["time"]]
            self.assertEqual(candle["open"], rows[0]["open"])
            self.assertEqual(candle["close"], rows[-1]["close"])
            self.assertEqual(candle["high"], max(c["high"] for c in rows))
            self.assertEqual(candle["low"], min(c["low"] for c in rows))
            self.assertEqual(candle["volume"], sum(c["volume"] for c in rows))

    def test_api_bounds_range_end_and_no_network(self):
        with patch("urllib.request.urlopen", side_effect=AssertionError("Network prohibited")):
            client = backend.app.test_client()
            response = client.get("/api/market/dataset-info?symbol=XAUUSD")
            self.assertEqual(response.status_code, 200)
            result = client.get("/api/market/history?symbol=XAUUSD&timeframe=1m&limit=100").get_json()
            self.assertEqual(len(result["candles"]), 100)
            self.assertEqual(result["source"], "local-csv")
            last = result["last_timestamp"]
            self.assertEqual(result["candles"][-1]["time"], last)
            self.assertEqual(client.get(f"/api/market/history?symbol=XAUUSD&timeframe=1m&start={last + 1}").get_json()["candles"], [])
            result = client.get("/api/market/history?symbol=XAUUSD&timeframe=1m&start=2025-01-01&end=2025-01-31&limit=10000").get_json()
            self.assertLessEqual(len(result["candles"]), 10000)
            self.assertTrue(all(timestamp("2025-01-01") <= c["time"] < timestamp("2025-02-01") for c in result["candles"]))
            self.assertEqual(client.get("/api/market/history?symbol=XAUUSD&start=bad").status_code, 400)

    def test_recursive_overlap_env_and_cache(self):
        with tempfile.TemporaryDirectory(dir=ROOT / "tests") as temp:
            root = Path(temp)
            folder = root / "data" / "nested"
            folder.mkdir(parents=True)
            with (ROOT / "XAUUSD_Data/XAU_1m_data.csv").open() as stream:
                excerpt = "".join(next(stream) for _ in range(101))
            (folder / "XAU-USD_1Minute_BID_2025-01-01.csv").write_text(excerpt)
            (folder / "overlap_M1_BID.csv").write_text(excerpt)
            with patch.dict(os.environ, {"TRADEFXBOOK_DATA_DIR": "data"}):
                provider = LocalXAUUSDDataProvider(root)
                info = provider.info()
                self.assertEqual(info["timeframes"]["1m"]["rows"], 100)
                self.assertEqual(info["timeframes"]["1m"]["files"], 2)
                self.assertEqual(info["timeframes"]["1m"]["input_rows"], 200)
                with patch.object(provider, "_ingest", side_effect=AssertionError("Re-read CSV")):
                    provider.history("1m")
                    provider.checked = 0
                    provider.info()
                self.assertIn("bid", provider.history("1m")["candles"][0])
                self.assertNotIn("ask", provider.history("1m")["candles"][0])

    def test_missing_data_fails_closed(self):
        with patch.dict(os.environ, {"TRADEFXBOOK_DATA_DIR": "tests/nonexistent_csv_directory"}):
            with patch.object(backend, "local_xauusd", LocalXAUUSDDataProvider()):
                with patch("urllib.request.urlopen", side_effect=AssertionError("Network prohibited")):
                    result = backend.app.test_client().get("/api/market/history?symbol=XAUUSD")
                    self.assertEqual(result.status_code, 503)
                    self.assertEqual(result.get_json()["candles"], [])

    def test_ambiguous_timeframe_rejected(self):
        with self.assertRaises(ValueError):
            timeframe_for(Path("unknown.csv"), [{"datetime": "2025-01-01"}])

    def test_trading_real_candles(self):
        # Isolate all trading mutations from the user's account/journal.
        rows = self.provider.history("1m", start="2025-01-02", limit=100)["candles"]
        with tempfile.TemporaryDirectory(dir=ROOT / "tests") as temp:
            with patch.object(backend, "DATA_FILE", str(Path(temp) / "store.json")):
                client = backend.app.test_client()
                entry, next_candle = rows[0], rows[1]
                for side in ("BUY", "SELL"):
                    opened = client.post("/api/trades/open", json={"symbol": "XAUUSD", "type": side, "entry": entry["close"], "lots": .01}).get_json()
                    trade = opened.get("trade", opened)
                    closed = client.post("/api/trades/close", json={"id": trade["id"], "exit": next_candle["close"], "reason": "MANUAL"}).get_json()
                    expected = (next_candle["close"] - entry["close"]) * (1 if side == "BUY" else -1)
                    self.assertAlmostEqual(closed["pnl"], expected)
                for side in ("BUY", "SELL"):
                    for reason in ("SL", "TP"):
                        threshold = next_candle["low"] if (side == "BUY") == (reason == "SL") else next_candle["high"]
                        payload = {"symbol": "XAUUSD", "type": side, "entry": entry["close"], "lots": .01, reason.lower(): threshold,
                                   "opened_at": datetime.fromtimestamp((entry["time"] + 60000) / 1000, timezone.utc).isoformat()}
                        client.post("/api/trades/open", json=payload)
                        closed = client.post("/api/trades/update", json={"ticks": {"XAUUSD": next_candle}}).get_json()["closed"]
                        self.assertEqual(closed[0]["reason"], reason)
                        self.assertEqual(closed[0]["exit"], threshold)


if __name__ == "__main__":
    unittest.main()
