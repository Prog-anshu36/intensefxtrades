/* Sealed Prop Firm evaluation: random fixed month, no scissors/jump/skip-ahead,
 * every plan can still play/step through it (speed is what the plan caps). */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

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
}
