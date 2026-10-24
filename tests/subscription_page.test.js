const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const window = { IntenseFXAuth: { getSubscription: () => null } };
const context = { window, Date, Number, String, Boolean, Set, Object, Intl };
vm.runInNewContext(fs.readFileSync('frontend/static/js/subscription.js', 'utf8'), context);
vm.runInNewContext(`${fs.readFileSync('frontend/static/js/page_subscription.js', 'utf8')}\nglobalThis.testPage = PageSubscription;`, context);
const html = context.testPage.render();
assert.equal((html.match(/class="subscription-card /g) || []).length, 4);
assert.match(html, /Blue · Free/);
assert.match(html, /Price to be configured/);
assert.match(html, /Plan feature comparison/);
assert.match(html, /Replay · last 365 days/);
assert.match(html, /Payments are not connected yet/);
assert.match(html, /Checkout not connected/);
assert.match(html, /data-subscription-plan="green" disabled/);
console.log('subscription page tests passed');
