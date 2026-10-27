/* Real CSV x every registered drawing tool x seven timeframes. No sample candles. */
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const modules=['drawing-types','drawing-events','coordinate-manager','anchor','property-engine','drawing-workspace-ux','drawing-object','drawing-state','drawing-manager','tool-registry','drawing-renderer','drawing-tools','tool-controller','transform-engine','hit-test-engine','selection-manager','snap-engine','history-manager','drawing-engine','index'];
const sandbox={window:{dispatchEvent(){},devicePixelRatio:1},CustomEvent:class{},Date,Math,Map,Set,JSON,structuredClone,console,MarketData:{getMeta:()=>({decimals:2})},Fmt:{price:v=>Number(v).toFixed(2)}};sandbox.window.window=sandbox.window;vm.createContext(sandbox);
modules.forEach(n=>vm.runInContext(fs.readFileSync(`frontend/static/js/drawing/${n}.js`,'utf8'),sandbox));
vm.runInContext(fs.readFileSync('frontend/static/js/page_backtesting.js','utf8'),sandbox);
const page=sandbox.window.PageBacktesting;
const context=new Proxy({measureText:s=>({width:String(s).length*7}),createLinearGradient:()=>({addColorStop(){}})}, {get:(o,k)=>o[k]||(()=>{}),set:(o,k,v)=>(o[k]=v,true)});
let cases=0,toolCount=0;
for(const [tf,file] of [['1m','1m'],['5m','5m'],['15m','15m'],['30m','30m'],['1h','1h'],['4h','4h'],['1d','1d']]) {
 const fd=fs.openSync(`XAUUSD_Data/XAU_${file}_data.csv`,'r'),buffer=Buffer.alloc(65536);const length=fs.readSync(fd,buffer,0,buffer.length,0);fs.closeSync(fd);
 const candles=buffer.toString('utf8',0,length).split(/\r?\n/).slice(1,101).filter(Boolean).map(row=>{const [stamp,...v]=row.split(';'),[y,m,d,h=0,min=0]=stamp.match(/\d+/g).map(Number);return {time:Date.UTC(y,m-1,d,h,min),open:+v[0],high:+v[1],low:+v[2],close:+v[3],volume:+v[4]};});
 assert.ok(candles.length>=80);assert.ok(candles.every(c=>Number.isFinite(c.close)));
 let width=1000,height=600,start=0,slots=100;
 const hi=Math.max(...candles.map(c=>c.high))+2,lo=Math.min(...candles.map(c=>c.low))-2;
 const adapter={continuousTime:true,getContainerRect:()=>({left:0,top:0,width,height}),getMetrics:()=>({topPad:8,bottomAxis:24,priceHeight:height-32,chartWidth:width-78,candleW:(width-78)/slots}),getWindowState:()=>({logicalStart:start,start:Math.floor(start),end:99,hi,lo}),getCandles:()=>candles};
 const engine=sandbox.window.IntenseDrawing.createDrawingEngine({coordinateAdapter:adapter,getSymbol:()=>'XAUUSD'});engine.initialize();engine.setMagnetEnabled(false);
 page.drawingEngine=engine;page.symbol='XAUUSD';page.timeframe=tf;page.candles=candles;page.idx=99;page._canvasW=width;page._canvasH=height;page.axisDateTimeLabel=()=>tf;
 const pointer=i=>{const p=engine.logicalToScreen(engine.createAnchor(candles[i].time,candles[i].close));return {clientX:p.x,clientY:p.y,button:0};};
 const tools=engine.toolRegistry.getTools().filter(t=>!['cursor','crosshair','select','test-point'].includes(t.id));toolCount=tools.length;
 for(const tool of tools) {
  engine.manager.clearDrawings();engine.activateTool(tool.id);
  engine.toolController.pointerDown(pointer(10));engine.toolController.pointerMove(pointer(20));
  if(tool.requiredAnchors>1)engine.toolController.pointerDown(pointer(20));
  for(let i=2;i<tool.requiredAnchors;i++)engine.toolController.pointerDown(pointer(10+i*10));
  engine.toolController.pointerUp(pointer(30));engine.toolController.keyDown({key:'Enter'});
  assert.equal(engine.getDrawings().length,1,`${tf}/${tool.id}: create`);
  let object=engine.getDrawings()[0];assert.ok(object.anchors.length);
  engine.manager.selectDrawing(object.id);
  page.selectedDrawingIds=[object.id];page.hoveredDrawingId=object.id;
  page.drawDrawingObject(context,object,a=>engine.logicalToScreen(a));
  const original=JSON.stringify(object.anchors);
  for(const view of [[500,320,5,40],[1600,900,-10,180],[768,500,30,80]]) {
   [width,height,start,slots]=view;
   for(const a of object.anchors) {const p=engine.logicalToScreen(a),back={time:engine.coordinateManager.xToTime(p.x),price:engine.coordinateManager.yToPrice(p.y)};assert.ok(Math.abs(back.time-a.time)<1,`${tf}/${tool.id}: time alignment ${JSON.stringify({a,p,back})}`);assert.ok(Math.abs(back.price-a.price)<1e-7,`${tf}/${tool.id}: price alignment`);}
  }
  assert.equal(JSON.stringify(engine.getDrawing(object.id).anchors),original);
  [width,height,start,slots]=[1000,600,0,100];
  engine.manager.moveDrawing(object.id,60000,.25);object=engine.getDrawing(object.id);assert.notEqual(JSON.stringify(object.anchors),original,`${tf}/${tool.id}: body moves in data coordinates`);
  engine.manager.moveAnchor(object.id,0,candles[12].time,candles[12].close);assert.equal(engine.getDrawing(object.id).anchors[0].time,candles[12].time);
  engine.manager.editDrawing(object.id,{style:{opacity:.35,width:3,lineStyle:'dashed'}});assert.equal(engine.getDrawing(object.id).style.opacity,.35);
  engine.manager.setLocked(object.id,true);const locked=JSON.stringify(engine.getDrawing(object.id).anchors);engine.manager.moveDrawing(object.id,60000,1);assert.equal(JSON.stringify(engine.getDrawing(object.id).anchors),locked);
  engine.manager.setLocked(object.id,false);engine.manager.setVisible(object.id,false);assert.equal(engine.getDrawing(object.id).visible,false);engine.manager.setVisible(object.id,true);
  engine.manager.duplicateDrawing(object.id);assert.equal(engine.getDrawings().length,2);assert.notEqual(engine.getDrawings()[1].id,object.id);
  const saved=JSON.stringify(engine.getDrawings());engine.manager.importDrawings(JSON.parse(saved),{clear:true});assert.equal(JSON.stringify(engine.getDrawings()),saved);
  engine.manager.deleteDrawing(object.id);assert.equal(engine.getDrawing(object.id),null);engine.manager.undo();assert.ok(engine.getDrawing(object.id));engine.manager.redo();assert.equal(engine.getDrawing(object.id),null);
  cases++;
 }
 engine.destroy();
 console.log(`${tf}: ${tools.length} drawing lifecycle/coordinate/rendering checks passed on real CSV`);
}
console.log(`tool_timeframe_matrix.test.js passed: ${toolCount} tools × 7 timeframes = ${cases} cases`);


