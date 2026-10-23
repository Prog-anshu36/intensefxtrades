# TradeFXBook drawing-tool research and implementation status

## Existing architecture

The app uses layered Canvas2D rendering. Flask and the existing SQLite-indexed local XAUUSD CSV provider supply bounded candle windows. Candles contain millisecond timestamps and OHLCV. The existing CoordinateManager maps timestamp/price anchors to the current chart camera. DrawingManager, ToolController, TransformEngine, HitTestEngine, PropertyEngine and command history are reused. Drawings persist in localStorage; account, journal and settings persist through the backend. No second chart or market-data provider was added.

## Reference research

The official tool index was inspected: https://www.tradingview.com/support/folders/43000547459/

Specific reviewed references:
- Crossline: https://www.tradingview.com/support/solutions/43000477747-crossline-drawing-tool/
- ABCD: https://www.tradingview.com/support/solutions/43000570202-abcd-pattern-drawing-tool/
- Arc: https://www.tradingview.com/support/solutions/43000516989-arc-drawing-tool/
- Trendline: https://www.tradingview.com/support/solutions/43000518095-trendline-drawing-tool/
- Fibonacci: https://www.tradingview.com/support/solutions/43000518158-fibonacci-retracement-drawing-tool/
- Position: https://www.tradingview.com/support/solutions/43000517002-long-position-drawing-tool/
- Channel: https://www.tradingview.com/support/solutions/43000518117-parallel-channel-drawing-tool/
- Callout: https://www.tradingview.com/support/solutions/43000516978-callout-drawing-tool/

Crossline is a placed one-anchor object, distinct from the moving crosshair. ABCD has four separately editable price/time anchors and three legs. Fibonacci requires more than a fixed list of lines: level visibility, color, label and fill controls are separate behaviors. These distinctions guide the implementation. This is not an exhaustive individual review of every tool in the official index.

## Changes in this pass

- Added a persistent one-click Crossline with price/time labels and line hit testing.
- Fixed selection along the extended portions of rays and extended lines.
- Added ABCD, XABCD and six-point Elliott impulse annotations using the generic anchor lifecycle. Labels, price-leg distances and adjacent price-leg ratios update during edits. No automatic harmonic validity or market structure is inferred.
- Replaced the fixed half-ellipse Arc with a three-anchor quadratic curve (start, end, curvature). Rendering and curved-path hit testing use the same projected anchors.
- Added searchable original TradeFXBook tool help with creation, editing, cancellation, history and coordinate instructions, plus buttons to activate actual registered tools.
- Added an optional Objects button. The drawing collection is still absent by default; it appears only when requested.

Changed files: frontend/static/js/drawing/drawing-engine.js, hit-test-engine.js, frontend/static/js/page_backtesting.js, frontend/static/css/pages.css, frontend/templates/index.html, tests/chart_tools_csv.test.js.

## QA

18 JavaScript suites and 7 backend tests pass. CSV-based tests cover every registered creation workflow, coordinate round trips after camera and size changes, numeric anchor edits, history and persistence. Additional checks verify rendered pattern labels/ratios, independent arc curvature, and selection on the curve. Existing selection, position, transform, snapping and property tests pass. Full browser acceptance of this latest pass is not completed: navigation to the external reference site timed out. The public documentation was read using the web tool instead.

## Outstanding phases and limitations

The complete requested A–L program is not finished. Remaining work includes Fibonacci per-level appearance/fills, time-zone/spiral tools, more faithful callout geometry, captured real-candle Bar Pattern, Head & Shoulders/Cypher-specific calculations, position sizing settings, configurable shortcut UI, path point insertion/removal, brush simplification, per-workspace persistence isolation, and full manual acceptance across all requested timeframes. Existing older two-anchor arcs keep their prior stored anchors and need migration for three-anchor curvature editing. Elliott/XABCD are manual labelled patterns, not validated wave/harmonic detectors. No fake buttons were added for missing tools.
