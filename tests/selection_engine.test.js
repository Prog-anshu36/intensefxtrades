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
const candles = Array.from({ length: 240 }, (_, i) => ({
  time: baseTime + i * 60_000,
  date: new Date(baseTime + i * 60_000),
  open: 4300,
  high: 4310,
  low: 4290,
  close: 4305,
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
const engine = drawing.createDrawingEngine({ eventTarget: sandbox.window, coordinateAdapter: adapter, getSymbol: () => "XAUUSD" });
engine.initialize();

const anchor = (minutes, price) => engine.createAnchor(baseTime + minutes * 60_000, price);
const hline = engine.createDrawing(drawing.DrawingTypes.HORIZONTAL_LINE, { anchors: [anchor(60, 4350)], layer: 1 });
const vline = engine.createDrawing(drawing.DrawingTypes.VERTICAL_LINE, { anchors: [anchor(75, 4330)], layer: 2 });
const trend = engine.createDrawing(drawing.DrawingTypes.TREND_LINE, { anchors: [anchor(55, 4360), anchor(85, 4320)], layer: 3 });

const hPoint = engine.logicalToScreen(hline.anchors[0]);
const hHit = engine.hitTest({ x: hPoint.x + 4, y: hPoint.y + 2 });
assert.equal(hHit.drawingId, hline.id, "horizontal line hit test selects line within tolerance");
assert.equal(hHit.hitType, "line", "horizontal line hit has line type");

engine.selectDrawing(trend.id);
assert.deepEqual(engine.selectionManager.getSelectedIds(), [trend.id], "single selection works");
engine.selectDrawing(hline.id, { toggle: true });
assert.deepEqual(new Set(engine.selectionManager.getSelectedIds()), new Set([trend.id, hline.id]), "multi-selection toggle adds object");
engine.selectDrawing(hline.id, { toggle: true });
assert.deepEqual(engine.selectionManager.getSelectedIds(), [trend.id], "multi-selection toggle removes object");

const firstAnchorScreen = engine.logicalToScreen(trend.anchors[0]);
const anchorHit = engine.hitTest({ x: firstAnchorScreen.x, y: firstAnchorScreen.y });
assert.equal(anchorHit.hitType, "anchor", "selected anchor hit takes priority");
assert.equal(anchorHit.anchorIndex, 0, "anchor index is reported");

const startLogical = engine.screenToLogical(firstAnchorScreen.x, firstAnchorScreen.y);
engine.startSelectionDrag(anchorHit, startLogical);
const movedAnchorLogical = engine.screenToLogical(firstAnchorScreen.x + 30, firstAnchorScreen.y - 20);
engine.updateSelectionDrag(movedAnchorLogical);
engine.endSelectionDrag();
const resizedTrend = engine.getDrawing(trend.id);
assert.equal(resizedTrend.anchors[0].time, movedAnchorLogical.time, "anchor drag updates logical time");
assert.equal(resizedTrend.anchors[0].price, movedAnchorLogical.price, "anchor drag updates logical price");
assert.equal(resizedTrend.anchors[1].time, trend.anchors[1].time, "anchor drag does not move opposite anchor");

engine.selectDrawing(trend.id);
const bodyHit = engine.hitTest(engine.logicalToScreen(resizedTrend.anchors[1]));
const bodyStart = engine.screenToLogical(bodyHit.drawing.anchors[1].time ? engine.logicalToScreen(bodyHit.drawing.anchors[1]).x : firstAnchorScreen.x, engine.logicalToScreen(bodyHit.drawing.anchors[1]).y);
engine.startSelectionDrag({ drawing: resizedTrend, hitType: "body" }, bodyStart);
const bodyEnd = engine.screenToLogical(engine.logicalToScreen(resizedTrend.anchors[1]).x + 20, engine.logicalToScreen(resizedTrend.anchors[1]).y + 10);
engine.updateSelectionDrag(bodyEnd);
engine.endSelectionDrag();
const movedTrend = engine.getDrawing(trend.id);
assert.notEqual(movedTrend.anchors[0].time, resizedTrend.anchors[0].time, "object drag changes anchor logical time");
assert.notEqual(movedTrend.anchors[0].price, resizedTrend.anchors[0].price, "object drag changes anchor logical price");

engine.updateDrawing(vline.id, { visible: false });
const hiddenPoint = engine.logicalToScreen(vline.anchors[0]);
const hiddenHit = engine.hitTest({ x: hiddenPoint.x, y: hiddenPoint.y });
assert.notEqual(hiddenHit?.drawingId, vline.id, "hidden drawing cannot be selected");

const boxIds = engine.hitTestEngine.hitTestBox({
  x1: hPoint.x - 20,
  y1: hPoint.y - 20,
  x2: hPoint.x + 20,
  y2: hPoint.y + 20,
});
assert.ok(boxIds.includes(hline.id), "box selection finds intersecting drawing");

engine.selectionManager.hover(hline.id);
engine.selectionManager.hover(null);
const eventTypes = emitted.map((item) => item.type);
["DRAWING_SELECTED", "DRAWING_SELECTION_CHANGED", "DRAWING_HOVERED", "DRAWING_HOVER_CLEARED", "DRAWING_DRAG_STARTED", "DRAWING_DRAG_UPDATED", "DRAWING_DRAG_ENDED"].forEach((name) => {
  assert.ok(eventTypes.some((type) => type.endsWith(`:${name}`)), `${name} emitted`);
});

console.log("selection_engine.test.js passed");
