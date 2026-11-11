/* Buy/Sell/Close must never get permanently stuck (disabled, unresponsive,
 * with no error shown) because of a stray exception mid-flow — e.g. a
 * malformed trade record making the open/closed table render throw, or any
 * other transient failure. Before this fix, _placingOrder/_closingTrade
 * could be left `true` forever by an exception thrown before the
 * try/finally, silently no-op'ing every future click until page reload. */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

function makePage() {
  const buttons = Object.fromEntries(['#btnBuy', '#btnSell'].map(id => [id, { disabled: false, price: {}, querySelector() { return this.price; } }]));
  const sandbox = {
    window: {}, Date, Math, console,
    MarketData: { TF_MINUTES: { '1m': 1 }, isLocal: () => true, getMeta: () => ({ decimals: 2, pip: 0.01 }) },
    Fmt: { price: p => Number(p).toFixed(2), dateTime: () => '' },
    Store: { state: { active_trades: [], pending_orders: [], history: [] }, refresh: async () => {} },
    API: { openTrade: async () => ({ id: 1 }), closeTrade: async () => ({}) },
    toast: () => {},
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../frontend/static/js/page_backtesting.js'), 'utf8'), sandbox);
  const page = sandbox.window.PageBacktesting;
  page.symbol = 'XAUUSD'; page.timeframe = '1m'; page.dataSource = 'local-csv';
  page.container = { querySelector: selector => buttons[selector] || null };
  page.candles = [{ time: 60000, date: new Date(60000), close: 2000, bid: { close: 1999.9 }, ask: { close: 2000.1 } }];
  page.idx = 0;
  page.rerender = () => {};
  return { page, buttons, sandbox };
}

(async () => {
  // 1) A broken open-trade table (e.g. a malformed cloud-synced record) must
  // not leave _placingOrder stuck true — the next order must still go through.
  {
    const { page, buttons } = makePage();
    page.renderOpenTable = () => { throw new Error('malformed trade record'); };
    let orders = 0;
    page.api.openTrade = async () => { orders++; return { id: orders }; };
    await page.placeTrade('BUY');
    assert.equal(orders, 1, 'first order still goes through despite the table render throwing');
    assert.equal(page._placingOrder, false, '_placingOrder must not be left stuck true');
    assert.equal(buttons['#btnBuy'].disabled, false, 'Buy button must not be left disabled');
    await page.placeTrade('BUY');
    assert.equal(orders, 2, 'a second order is not silently swallowed by a stale lock');
  }

  // 2) openTrade itself failing (network/API error) must not leave the lock stuck.
  {
    const { page } = makePage();
    page.api.openTrade = async () => { throw new Error('network error'); };
    await page.placeTrade('BUY');
    assert.equal(page._placingOrder, false, '_placingOrder resets even when the API call itself throws');
    let placed = false;
    page.api.openTrade = async () => { placed = true; return { id: 1 }; };
    await page.placeTrade('BUY');
    assert.ok(placed, 'a retry after a failed order is not blocked');
  }

  // 3) Closing a position: a failing closeTrade must not leave _closingTrade
  // stuck, and must surface as a toast rather than silently doing nothing.
  {
    const { page, sandbox } = makePage();
    page.store.state.active_trades = [{ id: 't1', symbol: 'XAUUSD', type: 'BUY' }];
    let toasted = null;
    page.api.closeTrade = async () => { throw new Error('close failed'); };
    sandbox.toast = (msg, kind) => { toasted = { msg, kind }; };
    await page.closeActive();
    assert.equal(page._closingTrade, false, '_closingTrade must not be left stuck true after a failed close');
    assert.ok(toasted && toasted.kind === 'error', 'a failed close surfaces an error toast instead of silently doing nothing');
    let closed = false;
    page.api.closeTrade = async () => { closed = true; return {}; };
    await page.closeActive();
    assert.ok(closed, 'closing again after a failure is not blocked by a stale lock');
  }

  console.log('order_buttons_never_stuck.test.js passed');
})();
