import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from backend import app as backend


class ProtectionTests(unittest.TestCase):
    def test_edit_protection_and_execute(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(backend, 'DATA_FILE', str(Path(folder) / 'state.json')):
            client = backend.app.test_client()
            state = client.get('/api/state').get_json()
            for side in ('BUY', 'SELL'):
                trade = client.post('/api/trades/open', json=dict(symbol='XAUUSD', type=side, entry=2650, lots=.1, opened_at='2025-01-01T09:00:00Z')).get_json()
                sl, tp = (2640, 2670) if side == 'BUY' else (2660, 2630)
                payload = dict(account_id=state['id'], id=trade['id'], sl=sl, tp=tp, mark=2650)
                self.assertEqual(client.post('/api/trades/protection', json={**payload, 'account_id':'wrong'}).status_code, 409)
                self.assertEqual(client.post('/api/trades/protection', json={**payload, 'sl':tp}).status_code, 400)
                self.assertEqual(client.post('/api/trades/protection', json={**payload, 'tp':float('inf')}).status_code, 400)
                self.assertEqual(client.post('/api/trades/protection', json=payload).status_code, 200)
                saved = client.get('/api/state').get_json()['active_trades'][-1]
                self.assertEqual((saved['sl'],saved['tp'],saved['entry']), (sl,tp,2650))
                tick = dict(time=1735722600000, high=max(2650,tp), low=min(2650,tp), close=tp)
                client.post('/api/trades/update', json={'ticks':{'XAUUSD':tick}})
                self.assertFalse(client.get('/api/state').get_json()['active_trades'])
                self.assertEqual(client.post('/api/trades/protection', json=payload).status_code,404)


if __name__ == '__main__':
    unittest.main()
