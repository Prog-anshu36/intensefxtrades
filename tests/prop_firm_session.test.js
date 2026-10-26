const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const values = new Map();
const listeners = [];
const sandbox = {
  console,
  Store: { state: { active_account_id: 'account-a', history: [], active_trades: [] }, subscribe: fn => listeners.push(fn) },
  localStorage: { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, String(v)) },
  document: { querySelector: () => null },
  UI: { showToast() {} },
  addEventListener() {},
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('frontend/static/js/prop-firm-session.js', 'utf8'), sandbox);
const page = sandbox.PagePropFirmSession;
const rules = sandbox.PropFirmRules;
assert.deepEqual(JSON.parse(JSON.stringify({ standard: rules.standard.targets, pro: rules.pro.targets })), {
  standard: { 1: 8, 2: 5 }, pro: { 1: 6, 2: 6 },
});
assert.equal(rules.standard.dailyLossPct, 5);
assert.equal(rules.pro.maxLossPct, 6);

const day = n => Date.UTC(2026, 0, n, 12);
let result = page.create('standard', 5000);
assert.equal(result.ok, true);
const attempt = result.attempt;
assert.equal(attempt.phaseBaselineKeys.length, 0);

page.onMarketCandle(day(1), sandbox.Store.state);
const addClosed = (id, date, pnl) => {
  sandbox.Store.state.history.push({ id, symbol: 'XAUUSD', type: 'BUY', entry: 2000,
    opened_at: new Date(date).toISOString(), closed_at: new Date(date + 60_000).toISOString(), pnl });
  return page.onMarketCandle(date + 120_000, sandbox.Store.state);
};
addClosed(1, day(1), 200);
assert.equal(attempt.status, 'active', 'target alone does not bypass minimum active days');
addClosed(2, day(2), 200);
assert.equal(attempt.status, 'active');
addClosed(3, day(3), 1);
assert.equal(attempt.status, 'phase-ready', 'phase 1 requires both target and three active days');
assert.equal(page.summary(attempt).tradedDays.length, 3);

assert.equal(page.advance(attempt.id).ok, true);
assert.equal(attempt.phase, 2);
assert.equal(attempt.phaseBaselineKeys.length, 3, 'phase 1 trades are excluded from phase 2 scoring');
assert.equal(page.summary(attempt).pnl, 0);
addClosed(4, day(4), 100);
addClosed(5, day(5), 100);
addClosed(6, day(6), 100);
assert.equal(attempt.status, 'passed', 'both model phases can complete from chart trade history');

sandbox.Store.state.active_account_id = 'account-b';
page.load();
assert.equal(page.attempts.length, 0, 'practice rounds are isolated per TradeFXBook account');
result = page.create('pro', 5000);
assert.equal(result.ok, true);
const pro = result.attempt;
page.onMarketCandle(day(7), sandbox.Store.state);
sandbox.Store.state.active_trades.push({ id: 77, symbol: 'XAUUSD', type: 'BUY', entry: 2000,
  opened_at: new Date(day(7)).toISOString(), floating_pnl: -151 });
const breach = page.onMarketCandle(day(7) + 60_000, sandbox.Store.state);
assert.equal(pro.status, 'failed', 'floating equity breaches the Pro daily loss rule');
assert.equal(breach.failed, true);
assert.equal(breach.liquidate.length, 1);

sandbox.Store.state.active_account_id = 'account-c';
page.load();
const rollover = page.create('pro', 5000).attempt;
page.onMarketCandle(day(8), sandbox.Store.state);
sandbox.Store.state.active_trades = [{ id: 88, symbol: 'XAUUSD', type: 'BUY', entry: 2000,
  opened_at: new Date(day(8)).toISOString(), floating_pnl: -149 }];
page.onMarketCandle(day(8) + 60_000, sandbox.Store.state);
sandbox.Store.state.active_trades[0].floating_pnl = -160;
page.sync();
assert.equal(rollover.status, 'active', 'store refresh does not evaluate against a stale prior-day loss baseline');
const nextDay = page.onMarketCandle(day(9), sandbox.Store.state);
assert.equal(rollover.status, 'active', 'the UTC+3 rollover captures a fresh daily baseline before loss checks');
assert.equal(nextDay.failed, false);

pro.status = 'active';
pro.deadlineAt = new Date(Date.now() - 1).toISOString();
page.evaluate(pro);
assert.equal(pro.status, 'expired', 'phase deadline expires after fourteen calendar days');

console.log('prop_firm_session.test.js passed: rule profiles, phase targets, minimum trading days, phase isolation, per-account persistence, floating-loss breach, expiry');
