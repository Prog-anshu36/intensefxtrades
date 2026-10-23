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
  window: { devicePixelRatio: 1, dispatchEvent() { return true; } },
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
const candles = Array.from({ length: 120 }, (_, i) => ({
  time: baseTime + i * 60_000,
  date: new Date(baseTime + i * 60_000),
  open: 4300 + i * 0.25,
  high: 4310 + i * 0.25,
  low: 4290 + i * 0.25,
  close: 4305 + i * 0.25,
}));
const adapter = {
  getContainerRect: () => ({ left: 0, top: 0, width: 720, height: 440, right: 720, bottom: 440 }),
  getMetrics: () => ({ rightAxis: 60, bottomAxis: 24, topPad: 8, chartWidth: 660, priceHeight: 408, totalSlots: 120, candleW: 5.5 }),
  getWindowState: () => ({ start: 0, end: 119, logicalStart: 0, visible: candles, hi: 4370, lo: 4300 }),
  getCandles: () => candles,
  getDevicePixelRatio: () => 1,
};
const engine = drawing.createDrawingEngine({
  eventTarget: sandbox.window,
  coordinateAdapter: adapter,
  getSymbol: () => "XAUUSD",
  getReplayLimit: () => 119,
});
engine.initialize();

function screenFor(index, price) {
  return {
    clientX: index * 5.5 + 2.75,
    clientY: 8 + ((4370 - price) / 70) * (408 - 8),
  };
}

function metricsFor(position) {
  const g = position.geometry;
  const entry = g.entry.price;
  const risk = position.type === drawing.DrawingTypes.SHORT_POSITION ? g.stopLoss.price - entry : entry - g.stopLoss.price;
  const reward = position.type === drawing.DrawingTypes.SHORT_POSITION ? entry - g.takeProfit.price : g.takeProfit.price - entry;
  return { risk, reward, rr: reward / risk };
}

function createPosition(toolId, entryPrice, pointerPrice) {
  assert.equal(engine.activateTool(toolId), true, `activate ${toolId}`);
  engine.handlePointerMove(screenFor(35, entryPrice));
  assert.ok(engine.state.temporaryDrawing, "preview exists before first click");
  engine.handlePointerDown(screenFor(35, entryPrice));
  engine.handlePointerMove(screenFor(37, pointerPrice));
  assert.ok(engine.state.temporaryDrawing.geometry, "preview has logical geometry");
  engine.handlePointerDown(screenFor(37, pointerPrice));
  const created = engine.getDrawing(engine.state.lastCreatedDrawingId);
  assert.ok(created, "position drawing was created");
  assert.equal(created.anchors.length, 5, "position drawing exposes composite anchors");
  assert.ok(created.geometry, "position drawing stores logical geometry");
  return created;
}

const long = createPosition(drawing.DrawingTypes.LONG_POSITION, 4335, 4330);
assert.equal(long.type, drawing.DrawingTypes.LONG_POSITION);
assert.equal(long.geometry.entry.price, 4335);
assert.equal(long.geometry.stopLoss.price, 4330);
assert.equal(long.geometry.takeProfit.price, 4345);
assert.deepEqual(metricsFor(long), { risk: 5, reward: 10, rr: 2 });

engine.selectionManager.select(long.id);
const handles = engine.transformEngine.getHandles(long);
assert.ok(handles.find((h) => h.id === "entry"), "entry handle exists");
assert.ok(handles.find((h) => h.id === "stop"), "stop handle exists");
assert.ok(handles.find((h) => h.id === "target"), "target handle exists");
assert.ok(handles.find((h) => h.id === "start"), "start time handle exists");
assert.ok(handles.find((h) => h.id === "end"), "end time handle exists");

const targetHandle = handles.find((h) => h.id === "target");
engine.startSelectionDrag({ drawing: long, hitType: "handle", handle: targetHandle }, targetHandle.logical);
engine.updateSelectionDrag(engine.coordinateManager.createAnchor(long.geometry.entry.time, 4355));
engine.endSelectionDrag();
const longTargetMoved = engine.getDrawing(long.id);
assert.deepEqual(metricsFor(longTargetMoved), { risk: 5, reward: 20, rr: 4 });

const stopHandle = engine.transformEngine.getHandles(longTargetMoved).find((h) => h.id === "stop");
engine.startSelectionDrag({ drawing: longTargetMoved, hitType: "handle", handle: stopHandle }, stopHandle.logical);
engine.updateSelectionDrag(engine.coordinateManager.createAnchor(long.geometry.entry.time, 4325));
engine.endSelectionDrag();
const longStopMoved = engine.getDrawing(long.id);
assert.deepEqual(metricsFor(longStopMoved), { risk: 10, reward: 20, rr: 2 });

