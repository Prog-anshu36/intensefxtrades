/* Sealed Prop Firm evaluation: random fixed month, no scissors/jump/skip-ahead,
 * every plan can still play/step through it (speed is what the plan caps). */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

(async () => {

// --- 1) prop-firm-session.js: every new attempt gets a random locked month ---
{
  const sandbox = {
    console,
    Store: { state: { active_account_id: 'account-a', history: [], active_trades: [] }, subscribe: () => {} },
    localStorage: { getItem: () => null, setItem: () => {} },
    document: { querySelector: () => null },
    UI: { showToast() {} },
    addEventListener() {},
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync('frontend/static/js/prop-firm-session.js', 'utf8'), sandbox);
  const page = sandbox.PagePropFirmSession;
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    const result = page.create('standard', 5000);
    assert.equal(result.ok, true);
    const win = result.attempt.evaluationWindow;
    assert.ok(win && Number.isFinite(win.start) && Number.isFinite(win.end), 'every attempt gets an evaluation window');
    assert.ok(win.start < win.end, 'window has a real span');
    const startDate = new Date(win.start), endDate = new Date(win.end);
    assert.ok(startDate.getUTCFullYear() >= 2021 && startDate.getUTCFullYear() <= 2025, 'window falls between 2021 and 2025');
    assert.equal(startDate.getUTCDate(), 1, 'window starts on the 1st of a month');
    assert.equal(startDate.getUTCHours(), 0);
    const nextMonthStart = Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + 1, 1);
    assert.equal(win.end, nextMonthStart - 1, 'window ends at the last millisecond of that same month');
    assert.ok(win.label, 'window has a human-readable label');
    seen.add(`${startDate.getUTCFullYear()}-${startDate.getUTCMonth()}`);
  }
  assert.ok(seen.size > 1, 'random month assignment actually varies across accounts');
  console.log('prop_firm_evaluation_lock.test.js: random sealed month assignment passed');
}

