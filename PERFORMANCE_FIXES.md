# Chart loading and responsiveness fixes

The main confirmed expensive path was intraday session enumeration across the much longer visible date ranges of 4H/daily charts. Each session repeatedly constructed Intl timezone formatters; the session cache existed but was not used. Formatter validity and formatter instances are now reused, session definitions are cached with bounded storage, and changing session configuration invalidates that cache. Returned sessions are cloned to protect cached values from editing.

Intraday session overlays are omitted on 4H and higher timeframes because these candles cannot supply accurate intraday session OHLC. The session navigator remains available. Intraday overlays continue on smaller timeframes.

History requests now have a 30-second timeout, identical concurrent requests share a single fetch, and toolbar loading no longer waits for a settings write. All timeframe buttons use the same switching method. A delegated click handler is removed before rebinding rather than accumulating during rerenders. Cleanup invalidates stale history responses.

Changed application files: frontend/static/js/session-engine.js, page_backtesting.js, marketdata.js, api.js and frontend/templates/index.html. Added tests/chart_performance.test.js; extended tests/marketdata_local.test.js.

Validation: 18 JavaScript suites and 7 backend tests pass. The new regression verifies hundreds of sessions reuse fewer than ten new formatters, repeated requests reuse formatters, session settings invalidate caches, and higher-timeframe chart overlays do not enumerate intraday sessions. Concurrent history callers share one request while receiving isolated candle objects.

Live checks: XAUUSD daily and 4H charts render actual local CSV candles; zoom and switching back to 1m work, with no captured browser console errors. Backend 5,000-candle requests measured 31 ms for 4H and 29 ms for daily on this machine with the existing index. These timings are backend requests, not total browser load times. The backend stopped during the repeated-switch test; restarting python backend/app.py restored service, and the checks were repeated successfully.

These changes address verified chart bottlenecks, not a guarantee of zero lag everywhere in the app. A missing backend or initial CSV index rebuild still prevents immediate loading; requests now surface an error rather than waiting indefinitely. Real XAUUSD CSV loading and candle values are unchanged.
