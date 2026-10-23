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
const engine = drawing.createDrawingEngine({ eventTarget: sandbox.window });
engine.initialize();

const anchor = (time, price) => engine.createAnchor(time, price);
const trend = engine.createDrawing(drawing.DrawingTypes.TREND_LINE, {
  anchors: [anchor(1000, 4300), anchor(2000, 4310)],
  symbol: "XAUUSD",
});
const originalAnchors = JSON.stringify(trend.anchors);

engine.updateDrawingProperties([trend.id], {
  style: { color: "#ff0000", width: 3, opacity: 0.5, lineStyle: "dashed" },
  properties: { extendLeft: true, extendRight: true, priceLabelVisible: true },
  locked: true,
}, { label: "Style Trend" });

const styledTrend = engine.getDrawing(trend.id);
assert.equal(styledTrend.style.color, "#ff0000", "line color updates");
assert.equal(styledTrend.style.width, 3, "line width updates");
assert.equal(styledTrend.style.lineStyle, "dashed", "line style updates");
assert.equal(styledTrend.properties.extendLeft, true, "extend left updates");
assert.equal(styledTrend.properties.priceLabelVisible, true, "price label setting updates");
assert.equal(styledTrend.locked, true, "lock updates");
assert.equal(JSON.stringify(styledTrend.anchors), originalAnchors, "style/property updates do not mutate anchors");

engine.undo();
assert.equal(engine.getDrawing(trend.id).style.color, drawing.DrawingStyleDefaults.color, "undo restores previous style");
assert.equal(engine.getDrawing(trend.id).locked, false, "undo restores lock state");
engine.redo();
assert.equal(engine.getDrawing(trend.id).style.color, "#ff0000", "redo reapplies style");

const rectangle = engine.createDrawing(drawing.DrawingTypes.RECTANGLE, {
  anchors: [anchor(3000, 4290), anchor(4000, 4320)],
});
engine.updateDrawingProperties([trend.id, rectangle.id], {
  style: { fillColor: "#00ff00", fillOpacity: 0.25 },
}, { label: "Mixed Fill" });
assert.equal(engine.getDrawing(rectangle.id).style.fillColor, "#00ff00", "fill style applies to fill-capable drawing");
assert.notEqual(engine.getDrawing(trend.id).style.fillColor, "#00ff00", "fill style is not applied to trend line");

engine.updateDrawingProperties([rectangle.id], { visible: false }, { label: "Hide Rectangle" });
assert.equal(engine.getDrawing(rectangle.id).visible, false, "visibility updates through property engine");

const text = engine.createDrawing(drawing.DrawingTypes.TEXT, {
  anchors: [anchor(5000, 4330)],
  metadata: { text: "Entry note" },
});
engine.updateDrawingProperties([text.id], {
  style: { textColor: "#abcdef", fontSize: 18, fontWeight: "700" },
  metadata: { text: "Managed note" },
});
assert.equal(engine.getDrawing(text.id).style.textColor, "#abcdef", "text color updates");
assert.equal(engine.getDrawing(text.id).style.fontSize, 18, "font size updates");
assert.equal(engine.getDrawing(text.id).metadata.text, "Managed note", "text metadata updates");

engine.selectDrawing(text.id);
engine.copySelectedDrawings();
engine.pasteDrawings();
const pasted = engine.getDrawing(engine.state.selectedDrawingIds[0]);
assert.equal(pasted.style.textColor, "#abcdef", "copy/paste preserves style");
assert.equal(pasted.metadata.text, "Managed note", "copy/paste preserves metadata");

const eventTypes = emitted.map((event) => event.type);
assert.ok(eventTypes.some((type) => type.endsWith(":DRAWING_PROPERTIES_UPDATED")), "property event emitted");
assert.ok(eventTypes.some((type) => type.endsWith(":DRAWING_STYLE_UPDATED")), "style event emitted");

console.log("property_engine.test.js passed");
