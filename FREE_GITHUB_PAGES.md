# Free browser edition

The full application runs on GitHub Pages without Render or a hosted backend.
GitHub Actions builds the existing frontend and exports the real CSV index into
bounded compressed binary chunks. Select GitHub Actions as the Pages source.

The existing chart, drawings, indicators, replay, orders, journal and analytics
are reused. A module Web Worker runs the actual Flask business routes through
Pyodide's Python WebAssembly runtime and Flask's in-process request client.
There is no server socket or paid hosting service.

History uses binary searches and an eight-chunk LRU cache. Each file contains at
most 5,000 real candles and is SHA-256 verified. The complete multi-year dataset
is never loaded into browser memory. Available bid/ask data and original prices
are preserved; derived intervals use the existing provider.

## Visitor data and sign-in

Trades/accounts/journal are saved in IndexedDB on this device/browser, scoped to
this site. Drawings/settings use localStorage. When Supabase is configured,
email/Google authentication is handled by Supabase and browser workspaces and
`tfb_` preferences are isolated by the signed-in user's ID. Trading data still
stays in that browser and is not synced to Supabase or another device. Without
Supabase configuration, the app continues in device-local mode and does not
show a fake login. Download backups using the sidebar. Clearing browser site
data or using private browsing can remove data. Screenshot attachments remain
subject to browser storage quotas.

Authentication setup and the profile/Blue-plan migration are documented in
`SUPABASE_AUTH_SETUP.md`. This does not add cloud trade sync, paid-plan
authorization, payment processing, or protected market-data delivery.

Requests are serialized; Web Locks coordinate tabs where supported. Storage
write failures are reported and the failed state change is rolled back.

The first visit loads pinned Pyodide and Python packages from public package
sources, then only required chart chunks. HTTP caching speeds later visits.
This is not guaranteed to work entirely offline. Modern workers, WebAssembly,
IndexedDB and DecompressionStream are required. XAUUSD/GOLD uses the real
supplied dataset; other existing demo symbols remain demo fixtures. No XAUUSD
synthetic or network-provider fallback is introduced.

SL/TP keeps the existing OHLC rules: when both are touched, stop-loss wins;
intrabar tick order is not invented. Bid/ask is used when supplied, otherwise
execution uses OHLC. Future candles are not used for replay execution.

## Build and test

```
python -m pip install -r requirements.txt
python scripts/dataset_package.py restore
python scripts/build_static_pages.py
node tests/pages_history.test.js
python -m http.server 8080 --directory _site
```

Open http://localhost:8080. WASM integration test:

```
npm install --prefix deployment-check --no-save pyodide@314.0.7
node tests/browser_python_runtime.cjs
```

The Pages workflow publishes on pushes to main. It creates no paid resource.
Render configuration files are optional legacy alternatives, unused here.