const crossedStopHandle = engine.transformEngine.getHandles(longStopMoved).find((h) => h.id === "stop");
engine.startSelectionDrag({ drawing: longStopMoved, hitType: "handle", handle: crossedStopHandle }, crossedStopHandle.logical);
engine.updateSelectionDrag(engine.coordinateManager.createAnchor(longStopMoved.geometry.entry.time, 4345));
engine.endSelectionDrag();
const longClamped = engine.getDrawing(long.id);
assert.ok(longClamped.geometry.stopLoss.price < longClamped.geometry.entry.price, "long stop remains below entry when dragged across");

const crossedTargetHandle = engine.transformEngine.getHandles(longClamped).find((h) => h.id === "target");
engine.startSelectionDrag({ drawing: longClamped, hitType: "handle", handle: crossedTargetHandle }, crossedTargetHandle.logical);
engine.updateSelectionDrag(engine.coordinateManager.createAnchor(longClamped.geometry.entry.time, 4320));
engine.endSelectionDrag();
const longTargetClamped = engine.getDrawing(long.id);
assert.ok(longTargetClamped.geometry.takeProfit.price > longTargetClamped.geometry.entry.price, "long target remains above entry when dragged across");

engine.setMagnetEnabled(false);
const hit = engine.hitTest(engine.coordinateManager.logicalToScreen(longTargetClamped.geometry.entry.time, longTargetClamped.geometry.entry.price), { drawings: [longTargetClamped] });
assert.equal(hit.drawingId, long.id, "hit testing returns parent position drawing");

const farStopPoint = engine.coordinateManager.logicalToScreen(longTargetClamped.geometry.timeRange.end, longTargetClamped.geometry.stopLoss.price);
const stopLineHit = engine.hitTest({ x: (farStopPoint.x + engine.coordinateManager.logicalToScreen(longTargetClamped.geometry.timeRange.start, longTargetClamped.geometry.stopLoss.price).x) / 2, y: farStopPoint.y }, { drawings: [longTargetClamped], selectedIds: [longTargetClamped.id] });
assert.equal(stopLineHit.hitType, "handle", "clicking the stop line adjusts stop only");
assert.equal(stopLineHit.handle.id, "stop", "stop line hit returns stop handle");

engine.startSelectionDrag(stopLineHit, engine.coordinateManager.createAnchor(longTargetClamped.geometry.entry.time, longTargetClamped.geometry.stopLoss.price));
engine.updateSelectionDrag(engine.coordinateManager.createAnchor(longTargetClamped.geometry.entry.time, 4315));
engine.endSelectionDrag();
const stopOnlyMoved = engine.getDrawing(long.id);
assert.equal(stopOnlyMoved.geometry.stopLoss.price, 4315);
assert.equal(stopOnlyMoved.geometry.takeProfit.price, longTargetClamped.geometry.takeProfit.price, "dragging stop line does not change target");

const farTargetPoint = engine.coordinateManager.logicalToScreen(stopOnlyMoved.geometry.timeRange.end, stopOnlyMoved.geometry.takeProfit.price);
const targetLineHit = engine.hitTest({ x: (farTargetPoint.x + engine.coordinateManager.logicalToScreen(stopOnlyMoved.geometry.timeRange.start, stopOnlyMoved.geometry.takeProfit.price).x) / 2, y: farTargetPoint.y }, { drawings: [stopOnlyMoved], selectedIds: [stopOnlyMoved.id] });
assert.equal(targetLineHit.handle.id, "target", "target line hit returns target handle");
engine.startSelectionDrag(targetLineHit, engine.coordinateManager.createAnchor(stopOnlyMoved.geometry.entry.time, stopOnlyMoved.geometry.takeProfit.price));
engine.updateSelectionDrag(engine.coordinateManager.createAnchor(stopOnlyMoved.geometry.entry.time, 4360));
engine.endSelectionDrag();
const targetOnlyMoved = engine.getDrawing(long.id);
assert.equal(targetOnlyMoved.geometry.takeProfit.price, 4360);
assert.equal(targetOnlyMoved.geometry.stopLoss.price, 4315, "dragging target line does not change stop");

const short = createPosition(drawing.DrawingTypes.SHORT_POSITION, 4335, 4340);
assert.equal(short.geometry.stopLoss.price, 4340);
assert.equal(short.geometry.takeProfit.price, 4325);
assert.deepEqual(metricsFor(short), { risk: 5, reward: 10, rr: 2 });

