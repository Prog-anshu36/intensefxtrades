/* "Next NY"/"Previous NY" (and Asia/London) must actually move to the next or
 * previous session, not silently re-select the session you're already on.
 * Bug: right after a jump, the replay candle sits on the floor candle BEFORE
 * the session's real start, so `current.start <= ts` was false and the
 * exclusion for "today's own session" never applied — "Next" kept landing
 * back on the same day. See jumpRelativeSession() in page_backtesting.js. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const sandbox = {
  structuredClone, console,
  Store: { state: { history: [], active_trades: [], settings: {} } },
  API: {},
  MarketData: { SYMBOLS: { XAUUSD: {} }, isLocal: (s) => s === 'XAUUSD', getMeta: () => ({ decimals: 2 }),
    TF_MINUTES: { '1m': 1, '3m': 3, '5m': 5, '15m': 15, '30m': 30, '1h': 60, '4h': 240, '1d': 1440, '1w': 10080, '1M': 43200 } },
  Fmt: { price: (n) => Number(n).toFixed(2) },
  toast: () => {},
  UI: { showToast() {} },
  document: { querySelector: () => null, getElementById: () => null },
  SubscriptionSystem: { canAccessFeature: () => true, getCandleSkipCap: () => 10, requestUpgrade: () => {}, getPermittedReplayRange: () => ({ start: 0, end: Date.now() }) },
  setTimeout, clearTimeout, requestAnimationFrame: () => 0,
  CustomEvent: class { constructor(type, detail) { this.type = type; Object.assign(this, detail); } },
};
sandbox.window = sandbox;
sandbox.window.dispatchEvent = () => {};
sandbox.window.addEventListener = () => {};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('frontend/static/js/session-engine.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync('frontend/static/js/fxn-asian-session-range.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync('frontend/static/js/page_backtesting.js', 'utf8'), sandbox);

const storageStub = { getItem: () => null, setItem: () => {} };
const chart = sandbox.createBacktestingWorkspace({
  store: { state: { history: [], active_trades: [], settings: {} } },
  api: { updateSettings: () => Promise.resolve({}) }, storage: storageStub, scope: 'nav-1', allowedSymbols: ['XAUUSD'],
  propFirmMode: false,
});
chart.symbol = 'XAUUSD';
chart.timeframe = '4h';
chart.updateReplayChrome = () => {};
chart.fxnIndicator = new sandbox.window.FXNAsianSessionRange({ enabled: true });
chart.sessionEngine = new sandbox.window.IntenseSessions.SessionEngine({ config: {} });
chart.saveSessionSettings = () => {};
chart.syncNewYorkSession();

const fourHour = 4 * 3600000;
const start = Date.UTC(2023, 6, 1);
const candles = [];
for (let t = start; t < Date.UTC(2023, 8, 15); t += fourHour) candles.push({ time: t, date: new Date(t), open: 1, high: 1, low: 1, close: 1 });
chart.candles = candles;
chart.replayActive = true;
chart.container = { querySelector: (sel) => sel === '#sessionSelectInput' ? { value: 'new-york' } : sel === '#sessionDateInput' ? { value: '2023-08-01' } : null };
chart.sessionNavigator = { selectedSessionType: 'new-york', date: '2023-08-01' };

const dayOf = () => new Date(chart.candles[chart.idx].time).toISOString().slice(0, 10);

chart.jumpToSelectedSession();
assert.equal(dayOf(), '2023-08-01', 'GO TO NY lands on the selected date');

chart.jumpRelativeSession(1);
assert.equal(dayOf(), '2023-08-02', 'Next NY actually advances to the next session, not the same one');

chart.jumpRelativeSession(1);
assert.equal(dayOf(), '2023-08-03', 'Next NY again keeps advancing');

chart.jumpRelativeSession(-1);
assert.equal(dayOf(), '2023-08-02', 'Previous NY steps back one session');

chart.jumpRelativeSession(-1);
assert.equal(dayOf(), '2023-08-01', 'Previous NY again steps back another session');

console.log('session_navigator_next_prev.test.js passed');
