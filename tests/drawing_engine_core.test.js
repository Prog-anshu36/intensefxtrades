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
  structuredClone: global.structuredClone,
};
sandbox.window.window = sandbox.window;
sandbox.window.CustomEvent = sandbox.CustomEvent;

vm.createContext(sandbox);
scripts.forEach((file) => {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  vm.runInContext(source, sandbox, { filename: file });
});

const drawing = sandbox.window.IntenseDrawing;
assert.ok(drawing.createDrawingEngine, "DrawingEngine factory should exist");

const engine = drawing.createDrawingEngine({ eventTarget: sandbox.window });
engine.initialize({
  existingDrawings: [{
    id: "legacy_1",
    type: "trendLine",
    anchors: [{ timestamp: 1000, price: 10 }, { timestamp: 2000, price: 12 }],
    style: { color: "#fff" },
    visible: true,
    locked: false,
    layer: 2,
    symbol: "XAUUSD",
    timeframeScope: "all",
  }],
});

assert.ok(engine.initialized, "DrawingEngine initializes successfully");
assert.ok(engine.toolRegistry.hasTool(drawing.DrawingTypes.SELECT), "Tool Registry loads core tools");
assert.ok(engine.toolRegistry.hasTool(drawing.DrawingTypes.TEST_POINT), "Test object type is registered");
assert.equal(engine.getDrawings().length, 1, "Existing drawings are imported");
assert.equal(engine.getDrawing("legacy_1").type, drawing.DrawingTypes.TREND_LINE, "Existing drawing type migrates");

const point = engine.createDrawing(drawing.DrawingTypes.TEST_POINT, {
  anchors: [{ timestamp: 3000, price: 15 }],
  symbol: "XAUUSD",
});
assert.ok(point.id, "Object receives a unique ID");
assert.ok(engine.getDrawing(point.id), "Object can be retrieved by ID");

const updated = engine.updateDrawing(point.id, { style: { color: "#3d7fff" }, metadata: { label: "test" } });
assert.equal(updated.style.color, "#3d7fff", "Object can be updated through DrawingManager");
assert.equal(updated.metadata.label, "test", "Metadata update is merged");

const temporary = engine.createTemporaryDrawing(drawing.DrawingTypes.TEST_POINT, {
  anchors: [{ timestamp: 4000, price: 16 }],
});
assert.ok(engine.state.temporaryDrawing, "Temporary drawing state exists separately");
assert.equal(engine.getDrawing(temporary.id), null, "Temporary drawing is not persistent");
engine.cancelCurrentOperation();
assert.equal(engine.state.temporaryDrawing, null, "Temporary drawing can be cancelled");

const renderResult = engine.render({ symbol: "XAUUSD" });
assert.ok(renderResult.drawingsRendered >= 2, "Renderer interface receives drawing objects");

const deleted = engine.deleteDrawing(point.id);
assert.equal(deleted.id, point.id, "Object can be deleted");
assert.equal(engine.getDrawing(point.id), null, "Deleted object is removed");

const eventTypes = emitted.map((event) => event.type);
assert.ok(eventTypes.some((type) => type.endsWith(":DRAWING_CREATED")), "Created event emitted");
assert.ok(eventTypes.some((type) => type.endsWith(":DRAWING_UPDATED")), "Updated event emitted");
assert.ok(eventTypes.some((type) => type.endsWith(":DRAWING_DELETED")), "Deleted event emitted");
assert.ok(eventTypes.some((type) => type.endsWith(":DRAWING_CREATION_STARTED")), "Creation-start event emitted");
assert.ok(eventTypes.some((type) => type.endsWith(":DRAWING_CREATION_CANCELLED")), "Creation-cancel event emitted");

console.log("drawing_engine_core.test.js passed");
