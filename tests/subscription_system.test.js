const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('frontend/static/js/subscription.js', 'utf8');
const window = { IntenseFXAuth: { getSubscription: () => null } };
vm.runInNewContext(source, { window, Date, Number, String, Boolean, Set, Object });
const system = window.SubscriptionSystem;

assert.equal(system.getUserPlan().code, 'blue');
for (const feature of ['dashboard', 'trades', 'generalSettings', 'tradingView']) assert.equal(system.canAccessFeature(feature), true);
for (const feature of ['analysis', 'performance', 'backtesting', 'replay', 'tradeAnalysis', 'aiCoach', 'technicalIndicators', 'premiumXauusd']) assert.equal(system.canAccessFeature(feature), false);
assert.equal(system.canCreateAccount([{ archived: true }]), false, 'archived accounts count against Blue limit');
assert.equal(system.canCreateAccount([]), true);

window.IntenseFXAuth.getSubscription = () => ({ plan_code: 'green', status: 'active' });
assert.equal(system.getUserPlan().code, 'green');
assert.equal(system.canAccessFeature('backtesting'), true);
assert.equal(system.canAccessFeature('replay'), false);
assert.equal(system.canAccessFeature('tradeAnalysis'), false);

const start = Date.UTC(2023, 0, 1), end = Date.UTC(2025, 0, 1);
window.IntenseFXAuth.getSubscription = () => ({ plan_code: 'purple', status: 'active' });
const range = system.getPermittedReplayRange('XAUUSD', { first_timestamp: start, last_timestamp: end });
assert.equal(range.start, Date.UTC(2024, 0, 2));
assert.equal(range.end, end);
const purpleRange = system.getPermittedReplayRange('XAUUSD', { first_timestamp: start, last_timestamp: end });
assert.equal(purpleRange.start, Date.UTC(2024, 0, 2));
assert.equal(system.canAccessReplayRange('XAUUSD', { start: purpleRange.start, end }, { first_timestamp: start, last_timestamp: end }), true);
assert.equal(system.canAccessReplayRange('XAUUSD', { start, end }, { first_timestamp: start, last_timestamp: end }), false);
assert.equal(system.canAccessHistoricalData('XAUUSD', { start: purpleRange.start, end }, { first_timestamp: start, last_timestamp: end }), true);
assert.equal(system.canAccessHistoricalData('XAUUSD', { start, end }, { first_timestamp: start, last_timestamp: end }), false);

window.IntenseFXAuth.getSubscription = () => ({ plan_code: 'red', status: 'active' });
assert.equal(system.getPermittedReplayRange('XAUUSD', { first_timestamp: start, last_timestamp: end }).start, start);
assert.equal(system.canAccessFeature('aiCoach'), true);
window.IntenseFXAuth.getSubscription = () => ({ plan_code: 'red', status: 'expired' });
assert.equal(system.getUserPlan().code, 'blue');

console.log('subscription system tests passed');
