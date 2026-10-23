# FXN - Asian Session Range

JavaScript port of the Pine v4 source supplied by the user, attributed to RobMinty.
Source is preserved in `reference-indicators/FXN-Asian-Session-Range.pine`.

Enable from the chart Indicators selector or the FXN toggle. FXN ⚙ exposes the
source inputs: session times, styles, colors, widths, labels, range displays,
ADR, previous day/week, developing current week, and high/low timestamps.
Preferences use localStorage `tfb_fxn_asian_range_v1`. Volume remains independent.

Default sessions use America/New_York with automatic date-specific DST:
Asia 20:00–02:00, London 03:00–07:00, New York 08:00–12:00.
Asia levels extend to 11:30 New York time. Fixed EST (Etc/GMT+5) remains
selectable in FXN settings. Existing settings without a timezone migrate to
America/New_York. Tick-size-based ranges
use the symbol's quoted precision; forex pips use ten ticks, as in the source.
The independent Canvas renderer uses the existing chart time/price projector.
It incrementally indexes only the replay prefix and rebuilds when rewinding.

Intentional differences and limitations:

- No Pine runtime or broker feed is embedded. This is a JavaScript implementation
  of the supplied source, not a TradingView-hosted instance.
- Pine's lookahead_on current-week final values are replaced with developing
  values from revealed candles. ADR uses completed days only, never future data.
- Daily/weekly OHLC depends on a broker's daily boundary. CSV files do not encode
  that metadata: default is UTC midnight with Monday weeks. Configure daily UTC
  offset and boundary hour to match the comparison feed. Prices can still differ
  between a local CSV and the reference broker.
- No unseen data is downloaded. A partially loaded first session/day/week is
  omitted; ADR requires its full configured lookback (21 completed days by default).
- Overlays are suppressed at 2H and above, matching the supplied resolution gates
  for supported app timeframes. No intraday range is invented on 4H/Daily.
- Historical range-break conditions produce chart labels, not popup notifications.
  External alert delivery is not implemented.
- Historical session boxes remain available in the loaded chart window rather
  than reproducing Pine's delete-and-recreate object lifecycle and object limits.
- ADR recency uses the replay clock rather than the actual wall clock.
- Canvas font metrics and fill geometry may differ from Pine's plot/fill rendering.

Tests: `node tests/fxn_asian_session_range.test.js` covers source defaults,
overnight boundaries, custom times, replay/rewind isolation, ADR lookback,
rendered labels/fills, timeframe suppression, partial data, and real CSV highs/lows.
