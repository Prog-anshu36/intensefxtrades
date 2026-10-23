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
const engine = drawing.createDrawingEngine({ eventTarget: sandbox.window, coordinateAdapter: adapter, getSymbol: () => "XAUUSD", maxHistorySize: 3 });
engine.initialize();
const anchor = (i, price) => engine.createAnchor(candles[i].date.getTime(), price);

const created = engine.createDrawing(drawing.DrawingTypes.TREND_LINE, { anchors: [anchor(60, 4350), anchor(70, 4360)], symbol: "XAUUSD" });
assert.equal(engine.getDrawings().length, 1, "create command adds drawing");
assert.equal(engine.canUndo(), true, "history can undo create");
engine.undo();
assert.equal(engine.getDrawings().length, 0, "undo creation removes drawing");
engine.redo();
assert.equal(engine.getDrawings().length, 1, "redo creation restores drawing");

const beforeMove = [engine.getDrawing(created.id)];
const moved = { ...beforeMove[0], anchors: beforeMove[0].anchors.map((item) => engine.createAnchor(item.time + 60_000, item.price + 5, item.metadata)) };
engine.updateDrawingsWithHistory(beforeMove, [moved], "Move Drawing");
assert.equal(engine.getDrawing(created.id).anchors[0].price, beforeMove[0].anchors[0].price + 5, "move command applies final state");
engine.undo();
assert.equal(engine.getDrawing(created.id).anchors[0].price, beforeMove[0].anchors[0].price, "undo movement restores anchors");
engine.redo();
assert.equal(engine.getDrawing(created.id).anchors[0].price, moved.anchors[0].price, "redo movement reapplies anchors");

const beforeAnchor = [engine.getDrawing(created.id)];
const anchorMoved = { ...beforeAnchor[0], anchors: [engine.createAnchor(candles[80].date.getTime(), 4321), beforeAnchor[0].anchors[1]] };
engine.updateDrawingsWithHistory(beforeAnchor, [anchorMoved], "Move Anchor");
engine.undo();
assert.equal(engine.getDrawing(created.id).anchors[0].time, beforeAnchor[0].anchors[0].time, "undo anchor movement restores anchor time");
engine.redo();
assert.equal(engine.getDrawing(created.id).anchors[0].price, 4321, "redo anchor movement reapplies anchor price");

engine.selectDrawing(created.id);
engine.copySelectedDrawings();
engine.pasteDrawings({ offsetCandles: 3 });
assert.equal(engine.getDrawings().length, 2, "paste creates copied drawing");
const pastedId = engine.state.selectedDrawingIds[0];
assert.notEqual(pastedId, created.id, "paste receives unique ID");
engine.undo();
assert.equal(engine.getDrawings().length, 1, "undo paste removes pasted drawing");
engine.redo();
assert.equal(engine.getDrawings().length, 2, "redo paste restores pasted drawing");

engine.duplicateSelectedDrawings({ offsetCandles: 4 });
assert.equal(engine.getDrawings().length, 3, "duplicate creates new drawing");
engine.undo();
assert.equal(engine.getDrawings().length, 2, "undo duplicate removes duplicate");
engine.redo();
assert.equal(engine.getDrawings().length, 3, "redo duplicate restores duplicate");

const ids = engine.getDrawings().map((item) => item.id);
engine.deleteDrawings(ids);
assert.equal(engine.getDrawings().length, 0, "delete command removes multiple drawings");
engine.undo();
assert.equal(engine.getDrawings().length, 3, "undo delete restores multiple drawings");
engine.redo();
assert.equal(engine.getDrawings().length, 0, "redo delete removes them again");

engine.createDrawing(drawing.DrawingTypes.HORIZONTAL_LINE, { anchors: [anchor(90, 4340)] });
engine.undo();
assert.equal(engine.canRedo(), true, "redo stack exists after undo");
engine.createDrawing(drawing.DrawingTypes.VERTICAL_LINE, { anchors: [anchor(95, 4340)] });
assert.equal(engine.canRedo(), false, "new action clears redo stack");
assert.ok(engine.history.getUndoCount() <= 3, "history is bounded");

const eventTypes = emitted.map((item) => item.type);
["COMMAND_EXECUTED", "COMMAND_UNDONE", "COMMAND_REDONE", "HISTORY_CHANGED"].forEach((name) => {
  assert.ok(eventTypes.some((type) => type.endsWith(`:${name}`)), `${name} emitted`);
});

console.log("history_manager.test.js passed");
