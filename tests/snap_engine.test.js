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

const emitted = [];
const sandbox = {
  window: {
    devicePixelRatio: 1,
    dispatchEvent(event) {
      emitted.push(event);
      return true;
    },
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
  Math,
  console,
  structuredClone: global.structuredClone,
};
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
scripts.forEach((file) => vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), sandbox, { filename: file }));

const baseTime = Date.UTC(2026, 7, 13, 17, 0, 0);
const candles = Array.from({ length: 180 }, (_, i) => ({
  time: baseTime + i * 60_000,
  date: new Date(baseTime + i * 60_000),
  open: 4300 + i * 0.1,
  high: 4310 + i * 0.1,
  low: 4290 + i * 0.1,
  close: 4305 + i * 0.1,
}));
const adapter = {
  getContainerRect: () => ({ left: 20, top: 10, right: 1020, bottom: 610, width: 1000, height: 600 }),
  getMetrics: (rect) => {
    const rightAxis = 78;
    const bottomAxis = 24;
    const topPad = 8;
    const chartWidth = rect.width - rightAxis;
    const priceHeight = rect.height - bottomAxis - topPad;
    const totalSlots = 126;
    const candleW = chartWidth / totalSlots;
    return { rightAxis, bottomAxis, topPad, chartWidth, priceHeight, totalSlots, candleW };
  },
  getWindowState: () => ({ start: 20, end: 139, logicalStart: 20, visible: candles.slice(20, 140), hi: 4400, lo: 4250 }),
  getCandles: () => candles,
  getDevicePixelRatio: () => 1,
};

const drawing = sandbox.window.IntenseDrawing;
const engine = drawing.createDrawingEngine({ eventTarget: sandbox.window, coordinateAdapter: adapter, getSymbol: () => "XAUUSD", getReplayLimit: () => 139 });
engine.initialize();

const candleIndex = 60;
const high = candles[candleIndex].high;
const highScreen = engine.logicalToScreen(candles[candleIndex].date.getTime(), high);
const nearHigh = engine.screenToLogical(highScreen.x + 3, highScreen.y + 2);
const highSnap = engine.snapLogical(nearHigh);
assert.equal(highSnap.snapped, true, "magnet snaps near candle high");
assert.equal(highSnap.logical.price, high, "high snap uses exact candle high price");
assert.equal(highSnap.logical.time, candles[candleIndex].date.getTime(), "high snap uses exact candle time");

engine.setMagnetEnabled(false);
const disabled = engine.snapLogical(nearHigh);
assert.equal(disabled.snapped, false, "magnet can be disabled");
engine.setMagnetEnabled(true);

const anchorDrawing = engine.createDrawing(drawing.DrawingTypes.TREND_LINE, {
  anchors: [
    engine.createAnchor(candles[70].date.getTime(), 4344),
    engine.createAnchor(candles[90].date.getTime(), 4322),
  ],
});
const anchorScreen = engine.logicalToScreen(anchorDrawing.anchors[0]);
const anchorSnap = engine.snapLogical(engine.screenToLogical(anchorScreen.x + 2, anchorScreen.y + 2));
assert.equal(anchorSnap.snapType, drawing.SnapCandidateTypes.DRAWING_ANCHOR, "existing drawing anchor has highest snap priority nearby");
assert.equal(anchorSnap.logical.price, anchorDrawing.anchors[0].price, "anchor snap uses exact anchor price");

const hline = engine.createDrawing(drawing.DrawingTypes.HORIZONTAL_LINE, { anchors: [engine.createAnchor(candles[80].date.getTime(), 4366)] });
const hlineScreen = engine.logicalToScreen(candles[82].date.getTime(), hline.anchors[0].price);
const hlineSnap = engine.snapLogical(engine.screenToLogical(hlineScreen.x + 9, hlineScreen.y + 2), { excludeDrawingId: anchorDrawing.id });
assert.equal(hlineSnap.snapType, drawing.SnapCandidateTypes.HORIZONTAL_LINE, "horizontal line price snapping works");
assert.equal(hlineSnap.logical.price, hline.anchors[0].price, "horizontal line snap only changes price");

const vline = engine.createDrawing(drawing.DrawingTypes.VERTICAL_LINE, { anchors: [engine.createAnchor(candles[100].date.getTime(), 4333)] });
const vlineScreen = engine.logicalToScreen(vline.anchors[0].time, 4355);
const vlineSnap = engine.snapLogical(engine.screenToLogical(vlineScreen.x + 2, vlineScreen.y + 9), { excludeDrawingId: anchorDrawing.id });
assert.equal(vlineSnap.snapType, drawing.SnapCandidateTypes.VERTICAL_LINE, "vertical line time snapping works");
assert.equal(vlineSnap.logical.time, vline.anchors[0].time, "vertical line snap only changes time");

engine.activateTool(drawing.DrawingTypes.HORIZONTAL_LINE);
engine.handlePointerDown({ clientX: highScreen.x + 3, clientY: highScreen.y + 2 });
const created = engine.getDrawings().find((item) => item.type === drawing.DrawingTypes.HORIZONTAL_LINE && item.id !== hline.id);
assert.equal(created.anchors[0].price, high, "drawing creation stores snapped coordinates");

engine.selectDrawing(anchorDrawing.id);
const dragHit = engine.hitTest(anchorScreen);
engine.startSelectionDrag(dragHit, engine.screenToLogical(anchorScreen.x, anchorScreen.y));
const lowScreen = engine.logicalToScreen(candles[62].date.getTime(), candles[62].low);
engine.updateSelectionDrag(engine.screenToLogical(lowScreen.x + 2, lowScreen.y + 2));
engine.endSelectionDrag();
const dragged = engine.getDrawing(anchorDrawing.id);
assert.equal(dragged.anchors[0].price, candles[62].low, "anchor drag snaps to exact candle low");

const far = engine.snapLogical({ type: "time-price", time: candles[63].date.getTime() + 30_000, price: 4390, metadata: { indexFloat: 63.5 } });
assert.equal(far.snapped, false, "snap releases outside threshold");

const eventTypes = emitted.map((item) => item.type);
["SNAP_CHANGED", "SNAP_CLEARED", "MAGNET_CHANGED"].forEach((name) => {
  assert.ok(eventTypes.some((type) => type.endsWith(`:${name}`)), `${name} emitted`);
});

console.log("snap_engine.test.js passed");
