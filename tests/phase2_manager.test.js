const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const names = ['drawing-types','drawing-events','coordinate-manager','anchor','property-engine','drawing-workspace-ux','drawing-object','drawing-state','drawing-manager','tool-registry','drawing-renderer','drawing-tools','tool-controller','transform-engine','hit-test-engine','selection-manager','snap-engine','history-manager','drawing-engine','index'];
const sandbox = { window: { dispatchEvent() {}, devicePixelRatio: 1 }, CustomEvent: class { constructor(type, options) { this.type=type; this.detail=options?.detail; } }, Date, Math, Map, Set, JSON, structuredClone };
vm.createContext(sandbox);
names.forEach(name => vm.runInContext(fs.readFileSync(`frontend/static/js/drawing/${name}.js`, 'utf8'), sandbox));
const D = sandbox.window.IntenseDrawing;
let width=1000, height=600, start=0, slots=106;
const base = Date.UTC(2025,0,1);
const candles = Array.from({length:200},(_,i)=>({time:base+i*60000, open:100, high:110, low:90, close:100}));
const adapter = {
  getContainerRect:()=>({left:0,top:0,width,height}),
  getMetrics:()=>({topPad:8,bottomAxis:24,priceHeight:height-32,chartWidth:width-78,candleW:(width-78)/slots}),
  getWindowState:()=>({logicalStart:start,start:Math.floor(start),end:199,hi:120,lo:80}),
  getCandles:()=>candles,
};
const engine=D.createDrawingEngine({coordinateAdapter:adapter}); engine.initialize(); engine.setMagnetEnabled(false);
const manager=engine.manager;
const a=engine.createAnchor(base+10*60000,100), b=engine.createAnchor(base+20*60000,105);
manager.startDrawing('test-line',a); manager.updatePreview([a,b]);
const line=manager.finishDrawing(); assert.ok(line && line.id);
manager.selectDrawing(line.id); assert.equal(engine.state.selectedDrawingIds[0],line.id);
const screen=engine.logicalToScreen(a); assert.ok(manager.hitTest({x:screen.x+2,y:screen.y+2}), 'tolerant hit test');
manager.moveDrawing(line.id,60000,2); assert.equal(manager.getDrawing(line.id).anchors[0].price,102);
manager.moveAnchor(line.id,1,base+24*60000,108); assert.equal(manager.getDrawing(line.id).anchors[1].price,108);
manager.deleteSelected(); assert.equal(manager.getDrawing(line.id),null);
manager.undo(); assert.ok(manager.getDrawing(line.id)); manager.redo(); assert.equal(manager.getDrawing(line.id),null); manager.undo();
manager.setLocked(line.id,true);
assert.equal(manager.moveDrawing(line.id,60000,1),null);
assert.equal(manager.moveAnchor(line.id,0,base,80),null);
assert.equal(manager.editDrawing(line.id,{style:{color:'#ff0000'}}),null);
engine.updateDrawingProperties([line.id],{style:{color:'#ff0000'}});
assert.notEqual(manager.getDrawing(line.id).style.color,'#ff0000');
const locked=manager.getDrawing(line.id);
assert.equal(engine.startSelectionDrag({drawing:locked,hitType:'body'},a),false);
manager.setVisible(line.id,false); assert.equal(manager.getDrawing(line.id).visible,false);
assert.equal(engine.getDrawings(d=>d.visible!==false).length,0);
manager.setVisible(line.id,true); assert.equal(manager.getDrawing(line.id).visible,true);
manager.setLocked(line.id,false); manager.duplicateDrawing(line.id);
assert.equal(manager.getDrawings().length,2); assert.notEqual(engine.state.selectedDrawingIds[0],line.id);
const anchors=JSON.stringify(manager.getDrawing(line.id).anchors);
for(const camera of [{width:400,height:320,start:4,slots:50},{width:1400,height:800,start:9,slots:160}]) {
  ({width,height,start,slots}=camera);
  const point=manager.getDrawing(line.id).anchors[0];
  const pixel=engine.logicalToScreen(point); const restored=engine.screenToLogical(pixel.x,pixel.y);
  assert.equal(restored.time,point.time); assert.ok(Math.abs(restored.price-point.price)<1e-8);
  assert.equal(JSON.stringify(manager.getDrawing(line.id).anchors),anchors);
}
const persisted=JSON.stringify(manager.getDrawings()); manager.deleteAll(); assert.equal(manager.getDrawings().length,0);
manager.importDrawings(JSON.parse(persisted),{clear:true}); assert.equal(JSON.stringify(manager.getDrawing(line.id).anchors),anchors);
manager.startDrawing('test-line',a); manager.cancelDrawing(); assert.equal(engine.state.temporaryDrawing,null);
engine.activateTool('test-line',{toolMode:'PERSISTENT'});
assert.equal(engine.state.toolMode,'PERSISTENT','engine forwards stay-in-drawing-mode setting');
engine.activateTool('test-line',{toolMode:'SINGLE_USE'});
assert.equal(engine.state.toolMode,'SINGLE_USE');
console.log('phase2_manager.test.js passed');
