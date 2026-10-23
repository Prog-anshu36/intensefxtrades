# Chart workspace review — 5 October 2026

## Reference workflows

Reviewed TradingView's official drawing-tool guide and Bar Replay guide, and TradeFXBook's public product page. Public documentation establishes interaction conventions; it does not expose either product's proprietary implementation or TradeFXBook's authenticated workspace.

- https://www.tradingview.com/support/solutions/43000703396-drawing-tools-available-on-tradingview/
- https://www.tradingview.com/support/solutions/43000474024-how-do-i-turn-bar-replay-on/
- https://www.tradefxbook.com/

Useful conventions: categorized tools, explicit anchor creation, independently editable objects, magnet snapping, single-use versus persistent drawing mode, undo/redo, and a historical replay cursor. TradeFXBook describes symbol/timeframe/date selection and candle-by-candle historical replay. Our order ticket must use the replay candle, even though TradingView documents that some of its quote panels continue displaying realtime prices in Bar Replay.

## Existing architecture

The app uses plain JavaScript and a custom layered Canvas2D chart, not React or TradingView's chart engine. `page_backtesting.js` coordinates the chart camera, data windows, rendering, replay, and order ticket. The existing DrawingEngine contains a registry, tool controller, drawing manager, history, selection, hit testing, transforms, properties, and magnet snapping. CoordinateManager converts timestamp/price anchors to screen positions. Drawings persist in localStorage. Trading state and journal use the existing backend APIs and store.

XAUUSD history comes from the existing local CSV provider through bounded market-history queries. This change does not replace the data provider, backend trading model, or journal. Candle timestamps are milliseconds; drawing anchors remain timestamp/price values. Empty future chart space represents projected time coordinates, not fabricated candles.

## Findings and corrections

| Area | Finding | Correction |
|---|---|---|
| Drag creation | Chart pointer-down returned before retaining the pointer, preventing the release handler from reaching tools | Complete down/move/up path, including pointer cancellation |
| Freehand | Hover movement could paint before the mouse was pressed | Require an active transient pointer for brush/highlighter movement |
| Click/drag distinction | Two-anchor tools could finalize on tiny incidental motion after a click | Require at least three screen pixels for release-based completion; second-click creation still works |
| Position tools | Initial horizontal extent was clamped to the final loaded candle | Use the existing CoordinateManager's projected timestamp conversion |
| Tool search | Search activated tools differently from the toolbar | Reuse `selectTool` and its persistent-mode/state handling |
| History controls | Toolbar buttons retained disabled states from initial rendering | Refresh availability from actual drawing history |
| Fullscreen | Watchlist and long replay panel pushed orders offscreen | Hide market browsing panels in fullscreen, put execution ticket first, retain replay dock and bounded position area |
| Replay execution | Non-local forward jumps evaluated only the destination bar | Evaluate every intervening bar; existing local CSV path already does so |
| Order/replay concurrency | Replay could advance during an order submission | Hold replay advancement while submission is active |
| Fullscreen Escape | Separate exit implementation could disagree with fullscreen state | Route unhandled Escape through the shared fullscreen toggle |

Removed the temporary Test Line button from the production toolbar; actual line tools remain available. Notifications remain disabled as requested.

## Validation

All 20 JavaScript suites pass, including actual chart pointer-listener integration and chronological replay execution tests. The Flask app was started successfully. A live 4H request returned 100 XAUUSD candles with `source: local-csv`.

Live browser checks: XAUUSD daily data rendered; fullscreen remained active when selecting a tool; Buy/Sell and SL/TP controls became immediately visible; rectangle drag creation, body movement, corner resizing, and toolbar undo worked. The temporary rectangle was removed through undo. The screenshot `chart-workspace-verified.png` records the resize test, not a user-created permanent object. No trades were submitted during browser QA.

## Remaining limits

This is not complete TradingView feature parity. Automated tests exercise all registered creation workflows, but every advanced shape has not been individually verified in the browser. Reference-site authenticated features were not inspected. Bid/ask is unavailable in the inspected dataset, so execution remains the existing OHLC model. OHLC bars cannot establish whether SL or TP was touched first within a candle. Rewinding a chart is not a rollback of persisted trading-account history. These require separate execution-model work rather than cosmetic chart changes.

## Video-reference order workflow (October 5)
Observed the second supplied video at 18:30: chart-first workspace, compact market/pending ticket, absolute SL/TP prices, confirmation/cancel, and replay controls. Implemented Buy/Sell preview with replay paused, exact stop/target inputs, live R:R, confirmation/cancel, inline validation, and replay-context rejection. Existing execution API and local CSV source remain in use. Browser verified XAUUSD daily at 4889.48 with SL 4880 and TP 4908.44 => 1:2.00; no trade submitted to the user account. Fullscreen preview verified; screenshot order-preview-verified.png. All 20 JavaScript suites and 7 CSV tests passed. Full video parity is incomplete: draft chart-level dragging, complete reference feature inventory, and all-tool visual acceptance remain outstanding. These are not represented as completed.

