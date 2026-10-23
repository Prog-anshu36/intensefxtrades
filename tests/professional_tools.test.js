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
  window: { devicePixelRatio: 1, dispatchEvent(event) { emitted.push(event); return true; } },
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

const drawing = sandbox.window.IntenseDrawing;
const baseTime = Date.UTC(2026, 7, 13, 17, 0, 0);
const candles = Array.from({ length: 60 }, (_, i) => ({
  time: baseTime + i * 60_000,
  date: new Date(baseTime + i * 60_000),
  open: 4300 + i,
  high: 4310 + i,
  low: 4290 + i,
  close: 4305 + i,
}));
const adapter = {
  getContainerRect: () => ({ left: 0, top: 0, width: 600, height: 420, right: 600, bottom: 420 }),
  getMetrics: () => ({ rightAxis: 60, bottomAxis: 24, topPad: 8, chartWidth: 540, priceHeight: 388, totalSlots: 60, candleW: 9 }),
  getWindowState: () => ({ start: 0, end: 59, logicalStart: 0, visible: candles, hi: 4380, lo: 4280 }),
  getCandles: () => candles,
  getDevicePixelRatio: () => 1,
};
const engine = drawing.createDrawingEngine({
  eventTarget: sandbox.window,
  coordinateAdapter: adapter,
  getSymbol: () => "XAUUSD",
  getReplayLimit: () => 59,
});
engine.initialize();

assert.ok(engine.toolRegistry.searchTools("fib").some((tool) => tool.id === drawing.DrawingTypes.FIB_RETRACEMENT), "tool search finds fibonacci");
assert.ok(engine.toolRegistry.getToolsByCategory(drawing.ToolCategories.LINES).length >= 8, "line category contains the professional line set");

function screenFor(index, price) {
  const x = index * 9 + 4.5;
  const y = 8 + ((4380 - price) / 100) * (388 - 8);
  return { clientX: x, clientY: y };
}

function createWithPointers(toolId, points, options = {}) {
  assert.equal(engine.activateTool(toolId), true, `activate ${toolId}`);
  engine.handlePointerMove(screenFor(points[0][0], points[0][1]));
  if (engine.toolRegistry.getActiveTool().creationMode === 'freehand') {
    assert.equal(engine.state.temporaryDrawing, null, 'freehand hover cannot paint before mouse down');
  } else assert.ok(engine.state.temporaryDrawing, `${toolId} creates preview`);
  points.forEach(([index, price]) => {
    engine.handlePointerDown(screenFor(index, price));
    engine.handlePointerMove(screenFor(index + 1, price + 1));
  });
  if (options.doubleClick) engine.handleDoubleClick(screenFor(points[points.length - 1][0], points[points.length - 1][1]));
  if (options.enter) engine.handleKeyDown({ key: "Enter" });
  const id = engine.state.lastCreatedDrawingId;
  const created = engine.getDrawing(id);
  assert.ok(created, `${toolId} commits through DrawingManager`);
  assert.equal(created.type, toolId, `${toolId} stores canonical type`);
  assert.equal(created.symbol, "XAUUSD", `${toolId} stores symbol`);
  assert.equal(created.version, 1, `${toolId} stores version`);
  assert.ok(created.anchors.every((anchor) => Number.isFinite(anchor.time) && Number.isFinite(anchor.price)), `${toolId} stores logical anchors`);
  return created;
}

const cases = [
  [drawing.DrawingTypes.HORIZONTAL_LINE, [[10, 4320]]],
  [drawing.DrawingTypes.VERTICAL_LINE, [[11, 4321]]],
  [drawing.DrawingTypes.TREND_LINE, [[12, 4322], [18, 4330]]],
  [drawing.DrawingTypes.RAY, [[13, 4323], [19, 4331]]],
  [drawing.DrawingTypes.EXTENDED_LINE, [[14, 4324], [20, 4332]]],
  [drawing.DrawingTypes.ARROW, [[15, 4325], [21, 4333]]],
  [drawing.DrawingTypes.HORIZONTAL_RAY, [[16, 4326]]],
  [drawing.DrawingTypes.VERTICAL_RAY, [[17, 4327]]],
  [drawing.DrawingTypes.RECTANGLE, [[18, 4328], [24, 4340]]],
  [drawing.DrawingTypes.ELLIPSE, [[19, 4329], [25, 4341]]],
  [drawing.DrawingTypes.TRIANGLE, [[20, 4330], [26, 4342], [24, 4318]]],
  [drawing.DrawingTypes.PARALLEL_CHANNEL, [[21, 4331], [27, 4343], [23, 4320]]],
  [drawing.DrawingTypes.FIB_RETRACEMENT, [[22, 4332], [28, 4344]]],
  [drawing.DrawingTypes.PRICE_RANGE, [[23, 4333], [29, 4345]]],
  [drawing.DrawingTypes.DATE_RANGE, [[24, 4334], [30, 4346]]],
  [drawing.DrawingTypes.PRICE_DATE_RANGE, [[25, 4335], [31, 4347]]],
  [drawing.DrawingTypes.TEXT, [[26, 4336]]],
];
const created = cases.map(([type, points]) => createWithPointers(type, points));
const polygon = createWithPointers(drawing.DrawingTypes.POLYGON, [[27, 4337], [33, 4349], [30, 4322]], { enter: true });
const brush = createWithPointers(drawing.DrawingTypes.BRUSH, [[28, 4338], [29, 4339], [30, 4340]], { enter: true });

assert.equal(new Set(engine.getDrawings().map((item) => item.id)).size, engine.getDrawings().length, "all created drawings have unique IDs");
assert.ok(engine.getDrawing(created[5].id).properties.arrowEnd, "arrow defaults include end arrow head");
assert.ok(Array.isArray(engine.getDrawing(created[12].id).properties.levels), "fibonacci defaults include levels");
assert.ok(polygon.anchors.length >= 3, "polygon foundation stores multiple anchors");
assert.ok(brush.anchors.length >= 2, "brush stores freehand logical anchors");

engine.selectDrawing(created[8].id);
const hit = engine.hitTest(engine.coordinateManager.logicalToScreen(created[8].anchors[0]), { drawings: engine.getDrawings() });
assert.ok(hit, "new tools participate in hit testing");
assert.ok(engine.transformEngine.getHandles(created[8]).length >= 8, "rectangle uses TransformEngine handles");
engine.updateDrawingProperties([created[8].id], { style: { fillColor: "#00ff00", fillOpacity: 0.2 } });
assert.equal(engine.getDrawing(created[8].id).style.fillColor, "#00ff00", "new shape integrates with PropertyEngine");
engine.undo();
engine.redo();
assert.equal(engine.getDrawing(created[8].id).style.fillColor, "#00ff00", "property changes use HistoryManager");

const eventTypes = emitted.map((event) => event.type);
assert.ok(eventTypes.some((type) => type.endsWith(":DRAWING_CREATION_COMPLETED")), "creation completion event emitted");
assert.ok(eventTypes.some((type) => type.endsWith(":SNAP_CHANGED") || type.endsWith(":SNAP_CLEARED")), "SnapEngine participates during creation");

console.log("professional_tools.test.js passed");
