# Prop-firm completion and validation

Implemented account rename, reversible archive/restore, search, model/status/phase/archive filters, and chart account switching. Archive preserves all records and refuses accounts with open positions or pending orders.

New Standard rounds support 3% or 5% daily loss and 0 or 3 minimum trading days. Rules are captured per account and retained through Phase 2. Legacy accounts keep their prior rule profile. New Pro rounds have no minimum trading days.

Selected-account analytics include an independently defined practice radar score, balance/equity and loss allowances, daily calendar with monthly navigation and weekly totals, biggest win/loss, average trade, profit factor, SL usage, planned R:R, long/short/overall profitability, duration quartile plots and scatter plots, instrument summaries, date filters, open-position/history tabs and paginated trading records. The score formula is disclosed in the interface; it does not claim to reproduce a provider's private rating algorithm. Data comes from each account's real simulated ledger.

Closed trades now retain SL, TP, commission and swap fields. Existing missing fields remain unavailable; historical protection levels are not fabricated.

## Validation executed
- 60 registered drawing tools across 1m, 5m, 15m, 30m, 1h, 4h and 1d: 420 automated real-CSV cases. Covers creation, renderer invocation, screen/data alignment on zoom/pan/resize, moving body and anchors, opacity/style editing, lock/unlock, hide/show, duplicate, serialization, delete and undo/redo.
- 31 relevant JavaScript suites passed, including pointer routing, selection, snapping, transforms, drawing lifecycle, positions, history, chart performance, account isolation, replay, order synchronization and prop-account tests.
- Python practice-ledger and trade-protection tests: 2 passed.
- Assets-only static Pages build completed.
- The exact chart source prepared from current GitHub main passed the 420-case matrix and seven additional chart/order/replay/performance suites.
- Browser QA used disposable state and an isolated test Elite entitlement. Created a Standard 3%/0-day account, renamed it, archived/restored it, searched accounts, opened its chart, loaded all seven timeframes, placed and closed a simulated trade, and confirmed the closed trade appeared in analytics. No runtime errors were observed in that run.

## Practical limits
Automated tests exercise all registered tools and coordinate transformations; they do not prove every possible pointer gesture or browser/device combination. Provider spreads, private scoring and execution parity are not claimed. Auth/payment setup is outside this prop-firm update. QA account data and test entitlement overrides are not published.

Responsive follow-up: verified phone viewport 390×844 with a 64px navigation rail and 326px usable content width; tablet/phone viewport checks performed. Prop routes retain a bounded scrolling app shell.