// The chart passes legacy camelCase objects into hit testing, unlike tool creation.
for (const [source,type] of [[engine.getDrawing(long.id),'longPosition'],[engine.getDrawing(short.id),'shortPosition']]) {
  const legacy={...source,type};
  engine.selectionManager.select(source.id);
  const handles=engine.transformEngine.getHandles(legacy);
  assert.ok(handles.some(h=>h.id==='stop'&&h.kind==='resize'),'chart SL handle is a position resize handle');
  const handle=handles.find(h=>h.id==='target');
  const hit=engine.hitTest(handle.screen,{drawings:[legacy],selectedIds:[source.id]});
  assert.equal(hit.handle.id,'target','chart hit testing resolves TP, not a generic anchor');
  const oldEntry=source.geometry.entry.price,oldStop=source.geometry.stopLoss.price;
  const newTarget=source.geometry.takeProfit.price+(type==='shortPosition'?-3:3);
  engine.startSelectionDrag(hit,handle.logical);
  engine.updateSelectionDrag(engine.coordinateManager.createAnchor(handle.logical.time,newTarget));
  const changed=engine.endSelectionDrag();
  engine.updateDrawingsWithHistory(changed.before,changed.after,'Adjust chart target');
  const updated=engine.getDrawing(source.id);
  assert.equal(updated.geometry.takeProfit.price,newTarget);
  assert.equal(updated.geometry.entry.price,oldEntry);
  assert.equal(updated.geometry.stopLoss.price,oldStop);
  assert.ok(engine.undo());assert.equal(engine.getDrawing(source.id).geometry.takeProfit.price,source.geometry.takeProfit.price);
}

for (const original of [long, short]) {
  let item=engine.getDrawing(original.id);
  const stop=item.geometry.stopLoss.price,target=item.geometry.takeProfit.price;
  const entryHandle=engine.transformEngine.getHandles(item).find(h=>h.id==='entry');
  const widthHandle=engine.transformEngine.getHandles(item).find(h=>h.id==='start');
  assert.notEqual(entryHandle.screen.y,widthHandle.screen.y,'entry and width handles do not overlap');
  const newEntry=(stop+target)/2;
  engine.startSelectionDrag({drawing:item,hitType:'handle',handle:entryHandle},entryHandle.logical);
  engine.updateSelectionDrag(engine.coordinateManager.createAnchor(item.geometry.entry.time,newEntry));
  engine.endSelectionDrag();
  item=engine.getDrawing(item.id);
  assert.equal(item.geometry.entry.price,newEntry);
  assert.equal(item.geometry.stopLoss.price,stop,'entry drag leaves SL fixed');
  assert.equal(item.geometry.takeProfit.price,target,'entry drag leaves TP fixed');
  assert.ok(metricsFor(item).risk>0&&metricsFor(item).reward>0,'both directions stay valid');
  const endHandle=engine.transformEngine.getHandles(item).find(h=>h.id==='end');
  const endTime=item.geometry.timeRange.end+60000;
  engine.startSelectionDrag({drawing:item,hitType:'handle',handle:endHandle},endHandle.logical);
  engine.updateSelectionDrag(engine.coordinateManager.createAnchor(endTime,item.geometry.entry.price));
  const changed=engine.endSelectionDrag();
  engine.updateDrawingsWithHistory(changed.before,changed.after,'Resize position');
  item=engine.getDrawing(item.id);
  assert.equal(item.geometry.timeRange.end,endTime,'width drag updates time only');
  assert.equal(item.geometry.entry.price,newEntry);assert.equal(item.geometry.stopLoss.price,stop);assert.equal(item.geometry.takeProfit.price,target);
  assert.ok(engine.undo());assert.equal(engine.getDrawing(item.id).geometry.timeRange.end,endTime-60000);
}

engine.selectionManager.select(short.id);
engine.duplicateSelectedDrawings({ offsetCandles: 4 });
assert.equal(engine.getDrawings().filter((item) => item.type === drawing.DrawingTypes.SHORT_POSITION).length, 2, "duplicate creates a separate short position");
assert.ok(engine.undo(), "undo restores duplicate operation");
assert.equal(engine.getDrawings().filter((item) => item.type === drawing.DrawingTypes.SHORT_POSITION).length, 1, "undo removes duplicated position");
assert.ok(engine.redo(), "redo re-applies duplicate operation");
assert.equal(engine.getDrawings().filter((item) => item.type === drawing.DrawingTypes.SHORT_POSITION).length, 2, "redo restores duplicated position");

console.log("position_tools.test.js passed");
