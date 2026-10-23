const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const scripts = [
  "frontend/static/js/drawing/drawing-types.js",
  "frontend/static/js/drawing/drawing-events.js",
  "frontend/static/js/drawing/coordinate-manager.js",
  "frontend/static/js/drawing/anchor.js",
  "frontend/static/js/drawing/property-engine.js",
  "frontend/static/js/drawing/drawing-workspace-ux.js",
  "frontend/static/js/drawing/drawing-object.js",
  "frontend/static/js/drawing/drawing-state.js",
  "frontend/static/js/drawing/drawing-manager.js",
  "frontend/static/js/drawing/tool-registry.js",
  "frontend/static/js/drawing/drawing-renderer.js",
  "frontend/static/js/drawing/drawing-tools.js",
  "frontend/static/js/drawing/tool-controller.js",
  "frontend/static/js/drawing/transform-engine.js",
  "frontend/static/js/drawing/hit-test-engine.js",
  "frontend/static/js/drawing/selection-manager.js",
  "frontend/static/js/drawing/snap-engine.js",
  "frontend/static/js/drawing/history-manager.js",
  "frontend/static/js/drawing/drawing-engine.js",
  "frontend/static/js/drawing/index.js",
];

const sandbox = {
  window: {
    devicePixelRatio: 2,
    dispatchEvent() { return true; },
  },
  CustomEvent: class CustomEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  },
  Date,
  Map,
  Set,
  Error,
  JSON,
  structuredClone: global.structuredClone,
};
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
scripts.forEach((file) => vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), sandbox, { filename: file }));

function makeCandles(count, startMs, stepMs) {
  return Array.from({ length: count }, (_, i) => ({
    time: startMs + i * stepMs,
    date: new Date(startMs + i * stepMs),
    open: 100 + i,
    high: 102 + i,
    low: 98 + i,
    close: 101 + i,
  }));
}

function makeAdapter({ candles, logicalStart = 10, visibleCount = 100, width = 1000, height = 600, hi = 220, lo = 80 }) {
  return {
    getContainerRect: () => ({ left: 50, top: 25, right: 1050, bottom: 625, width, height }),
    getMetrics: (rect) => {
      const rightAxis = 78;
      const bottomAxis = 24;
      const topPad = 8;
      const chartWidth = rect.width - rightAxis;
      const priceHeight = rect.height - bottomAxis - topPad;
      const totalSlots = visibleCount + 6;
      const candleW = chartWidth / totalSlots;
      return { rightAxis, bottomAxis, topPad, chartWidth, priceHeight, totalSlots, candleW };
    },
    getWindowState: () => ({
      start: Math.floor(logicalStart),
      end: Math.floor(logicalStart + visibleCount - 1),
      logicalStart,
      visible: candles.slice(Math.floor(logicalStart), Math.floor(logicalStart + visibleCount)),
      hi,
      lo,
    }),
    getCandles: () => candles,
    getDevicePixelRatio: () => sandbox.window.devicePixelRatio,
  };
}

const { CoordinateManager, DrawingTypes, createDrawingEngine } = sandbox.window.IntenseDrawing;
const baseTime = Date.UTC(2026, 7, 13, 17, 0, 0);
const oneMinute = 60 * 1000;
const candles1m = makeCandles(300, baseTime, oneMinute);
const manager = new CoordinateManager(makeAdapter({ candles: candles1m }));

const screen = { x: 500, y: 300 };
const logical = manager.screenToLogical(screen.x, screen.y);
assert.ok(logical && Number.isFinite(logical.time) && Number.isFinite(logical.price), "screenToLogical returns time + price");
const roundTrip = manager.logicalToScreen(logical);
assert.ok(Math.abs(roundTrip.x - screen.x) < 6, "logicalToScreen returns near original x");
assert.ok(Math.abs(roundTrip.y - screen.y) < 0.0001, "logicalToScreen returns original y");

const anchor = manager.createAnchor(Date.UTC(2026, 7, 13, 17, 35, 0), 4335.203847, { snapSource: "manual" });
assert.equal(anchor.type, "time-price", "anchor uses time-price type");
assert.equal(anchor.price, 4335.203847, "price precision is preserved");
assert.equal(anchor.time, Date.UTC(2026, 7, 13, 17, 35, 0), "time precision is preserved as ms timestamp");
assert.ok(manager.validateAnchor(anchor), "valid anchor passes validation");
assert.equal(manager.createAnchor(null, Infinity), null, "invalid coordinates are rejected");

const before = JSON.stringify(anchor);
manager.setAdapter(makeAdapter({ candles: candles1m, logicalStart: 30, visibleCount: 35, hi: 5000, lo: 4200 }));
manager.logicalToScreen(anchor);
assert.equal(JSON.stringify(anchor), before, "zoom/pan/price scale do not mutate logical anchor");

const offscreen = manager.logicalToScreen(manager.createAnchor(candles1m[2].time, 110));
assert.ok(offscreen && offscreen.offscreen, "off-screen anchors return clearly marked coordinates");

const candles5m = makeCandles(80, baseTime, oneMinute * 5);
manager.setAdapter(makeAdapter({ candles: candles5m, logicalStart: 0, visibleCount: 60 }));
const screen5m = manager.logicalToScreen(anchor);
assert.equal(anchor.time, Date.UTC(2026, 7, 13, 17, 35, 0), "timeframe-style candle changes do not mutate anchor time");
assert.equal(anchor.price, 4335.203847, "timeframe-style candle changes do not mutate anchor price");
assert.ok(screen5m === null || typeof screen5m.offscreen === "boolean", "timeframe conversion has defined screen result");

const engine = createDrawingEngine({ eventTarget: sandbox.window, coordinateAdapter: makeAdapter({ candles: candles1m }) });
engine.initialize();
const drawing = engine.createDrawing(DrawingTypes.TEST_POINT, { anchors: [anchor], symbol: "XAUUSD" });
assert.equal(drawing.anchors[0].type, "time-price", "DrawingObject stores normalized time-price anchor");
assert.equal(drawing.anchors[0].time, anchor.time, "DrawingObject anchor stores logical time");
assert.equal(drawing.anchors[0].price, anchor.price, "DrawingObject anchor stores logical price");

const context = manager.getCoordinateContext();
assert.equal(context.devicePixelRatio, 2, "DPI is exposed in coordinate context");
assert.ok(context.containerRect.width === 1000 && context.plotRect.width > 0, "coordinate context exposes container and plot bounds");
assert.ok(manager.getDebugSnapshot(screen).logical, "debug snapshot includes logical coordinates");

console.log("coordinate_manager.test.js passed");
