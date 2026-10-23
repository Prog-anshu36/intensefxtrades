const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const handlers = {};
const noop = () => {};
const canvas = {
  addEventListener: (name, fn) => { handlers[name] = fn; },
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 600 }),
  style: {}, classList: { add: noop, remove: noop },
  setPointerCapture: noop, releasePointerCapture: noop,
};
const sandbox = {
  window: { addEventListener: noop, removeEventListener: noop },
  document: { addEventListener: noop, removeEventListener: noop },
  performance: { now: () => 100 }, Date, Math,
  MarketData: { TF_MINUTES: { '1m': 1 }, getMeta: () => ({ decimals: 2 }) },
  Fmt: { price: String, dateTime: String }, UI: { updateStatusBar: noop },
  cancelAnimationFrame: noop,
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('frontend/static/js/page_backtesting.js', 'utf8'), sandbox);
const page = sandbox.window.PageBacktesting;
page.candles = [{ date: new Date(60000), close: 2000 }]; page.idx = 0;
page.tool = 'rectangle'; page.cursorMode = 'crosshair';
page.drawingToolType = () => 'rectangle';
page.engineToolForUiTool = () => 'rectangle';
page.chartWindow = () => ({ start: 0, logicalStart: 0, visible: page.candles, hi: 2100, lo: 1900 });
page.chartCoordinates = () => ({ xToIndex: x => x / 10, yToPrice: y => 2100 - y });
page.drawingCoordinateAdapter = () => ({});
page.scheduleDraw = page.scheduleDrawingDraw = page.scheduleInteractionDraw = noop;
page.syncToolControllerResult = noop;
const calls = [];
page.drawingEngine = {
  setCoordinateAdapter: noop,
  handlePointerDown: () => { calls.push('down'); return true; },
  handlePointerMove: () => { calls.push('move'); return true; },
  handlePointerUp: () => { calls.push('up'); return true; },
  toolController: { cancel: () => calls.push('cancel') },
};
page.syncLegacyDrawingsFromEngine = noop;
page.bindChartInteractions({ querySelector: s => ['#tvCanvas', '#chartCard'].includes(s) ? canvas : null });
const event = (x, y) => ({ pointerId: 1, button: 0, clientX: x, clientY: y, preventDefault: noop });
handlers.pointerdown(event(100, 100));
handlers.pointermove(event(200, 200));
handlers.pointerup(event(200, 200));
assert.deepEqual(calls, ['down', 'move', 'up'], 'chart forwards the complete drag creation lifecycle');
calls.length = 0;
handlers.pointerdown(event(100, 100)); handlers.pointercancel();
assert.deepEqual(calls, ['down', 'cancel'], 'cancelled pointer cleans up unfinished tool');
console.log('chart_pointer_integration.test.js passed');
