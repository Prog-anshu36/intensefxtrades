// Exercise the shared tool lifecycle against bounded reads of real local CSV.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const modules = ['drawing-types','drawing-events','coordinate-manager','anchor','property-engine','drawing-workspace-ux','drawing-object','drawing-state','drawing-manager','tool-registry','drawing-renderer','drawing-tools','tool-controller','transform-engine','hit-test-engine','selection-manager','snap-engine','history-manager','drawing-engine','index'];
const sandbox = {window:{dispatchEvent(){},devicePixelRatio:1},CustomEvent:class{},Date,Math,Map,Set,JSON,structuredClone};
vm.createContext(sandbox);
modules.forEach(n=>vm.runInContext(fs.readFileSync(`frontend/static/js/drawing/${n}.js`,'utf8'),sandbox));
const buffer=Buffer.alloc(16384), fd=fs.openSync('XAUUSD_Data/XAU_5m_data.csv','r');
const bytes=fs.readSync(fd,buffer,0,buffer.length,0);fs.closeSync(fd);
const candles=buffer.toString('utf8',0,bytes).split(/\r?\n/).slice(1,81).map(row=>{
  const [stamp,open,high,low,close,volume]=row.split(';');
  const [year,month,day,hour,minute]=stamp.match(/\d+/g).map(Number);
  return {time:Date.UTC(year,month-1,day,hour,minute),open:+open,high:+high,low:+low,close:+close,volume:+volume};
});
assert.equal(candles[0].open,384);assert.equal(candles[0].time,Date.UTC(2004,5,11,7,15));
let width=1000,height=600,start=0,slots=80;
const adapter={continuousTime:true,getContainerRect:()=>({left:0,top:0,width,height}),getMetrics:()=>({topPad:8,bottomAxis:24,priceHeight:height-32,chartWidth:width-78,candleW:(width-78)/slots}),getWindowState:()=>({logicalStart:start,start:Math.floor(start),end:79,hi:386,lo:380}),getCandles:()=>candles};
const engine=sandbox.window.IntenseDrawing.createDrawingEngine({coordinateAdapter:adapter});engine.initialize();engine.setMagnetEnabled(false);
const pointer=i=>{const p=engine.logicalToScreen(engine.createAnchor(candles[i].time,candles[i].close));return {clientX:p.x,clientY:p.y,button:0};};
for(const tool of engine.toolRegistry.getTools()) {
  if(tool.id==='cursor'||tool.id==='crosshair'||tool.id==='select'||tool.id==='test-point')continue;
  const count=engine.getDrawings().length;engine.activateTool(tool.id);
  engine.toolController.pointerDown(pointer(10));engine.toolController.pointerMove(pointer(20));
  if(tool.requiredAnchors>1)engine.toolController.pointerDown(pointer(20));
  for(let anchor=2;anchor<tool.requiredAnchors;anchor++)engine.toolController.pointerDown(pointer(10+anchor*10));
  engine.toolController.pointerUp(pointer(30));engine.toolController.keyDown({key:'Enter'});
  assert.equal(engine.getDrawings().length,count+1,`${tool.id} finalizes exactly one drawing`);
  const drawing=engine.getDrawings().at(-1);
  assert.ok(drawing.anchors.every(a=>Number.isFinite(a.time)&&Number.isFinite(a.price)),tool.id);
  const frozen=JSON.stringify(drawing.anchors);
  width=500;height=320;start=5;slots=40;
  const p=engine.logicalToScreen(drawing.anchors[0]),logical=engine.screenToLogical(p.x,p.y);
  assert.ok(Math.abs(logical.time-drawing.anchors[0].time)<1);assert.ok(Math.abs(logical.price-drawing.anchors[0].price)<1e-8);
  assert.equal(JSON.stringify(drawing.anchors),frozen);
  width=1000;height=600;start=0;slots=80;
  engine.manager.moveAnchor(drawing.id,0,candles[12].time,383.5);
  if(drawing.geometry?.entry)assert.equal(engine.getDrawing(drawing.id).geometry.entry.price,383.5);
  engine.manager.deleteDrawing(drawing.id);engine.manager.undo();assert.ok(engine.getDrawing(drawing.id));engine.manager.redo();assert.equal(engine.getDrawing(drawing.id),null);
}
const fib=engine.createDrawing('fib-retracement',{anchors:[engine.createAnchor(candles[10].time,382),engine.createAnchor(candles[30].time,385)]});
engine.updateDrawingProperties([fib.id],{properties:{levels:[0,.42,1,1.618],reverse:true,fibMode:'projection'}});
assert.equal(JSON.stringify(engine.getDrawing(fib.id).properties.levels),'[0,0.42,1,1.618]');
assert.equal(engine.getDrawing(fib.id).properties.fibMode,'projection');
// Rendering checks use real CSV anchor prices as well as engine lifecycle tests.
sandbox.MarketData={getMeta:()=>({decimals:2})};
vm.runInContext(fs.readFileSync('frontend/static/js/page_backtesting.js','utf8'),sandbox);
const page=sandbox.window.PageBacktesting;page.selectedDrawingIds=[];page.hoveredDrawingId=null;
// Exercise the page's actual toolbar IDs: engine-only tests bypass this gate.
page.drawingEngine=engine;
for (const uiTool of ['longPosition','shortPosition']) {
  page.tool=uiTool;
  assert.equal(page.drawingToolType(),uiTool,'position toolbar must enable chart creation routing');
  const engineTool=page.engineToolForUiTool();
  assert.ok(engine.toolRegistry.hasTool(engineTool),'toolbar resolves to a registered tool');
  engine.activateTool(engineTool);
  const count=engine.getDrawings().length;
  if(page.drawingToolType() && page.engineToolForUiTool()) {
    engine.handlePointerDown(pointer(10));
    engine.handlePointerMove(pointer(20));
    engine.handlePointerUp(pointer(20));
  }
  assert.equal(engine.getDrawings().length,count+1,'page-routed position drag creates a drawing');
  assert.equal(engine.getDrawings().at(-1).type,engineTool);
}
page.tool='crosshair';
// Retracement is measured back from the swing end, for either price direction.
sandbox.Fmt={price:(price)=>price.toFixed(3)};
page.symbol='XAUUSD';page._canvasW=1000;
for (const [start,end] of [[382,385],[385,382]]) {
  for (const reverse of [false,true]) {
    const anchors=[engine.createAnchor(candles[10].time,start),engine.createAnchor(candles[30].time,end)];
    const props={levels:[0,.236,.5,.618,1,1.618,-.272],reverse};
    const item=engine.createDrawing('fib-retracement',{anchors,properties:props});
    const pts=anchors.map(a=>engine.logicalToScreen(a));
    const text=[],lines=[];
    const canvas={globalAlpha:1,save(){},restore(){},setLineDash(){},beginPath(){},moveTo(x,y){lines.push({x,y});},lineTo(){},stroke(){},fillText(label){text.push(label);}};
    page.drawFibLevels(canvas,pts,{anchors,properties:props});
    props.levels.forEach((ratio,i)=>{
      const expected=reverse ? start+(end-start)*ratio : end+(start-end)*ratio;
      assert.ok(text[i].includes(expected.toFixed(3)),`correct ${ratio} label for ${start}->${end}, reverse=${reverse}`);
      const expectedY=engine.logicalToScreen(engine.createAnchor(candles[20].time,expected)).y;
      assert.ok(Math.abs(lines[i+1].y-expectedY)<1e-8,'line and price label agree');
      assert.ok(engine.hitTestEngine.hitTestBody(item,{x:(pts[0].x+pts[1].x)/2,y:expectedY}),'rendered Fibonacci level is selectable');
    });
    engine.manager.deleteDrawing(item.id);
  }
}
assert.equal(sandbox.window.IntenseDrawing.fibLevelValue(382,385,1.618,{fibMode:'extension'},383),383+3*1.618,'extension formula is preserved');
{
  page.candles=candles;page.idx=0;page.lots=.1;
  for (const [type,stop,target] of [['longPosition',381,386],['shortPosition',386,381]]) {
    const entry=383, id='position-style-'+type, texts=[],zones=[];
    const ctx=new Proxy({measureText:text=>({width:text.length*6}),fillRect:(x,y,w,h)=>zones.push({x,y,w,h}),fillText:text=>texts.push(text)}, {get:(o,k)=>o[k]||(()=>{}),set:(o,k,v)=>(o[k]=v,true)});
    const item={id,type,anchors:[],geometry:{entry:{time:candles[10].time,price:entry},stopLoss:{price:stop},takeProfit:{price:target},timeRange:{start:candles[10].time,end:candles[30].time}},properties:{}};
    page.selectedDrawingIds=[id];
    page.drawPositionObject(ctx,item,a=>engine.logicalToScreen(a),{});
    assert.equal(zones.length,2,'separate risk/reward fills');
    assert.ok(zones.every(zone=>zone.w>0&&zone.h>0));
    assert.ok(texts.some(text=>text.startsWith('Stop:')));
    assert.ok(texts.some(text=>text.startsWith('Target:')));
    assert.ok(texts.some(text=>text.startsWith('Risk/Reward ratio:')));
    assert.ok(texts.some(text=>text.startsWith('Open P&L:')));
    page.selectedDrawingIds=[];
    page.hoveredDrawingId=null;
    texts.length=0;zones.length=0;
    page.drawPositionObject(ctx,item,a=>engine.logicalToScreen(a),{});
    assert.equal(zones.length,2,'idle position retains both translucent zones');
    assert.equal(texts.length,0,'idle position hides details');
    page.hoveredDrawingId=id;
    page.drawPositionObject(ctx,item,a=>engine.logicalToScreen(a),{});
    assert.ok(texts.some(text=>text.startsWith('Risk/Reward ratio:')),'hover reveals details without selection');
    page.hoveredDrawingId=null;
    texts.length=0;
    page.drawPositionObject(ctx,item,a=>engine.logicalToScreen(a),{});
    assert.equal(texts.length,0,'details disappear after hover leaves');
  }
  page.selectedDrawingIds=[];
}
{
  const strokes=[],labels=[];
  const ctx={globalAlpha:1,save(){},restore(){},setLineDash(value){this.dash=value;},beginPath(){},moveTo(){},lineTo(){},stroke(){strokes.push({color:this.strokeStyle,dash:this.dash});},fillText(text,x,y){labels.push({text,x,y,color:this.fillStyle,align:this.textAlign});},fillRect(){throw new Error('Fibonacci background must remain transparent');}};
  const anchors=[engine.createAnchor(candles[10].time,382),engine.createAnchor(candles[30].time,385)];
  page.drawFibLevels(ctx,[{x:100,y:400},{x:500,y:100}],{anchors,properties:{},style:{width:1}});
  assert.equal(JSON.stringify(strokes.map(s=>s.color)),JSON.stringify(['#808080','#ff9800','#4caf50','#009688','#00bcd4']));
  assert.equal(JSON.stringify(strokes[0].dash),'[8,8]');
  assert.equal(labels.length,4);
  assert.ok(labels.every(label=>label.x===93&&label.align==='right'),'labels sit left of the horizontal lines');
  assert.ok(labels[3].text.startsWith('0.66 '),'reference 0.66 level is shown');
}
page.drawingEngine=engine;
assert.equal(page.drawingToolType('crosshair'),null,'registered crosshair must allow mouse pan rather than drawing creation');
assert.equal(page.drawingToolType('select'),null,'selection cursor is not a creation tool');
assert.equal(page.drawingToolType('zoom'),null);
assert.ok(page.drawingToolType('abcd'),'registered custom tools still create drawings');
page._canvasW=1000;page._canvasH=600;page.axisDateTimeLabel=()=> 'UTC';
const labels=[],curves=[];
const ctx=new Proxy({fillText:(...args)=>labels.push(args[0]),quadraticCurveTo:(...args)=>curves.push(args)}, {get:(o,k)=>o[k]||(()=>{}),set:(o,k,v)=>(o[k]=v,true)});
const points=[10,20,30,40].map(i=>engine.createAnchor(candles[i].time,candles[i].close));
page.drawDrawingObject(ctx,{id:'pattern',type:'polyline',anchors:points,properties:{patternLabels:'ABCD'},style:{}},a=>engine.logicalToScreen(a));
assert.ok(['A','B','C','D'].every(v=>labels.includes(v)),'pattern anchor labels rendered');
assert.ok(labels.some(v=>v.includes(' / ')),'actual price leg ratios rendered');
page.drawDrawingObject(ctx,{id:'arc',type:'polyline',anchors:points.slice(0,3),properties:{arc:true},style:{}},a=>engine.logicalToScreen(a));
assert.equal(curves.length,1,'arc uses independent curvature anchor');
const arc=engine.createDrawing('brush',{anchors:points.slice(0,3),properties:{arc:true}});
const [pa,pb,pc]=points.slice(0,3).map(a=>engine.logicalToScreen(a));
const mid={x:.25*pa.x+.5*pc.x+.25*pb.x,y:.25*pa.y+.5*pc.y+.25*pb.y};
assert.ok(engine.hitTestEngine.hitTestBody(arc,mid),'curve body can be selected');
const saved=JSON.stringify(engine.getDrawings());engine.manager.importDrawings(JSON.parse(saved),{clear:true});assert.equal(JSON.stringify(engine.getDrawings()),saved);
console.log('chart_tools_csv.test.js passed: all registered creation workflows, real CSV coordinates, resize/pan/zoom, anchor edits, history, properties and persistence');




page.candles=candles;page.idx=candles.length-1;page.visibleCount=20;page.replayActive=false;
const dataBefore=JSON.stringify(candles);
assert.equal(page.clampViewEnd(candles.length+10000),candles.length+10000,'camera permits empty future space');
assert.equal(JSON.stringify(candles),dataBefore,'empty space never adds candles');
page.replayActive=true;page.idx=10;
assert.equal(page.clampViewEnd(1000),1000,'replay camera can pan past revealed data');
assert.equal(page.getReplayLimit(),10,'camera movement does not reveal future replay candles');
