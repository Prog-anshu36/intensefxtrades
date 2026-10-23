const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const sandbox = { window: {}, Date, Math };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('frontend/static/js/drawing/coordinate-manager.js', 'utf8'), sandbox);
const CoordinateManager = sandbox.window.IntenseDrawing.CoordinateManager;
const base = Date.UTC(2025, 0, 1);
let width = 1200, height = 650, logicalStart = 12.25, count = 100, step = 60000;
let candles = [];
const build = () => { candles = Array.from({ length: 200 }, (_, i) => ({ time: base + i * step + (i >= 100 ? step * 2 : 0) })); };
build();
const manager = new CoordinateManager({
  continuousTime: true,
  getContainerRect: () => ({ left: 23, top: 41, width, height }),
  getMetrics: () => ({ topPad: 8, bottomAxis: 24, priceHeight: height - 32, chartWidth: width - 78, candleW: (width - 78) / (count + 6) }),
  getWindowState: () => ({ logicalStart, hi: 3000, lo: 2000 }),
  getCandles: () => candles,
  getTimeframeMs: () => step,
});
function verify() {
  for (const index of [-3.25, 0, 17.375, 99.5, 150, 202.75]) {
    const time = manager.indexToTime(index);
    const x = manager.timeToX(time);
    assert.ok(Math.abs(manager.xToTime(x) - time) < 0.001, 'timestamp round trip including gaps/future margin');
    assert.ok(Math.abs(manager.timeToIndex(time) - index) < 1e-7);
  }
  for (const price of [1900, 2000, 2345.6789, 3000, 3100]) {
    assert.ok(Math.abs(manager.yToPrice(manager.priceToY(price)) - price) < 1e-8, 'price round trip');
  }
}
verify();
count = 30; verify(); // zoom in
count = 300; verify(); // zoom out
logicalStart = 80.5; verify(); // pan
width = 460; height = 350; verify(); // resize
for (const minutes of [1, 5, 15, 30, 60, 240, 1440]) { step = minutes * 60000; build(); verify(); }
const before = JSON.stringify(candles);
verify();
assert.equal(JSON.stringify(candles), before, 'transformations never mutate dataset');
console.log('chart_foundation.test.js passed');
