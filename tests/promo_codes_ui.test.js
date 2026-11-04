const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function load(auth) {
  const window = { addEventListener() {}, IntenseFXAuth: auth };
  const context = { window, document: { addEventListener() {} }, Date, Number, String, Boolean, Set, Object, Intl, Promise };
  vm.runInNewContext(fs.readFileSync('frontend/static/js/subscription.js', 'utf8'), context);
  vm.runInNewContext(`${fs.readFileSync('frontend/static/js/page_subscription.js', 'utf8')}\nglobalThis.page = PageSubscription;`, context);
  return context;
}
(async () => {
  // Every account sees the promo section under the VIP key section.
  const ctx = load({ getSubscription: () => null });
  const html = ctx.page.render();
  assert.match(html, /id="promoCodeInput"/);
  assert.match(html, /id="promoCodeRedeem"/);
  assert.ok(html.indexOf('id="vipKeyInput"') < html.indexOf('id="promoCodeInput"'), 'promo below VIP key');
  assert.match(html, /id="devPromoMount"/);

  // Non-developer: panel never rendered.
  const mount1 = { isConnected: true, innerHTML: '' };
  await load({ checkDeveloper: async () => false }).page.mountDeveloperPanel(mount1);
  assert.equal(mount1.innerHTML, '');
  // Errors count as non-developer.
  const mount2 = { isConnected: true, innerHTML: '' };
  await load({ checkDeveloper: async () => { throw new Error('x'); } }).page.mountDeveloperPanel(mount2);
  assert.equal(mount2.innerHTML, '');
  // Missing auth hooks are safe.
  await load({}).page.mountDeveloperPanel({ isConnected: true, innerHTML: '' });

  // Developer: panel rendered.
  const els = {};
  const stub = () => ({ addEventListener() {}, set innerHTML(v) {}, value: '', checked: false });
  const mount3 = { isConnected: true, _h: '', set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; }, querySelector: id => els[id] || (els[id] = stub()) };
  await load({ checkDeveloper: async () => true, devListPromos: async () => ({ ok: true, codes: [] }) }).page.mountDeveloperPanel(mount3);
  assert.match(mount3.innerHTML, /DEVELOPER MODE/);
  assert.match(mount3.innerHTML, /id="devPromoForm"/);
  assert.match(mount3.innerHTML, /Never expires/);
  console.log('promo codes ui tests passed');
})();
