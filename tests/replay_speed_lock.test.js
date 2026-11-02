/* Locked replay-speed presets must not work: a click on a locked preset leaves
 * the speed unchanged, saved/restored speeds are clamped to the plan cap, the
 * slider cannot be dragged past the cap and the play loop re-enforces it. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const toasts = [];
const sandbox = {
  structuredClone, console,
  Store: { state: { history: [], active_trades: [], settings: {} } },
  API: {},
  MarketData: { SYMBOLS: { XAUUSD: {} }, isLocal: (s) => s === 'XAUUSD', getMeta: () => ({ decimals: 2 }),
    TF_MINUTES: { "1m": 1, "4h": 240 } },
  Fmt: { price: (n) => Number(n).toFixed(2) },
  toast: (m) => toasts.push(m),
  setTimeout: () => 0, clearTimeout: () => {},
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('frontend/static/js/page_backtesting.js', 'utf8'), sandbox);

const makeChart = (saved) => {
  const storage = { getItem: () => (saved ? JSON.stringify(saved) : null), setItem: () => {} };
  const chart = sandbox.createBacktestingWorkspace({ store: { state: { history: [], active_trades: [], settings: {} } },
    api: {}, storage, scope: 'speed-lock' });
  chart.symbol = 'XAUUSD';
  chart.candles = [{ time: 0, date: new Date(0) }];
  chart.idx = 0; chart.replayActive = true; chart.playing = false;
  chart.replayBookmarks = []; chart.hiddenCandles = [];
  return chart;
};
const plan = (cap) => ({
  getReplaySpeedCap: () => cap, getCandleSkipCap: () => 10, canAccessFeature: () => true,
  planForReplaySpeed: (s) => ({ name: s > 10 ? 'Golden VIP' : 'Red', tier: s > 10 ? 'Pass' : 'Elite' }),
});

// 1) cap helpers
sandbox.SubscriptionSystem = plan(10);
let chart = makeChart();
assert.equal(chart.clampReplaySpeed(100), 10, 'clamps above cap');
assert.equal(chart.clampReplaySpeed(5), 5, 'allows at/below cap');
assert.equal(chart.clampReplaySpeed(NaN), 1, 'bad value falls back to 1x');
sandbox.SubscriptionSystem = undefined;
assert.equal(makeChart().clampReplaySpeed(50), 1, 'no subscription system defaults to Blue cap');

// 2) render: locked presets flagged, slider capped
sandbox.SubscriptionSystem = plan(10);
chart = makeChart();
const panel = chart.renderReplayPanel();
const preset = (x) => new RegExp(`<button[^>]*data-replay-speed="${x}"[^>]*>`).exec(panel)[0];
for (const x of [20, 50, 100]) assert.ok(/aria-disabled="true"/.test(preset(x)) && /locked/.test(preset(x)), `${x}x is locked`);
for (const x of [5, 10]) assert.ok(!/aria-disabled/.test(preset(x)) && !/locked/.test(preset(x)), `${x}x is unlocked`);
assert.ok(/id="speedSlider"[^>]*max="100"/.test(panel), 'slider max follows plan cap (10x -> 100)');

// 3) restore paths are clamped
sandbox.SubscriptionSystem = plan(2);
chart = makeChart({ symbol: 'XAUUSD', speed: 100 });
chart.loadReplayStorage();
assert.equal(chart.speed, 2, 'saved 100x restored as 2x on a 2x plan');

// 4) notify leaves speed alone and explains
sandbox.SubscriptionSystem = plan(10);
chart = makeChart(); chart.speed = 5; toasts.length = 0;
chart.notifyReplaySpeedLocked(100);
assert.equal(chart.speed, 5, 'speed unchanged');
assert.ok(/Golden VIP/.test(toasts[0]) && /stays at 5x/.test(toasts[0]), 'toast explains the lock');

// 5) play loop re-enforces the cap
sandbox.SubscriptionSystem = plan(1);
chart = makeChart(); chart.speed = 100; chart.playing = true; chart.step = async () => {};
chart.startReplayLoop();
assert.equal(chart.speed, 1, 'play loop clamps a stale high speed');
chart.playing = false; chart.playLoopToken++;

console.log('replay_speed_lock.test.js passed');