// --- 2) page_backtesting.js: the shared chart engine's Prop Firm management layer ---
{
  const toasts = [];
  const sandbox = {
    structuredClone, console,
    Store: { state: { history: [], active_trades: [], settings: {} } },
    API: {},
    MarketData: { SYMBOLS: { XAUUSD: {} }, isLocal: (s) => s === 'XAUUSD', getMeta: () => ({ decimals: 2 }),
      TF_MINUTES: { "1m": 1, "3m": 3, "5m": 5, "15m": 15, "30m": 30, "1h": 60, "4h": 240, "1d": 1440, "1w": 10080, "1M": 43200 } },
    Fmt: { price: (n) => Number(n).toFixed(2) },
    toast: (message) => toasts.push(message),
    UI: { showToast() {} },
    document: { querySelector: () => null, getElementById: () => null },
    setTimeout, clearTimeout, requestAnimationFrame: () => 0,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync('frontend/static/js/page_backtesting.js', 'utf8'), sandbox);

  const evaluationWindow = { start: Date.UTC(2023, 2, 1), end: Date.UTC(2023, 3, 1) - 1, label: 'March 2023' };
  const storageStub = { getItem: () => null, setItem: () => {} };
  const chart = sandbox.createBacktestingWorkspace({
    store: { state: { history: [], active_trades: [], settings: {} } },
    api: {}, storage: storageStub, scope: 'prop-1', allowedSymbols: ['XAUUSD'],
    propFirmMode: true, evaluationWindow,
  });

  assert.equal(chart.propFirmMode, true);
  const bounds = chart.evaluationBounds();
  assert.equal(bounds.start, evaluationWindow.start);
  assert.equal(bounds.end, evaluationWindow.end);
  // No subscription module loaded at all (worst case) — a sealed evaluation still works for every plan.
  assert.equal(chart.replayFeatureAllowed(), true, 'Prop Firm mode bypasses the Purple-only Replay gate');

  chart.candles = [{ time: evaluationWindow.start, date: new Date(evaluationWindow.start) }];
  chart.idx = 0;
  chart.datasetInfo = { first_timestamp: evaluationWindow.start, last_timestamp: evaluationWindow.end };
  chart.tool = 'crosshair';

  chart.toggleScissorsTool();
  assert.equal(chart.tool, 'crosshair', 'scissors cannot be enabled inside a sealed evaluation');
  chart.cutReplayAt(0);
  chart.jumpReplayToDate('2023-03-15T00:00');
  chart.goToReplayEnd();
  chart.exitReplayToLive();
  assert.ok(toasts.length >= 4, 'every bypass attempt is rejected with feedback instead of silently doing nothing');
  assert.ok(toasts.every((message) => /sealed|fixed|forward|evaluation/i.test(message)), 'rejections explain the sealed-evaluation rule');

  const normalAttempt = sandbox.createBacktestingWorkspace({
    store: { state: { history: [], active_trades: [], settings: {} } }, api: {}, storage: storageStub, scope: 'plain',
  });
  assert.equal(normalAttempt.propFirmMode, false, 'the standalone Backtesting chart is unaffected');

  // Toolbar/panel markup: a sealed evaluation hides the controls that peek or jump ahead.
  chart.replayActive = true;
  chart.playing = false;
  chart.replayBookmarks = [];
  chart.hiddenCandles = [];
  const surface = chart.renderChartSurface();
  assert.ok(!surface.includes('id="scissorsToolBtn"'), 'scissors button is removed in a sealed evaluation');
  assert.ok(!surface.includes('id="liveChartBtn"'), 'Live (exit to real-time) button is removed');
  assert.ok(surface.includes('prop-sealed-badge'), 'a sealed-evaluation indicator takes the scissors button’s place');
  const panel = chart.renderReplayPanel();
  assert.ok(!panel.includes('id="btnEnd"'), 'skip-to-end button is removed');
  assert.ok(!panel.includes('id="btnReplayLive"'), 'replay-panel Live button is removed');
  assert.ok(!panel.includes('id="replayDateInput"'), 'jump-to-date row is removed');
  assert.ok(/id="replayProgress"[^>]*disabled/.test(panel), 'the progress bar cannot be dragged ahead');
  assert.ok(panel.includes('id="btnPlay"') && panel.includes('id="btnPrev"') && panel.includes('id="btnNext"'), 'play/pause and step controls remain exactly as before');

  const plainSurface = normalAttempt.renderChartSurface.call({ ...normalAttempt, tool: 'crosshair', candles: [], idx: 0 });
  assert.ok(plainSurface.includes('id="scissorsToolBtn"') || plainSurface.includes('data-plan-feature="replay"'), 'the standalone Backtesting toolbar keeps its normal scissors/plan gating');

  console.log('prop_firm_evaluation_lock.test.js: chart management layer (speed-allowed, scissors/jump/end/live blocked) passed');

  // --- 3) Multi-timeframe analysis must never reveal a not-yet-closed higher-TF
  // candle. This is the pre-existing engine's own closed-time snap logic
  // (unchanged here) — verified directly so it isn't assumed.
  const minuteStart = evaluationWindow.start; // 2023-03-01T00:00:00Z
  const oneMin = 60 * 1000, oneHour = 60 * oneMin;
  // Practice clock sits at 00:37 into the month: the 1h candle for 00:00-01:00
  // has not closed yet.
  const practiceTs = minuteStart + 37 * oneMin;
  chart.symbol = 'XAUUSD';
  chart.timeframe = '1h';
  chart.candles = [
    { time: minuteStart - oneHour, date: new Date(minuteStart - oneHour) }, // 23:00-00:00 (closed)
    { time: minuteStart, date: new Date(minuteStart) },                     // 00:00-01:00 (in progress at practiceTs)
    { time: minuteStart + oneHour, date: new Date(minuteStart + oneHour) }, // 01:00-02:00 (fully in the future)
  ];
  const mtfIdx = chart.snapIndexToTimestamp(practiceTs);
  assert.equal(mtfIdx, 0, 'switching to a higher timeframe snaps to the last fully-closed candle, not the in-progress one');
  chart.idx = mtfIdx;
  chart.replayActive = true;
  chart.syncReplayBuffers();
  assert.equal(chart.visibleCandles.length, 1, 'the in-progress and future higher-timeframe candles stay hidden after a timeframe switch');
  assert.equal(chart.hiddenCandles.length, 2);
  console.log('prop_firm_evaluation_lock.test.js: multi-timeframe switch hides not-yet-closed candles passed');

  // --- 4) First-ever open of a sealed account must reveal its first candle, not
  // blank the chart. Regression for a bug where the initial anchor was seeded at
  // the window's start INSTANT (candle not yet closed) instead of its close, so
  // snapIndexToTimestamp returned -1 and visibleCandles.length was 0.
  const fresh = sandbox.createBacktestingWorkspace({
    store: { state: { history: [], active_trades: [], settings: {} } },
    api: { updateSettings: () => Promise.resolve({}) }, storage: storageStub, scope: 'prop-fresh', allowedSymbols: ['XAUUSD'],
    propFirmMode: true, evaluationWindow,
  });
  fresh.symbol = 'XAUUSD';
  fresh.timeframe = '4h';
  fresh.updateReplayChrome = () => {}; // DOM chrome irrelevant to this data-layer regression
  fresh.candles = [];
  fresh.idx = 0;
  fresh.replayActive = false;
  fresh.replayTimestamp = null;
  const fourHour = 4 * 60 * 60 * 1000;
  const monthCandles = [];
  for (let t = evaluationWindow.start; t < evaluationWindow.start + fourHour * 5; t += fourHour) {
    monthCandles.push({ time: t, date: new Date(t), open: 1, high: 1, low: 1, close: 1 });
  }
  sandbox.API.getMarketHistory = () => Promise.resolve({
    symbol: 'XAUUSD', timeframe: '4h', source: 'local-csv', candles: monthCandles,
    first_timestamp: evaluationWindow.start, last_timestamp: evaluationWindow.end,
  });
  sandbox.MarketData.history = async (symbol, timeframe, count, options = {}) => {
    const clamp = (c) => (options.start != null ? c.filter((x) => x.time >= options.start) : c);
    return { symbol, timeframe, source: 'local-csv', candles: clamp(monthCandles),
      first_timestamp: evaluationWindow.start, last_timestamp: evaluationWindow.end };
  };
  await fresh.loadRealHistory();
  assert.ok(fresh.idx >= 0, 'first-ever chart open on a sealed account must land on a real candle, not -1');
  assert.ok(fresh.visibleCandles.length >= 1, 'the first candle of the locked month is revealed immediately, not a blank chart');
  console.log('prop_firm_evaluation_lock.test.js: first-open of a sealed account reveals its first candle passed');

  // --- 5) Self-heal: an account whose SAVED state already has the pre-fix bad
  // position (replayActive already true, replayTimestamp/idx pinned at the
  // window's unclosed start) must not stay blank forever — the very next load
  // must recover it, not just a brand-new account's first-ever open.
  const broken = sandbox.createBacktestingWorkspace({
    store: { state: { history: [], active_trades: [], settings: {} } },
    api: { updateSettings: () => Promise.resolve({}) }, storage: storageStub, scope: 'prop-broken', allowedSymbols: ['XAUUSD'],
    propFirmMode: true, evaluationWindow,
  });
  broken.symbol = 'XAUUSD';
  broken.timeframe = '4h';
  broken.updateReplayChrome = () => {};
  broken.candles = [];
  broken.idx = -1;
  broken.replayActive = true; // already true from the old buggy run
  broken.replayTimestamp = evaluationWindow.start; // the old bad (unclosed) anchor
  await broken.loadRealHistory();
  assert.ok(broken.idx >= 0, 'a previously-broken saved sealed account self-heals to a real candle on its next load');
  assert.ok(broken.visibleCandles.length >= 1, 'a previously-broken saved sealed account shows its chart again, not a permanent blank screen');
  console.log('prop_firm_evaluation_lock.test.js: previously-broken sealed account self-heals on next load passed');

  // --- 6) Real history BEFORE the sealed month must stay fully scrollable (a
  // real prop-firm chart shows all prior market context); only candles AT OR
  // AFTER the locked month's end must stay unreachable, forever.
  const datasetStart = Date.UTC(2003, 0, 1); // dataset goes back to ~2003
  const allCandles = [];
  for (let t = datasetStart; t <= evaluationWindow.end + fourHour * 3; t += fourHour) {
    allCandles.push({ time: t, open: 1, high: 1, low: 1, close: 1 });
  }
  // Mirrors the real backend's query semantics (backend/xauusd_data_provider.py
  // history()): a plain start/end page is capped by `count`, exactly like the
  // real paged fetches loadLocalPage makes — so this test exercises the real
  // "keep scrolling back, one bounded page at a time" flow, not an unbounded one.
  const fakeHistory = async (symbol, timeframe, count, options = {}) => {
    let rows;
    if (options.anchor != null) {
      const beforeAll = allCandles.filter((c) => c.time <= (options.end != null ? Math.min(options.anchor, options.end) : options.anchor));
      const before = beforeAll.slice(-Math.max(1, Math.floor(count / 2)));
      const afterAll = allCandles.filter((c) => c.time > Math.max(options.anchor, options.start ?? -Infinity) && (options.end == null || c.time <= options.end));
      const after = afterAll.slice(0, count - before.length);
      rows = before.concat(after);
    } else if (options.start != null) {
      rows = allCandles.filter((c) => c.time >= options.start && (options.end == null || c.time <= options.end)).slice(0, count);
    } else {
      rows = allCandles.filter((c) => options.end == null || c.time <= options.end).slice(-count);
    }
    return { symbol, timeframe, source: 'local-csv', candles: rows.map((c) => ({ ...c, date: new Date(c.time) })),
      first_timestamp: datasetStart, last_timestamp: evaluationWindow.end + fourHour * 3 };
  };
  sandbox.MarketData.history = fakeHistory;
  const history = sandbox.createBacktestingWorkspace({
    store: { state: { history: [], active_trades: [], settings: {} } },
    api: { updateSettings: () => Promise.resolve({}) }, storage: storageStub, scope: 'prop-history', allowedSymbols: ['XAUUSD'],
    propFirmMode: true, evaluationWindow,
  });
  history.symbol = 'XAUUSD';
  history.timeframe = '4h';
  history.updateReplayChrome = () => {};
  history.candles = [];
  history.idx = 0;
  history.replayActive = false;
  history.replayTimestamp = null;
  await history.loadRealHistory();
  assert.ok(history.candles[0].time > datasetStart, 'the initial fetch does not eagerly pull the entire multi-year dataset');
  // Scroll backward repeatedly, panning the camera to the front each time (as
  // the real UI does while a trader drags/scrolls back) — must reach all the
  // way to the real dataset start, never stopping at the sealed month's own
  // start or getting stuck once the in-memory buffer fills up.
  for (let i = 0; i < 40 && history.candles[0].time > datasetStart; i++) {
    history.viewEnd = history.visibleCount - 1; // pan the view to the oldest loaded candle
    await history.loadLocalPage(-1);
  }
  assert.equal(history.candles[0].time, datasetStart, 'scrolling back reaches the real history before the sealed month, not just the month itself');
  assert.ok(!history._olderExhausted || history.candles[0].time === datasetStart, 'backward scrolling is never cut off at the evaluation window start');
  // Forward loading must still never cross the sealed month's end.
  const beforeLen = history.candles.length;
  await history.loadLocalPage(1);
  assert.ok(history.candles.every((c) => c.time <= evaluationWindow.end), 'no candle at or after the sealed month end is ever loaded, however far forward is requested');
  console.log('prop_firm_evaluation_lock.test.js: full real history before the sealed month is scrollable; future edge stays fenced passed');
}

})().catch((error) => { console.error(error); process.exit(1); });
