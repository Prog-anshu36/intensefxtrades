# Historical prop challenge engine (initial backend layer)

This branch introduces a server-side API for assigning historical XAUUSD months and serving candles through a monotonic cursor.

## API

All challenge endpoints require an `X-Practice-Owner` header and scope records to that value.

- `GET /api/prop-challenge/coverage` — inspect locally indexed XAUUSD data coverage.
- `POST /api/prop-challenge` with `{"model":"standard","starting_balance":5000}` — assign an eligible random month from 48–60 months before the current UTC month.
- `GET /api/prop-challenge/<id>` — fetch assignment/progress metadata.
- `GET /api/prop-challenge/<id>/candles?limit=500` — request the next candles. The cursor advances server-side; clients cannot request a different start time or rewind it.
- `POST /api/prop-challenge/<id>/trading-day` with `{"market_time": <milliseconds>}` — record a day only inside the already revealed timeline.
- `POST /api/prop-challenge/<id>/result` with `{"passed": true|false}` — advance phase or close the attempt.

The engine uses only the project's local XAUUSD 1-minute data provider. If no complete month exists in the requested historical window, creation fails rather than generating synthetic prices.

## Important integration status

This is the backend foundation, not yet the complete locked-challenge user experience. The existing Prop Firm UI/chart is not yet switched over to consume this API, and the existing browser-side challenge evaluator remains in place. Until that client integration and server-authoritative order/risk ledger are implemented and tested, do not treat challenge outcomes as tamper-proof or as a live prop-firm certification.

For a public/hosted multi-user deployment, replace the current `X-Practice-Owner` value with an owner ID derived from verified authentication (for example, the validated Supabase subject); a client-supplied owner header alone is not an authentication boundary. The application-level owner-password gate should also be configured for hosted deployments.
