const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup(legacy = {}) {
  const values = new Map(Object.entries(legacy));
  const localStorage = {
    get length() { return values.size; }, key: i => [...values.keys()][i],
    getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
  const listeners = [], events = [], writes = [], cleared = [];
  const sandbox = { console, structuredClone, localStorage, Store: { state: {}, subscribe: fn => listeners.push(fn) },
    clearTimeout: id => cleared.push(id), cancelAnimationFrame() {},
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    API: { updateSettings: payload => { writes.push(payload); return Promise.resolve(); } },
    document: { removeEventListener() {} } };
  sandbox.window = sandbox;
  sandbox.dispatchEvent = event => events.push(event);
  sandbox.removeEventListener = () => {};
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync('frontend/static/js/page_backtesting.js', 'utf8'), sandbox);
  const chart = sandbox.PageBacktesting;
  // The production script exposes a global lexical binding; account isolation
  // must still attach if the window property is absent in another build host.
  delete sandbox.PageBacktesting;
  chart.updateDrawingHistoryControls = chart.syncDrawingEngineFromLegacy = chart.ensureDrawingNames = () => {};
  chart.normalizeDrawing = drawing => drawing;
  chart.syncReplayBuffers = chart.updateReplayChrome = () => {};
  vm.runInContext(fs.readFileSync('frontend/static/js/chart-account-state.js', 'utf8'), sandbox);
  function switchTo(id) {
    sandbox.Store.state = { active_user_id: 'local', active_account_id: id, accounts: [{ id: 'a' }, { id: 'b' }] };
    listeners.forEach(fn => fn(sandbox.Store.state));
  }
  return { sandbox, chart, values, switchTo, events, writes, cleared };
}

const t = setup({ tfb_drawings_v1_XAUUSD: JSON.stringify([{ id: 'legacy-line' }]), tfb_replay_engine_v1: JSON.stringify({ symbol: 'XAUUSD', replayActive: true, timestamp: 10 }) });
t.switchTo('b');
assert.equal(t.chart.chartStorage().getItem('tfb_drawings_v1_XAUUSD'), null, 'new account never imports shared drawings');
assert.equal(t.chart.chartStorage().getItem('tfb_replay_engine_v1'), null, 'new account never imports shared replay');
assert.ok(t.sandbox.ChartAccountState.storageFor('local:a').getItem('tfb_drawings_v1_XAUUSD'), 'legacy chart is retained for original account');
t.chart.symbol = 'XAUUSD'; t.chart._initialized = true;
t.chart.drawings = [{ id: 'b-line' }]; t.chart.replayActive = true;
t.chart.idx = 4; t.chart.replayTimestamp = 12345; t.chart.viewEnd = 6;
t.chart.replayBookmarks = [{ timestamp: 12345 }];
t.chart.selectedDrawingIds = ['b-line']; t.chart.drawingHistory = [[{ id: 'b-line' }]];
t.chart.orderDraft = { type: 'BUY' }; t.chart._persistReplayTimer = 42;
t.chart.saveDrawingStorage(); t.chart.saveReplayStorage();
const bStorage = t.chart.chartStorage();
t.switchTo('a');
assert.equal(t.chart._initialized, false, 'account change forces chart initialization');
assert.equal(t.chart.drawings.length, 0); assert.equal(t.chart.selectedDrawingIds.length, 0);
assert.equal(t.chart.replayActive, false); assert.equal(t.chart.replayBookmarks.length, 0);
assert.equal(t.chart.drawingHistory.length, 0); assert.equal(t.chart.orderDraft, undefined);
assert.ok(t.cleared.includes(42), 'outgoing delayed replay save is cancelled');
assert.equal(t.writes.length, 0, 'cleanup cannot write outgoing replay settings into the new account');
assert.equal(JSON.parse(bStorage.getItem('tfb_drawings_v1_XAUUSD'))[0].id, 'b-line');
assert.equal(JSON.parse(bStorage.getItem('tfb_replay_engine_v1')).timestamp, 12345);
t.chart.symbol = 'XAUUSD'; t.chart.loadDrawingStorage();
assert.equal(t.chart.drawings[0].id, 'legacy-line');
t.chart.drawings = [{ id: 'a-only' }]; t.chart.saveDrawingStorage();
t.chart._initialized = true;
t.switchTo('b'); t.chart.symbol = 'XAUUSD'; t.chart.loadDrawingStorage();
assert.equal(t.chart.drawings[0].id, 'b-line', 'returning account restores its own drawings');
assert.equal(JSON.parse(t.chart.chartStorage().getItem('tfb_replay_engine_v1')).timestamp, 12345);
const count = t.events.length; t.switchTo('b');
assert.equal(t.events.length, count, 'normal same-account refresh does not reset the chart');
assert.equal(t.chart.drawings[0].id, 'b-line');
assert.notEqual(t.sandbox.ChartAccountState.scopeFor({ active_user_id: 'other', active_account_id: 'b' }), 'local:b');

(async () => {
  let resolve;
  const s = { API: { getState: () => new Promise(r => { resolve = r; }) } };
  vm.createContext(s); vm.runInContext(fs.readFileSync('frontend/static/js/store.js', 'utf8') + '\nthis.store = Store;', s);
  s.store.state = { active_account_id: 'a' };
  const pending = s.store.refresh();
  s.store.state = { active_account_id: 'b', history: ['b-record'] };
  resolve({ active_account_id: 'a', history: ['a-record'] }); await pending;
  assert.equal(s.store.state.active_account_id, 'b', 'stale background response cannot switch accounts back');
  assert.equal(s.store.state.history[0], 'b-record');
  console.log('account_chart_isolation.test.js passed: account storage, legacy migration, chart reset, replay cancellation, restoration, stale refresh');
})().catch(error => { console.error(error); process.exitCode = 1; });
