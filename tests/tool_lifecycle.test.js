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
    devicePixelRatio: 1.5,
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
  open: 4300 + i * 0.1,
  high: 4302 + i * 0.1,
  low: 4298 + i * 0.1,
  close: 4301 + i * 0.1,
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

function event(x, y, extra = {}) {
  return { clientX: x, clientY: y, key: extra.key || "", ...extra };
}

const drawing = sandbox.window.IntenseDrawing;
const engine = drawing.createDrawingEngine({ eventTarget: sandbox.window, coordinateAdapter: adapter, getSymbol: () => "XAUUSD" });
engine.initialize();

assert.ok(engine.toolRegistry.hasTool(drawing.DrawingTypes.HORIZONTAL_LINE), "horizontal line tool registered");
assert.ok(engine.toolRegistry.hasTool(drawing.DrawingTypes.VERTICAL_LINE), "vertical line tool registered");
assert.ok(engine.toolRegistry.hasTool(drawing.DrawingTypes.TREND_LINE), "trend line tool registered");

assert.throws(() => engine.toolRegistry.registerTool({ id: drawing.DrawingTypes.TREND_LINE }), /already registered/, "duplicate tool IDs are rejected");

engine.activateTool(drawing.DrawingTypes.HORIZONTAL_LINE);
assert.equal(engine.getActiveTool(), drawing.DrawingTypes.HORIZONTAL_LINE, "active tool state works");
engine.handlePointerMove(event(500, 250));
assert.ok(engine.state.temporaryDrawing, "horizontal preview exists");
assert.equal(engine.getDrawings().length, 0, "preview is not persistent");
engine.handlePointerDown(event(500, 250));
assert.equal(engine.getDrawings().length, 1, "horizontal line created through DrawingManager");
assert.equal(engine.getDrawings()[0].type, drawing.DrawingTypes.HORIZONTAL_LINE, "horizontal drawing type stored");
assert.equal(engine.getActiveTool(), drawing.DrawingTypes.SELECT, "single-use tool returns to select");

engine.activateTool(drawing.DrawingTypes.VERTICAL_LINE);
engine.handlePointerMove(event(620, 320));
engine.toolController.cancel();
assert.equal(engine.state.temporaryDrawing, null, "cancel removes temporary preview");
assert.equal(engine.getDrawings().length, 1, "cancel does not create persistent drawing");
engine.handlePointerMove(event(620, 320));
engine.handlePointerDown(event(620, 320));
assert.equal(engine.getDrawings().length, 2, "vertical line completes with one anchor");

engine.activateTool(drawing.DrawingTypes.TREND_LINE);
engine.handlePointerMove(event(420, 260));
assert.ok(engine.state.temporaryDrawing, "trend preview starts on move");
engine.handlePointerDown(event(420, 260));
assert.equal(engine.getDrawings().length, 2, "first trend anchor is temporary only");
const firstAnchor = engine.state.temporaryDrawing.anchors[0];
engine.handlePointerMove(event(700, 190));
assert.equal(engine.state.temporaryDrawing.anchors.length, 2, "trend preview has anchor plus cursor");
engine.handleKeyDown({ key: "Escape" });
assert.equal(engine.state.temporaryDrawing, null, "ESC cancels trend creation");
assert.equal(engine.getDrawings().length, 2, "ESC does not create drawing");

engine.activateTool(drawing.DrawingTypes.TREND_LINE);
engine.handlePointerDown(event(420, 260));
engine.handlePointerMove(event(700, 190));
engine.handlePointerDown(event(700, 190));
assert.equal(engine.getDrawings().length, 3, "trend line completes after two anchors");
const trend = engine.getDrawings().find((item) => item.type === drawing.DrawingTypes.TREND_LINE);
assert.ok(trend.id && trend.anchors.length === 2, "trend line has unique ID and two anchors");
assert.equal(trend.anchors[0].time, firstAnchor.time, "trend anchor uses CoordinateManager logical time");
assert.ok(Number.isFinite(trend.anchors[0].price), "trend anchor uses CoordinateManager logical price");
assert.equal(engine.state.lastCreatedDrawingId, trend.id, "last created drawing is tracked");

engine.activateTool(drawing.DrawingTypes.TREND_LINE);
engine.handlePointerDown(event(450, 270));
assert.ok(engine.state.temporaryDrawing, "new trend creation starts");
engine.activateTool(drawing.DrawingTypes.VERTICAL_LINE);
assert.equal(engine.state.temporaryDrawing, null, "tool switching removes stale preview");
assert.equal(engine.getActiveTool(), drawing.DrawingTypes.VERTICAL_LINE, "new tool becomes active");

const eventTypes = emitted.map((item) => item.type);
["TOOL_ACTIVATED", "TOOL_DEACTIVATED", "TOOL_CHANGED", "DRAWING_CREATION_STARTED", "DRAWING_PREVIEW_UPDATED", "DRAWING_CREATED", "DRAWING_CREATION_CANCELLED", "DRAWING_CREATION_COMPLETED"].forEach((name) => {
  assert.ok(eventTypes.some((type) => type.endsWith(`:${name}`)), `${name} emitted`);
});

console.log("tool_lifecycle.test.js passed");
