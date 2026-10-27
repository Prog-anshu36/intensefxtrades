const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('frontend/static/js/supabase-auth.js', 'utf8');
function node(id) {
  return { id, hidden: false, disabled: false, value: '', textContent: '', innerHTML: '', dataset: {}, style: {}, attrs: {}, listeners: {}, checked: false,
    addEventListener(type, fn) { this.listeners[type] = fn; }, setAttribute(k, v) { this.attrs[k] = v; },
    querySelectorAll() { return []; }, focus() {}, closest() { return null; }, classList: { add() {}, remove() {}, toggle() {} } };
}
function harness(config, signedIn = false) {
  const ids = new Map();
  const selectors = new Map();
  ["authGate", "authNotice", "authName", "authEmail", "authPassword", "authConfirmPassword", "authTerms", "authTermsRow", "authLinks", "authShowPassword", "authForm", "authGoogle", "userPill", "authAccountPopover", "authProfileSave", "authSignout", "authSubmit", "authConfigHint", "appSplash"].forEach((id) => ids.set(id, node(id)));
  [".auth-name-field", ".auth-email-field", ".auth-password-field", ".auth-confirm-field"].forEach((selector) => selectors.set(selector, node(selector)));
  ids.get('authForm').querySelectorAll = () => [];
  ids.get('authGate').hidden = true;
  ids.get('authLinks').hidden = false;
  const bodyClasses = new Set();
  const document = { body: { classList: { add: (x) => bodyClasses.add(x), remove: (x) => bodyClasses.delete(x), contains: (x) => bodyClasses.has(x) }, dataset: {} },
    getElementById: (id) => ids.get(id) || null, querySelector: (selector) => selectors.get(selector) || null,
    addEventListener() {}, dispatchEvent() {} };
  let signInCalled = false;
  const account = { id: '54f6e212-1946-44ac-a974-432162f81012', email: 'trader@example.test', user_metadata: { full_name: 'Test Trader' } };
  const session = signedIn ? { user: account } : null;
  let authChange;
  const client = { auth: { getSession: async () => ({ data: { session: null }, error: null }), onAuthStateChange(fn) { authChange = fn; },
    signInWithPassword: async () => { signInCalled = true; return { data: { session }, error: null }; } },
    from(table) { return { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: table === 'profiles' ? { user_id: account.id, full_name: 'Test Trader', email: account.email } : { plan_code: 'blue', status: 'active' }, error: null }; },
      update() { return this; } }; } };
  const window = { addEventListener() {}, dispatchEvent() {}, IntenseFXAuthConfig: config, localStorage: {}, location: { href: 'https://example.test/intensefxtrades/', hash: '' }, setTimeout: (fn) => fn(), supabase: { createClient: () => client }, console };
  vm.runInNewContext(source, { window, document, Storage: function Storage() {}, URL, URLSearchParams, Event: function Event() {}, CustomEvent: function CustomEvent() {}, console });
  return { window, document, ids, selectors, bodyClasses, authEvent: event => authChange(event, session), get signInCalled() { return signInCalled; } };
}

(async () => {
  const local = harness({ supabaseUrl: '', supabaseAnonKey: '' });
  const localResult = await local.window.IntenseFXAuth.initialize();
  assert.equal(localResult.configured, false, 'Pages remains in device-local mode when Supabase is not configured');
  assert.equal(local.bodyClasses.has('auth-required'), false);

  const invalid = harness({ supabaseUrl: 'https://project.supabase.co', supabaseAnonKey: '' });
  const invalidResult = await invalid.window.IntenseFXAuth.initialize();
  assert.equal(invalidResult.error, 'invalid-config');
  assert.equal(invalid.bodyClasses.has('auth-required'), true, 'partial auth setup fails closed');
  assert.equal(invalid.ids.get('authForm').hidden, true, 'incomplete setup cannot present a working-looking form');

  const valid = harness({ supabaseUrl: 'https://project.supabase.co', supabaseAnonKey: 'public-anon-key-for-tests-123456789' });
  const validResult = await valid.window.IntenseFXAuth.initialize();
  assert.equal(validResult.configured, true);
  assert.equal(valid.bodyClasses.has('auth-required'), true, 'configured but signed-out visitors see the real sign-in gate');
  assert.equal(valid.ids.get('authTermsRow').hidden, false, 'Google consent checkbox is visible on initial login');
  valid.ids.get('authEmail').value = 'not-an-email';
  valid.ids.get('authPassword').value = 'testing123';
  await valid.ids.get('authForm').listeners.submit({ preventDefault() {} });
  assert.match(valid.ids.get('authNotice').textContent, /valid email/i);
  assert.equal(valid.signInCalled, false, 'invalid email is rejected before the provider is called');
  valid.window.IntenseFXAuth.setMode('signup');
  assert.equal(valid.selectors.get('.auth-name-field').hidden, false);
  assert.equal(valid.selectors.get('.auth-confirm-field').hidden, false);
  assert.equal(valid.ids.get('authTermsRow').hidden, false);
  valid.window.IntenseFXAuth.setMode('reset');
  assert.equal(valid.selectors.get('.auth-password-field').hidden, false, 'password recovery exposes the new password input');
  assert.equal(valid.selectors.get('.auth-confirm-field').hidden, false);

  const happy = harness({ supabaseUrl: 'https://project.supabase.co', supabaseAnonKey: 'public-anon-key-for-tests-123456789' }, true);
  await happy.window.IntenseFXAuth.initialize();
  happy.ids.get('authEmail').value = 'trader@example.test';
  happy.ids.get('authPassword').value = 'testing123';
  await happy.ids.get('authForm').listeners.submit({ preventDefault() {} });
  assert.equal(happy.signInCalled, true);
  assert.equal(happy.bodyClasses.has('auth-required'), false, 'successful provider session opens the protected workspace');
  assert.equal(happy.window.location.hash, '#subscription', 'successful login opens all plan cards');
  happy.window.location.hash = '#backtesting';
  happy.authEvent('SIGNED_IN');
  await Promise.resolve(); await Promise.resolve();
  assert.equal(happy.window.location.hash, '#backtesting', 'session confirmation on tab focus must not reopen billing');
  happy.window.location.hash = '#prop-chart';
  happy.authEvent('TOKEN_REFRESHED');
  happy.authEvent('SIGNED_IN');
  await Promise.resolve(); await Promise.resolve();
  assert.equal(happy.window.location.hash, '#prop-chart', 'token refresh keeps the current workspace');
  assert.equal(happy.window.IntenseFXAuth.getPlan(), 'blue', 'profile access never promotes beyond the database plan');
  console.log('supabase_auth.test.js passed: local-mode compatibility, fail-closed config, gated session, form validation, registration fields');
})().catch((error) => { console.error(error); process.exitCode = 1; });

