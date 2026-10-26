import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from backend import app as backend


class PropPracticeWorkspaceTests(unittest.TestCase):
    def test_ledgers_orders_protection_and_phases_are_isolated(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(backend, 'DATA_FILE', str(Path(folder) / 'state.json')):
            client = backend.app.test_client()
            normal = client.get('/api/state').get_json()
            headers = {'X-Practice-Id': 'round-one-phase-1', 'X-Practice-Owner': normal['id']}
            self.assertEqual(client.get('/api/state', headers=headers).status_code, 404)
            result = client.post('/api/prop-practice', headers=headers, json={'model': 'standard', 'balance': 5000})
            self.assertEqual(result.status_code, 200)
            practice = result.get_json()
            self.assertEqual(practice['balance'], 5000)
            self.assertEqual(practice['settings']['symbol'], 'XAUUSD')
            trade = client.post('/api/trades/open', headers=headers, json=dict(symbol='XAUUSD', type='BUY', entry=2000, lots=.1, opened_at='2026-01-01T09:00:00Z')).get_json()
            self.assertEqual(client.post('/api/trades/protection', headers=headers, json=dict(account_id=practice['id'], id=trade['id'], sl=1990, tp=2020, mark=2000)).status_code, 200)
            tick = dict(time=1767258060000, closed_time=1767258120000, open=2000, high=2021, low=2000, close=2020)
            closed = client.post('/api/trades/update', headers=headers, json={'ticks': {'XAUUSD': tick}}).get_json()['closed']
            self.assertEqual(closed[0]['reason'], 'TP')
            saved = client.get('/api/state', headers=headers).get_json()
            self.assertEqual(saved['balance'], 5200)
            self.assertEqual(len(saved['history']), 1)
            self.assertEqual(client.post('/api/settings', headers=headers, json={'timeframe': '4h', 'replay_timestamp': 123}).status_code, 200)
            # Reinitialization is idempotent and cannot wipe a returning phase.
            restored = client.post('/api/prop-practice', headers=headers, json={'model': 'standard', 'balance': 5000}).get_json()
            self.assertEqual(restored['balance'], 5200)
            self.assertEqual(restored['settings']['timeframe'], '4h')
            second = {**headers, 'X-Practice-Id': 'round-one-phase-2'}
            phase2 = client.post('/api/prop-practice', headers=second, json={'model': 'standard', 'balance': 5000}).get_json()
            self.assertEqual(phase2['balance'], 5000)
            self.assertEqual(phase2['history'], [])
            # Normal settings, trades and initial balance are untouched.
            normal_after = client.get('/api/state').get_json()
            self.assertEqual(normal_after['balance'], normal['balance'])
            self.assertEqual(normal_after['history'], [])
            self.assertEqual(normal_after['settings'], normal['settings'])
            self.assertNotIn('prop_practice', normal_after)
            self.assertEqual(client.post('/api/trades/open', headers=headers, json=dict(symbol='EURUSD', type='BUY', entry=1, lots=.1)).status_code, 400)
            self.assertEqual(client.get('/api/state', headers={**headers, 'X-Practice-Owner': 'wrong'}).status_code, 409)
            self.assertEqual(client.post('/api/accounts/reset', headers=headers).status_code, 400)
            pending = dict(symbol='XAUUSD', type='SELL', order_type='limit', entry=2030, lots=.1)
            self.assertEqual(client.post('/api/trades/pending', headers=headers, json=pending).status_code, 200)
            self.assertEqual(client.post('/api/trades/pending/cancel-all', headers=headers).get_json()['cancelled'], 1)
            self.assertEqual(client.get('/api/state', headers=headers).get_json()['pending_orders'], [])


if __name__ == '__main__':
    unittest.main()

