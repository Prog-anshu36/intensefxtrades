/* Two related fixes:
 * 1) Hitting the phase 1 target used to leave the account in "phase-ready",
 *    waiting for a manual "Start Phase 2" click — unlike a real evaluation,
 *    where passing a phase hands you the next one immediately. Phase 1
 *    completion now auto-advances a 2-phase account straight to phase 2.
 * 2) A new "instant" 1-step model: a single phase, no phase 2 at all — once
 *    its target is hit the account goes straight to "passed".
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const values = new Map();
const sandbox = {
  console,
  Store: { state: { active_account_id: 'acct-1', history: [], active_trades: [] }, subscribe() {} },
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

// The new model exists, is single-phase, and keeps its own sizes.
assert.ok(rules.instant, 'an "instant" 1-step model is registered');
assert.equal(rules.instant.targets[2], undefined, 'instant model has no phase 2 target');
assert.ok(rules.instant.targets[1] > 0);
assert.ok(Array.isArray(rules.instant.sizes) && rules.instant.sizes.length > 0);

const day = n => Date.UTC(2026, 1, n, 12);
const addClosed = (attempt, id, date, pnl) => {
  sandbox.Store.state.history.push({ id, symbol: 'XAUUSD', type: 'BUY', entry: 2000,
    opened_at: new Date(date).toISOString(), closed_at: new Date(date + 60_000).toISOString(), pnl });
  return page.onMarketCandle(date + 120_000, sandbox.Store.state);
};

// 1) 2-phase model: phase 1 target hit auto-advances to phase 2, no manual advance() needed.
{
  const { attempt } = page.create('pro', 5000); // pro has minDays 0, so one profitable trade is enough
  page.onMarketCandle(day(1), sandbox.Store.state);
  const target = attempt.startingBalance * rules.pro.targets[1] / 100;
  addClosed(attempt, 1, day(1), target + 1);
  assert.equal(attempt.phase, 2, 'phase 1 target hit moves straight to phase 2');
  assert.equal(attempt.status, 'active', 'phase 2 starts immediately active, no "phase-ready" gate');
  assert.equal(attempt.phaseBaselineKeys.length, 1, 'phase 1 trade excluded from phase 2 scoring');
  // Phase 2 target hit finishes the account as "passed".
  const target2 = attempt.startingBalance * rules.pro.targets[2] / 100;
  addClosed(attempt, 2, day(2), target2 + 1);
  assert.equal(attempt.status, 'passed');
}

// 2) 1-step "instant" model: target hit goes straight to "passed", never phase 2.
{
  sandbox.Store.state.history = [];
  sandbox.Store.state.active_account_id = 'acct-2';
  page.load();
  const { attempt } = page.create('instant', 5000);
  page.onMarketCandle(day(3), sandbox.Store.state);
  const target = attempt.startingBalance * rules.instant.targets[1] / 100;
  addClosed(attempt, 3, day(3), target + 1);
  assert.equal(attempt.phase, 1, 'instant model never advances to phase 2');
  assert.equal(attempt.status, 'passed', 'instant model target hit passes directly');
}

console.log('prop_firm_instant_and_auto_phase2.test.js passed');
