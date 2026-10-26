const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const storage = () => { const data = new Map(); return { getItem: k => data.get(k) || null, setItem: (k,v) => data.set(k, String(v)) }; };
const normalStore = { state: { history: [], active_trades: [], settings: {} } };
const sandbox = { structuredClone, Store: normalStore, API: {}, console,
  MarketData: { SYMBOLS: { XAUUSD: {}, EURUSD: {} }, getMeta: () => ({ decimals: 2 }) },
  Fmt: { price: n => Number(n).toFixed(2) } };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('frontend/static/js/page_backtesting.js', 'utf8'), sandbox);
const normal = sandbox.PageBacktesting;
const aStore = { state: { ...normalStore.state, active_trades: [{ id: 8, symbol: 'XAUUSD', type: 'SELL', lots: .1, entry: 2000 }] } };
const a = sandbox.createBacktestingWorkspace({ store: aStore, api: { name: 'prop' }, storage: storage(), scope: 'phase1', allowedSymbols: ['XAUUSD'] });
a.drawings.push({ id: 'one', anchors: [{ timestamp: 1767258000000, price: 2000 }] });
a.replayBookmarks.push({ timestamp: 1767258000000 });
const b = sandbox.createBacktestingWorkspace({ store: { state: normalStore.state }, storage: storage(), scope: 'phase2' });
assert.equal(b.drawings.length, 0, 'new phase does not inherit prior phase drawings');
assert.equal(b.replayBookmarks.length, 0, 'new phase does not inherit replay state');
assert.equal(normal.drawings.length, 0, 'prop drawings never mutate normal backtesting');
assert.equal(a.store, aStore);
assert.equal(normal.store, normalStore);
assert.equal(a.api.name, 'prop');
assert.deepEqual(Array.from(a.availableSymbols()), ['XAUUSD']);
assert.equal(a.placeTrade, normal.placeTrade, 'both workspaces use the same order and chart implementation');
assert.equal(a.drawChart, normal.drawChart);
const labels = [];
const ctx = new Proxy({ fillText: text => labels.push(text) }, { get: (o,k) => o[k] || (() => {}), set: (o,k,v) => (o[k] = v, true) });
a.symbol = 'XAUUSD';
a.drawTradeLevels(ctx, price => 2000 - price, 900, { decimals: 2 });
assert.ok(labels.some(label => label.includes('Entered')), 'practice chart renders its own live trade protection controls');
assert.equal(normalStore.state.active_trades.length, 0);
console.log('prop_practice_chart.test.js passed: shared engine, isolated dependencies, drawings, replay, XAUUSD and live protection');

