/* Golden VIP can choose its own evaluation month instead of a random one.
 * Everyone else's choice must be ignored server-side, not just hidden in the
 * UI, and an out-of-range month must never be honored for anyone. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const sandbox = {
  window: {}, console,
  Store: { subscribe() {} },
  localStorage: { getItem: () => null, setItem: () => {} },
  document: { querySelector: () => null },
  UI: { showToast() {} },
  addEventListener: () => {},
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('frontend/static/js/prop-firm-session.js', 'utf8'), sandbox);
const S = sandbox.PropFirmSession;

// Not Golden VIP: a supplied customMonth is ignored, account still gets a random month.
sandbox.SubscriptionSystem = { getUserPlan: () => ({ productCode: null }) };
S.attempts = [];
let r = S.create('standard', 5000, { customMonth: '2022-5' });
assert.equal(r.ok, true);
assert.notEqual(`${r.attempt.evaluationWindow.year}-${r.attempt.evaluationWindow.month}`, '2022-5', 'non-Golden-VIP customMonth must be ignored');

// Golden VIP: the chosen month is honored exactly.
sandbox.SubscriptionSystem = { getUserPlan: () => ({ productCode: 'golden_vip' }) };
S.attempts = [];
r = S.create('standard', 5000, { customMonth: '2022-5' });
assert.equal(r.attempt.evaluationWindow.year, 2022);
assert.equal(r.attempt.evaluationWindow.month, 5);
assert.equal(new Date(r.attempt.evaluationWindow.start).toISOString().slice(0, 7), '2022-06', 'June 2022 (month index 5) is used');

// Golden VIP + no customMonth: still gets a random month (unaffected).
S.attempts = [];
r = S.create('standard', 5000, {});
assert.ok(r.attempt.evaluationWindow, 'Golden VIP without a chosen month still gets a sealed window');

// Golden VIP + an out-of-range month (outside the supported dataset): rejected, falls back to random.
S.attempts = [];
r = S.create('standard', 5000, { customMonth: '2030-1' });
assert.equal(r.ok, true);
assert.notEqual(r.attempt.evaluationWindow.year, 2030, 'an unsupported month must never be honored, even for Golden VIP');

// isGoldenVip() helper agrees with the plan's productCode.
assert.equal(S.isGoldenVip(), true);
sandbox.SubscriptionSystem = { getUserPlan: () => ({ productCode: null }) };
assert.equal(S.isGoldenVip(), false);

// evalMonthOptions() exposes the full supported pool for the UI dropdown (2021–2025 + Jan 2026 = 61 months).
assert.equal(S.evalMonthOptions().length, 61);

console.log('prop_firm_golden_vip_custom_month.test.js passed');
