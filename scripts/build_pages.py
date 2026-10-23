"""Build the GitHub Pages entry link for the full hosted Flask application."""
import argparse
import html
import json
from pathlib import Path
from urllib.parse import urlsplit


def build(url, output):
    parsed = urlsplit(url)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError('Use the public HTTPS application URL without credentials, query, or fragment.')
    if parsed.hostname in ('localhost','127.0.0.1','0.0.0.0'):
        raise ValueError('A local development URL cannot be shared publicly.')
    target = url.rstrip('/') + '/'
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    script_target = json.dumps(target).replace('<', '\\u003c')
    (output/'index.html').write_text(f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>intensefxTRADES</title><link rel="canonical" href="{html.escape(target, quote=True)}">
<meta name="robots" content="noindex"><meta name="referrer" content="no-referrer">
<style>body{{background:#0b0e11;color:#d1d4dc;font:16px system-ui;display:grid;place-content:center;min-height:95vh}}a{{color:#72a5ff}}</style>
</head><body><main><h1>intensefxTRADES</h1><p>Opening the trading application…</p>
<p><a href="{html.escape(target, quote=True)}">Open intensefxTRADES</a></p></main>
<script>window.location.replace({script_target});</script></body></html>''', encoding='utf-8')
    (output/'.nojekyll').write_text('', encoding='utf-8')
    return target


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app-url', required=True)
    parser.add_argument('--output', default='_site')
    args=parser.parse_args()
    print('Built GitHub Pages entry for ' + build(args.app_url,args.output))
