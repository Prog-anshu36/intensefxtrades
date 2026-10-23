const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const buttons = Object.fromEntries(['#btnBuy', '#btnSell'].map(id => [id, { disabled: false, price: {}, querySelector() { return this.price; } }]));
let order;
const sandbox = {
  window: {}, Date, Math,
  MarketData: { TF_MINUTES: { '1m': 1 }, isLocal: () => true, getMeta: () => ({ decimals: 2, pip: 0.01 }) },
  Fmt: { price: p => Number(p).toFixed(2), dateTime: () => '' },
  Store: { state: { active_trades: [], pending_orders: [], history: [] }, refresh: async () => {} },
  API: { openTrade: async payload => { order = payload; return { id: 1 }; } },
  toast: () => {},
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../frontend/static/js/page_backtesting.js'), 'utf8'), sandbox);
const page = sandbox.window.PageBacktesting;
page.symbol = 'XAUUSD'; page.timeframe = '1m'; page.dataSource = 'local-csv';
page.container = { querySelector: selector => buttons[selector] || null };
page.candles = [
  { time: 60000, date: new Date(60000), close: 2000, bid: { close: 1999.9 }, ask: { close: 2000.1 } },
  { time: 120000, date: new Date(120000), close: 2002, bid: { close: 2001.9 }, ask: { close: 2002.1 } },
];
page.idx = 0; page.syncOrderPrices();
assert.equal(buttons['#btnBuy'].price.textContent, '2000.10');
assert.equal(buttons['#btnSell'].price.textContent, '1999.90');
page.idx = 1; page.syncOrderPrices();
assert.equal(buttons['#btnBuy'].price.textContent, '2002.10');
assert.equal(buttons['#btnSell'].price.textContent, '2001.90');
page.rerender = () => {};
(async () => {
  await page.placeTrade('BUY');
  assert.equal(order.entry, 2002.1);
  assert.equal(order.opened_at, new Date(180000).toISOString());
  await page.placeTrade('SELL');
  assert.equal(order.entry, 2001.9);
  page.stopPlay = () => {};
  page.slEnabled = true; page.tpEnabled = true; page.slPips = 100; page.tpPips = 200;
  page.previewOrder('BUY');
  assert.equal(page.orderDraft.sl, 2001.1);
  assert.equal(page.orderDraft.tp, 2004.1);
  page.orderDraft.sl = 2000; page.orderDraft.tp = 2005;
  await page.confirmOrderDraft();
  assert.equal(order.sl, 2000); assert.equal(order.tp, 2005);
  assert.equal(page.orderDraft, null);
  page.previewOrder('SELL');
  page.orderDraft.sl = 1990;
  const previousOrder = order;
  await page.confirmOrderDraft();
  assert.equal(order, previousOrder, 'invalid sell stop must not submit');
  assert.ok(page.orderDraft.error);
  page.previewOrder('SELL');
  page.idx = 0;
  await page.confirmOrderDraft();
  assert.equal(order, previousOrder, 'moving replay invalidates the preview');
  assert.ok(page.orderDraft.error);
  page.idx = 1;
  page.candles[1] = { time: 120000, date: new Date(120000), close: 2002 };
  page.syncOrderPrices();
  assert.equal(buttons['#btnBuy'].price.textContent, '2002.00');
  assert.equal(buttons['#btnSell'].price.textContent, '2002.00');
  page.dataSource = 'unavailable'; page.syncOrderPrices();
  assert.equal(buttons['#btnBuy'].disabled, true);
  assert.equal(buttons['#btnBuy'].price.textContent, '--');
  console.log('chart_order_sync.test.js passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
