# Historical Prop Firm Session

The Prop Firm Session now uses a dedicated historical challenge flow. Local Flask runs use the SQLite-backed Python engine; the browser-only GitHub Pages edition uses a matching worker engine backed by the real bounded history reader and device-local IndexedDB. Ordinary Backtesting and its replay engine are not changed by this feature.

## Challenge rules and market feed

- Each new challenge is assigned a random, previously unused XAUUSD month from 48–60 months before the current UTC month, based on the project's local XAUUSD 1-minute dataset.
- The assigned dataset stays attached to that challenge. A different challenge for the same owner receives a different eligible month; creation fails if no unused eligible month remains.
- The server reveals exactly one next candle per market request and persists only candles that have already been revealed. The Prop Firm Session UI has no rewind, seek, candle-jump, or speed controls; its market advances automatically at a fixed rate.
- The challenge-wide limit is 15 unique historical trading days. Attempting to reveal a 16th trading day fails the challenge. If the assigned month ends before the challenge passes, it fails.
- The existing Standard / Pro targets, daily loss, maximum loss, and minimum actual trading-day rules are checked by the challenge engine. On a hosted Flask deployment these checks run in the backend; on GitHub Pages they run in the browser worker because the public edition has no hosted server. Risk checks include the adverse high/low of each revealed candle.
- Only one XAUUSD position may be open at a time. Orders use the last revealed candle's close; the server validates lot size, stop loss, and take profit, evaluates stop/target hits, records closed trades, and calculates simulated P/L using 100 oz per lot.
- Phase 2 continues through the same assigned historical month. The 15-trading-day challenge limit does not reset.
- Challenge records and revealed candles are persisted in SQLite. Local Flask challenge ownership uses the authenticated Flask session (or configured single-owner Basic Auth), not a client-supplied owner header. GitHub Pages challenges are isolated by the browser profile's user/device scope and stay on that device.

## API

- `GET /api/prop-challenge/coverage` — inspect local XAUUSD data coverage.
- `GET /api/prop-challenge` — list the authenticated owner's challenges.
- `POST /api/prop-challenge` with `{"model":"standard","starting_balance":5000}` — create a challenge and assign its historical month.
- `GET /api/prop-challenge/<id>` — read challenge state.
- `GET /api/prop-challenge/<id>/candles?limit=120` — read only previously revealed candles for chart restoration.
- `POST /api/prop-challenge/<id>/next-candle` — reveal the next single candle and enforce trading-day/risk rules.
- `POST /api/prop-challenge/<id>/order` with side/lots/optional stop_loss/take_profit — open a simulated position at the latest revealed price.
- `POST /api/prop-challenge/<id>/close` — close the open position at the latest revealed price.
- `POST /api/prop-challenge/<id>/advance-phase` — advance from a server-validated Phase 1 pass to Phase 2.

The engine uses the local data provider only. It does not synthesize prices or substitute external feeds. If the required historical month is unavailable, challenge creation fails rather than fabricating a dataset.

## Scope

The new UI is loaded only for the Prop Firm Session route. The ordinary Backtesting page and its replay controls remain unchanged. The existing Prop Practice Chart and analysis routes are not replaced by this historical challenge UI.

This is a simulated evaluation, not a real prop-firm account or certification. GitHub Pages is a browser-only practice environment: its static historical dataset and client-side state are not a tamper-proof prop-firm security boundary. The local Flask deployment uses the SQLite backend and requires its local XAUUSD CSV data.
