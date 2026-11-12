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

  // Regression: afterRender() must retry the developer-panel check once
  // sign-in finishes, not just once at the moment the page first rendered —
  // otherwise landing directly on Plans before auth is ready permanently
  // hides the panel for a real developer account.
  {
    const docListeners = {}, winListeners = {};
    let isDev = false;
    const auth = { checkDeveloper: async () => isDev, devListPromos: async () => ({ ok: true, codes: [] }) };
    const window = { addEventListener(type, fn) { winListeners[type] = fn; }, IntenseFXAuth: auth };
    const document = { addEventListener(type, fn) { docListeners[type] = fn; } };
    const context = { window, document, Date, Number, String, Boolean, Set, Object, Intl, Promise };
    vm.runInNewContext(fs.readFileSync('frontend/static/js/subscription.js', 'utf8'), context);
    vm.runInNewContext(`${fs.readFileSync('frontend/static/js/page_subscription.js', 'utf8')}\nglobalThis.page = PageSubscription;`, context);
    const page = context.page;
    const els = {};
    const stub = () => ({ addEventListener() {}, set innerHTML(v) {}, value: '', checked: false });
    let mountHtml = '';
    const mount = { isConnected: true, set innerHTML(v) { mountHtml = v; }, get innerHTML() { return mountHtml; }, querySelector: id => els[id] || (els[id] = stub()) };
    const containerEls = { '#devPromoMount': mount };
    const container = { querySelector: sel => containerEls[sel] || stub(), querySelectorAll: () => [] };
    page.vipMessage = ''; page.vipMessageKind = ''; page.promoMessage = ''; page.promoMessageKind = '';
    page.afterRender(container);
    await new Promise(r => setImmediate(r));
    assert.equal(mountHtml, '', 'not a developer yet (session still loading): panel stays hidden');
    assert.equal(typeof docListeners['intensefx:authenticated'], 'function', 'retries on sign-in completing');
    assert.equal(typeof winListeners['intensefx:subscription-changed'], 'function', 'retries on a subscription change too');

    isDev = true;
    docListeners['intensefx:authenticated']();
    await new Promise(r => setImmediate(r));
    assert.match(mountHtml, /DEVELOPER MODE/, 'panel appears once sign-in actually finishes, without a page reload');
  }

  console.log('promo codes ui tests passed');
})();
