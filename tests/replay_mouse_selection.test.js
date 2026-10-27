const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
for(const workspace of ['backtesting','prop-chart']) {
 const listeners={}, noop=()=>{};
 const canvas={addEventListener:(n,f)=>listeners[n]=f,getBoundingClientRect:()=>({left:0,top:0,width:500,height:300}),setPointerCapture:noop,releasePointerCapture:noop,classList:{add:noop,remove:noop},style:{}};
 const sandbox={window:{addEventListener:noop,removeEventListener:noop},document:{addEventListener:noop,removeEventListener:noop},performance:{now:()=>100},MarketData:{TF_MINUTES:{'1m':1},getMeta:()=>({decimals:2})},UI:{updateStatusBar:noop},Fmt:{price:String,dateTime:String},cancelAnimationFrame:noop};
 vm.createContext(sandbox);vm.runInContext(fs.readFileSync('frontend/static/js/page_backtesting.js','utf8'),sandbox);
 const p=sandbox.window.PageBacktesting;p.tool='scissors';p.timeframe='1m';p.candles=Array.from({length:100},(_,i)=>({date:new Date(i*60000)}));p.idx=99;p.visibleCount=50;p.viewEnd=99;
 for(const m of ['stopZoomAnimation','scheduleInteractionDraw','scheduleDraw'])p[m]=noop;
 p.chartMetrics=()=>({chartWidth:450,bottomAxis:20,topPad:10,priceHeight:270,totalSlots:50});
 p.chartWindow=()=>({visible:p.candles,hi:100,lo:0,start:0,logicalStart:50});p.getReplayLimit=()=>99;
 p.chartCoordinates=()=>({xToIndex:x=>Math.round(x/5),yToPrice:y=>100-y});
 p.orderDraftHit=()=>{throw Error('replay was intercepted by order handling')};
 p.cutReplayAt=i=>p.cut=i;
 p.bindChartInteractions({querySelector:s=>s==='#tvCanvas'?canvas:null});
 const e=(x,y=100,button=0)=>({clientX:x,clientY:y,button,pointerId:1,preventDefault:noop});
 listeners.pointerdown(e(100));listeners.pointermove(e(120));listeners.pointerup(e(120));
 assert.equal(p.cut,24,workspace+' chooses release candle despite mouse movement');assert.equal(p.viewEnd,99,'selection does not pan');
 p.cut=null;listeners.pointerdown(e(100));listeners.pointerup(e(100,295));assert.equal(p.cut,null,'axis release does not cut');
 p.chartCoordinates=()=>({xToIndex:()=>120,yToPrice:()=>50});listeners.pointerdown(e(100));listeners.pointerup(e(100));assert.equal(p.cut,null,'future whitespace is not a candle');
}
console.log('replay_mouse_selection.test.js passed: both workspaces, drag selection, unchanged camera, axes and whitespace');

