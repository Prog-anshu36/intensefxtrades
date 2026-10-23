import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from backend.trade_importer import parse_trades
from backend import app as backend

HEADER = 'symbol,direction,entry_time,exit_time,entry_price,exit_price,quantity,commission,swap,stop_loss,take_profit,notes,tags\n'
ROW = 'XAUUSD,BUY,2025-01-01T09:00:00Z,2025-01-01T10:00:00Z,2650,2660,0.5,2,-1,2645,2670,review,A+|NY\n'

class ImportTests(unittest.TestCase):
    def test_manual_edit_delete_restore_accounting(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(backend, 'DATA_FILE', str(Path(folder) / 'state.json')):
            client = backend.app.test_client()
            state = client.get('/api/state').get_json()
            payload = {'account_id': state['id'], 'trade': {'symbol':'XAUUSD','type':'BUY','opened_at':'2025-01-01T09:00Z','closed_at':'2025-01-01T10:00Z','entry':2650,'exit':2660,'lots':0.5,'commission':2,'swap':-1,'sl':2645,'tp':2670,'notes':'keep notes','tags':['NY']}}
            saved = client.post('/api/trades/record', json=payload)
            self.assertEqual(saved.status_code, 200)
            trade = saved.get_json()['trade']
            self.assertEqual(trade['pnl'], 497)
            updated = client.post('/api/trades/record', json={'account_id':state['id'],'id':trade['id'],'trade':{'exit':2662}})
            self.assertEqual(updated.get_json()['trade']['pnl'], 597)
            self.assertEqual(updated.get_json()['trade']['notes'], 'keep notes')
            self.assertEqual(client.get('/api/state').get_json()['balance'], state['balance']+597)
            key = {'account_id':state['id'],'id':trade['id']}
            self.assertEqual(client.post('/api/trades/archive', json=key).status_code, 200)
            archived = client.get('/api/state').get_json()
            self.assertEqual(archived['balance'],state['balance'])
            self.assertEqual(len(archived['deleted_trades']),1)
            second = client.post('/api/trades/record',json=payload).get_json()['trade']
            self.assertNotEqual(second['id'],trade['id'])
            self.assertEqual(client.post('/api/trades/archive',json={**key,'restore':True}).status_code,200)
            self.assertEqual(client.get('/api/state').get_json()['balance'],state['balance']+1094)
            self.assertEqual(client.post('/api/trades/archive',json={**key,'restore':True}).status_code,404)
            self.assertEqual(client.post('/api/trades/record',json={**payload,'account_id':'wrong'}).status_code,409)
            self.assertEqual(client.post('/api/trades/record',json={**payload,'trade':{**payload['trade'],'lots':-1}}).status_code,400)

    def test_financials_timezone_and_duplicates(self):
        report = parse_trades(HEADER + ROW + ROW, [], backend.CONTRACT_SIZE)
        trade = report['trades'][0]
        self.assertEqual(trade['gross_pnl'], 500)
        self.assertEqual(trade['pnl'], 497)
        self.assertEqual(trade['risk'], 250)
        self.assertEqual(trade['r_multiple'], 1.988)
        self.assertEqual(trade['duration_seconds'], 3600)
        self.assertEqual(report['duplicates'], 1)
        self.assertEqual(parse_trades(HEADER + ROW, [trade], backend.CONTRACT_SIZE)['duplicates'], 1)

    def test_validation(self):
        for row in (ROW.replace('0.5,2', '-1,2'), ROW.replace('2650,2660', 'NaN,2660'),
                    ROW.replace('10:00:00Z', '08:00:00Z'), ROW.replace('2645,2670', '2655,2670')):
            result = parse_trades(HEADER + row, [], backend.CONTRACT_SIZE)
            self.assertEqual(len(result['errors']), 1)
            self.assertFalse(result['trades'])

    def test_account_persistence_atomicity_and_1000_rows(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(backend, 'DATA_FILE', str(Path(folder) / 'state.json')):
            client = backend.app.test_client()
            state = client.get('/api/state').get_json()
            account = state['id']
            text = HEADER + ''.join(ROW.replace('2650,2660', f'{2650+i / 100},{2660+i / 100}').replace('2645,2670', '2600,2800') for i in range(1000))
            payload = {'csv': text, 'account_id': account}
            preview = client.post('/api/trades/import', json=payload)
            self.assertEqual(preview.status_code, 200)
            self.assertEqual(preview.get_json()['valid'], 1000)
            self.assertEqual(len(client.get('/api/state').get_json()['history']), 0)
            commit = client.post('/api/trades/import', json={**payload, 'commit': True})
            self.assertEqual(commit.get_json()['imported'], 1000)
            saved = client.get('/api/state').get_json()
            self.assertEqual(len(saved['history']), 1000)
            self.assertAlmostEqual(saved['balance'], state['balance'] + 497000)
            again = client.post('/api/trades/import', json={**payload, 'commit': True}).get_json()
            self.assertEqual(again['imported'], 0)
            self.assertEqual(again['duplicates'], 1000)
            self.assertEqual(client.post('/api/trades/import', json={**payload, 'account_id': 'wrong'}).status_code, 409)
            invalid = client.post('/api/trades/import', json={'account_id': account, 'csv': HEADER + ROW.replace('2650', 'NaN'), 'commit': True})
            self.assertEqual(invalid.status_code, 422)
            self.assertEqual(len(client.get('/api/state').get_json()['history']), 1000)
            trade_id = saved['history'][0]['id']
            review = client.post('/api/trades/review', json={'account_id': account, 'id': trade_id, 'notes': 'Followed my plan', 'strategy': 'NY', 'tags': ['A+', 'A+']})
            self.assertEqual(review.status_code, 200)
            refreshed = client.get('/api/state').get_json()['history'][0]
            self.assertEqual(refreshed['notes'], 'Followed my plan')
            self.assertEqual(refreshed['tags'], ['A+'])
            self.assertEqual(client.post('/api/trades/review', json={'account_id': 'wrong', 'id': trade_id}).status_code, 409)

if __name__ == '__main__':
    unittest.main()
