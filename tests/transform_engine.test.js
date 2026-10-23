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
  window: { devicePixelRatio: 1.5, dispatchEvent(event) { emitted.push(event); return true; } },
  CustomEvent: class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
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
  getDevicePixelRatio: () => 1.5,
};

const drawing = sandbox.window.IntenseDrawing;
const engine = drawing.createDrawingEngine({ eventTarget: sandbox.window, coordinateAdapter: adapter, getSymbol: () => "XAUUSD", getReplayLimit: () => 139 });
engine.initialize();
const anchor = (i, price) => engine.createAnchor(candles[i].date.getTime(), price);

const rectangle = engine.createDrawing(drawing.DrawingTypes.RECTANGLE, { anchors: [anchor(60, 4360), anchor(80, 4320)] });
engine.selectDrawing(rectangle.id);
const rectHandles = engine.transformEngine.getHandles(rectangle);
assert.equal(rectHandles.length, 8, "rectangle exposes eight transform handles");
const se = rectHandles.find((handle) => handle.id === "se");
assert.ok(se, "rectangle has southeast corner handle");
const hit = engine.hitTest({ x: se.screen.x, y: se.screen.y });
assert.equal(hit.hitType, "handle", "handle hit testing returns handle hit type");
assert.equal(hit.handle.id, "se", "handle hit carries semantic handle id");

const start = engine.screenToLogical(se.screen.x, se.screen.y);
engine.startSelectionDrag(hit, start);
const target = engine.screenToLogical(se.screen.x + 40, se.screen.y + 30);
engine.updateSelectionDrag(target);
const resizeResult = engine.endSelectionDrag();
engine.updateDrawingsWithHistory(resizeResult.before, resizeResult.after, "Resize Rectangle");
const resized = engine.getDrawing(rectangle.id);
assert.ok(resized.anchors[0].time < resized.anchors[1].time, "rectangle remains valid after corner crossing logic");
assert.ok(resized.anchors[0].price > resized.anchors[1].price, "rectangle price anchors remain normalized");
engine.undo();
assert.equal(engine.getDrawing(rectangle.id).anchors[1].time, rectangle.anchors[1].time, "undo rectangle resize restores anchor time");
engine.redo();
assert.equal(engine.getDrawing(rectangle.id).anchors[1].time, resized.anchors[1].time, "redo rectangle resize restores resized time");

const trend = engine.createDrawing(drawing.DrawingTypes.TREND_LINE, { anchors: [anchor(70, 4350), anchor(90, 4330)] });
engine.selectDrawing(trend.id);
const trendHandle = engine.transformEngine.getHandles(trend)[0];
engine.startSelectionDrag({ drawing: trend, hitType: "anchor", handle: trendHandle, anchorIndex: 0 }, engine.screenToLogical(trendHandle.screen.x, trendHandle.screen.y));
const highScreen = engine.logicalToScreen(candles[72].date.getTime(), candles[72].high);
engine.updateSelectionDrag(engine.screenToLogical(highScreen.x + 2, highScreen.y + 2));
const trendResult = engine.endSelectionDrag();
engine.updateDrawingsWithHistory(trendResult.before, trendResult.after, "Move Trend Anchor");
assert.equal(engine.getDrawing(trend.id).anchors[0].price, candles[72].high, "trend anchor resize uses snap engine");
engine.undo();
assert.equal(engine.getDrawing(trend.id).anchors[0].price, trend.anchors[0].price, "undo trend anchor move works");

const hline = engine.createDrawing(drawing.DrawingTypes.HORIZONTAL_LINE, { anchors: [anchor(75, 4344)] });
engine.selectDrawing(hline.id);
const hHandle = engine.transformEngine.getHandles(hline)[0];
engine.startSelectionDrag({ drawing: hline, hitType: "anchor", handle: hHandle, anchorIndex: 0 }, engine.screenToLogical(hHandle.screen.x, hHandle.screen.y));
engine.updateSelectionDrag(engine.screenToLogical(hHandle.screen.x + 80, hHandle.screen.y - 20));
engine.endSelectionDrag();
const movedH = engine.getDrawing(hline.id);
assert.equal(movedH.anchors[0].time, hline.anchors[0].time, "horizontal line resize preserves time");
assert.notEqual(movedH.anchors[0].price, hline.anchors[0].price, "horizontal line resize changes price");

const vline = engine.createDrawing(drawing.DrawingTypes.VERTICAL_LINE, { anchors: [anchor(85, 4333)] });
engine.selectDrawing(vline.id);
const vHandle = engine.transformEngine.getHandles(vline)[0];
engine.startSelectionDrag({ drawing: vline, hitType: "anchor", handle: vHandle, anchorIndex: 0 }, engine.screenToLogical(vHandle.screen.x, vHandle.screen.y));
engine.updateSelectionDrag(engine.screenToLogical(vHandle.screen.x + 60, vHandle.screen.y - 50));
engine.endSelectionDrag();
const movedV = engine.getDrawing(vline.id);
assert.notEqual(movedV.anchors[0].time, vline.anchors[0].time, "vertical line resize changes time");
assert.equal(movedV.anchors[0].price, vline.anchors[0].price, "vertical line resize preserves price");

engine.selectionManager.selectMultiple([hline.id, vline.id]);
const beforeGroup = [engine.getDrawing(hline.id), engine.getDrawing(vline.id)];
const groupPoint = engine.logicalToScreen(beforeGroup[0].anchors[0]);
engine.startSelectionDrag({ drawing: beforeGroup[0], hitType: "body" }, engine.screenToLogical(groupPoint.x, groupPoint.y));
engine.updateSelectionDrag(engine.screenToLogical(groupPoint.x + 20, groupPoint.y + 20));
const groupResult = engine.endSelectionDrag();
engine.updateDrawingsWithHistory(groupResult.before, groupResult.after, "Move Group");
assert.equal(engine.history.getUndoCount() > 0, true, "group move can be committed to history");
engine.undo();
assert.equal(engine.getDrawing(hline.id).anchors[0].price, beforeGroup[0].anchors[0].price, "undo group move restores horizontal line");

const eventTypes = emitted.map((item) => item.type);
assert.ok(eventTypes.some((type) => type.endsWith(":DRAWING_DRAG_STARTED")), "drag start event emitted");
assert.ok(eventTypes.some((type) => type.endsWith(":DRAWING_DRAG_ENDED")), "drag end event emitted");

console.log("transform_engine.test.js passed");
