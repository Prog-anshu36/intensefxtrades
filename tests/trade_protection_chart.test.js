const fs=require('fs'),vm=require('vm'),assert=require('assert');
const sandbox={window:{},Store:{state:{active_trades:[]}},Fmt:{price:n=>Number(n).toFixed(2)}};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('frontend/static/js/page_backtesting.js','utf8'),sandbox);
const page=sandbox.window.PageBacktesting;page.symbol='XAUUSD';
const labels=[];
const ctx=new Proxy({fillText:text=>labels.push(text)},{get:(o,k)=>o[k] || (()=>{}),set:(o,k,v)=>(o[k]=v,true)});
for(const type of ['BUY','SELL']){
  const trade={id:1,symbol:'XAUUSD',type,lots:.1,entry:2650,sl:null,tp:null};
  sandbox.Store.state.active_trades=[trade];
  page.tradeProtectionDraft=null;
  page.drawTradeLevels(ctx,p=>300-(p-2650)*4,900,{decimals:2});
  assert.ok(labels.some(t=>t.includes('Entered')));
  assert.equal(page._tradeLevelHits.length,2);
  const [sl,tp]=page._tradeLevelHits;
  assert.equal(page.tradeLevelHit({x:sl.x+10,y:sl.y}).key,'sl');
  assert.ok(type==='BUY'?sl.y>300 && tp.y<300:sl.y<300 && tp.y>300);
  page.tradeProtectionDraft={id:1,sl:2640,tp:2670};
  page.drawTradeLevels(ctx,p=>300-(p-2650)*4,900,{decimals:2});
  assert.equal(page._tradeLevelHits.filter(h=>h.action).length,2);
  const confirm=page._tradeLevelHits.find(h=>h.action==='confirm');
  assert.equal(page.tradeLevelHit({x:confirm.x+10,y:confirm.y}).action,'confirm');
  assert.equal(trade.sl,null,'preview does not mutate the live trade');
}
console.log('trade_protection_chart.test.js passed');
