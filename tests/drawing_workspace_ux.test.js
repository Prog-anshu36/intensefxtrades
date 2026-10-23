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

const storageData = new Map();
const storage = {
  getItem(key) { return storageData.get(key) || null; },
  setItem(key, value) { storageData.set(key, value); },
};
const sandbox = {
  window: { localStorage: storage, dispatchEvent() { return true; }, devicePixelRatio: 1 },
  localStorage: storage,
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
const ux = new drawing.DrawingWorkspaceUX({ storage, key: "ux-test" });

assert.ok(ux.getState().favorites.includes("trend"), "default favorites exist");
ux.toggleFavorite("arrow");
assert.ok(ux.getState().favorites.includes("arrow"), "favorite can be added");
ux.moveFavorite("arrow", -10);
assert.equal(ux.getState().favorites[0], "arrow", "favorite order persists");
ux.setToolbarMode("expanded");
ux.setObjectTreePatch({ search: "NY", filter: "locked" });
assert.equal(ux.resolveShortcut("t"), "trend", "shortcut registry resolves tool");

const group = ux.createGroup("NY Session", ["a", "b"]);
assert.deepEqual(group.children, ["a", "b"], "group stores children");
ux.assignToGroup(["c"], group.id);
assert.ok(ux.groupForDrawing("c"), "drawing can be assigned to group");
ux.updateGroup(group.id, { collapsed: true, locked: true });
assert.equal(ux.getState().groups[group.id].collapsed, true, "group state updates");

const engine = drawing.createDrawingEngine({ eventTarget: sandbox.window });
engine.initialize();
const trend = engine.createDrawing(drawing.DrawingTypes.TREND_LINE, {
  anchors: [engine.createAnchor(1000, 4300), engine.createAnchor(2000, 4310)],
  metadata: { name: "NY Resistance" },
});
const template = ux.saveTemplate("Resistance", trend);
ux.setDefaultTemplate(drawing.DrawingTypes.TREND_LINE, template.id);
assert.equal(ux.getTemplate(template.id).style.color, trend.style.color, "template stores style only, not geometry");
assert.equal(ux.getState().defaultTemplates[drawing.DrawingTypes.TREND_LINE], template.id, "default template persists");

const uxReloaded = new drawing.DrawingWorkspaceUX({ storage, key: "ux-test" });
assert.equal(uxReloaded.getState().toolbarMode, "expanded", "workspace preferences reload");
assert.equal(uxReloaded.getState().objectTree.search, "NY", "object tree state reloads");
assert.ok(uxReloaded.getState().groups[group.id], "groups reload");
assert.ok(uxReloaded.getTemplate(template.id), "templates reload");

console.log("drawing_workspace_ux.test.js passed");
