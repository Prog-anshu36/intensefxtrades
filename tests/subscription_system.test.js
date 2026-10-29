const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('frontend/static/js/subscription.js', 'utf8');
const window = { IntenseFXAuth: { getSubscription: () => null }, addEventListener() {} };
const document = { addEventListener() {}, querySelectorAll() { return []; } };
vm.runInNewContext(source, { window, document, Date, Number, String, Boolean, Set, Object });
const system = window.SubscriptionSystem;

assert.equal(system.getUserPlan().code, 'blue');
for (const feature of ['dashboard', 'trades', 'generalSettings', 'tradingView']) assert.equal(system.canAccessFeature(feature), true);
for (const feature of ['analysis', 'performance', 'backtesting', 'replay', 'tradeAnalysis', 'aiCoach', 'technicalIndicators', 'premiumXauusd']) assert.equal(system.canAccessFeature(feature), false);
assert.equal(system.canCreateAccount([{ archived: true }]), false, 'archived accounts count against Blue limit');
assert.equal(system.canCreateAccount([]), true);
assert.equal(system.getUserPlan().demoAccountLimit, 1);
assert.equal(system.getUserPlan().performanceSessionLimit, 1);
assert.equal(system.getMaxPlaybackSpeed(), 1);
assert.equal(system.canCreateDemoAccount([]), true);
assert.equal(system.canCreateDemoAccount([{type:'Demo'}]), false);
assert.equal(system.canCreatePerformanceSession(0), true);
assert.equal(system.canCreatePerformanceSession(1), false);

window.IntenseFXAuth.getSubscription = () => ({ plan_code: 'green', status: 'active' });
assert.equal(system.getUserPlan().code, 'green');
assert.equal(system.canAccessFeature('backtesting'), true);
assert.equal(system.canAccessFeature('replay'), false);
assert.equal(system.canAccessFeature('tradeAnalysis'), false);
assert.equal(system.getUserPlan().demoAccountLimit, 3);
assert.equal(system.getUserPlan().performanceSessionLimit, 3);
assert.equal(system.getMaxPlaybackSpeed(), 3);
assert.equal(system.canCreateDemoAccount([{type:'Demo'},{type:'Demo'},{type:'Demo'}]), false);
assert.equal(system.canCreatePerformanceSession(3), false);

window.IntenseFXAuth.getSubscription = () => ({ plan_code: 'purple', status: 'active' });
assert.equal(system.getUserPlan().demoAccountLimit, 5);
assert.equal(system.getUserPlan().performanceSessionLimit, 5);
assert.equal(system.getMaxPlaybackSpeed(), 5);

window.IntenseFXAuth.getSubscription = () => ({ plan_code: 'red', status: 'active' });
assert.equal(system.getUserPlan().demoAccountLimit, 10);
assert.equal(system.getUserPlan().performanceSessionLimit, 10);
assert.equal(system.getMaxPlaybackSpeed(), 10);

window.IntenseFXAuth.getSubscription = () => ({ plan_code: 'red', product_code:'golden_vip', status: 'active' });
assert.equal(system.getUserPlan().demoAccountLimit, 50);
assert.equal(system.getUserPlan().performanceSessionLimit, 50);
assert.equal(system.getMaxPlaybackSpeed(), 100);
assert.equal(system.getUserPlan().sameDayChallenge, true);

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
