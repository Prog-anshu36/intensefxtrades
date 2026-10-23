const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path'),{execFileSync}=require('child_process');
const scope={globalThis:null,URL,Date,Map,Number,Math,Error,Array,Response,Blob,DataView,Uint8Array,DecompressionStream,crypto:require('crypto').webcrypto};scope.globalThis=scope;
vm.createContext(scope);vm.runInContext(fs.readFileSync('frontend/static/js/pages-history.js','utf8'),scope);
let reads=0;
const fetcher=async url=>{reads++;const file=path.join('_site',new URL(url).pathname.replace('/intensefxtrades/',''));return new Response(fs.readFileSync(file),{status:200});};
const provider=new scope.PagesHistory('https://example.test/intensefxtrades/',fetcher);
(async()=>{
 const cases=[...['1m','3m','5m','15m','30m','1h','4h','1d','1w','1M'].map(timeframe=>({timeframe,limit:100})),{timeframe:'1m',start:'2025-01-01',end:'2025-01-31',limit:100},{timeframe:'5m',anchor:'2025-01-02T12:00:00Z',limit:100}];
 const info=await provider.info();
 for(const timeframe of Object.keys(info.timeframes))cases.push({timeframe,start:new Date(info.info.timeframes[timeframe].first_timestamp).toISOString(),limit:100});
 for(const options of cases){
  const result=await provider.history(new URLSearchParams({symbol:'XAUUSD',...options}));
  const code="import json; from backend.xauusd_data_provider import LocalXAUUSDDataProvider; print(json.dumps(LocalXAUUSDDataProvider().history(**json.loads("+JSON.stringify(JSON.stringify(options))+"))))";
  const expected=JSON.parse(execFileSync('python',['-c',code],{encoding:'utf8'}));
  assert.equal(JSON.stringify(result.candles),JSON.stringify(expected.candles),'exact real CSV values: '+JSON.stringify(options));
  assert.equal(result.total_candles,expected.total_candles);
  assert.ok(result.candles.every((c,i,all)=>i===0||c.time>all[i-1].time));
 }
 assert.ok(provider.cache.size<=8,'chunk cache stays bounded');
 assert.ok(reads<45,'chart windows do not fetch the multi-year dataset');
 const count=reads;await assert.rejects(()=>provider.history(new URLSearchParams({symbol:'XAUUSD',timeframe:'10s'})));assert.equal(reads,count,'no synthetic fallback or vendor call');
 console.log('pages_history.test.js passed: all exported timeframes match real CSV API, filters, anchors, order, uniqueness and bounded reads');
})().catch(error=>{console.error(error);process.exitCode=1;});
