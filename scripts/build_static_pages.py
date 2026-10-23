"""Build the complete browser-only GitHub Pages app from real indexed CSV data."""
import argparse
from contextlib import closing
import gzip
import hashlib
import json
from pathlib import Path
import shutil
import sqlite3
import struct
import sys

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from backend.xauusd_data_provider import LocalXAUUSDDataProvider


def export_history(provider,output,chunk_size=5000):
    info=provider.info()
    output=Path(output);output.mkdir(parents=True,exist_ok=True)
    manifest={'version':1,'info':info,'timeframes':{}}
    with closing(sqlite3.connect(provider.db)) as db:
        for tf,frame in info['timeframes'].items():
            sides=[s for s in ('bid','ask') if s in frame['sides']]
            sql='SELECT c.time,c.open,c.high,c.low,c.close,c.volume'
            for side in sides: sql+=f',{side}.open,{side}.high,{side}.low,{side}.close,{side}.volume'
            sql+=' FROM candles c'
            for side in sides: sql+=f' LEFT JOIN candles {side} ON {side}.tf=c.tf AND {side}.side=\'{side}\' AND {side}.time=c.time'
            sql+=' WHERE c.tf=? AND c.side=? ORDER BY c.time'
            cursor=db.execute(sql,(tf,frame['price_side']))
            record=struct.Struct('<'+'d'*(6+5*len(sides)))
            chunks=[];offset=0
            for number in range(1000000):
                rows=cursor.fetchmany(chunk_size)
                if not rows: break
                raw=b''.join(record.pack(*(float('nan') if value is None else value for value in row)) for row in rows)
                payload=gzip.compress(raw,compresslevel=6,mtime=0)
                sha=hashlib.sha256(payload).hexdigest()
                # Windows paths are case-insensitive: 1m and 1M must never share a directory.
                directory='month-1' if tf=='1M' else tf
                name=f'{directory}/{number:05d}-{sha[:12]}.bin.gz'
                path=output/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(payload)
                chunks.append({'path':name,'offset':offset,'rows':len(rows),'first':rows[0][0],'last':rows[-1][0],'sha256':sha})
                offset+=len(rows)
            if offset!=frame['rows']: raise ValueError('Export count differs from real CSV index')
            manifest['timeframes'][tf]={'stride':record.size//8,'sides':sides,'rows':offset,'chunks':chunks}
            print(f'{tf}: {offset:,} real candles, {len(chunks)} bounded chunks',flush=True)
    (output/'manifest.json').write_text(json.dumps(manifest,separators=(',',':')),encoding='utf-8')
    return manifest


def build(output=ROOT/'_site',provider=None,assets_only=False):
    output=Path(output);output.mkdir(parents=True,exist_ok=True)
    shutil.copytree(ROOT/'frontend/static',output/'static',dirs_exist_ok=True)
    text=(ROOT/'frontend/templates/index.html').read_text(encoding='utf-8').replace('"/static/','"./static/')
    version=hashlib.sha256(b''.join((ROOT/'frontend/static/js'/name).read_bytes() for name in ('pages-bridge.js','pages-worker.js','pages-history.js'))).hexdigest()[:12]
    text=text.replace('<script src="./static/js/api.js', f'<script src="./static/js/pages-bridge.js?v={version}"></script>\n<script src="./static/js/api.js',1)
    text=text.replace('<title>intensefxTRADES</title>','<title>intensefxTRADES</title>\n<meta name="description" content="Free real-CSV XAUUSD backtesting. Trades and journals are saved on this device.">')
    (output/'index.html').write_text(text,encoding='utf-8')
    (output/'.nojekyll').write_text('',encoding='utf-8')
    python=output/'python/backend';python.mkdir(parents=True,exist_ok=True)
    for name in ('app.py','trade_importer.py','xauusd_data_provider.py'):
        shutil.copy2(ROOT/'backend'/name,python/name)
    shutil.copy2(ROOT/'frontend/pages-runtime.py',output/'python/pages_runtime.py')
    if not assets_only: export_history(provider or LocalXAUUSDDataProvider(),output/'history')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',default=str(ROOT/'_site'))
    parser.add_argument('--assets-only',action='store_true')
    args=parser.parse_args()
    build(args.output,assets_only=args.assets_only)
