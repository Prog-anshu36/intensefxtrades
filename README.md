# intensefxTRADES

The free website runs directly on GitHub Pages using a browser Python worker,
bounded real-CSV history and device-local persistence. See
[FREE_GITHUB_PAGES.md](FREE_GITHUB_PAGES.md). No Render account or paid backend is
required. Local Flask development remains available as documented below.

A full rebuild of your trading replay/journal tool, restyled to match the
intensefxTRADES reference screenshots: dark, card-based UI with a Dashboard,
Performance Analytics, Trade Analysis, a Trade Journal, and the original
chart/replay/order screen — now called Backtesting.

## Stack

- **Backend:** Flask (Python). Stores your account balance, open/closed
  trades, and journal entries in `backend/store.json`, so everything
  survives a restart.
- **Frontend:** Plain HTML/CSS/JS (no build step). XAUUSD historical candles
  come from the project CSV folder. Other instruments retain their existing
  market-data behavior.

## Setup

```bash
cd tradefxbook
pip install -r requirements.txt
python backend/app.py
```

Then open **http://127.0.0.1:5050** in your browser.

### Local XAUUSD history

Place CSV files anywhere under `XAUUSD_Data/` at the project root. The
provider discovers files recursively, indexes them in SQLite under
`backend/market_cache/`, removes duplicate candle timestamps, and returns
bounded chart windows. Set `TRADEFXBOOK_DATA_DIR` to override the data folder;
relative override paths are resolved from the project root. The first index of
a large dataset can take a few minutes; subsequent requests query the cached
SQLite index and periodically check the CSV file manifest for changes.

`/api/market/dataset-info?symbol=XAUUSD` reports the discovered files, real
candle counts, and timestamp range. History accepts `timeframe`, `start`,
`end`, and `limit` (or the existing `count` parameter). Unsupported intervals
are derived from lower real intervals using OHLCV aggregation. The API refuses
to upsample or fall back to generated or network XAUUSD candles. Timestamps
without an explicit zone are interpreted as UTC.

The server keeps running in your terminal; press `Ctrl+C` to stop it.
Your account state lives in `backend/store.json` — delete that file (or hit
the reset endpoint, see below) to start over with a fresh $10,000 account.

## Pages

- **Dashboard** — total/unrealized/realized P&L, win rate, an equity
  performance chart with 1D/1W/1M/3M/1Y/ALL ranges, a monthly P&L calendar,
  open positions, and top performers.
- **Trades** — all open and closed positions in one sortable list.
- **Journal** — write reflections on your trades (mood, tags, notes),
  optionally linked to a specific closed trade.
- **Analysis → Performance** — win rate, profit factor, expectancy, quick
  stats (avg winner/loser, streaks, risk:reward), and an equity curve, all
  filterable by time period and winners/losers.
- **Analysis → Trade Analysis** — the full trade log, sortable by any
  column, filterable by symbol.
- **Backtesting** — the core screen: a candlestick chart for EURUSD,
  GBPUSD, USDJPY, XAUUSD, or BTCUSD, replay controls (step, auto-play,
  speed), and an order panel (lots, take-profit/stop-loss in pips,
  market buy/sell).

XAUUSD replay uses only candles in `XAUUSD_Data` and stops at the last
available candle. This export contains OHLCV but no bid/ask quotes, so XAUUSD
entries, exits, and SL/TP checks use the existing OHLC execution model. When
paired bid/ask OHLC data is present, the provider preserves it for side-aware
execution. With OHLC alone, a bar cannot reveal whether stop loss or take
profit occurred first when both levels fall inside that bar; the existing
execution model conservatively prioritizes stop loss. Other symbols retain
their prior market-data behavior.

## API (for reference)

| Method | Path                  | Purpose                                  |
|--------|-----------------------|-------------------------------------------|
| GET    | `/api/state`          | Full account state                       |
| GET    | `/api/market/dataset-info?symbol=XAUUSD` | Local XAUUSD CSV counts and coverage |
| GET    | `/api/market/history?symbol=XAUUSD&timeframe=1m&limit=100` | Bounded local CSV candle window |
| POST   | `/api/settings`       | Update saved symbol/timeframe/etc.       |
| POST   | `/api/trades/open`    | Open a simulated position                |
| POST   | `/api/trades/close`   | Close a position at a given exit price   |
| POST   | `/api/trades/update`  | Push latest tick(s); auto-closes SL/TP   |
| GET    | `/api/journal`        | List journal entries                     |
| POST   | `/api/journal`        | Add a journal entry                      |
| DELETE | `/api/journal/<id>`   | Delete a journal entry                   |
| POST   | `/api/reset`          | Wipe everything back to a fresh account  |

## Notes / known limitations

- This is a **local single-user** tool — there's no login, and the
  "Traders Lounge", "Trade Rooms", "Leaderboard", and "Settings" nav items
  are intentionally inert placeholders (greyed out), same as the
  "Coming Soon" treatment in the reference design.
- The theme toggle currently just shows a toast — the app is dark-mode only
  for now.
- Contract sizes used for P&L math: 100,000 units/lot for FX pairs, 100
  oz/lot for XAUUSD, 1 BTC/lot for BTCUSD. Adjust `CONTRACT_SIZE` in
  `backend/app.py` if you want different conventions.
