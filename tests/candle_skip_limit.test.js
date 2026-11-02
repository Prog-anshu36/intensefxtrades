/* The chart's -N/+N fast-forward buttons: locked on Blue/Green, 5 on Purple,
 * 10 on Red/Golden VIP — identically on the standalone Backtesting chart and
 * a sealed Prop Firm evaluation. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// --- 1) subscription.js: per-plan cap ---
{
  const window = { addEventListener() {}, IntenseFXAuth: { getSubscription: () => null } };
  const context = { window, document: { addEventListener() {} }, Date, Number, String, Boolean, Set, Object, Intl };
  vm.runInNewContext(fs.readFileSync('frontend/static/js/subscription.js', 'utf8'), context);
  const sys = window.SubscriptionSystem;
  assert.equal(sys.getCandleSkipCap(sys.PLANS.blue), 0, 'Blue is locked');
  assert.equal(sys.getCandleSkipCap(sys.PLANS.green), 0, 'Green is locked');
  assert.equal(sys.getCandleSkipCap(sys.PLANS.purple), 5, 'Purple gets 5');
  assert.equal(sys.getCandleSkipCap(sys.PLANS.red), 10, 'Red gets 10');
  assert.equal(sys.getCandleSkipCap(sys.GOLDEN_PASS), 10, 'Golden VIP gets 10 (red and above)');
  assert.ok(sys.PLANS.purple.features.has('candleSkip'), 'Purple is entitled to the candleSkip feature (for the upgrade-gate UI)');
  assert.ok(!sys.PLANS.green.features.has('candleSkip'), 'Green is not entitled to candleSkip');
  console.log('candle_skip_limit.test.js: subscription.js per-plan cap passed');
}

// --- 2) page_backtesting.js: locked/allowed rendering, identical in
// propFirmMode and in the standalone chart ---
{
  const sandbox = {
    structuredClone, console,
    Store: { state: { history: [], active_trades: [], settings: {} } },
    API: {},
    MarketData: { SYMBOLS: { XAUUSD: {} }, isLocal: (s) => s === 'XAUUSD', getMeta: () => ({ decimals: 2 }),
      TF_MINUTES: { "1m": 1, "4h": 240 } },
    Fmt: { price: (n) => Number(n).toFixed(2) },
    toast: () => {},
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync('frontend/static/js/page_backtesting.js', 'utf8'), sandbox);

  const storageStub = { getItem: () => null, setItem: () => {} };
  const makeChart = (propFirmMode) => {
    const chart = sandbox.createBacktestingWorkspace(propFirmMode
      ? { store: { state: { history: [], active_trades: [], settings: {} } }, api: {}, storage: storageStub, scope: 'prop-skip', allowedSymbols: ['XAUUSD'], propFirmMode: true, evaluationWindow: { start: 0, end: 1000000, label: 'Test' } }
      : { store: { state: { history: [], active_trades: [], settings: {} } }, api: {}, storage: storageStub, scope: 'plain-skip' });
    chart.symbol = 'XAUUSD';
    chart.candles = [{ time: 0, date: new Date(0) }];
    chart.idx = 0;
    chart.replayActive = true;
    chart.playing = false;
    chart.replayBookmarks = [];
    chart.hiddenCandles = [];
    return chart;
  };

  for (const propFirmMode of [false, true]) {
    const label = propFirmMode ? 'propFirmMode' : 'standalone';

    sandbox.SubscriptionSystem = undefined;
    assert.equal(makeChart(propFirmMode).candleSkipLimit(), 0, `${label}: no SubscriptionSystem loaded defaults to locked`);

    sandbox.SubscriptionSystem = { getCandleSkipCap: () => 0, canAccessFeature: () => true };
    let chart = makeChart(propFirmMode);
    let panel = chart.renderReplayPanel();
    assert.ok(/data-plan-feature="candleSkip"/.test(panel), `${label}, Blue/Green: fast-forward buttons carry the upgrade gate`);
    assert.ok(/🔒 [+−-]10/.test(panel), `${label}, Blue/Green: fast-forward buttons show locked at +10/-10`);
    assert.ok(panel.includes('id="btnPlay"') && panel.includes('id="btnPrev"'), `${label}, Blue/Green: Play/Step remain unaffected`);
    let dock = chart.renderFullscreenReplayDock();
    assert.ok(/data-plan-feature="candleSkip"/.test(dock), `${label}, Blue/Green fullscreen: fast-forward buttons carry the upgrade gate`);

    sandbox.SubscriptionSystem = { getCandleSkipCap: () => 5, canAccessFeature: () => true };
    chart = makeChart(propFirmMode);
    panel = chart.renderReplayPanel();
    assert.ok(!panel.includes('data-plan-feature="candleSkip"'), `${label}, Purple: fast-forward is not gated`);
    assert.ok(panel.includes('>−5<') || panel.includes('>-5<'), `${label}, Purple: fast-forward buttons show ±5`);

    sandbox.SubscriptionSystem = { getCandleSkipCap: () => 10, canAccessFeature: () => true };
    chart = makeChart(propFirmMode);
    panel = chart.renderReplayPanel();
    assert.ok(!panel.includes('data-plan-feature="candleSkip"'), `${label}, Red: fast-forward is not gated`);
    assert.ok(panel.includes('>−10<') || panel.includes('>-10<'), `${label}, Red: fast-forward buttons show ±10`);
  }
  console.log('candle_skip_limit.test.js: chart rendering (locked/5/10, standalone and propFirmMode alike) passed');
}
