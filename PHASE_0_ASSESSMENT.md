# Phase 0 implementation assessment

The app uses Flask and plain JavaScript, with a custom Canvas 2D chart in
`page_backtesting.js`. There is no React or external chart library on this page.
The existing engine is suitable and will be retained.

- Data: `xauusd_data_provider.py` recursively discovers CSV files under the
  project-relative `XAUUSD_Data` or `TRADEFXBOOK_DATA_DIR`, normalizes and deduplicates
  rows into a SQLite index, and serves bounded API queries. Existing native
  timeframes are preferred; missing frames are aggregated on the backend.
- Candles: `{time, open, high, low, close, volume}`, with Unix milliseconds;
  the frontend additionally carries a Date object and optional bid/ask OHLC.
- Timeframes: shared minute-duration map, including 1m, 3m, 5m, 15m, 30m,
  1h, 4h, 1d. Local replay selects completed candles using their real timestamps.
- Price scale: visible high/low bounds, padding, vertical zoom and price offset.
- Camera: fractional logical start, cursor-anchored animated wheel zoom,
  pointer/touch pan, wheel pan, inertia and a separate replay pointer.
- Backtesting: chronological candle steps, paged local history, replay clock,
  hidden future candles and backend trade/SL/TP evaluation.
- State: shared Store synced with Flask; chart camera and replay state live on
  PageBacktesting. User/accounts/trades/journal/settings persist in backend JSON;
  drawings, workspace preferences and replay bookmarks also use localStorage.
- Existing drawings: coordinate manager and timestamp/price anchors, selection,
  history, snapping and rendering already exist. No new tools are in this phase.
- Layout: existing toolbar, drawing rail, chart, axes, settings and dark chart.
- Gaps: crosshair movement currently invokes full scene rendering; candle,
  drawing and interaction paint share a canvas; coordinate formulas are repeated;
  crosshair has price badge and OHLC tooltip but no bottom-axis time badge.

Phase 1 will reuse the coordinate manager, split rendering into scene/drawing/
interaction canvases, remove full-dataset copying in chart-window calculation,
and validate alignment across camera and size changes. Existing tools and UI
remain available without implementing or expanding advanced tools.

## Phase 1 validation

- Added separate drawing and interaction canvas layers. Pointer-only crosshair
  updates reuse the last rendered camera frame; the drawing renderer can request
  a drawing-only paint. Camera/replay changes repaint the scene and all layers.
- Reused CoordinateManager for price transforms and pointer index conversion.
  Opt-in continuous timestamp interpolation supports gaps and future margin;
  existing drawing consumers retain their established candle snapping.
- Added crosshair time-axis badge, bounded responsive chart width and resize
  observer cleanup. Resize clears a stale hover so the next pointer position is
  calculated against the new container geometry.
- All 15 JavaScript test files passed; 7 Python tests passed. Foundation tests
  cover precise timestamp/price round trips, gaps, future margin, zoom in/out,
  pan, resize, seven required timeframes, and immutable candle timestamps.
- Live browser: XAUUSD local CSV chart, crosshair OHLC/volume, zoom controls,
  5m switch, visible right price axis at 1280px viewport; no browser errors.
- Remaining validation: wheel/touch gestures and physical monitor/DPI changes
  have not been manually exercised. This phase does not certify the correctness
  of existing advanced indicators/tools or execution logic.
