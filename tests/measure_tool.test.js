/* TradingView-style Measure tool: ruler icon in the rail and a box + stats
 * bubble ("31.7 (1.34%) 317 / 40 bars, 40m / Vol …"), identically on the
 * standalone Backtesting chart and the Prop Firm practice chart. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const sandbox = {
  structuredClone, console,
  Store: { state: { history: [], active_trades: [], settings: {} } },
  API: {},
  MarketData: { SYMBOLS: { XAUUSD: {} }, isLocal: (s) => s === 'XAUUSD', getMeta: () => ({ decimals: 1 }),
    TF_MINUTES: { "1m": 1, "4h": 240 } },
  Fmt: { price: (n) => Number(n).toFixed(1) },
  toast: () => {},
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('frontend/static/js/page_backtesting.js', 'utf8'), sandbox);
sandbox.SubscriptionSystem = { getCandleSkipCap: () => 10, getReplaySpeedCap: () => 10, canAccessFeature: () => true };

const storageStub = { getItem: () => null, setItem: () => {} };
const T0 = Date.UTC(2026, 0, 5, 10, 0, 0);
const makeChart = (propFirmMode) => {
  const chart = sandbox.createBacktestingWorkspace(propFirmMode
    ? { store: { state: { history: [], active_trades: [], settings: {} } }, api: {}, storage: storageStub, scope: 'prop-measure', allowedSymbols: ['XAUUSD'], propFirmMode: true, evaluationWindow: { start: 0, end: 1 } }
    : { store: { state: { history: [], active_trades: [], settings: {} } }, api: {}, storage: storageStub, scope: 'plain-measure' });
  chart.symbol = 'XAUUSD';
  chart.candles = Array.from({ length: 60 }, (_, i) => ({ time: T0 + i * 60000, date: new Date(T0 + i * 60000), open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }));
  chart.idx = 59; chart.replayActive = false; chart.playing = false;
  chart.replayBookmarks = []; chart.hiddenCandles = [];
  chart.chartCoordinates = () => ({ timeToIndex: (t) => (t - T0) / 60000 });
  chart._canvasW = 800; chart._canvasH = 500;
  return chart;
};
const recorder = () => {
  const log = { text: [], fills: [], rects: [], strokes: 0 };
  let fillStyle = '';
  const ctx = {
    save() {}, restore() {}, setLineDash() {}, beginPath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {}, closePath() {},
    stroke() { log.strokes += 1; }, fill() { log.fills.push(fillStyle); },
    fillRect(x, y, w, h) { log.rects.push({ x, y, w, h, color: fillStyle }); },
    fillText(t) { log.text.push(t); }, measureText: (t) => ({ width: String(t).length * 7 }),
    set fillStyle(v) { fillStyle = v; }, get fillStyle() { return fillStyle; },
  };
  return { ctx, log };
};
const drawing = (priceB) => ({ type: 'riskReward', anchors: [
  { time: T0, price: 2366.0 }, { time: T0 + 40 * 60000, price: priceB }] });
const pts = [{ x: 100, y: 300 }, { x: 300, y: 180 }];

for (const propFirmMode of [false, true]) {
  const label = propFirmMode ? 'propFirmMode' : 'standalone';
  const chart = makeChart(propFirmMode);

  // up measure: blue box, bubble text like the reference
  let { ctx, log } = recorder();
  chart.drawMeasureBox(ctx, pts, drawing(2397.7));
  assert.deepEqual(log.text, ['31.7 (1.34%) 317', '40 bars, 40m', 'Vol 410'], `${label}: up measure text`);
  assert.ok(log.rects[0].color.startsWith('rgba(41,98,255'), `${label}: up box is blue`);
  assert.equal(log.fills[0], '#2962ff', `${label}: bubble is blue`);
  assert.deepEqual([log.rects[0].x, log.rects[0].w, log.rects[0].h], [100, 200, 120], `${label}: box spans the two points`);

  // down measure: red box and negative numbers
  ({ ctx, log } = recorder());
  chart.drawMeasureBox(ctx, [{ x: 100, y: 180 }, { x: 300, y: 300 }], drawing(2334.3));
  assert.equal(log.text[0], '-31.7 (-1.34%) -317', `${label}: down measure text`);
  assert.ok(log.rects[0].color.startsWith('rgba(242,54,69'), `${label}: down box is red`);

  // longer spans use d/h/m, volume omitted when the chart has none
  assert.equal(chart.formatMeasureDuration(2 * 3600000 + 5 * 60000), '2h 5m');
  assert.equal(chart.formatMeasureDuration(26 * 3600000), '1d 2h');
  chart.candles.forEach((c) => { c.volume = 0; });
  ({ ctx, log } = recorder());
  chart.drawMeasureBox(ctx, pts, drawing(2397.7));
  assert.equal(log.text.length, 2, `${label}: no Vol row without volume`);

  // bubble stays inside the canvas when the box is at the very top
  ({ ctx, log } = recorder());
  chart.drawMeasureBox(ctx, [{ x: 40, y: 30 }, { x: 60, y: 8 }], drawing(2397.7));
  assert.equal(log.text.length, 2, `${label}: still drawn near the edge`);

  // toolbar: Measure group with the ruler icon is present on both charts
  const rail = chart.renderLeftRail();
  assert.ok(rail.includes('M4 17l3 3L20 7l-3-3z'), `${label}: ruler icon in the left rail`);
}
console.log('measure_tool.test.js passed');
