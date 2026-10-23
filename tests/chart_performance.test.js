const fs=require('fs'),vm=require('vm'),assert=require('assert');
let formatterCount=0;
function CountingFormatter(...args){formatterCount++;return new Intl.DateTimeFormat(...args);}
const sandbox={window:{},Intl:{DateTimeFormat:CountingFormatter},Date,Math,Map,JSON,structuredClone,MarketData:{TF_MINUTES:{'4h':240,'1d':1440,'1m':1}}};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('frontend/static/js/session-engine.js','utf8'),sandbox);
vm.runInContext(fs.readFileSync('frontend/static/js/page_backtesting.js','utf8'),sandbox);
const engine=sandbox.window.IntenseSessions.createSessionEngine();
const from=Date.UTC(2025,0,1),to=Date.UTC(2025,3,1);
const before=formatterCount;
const first=engine.getSessionsInRange(from,to);
assert.ok(first.length>200);
assert.ok(formatterCount-before<10,'timezone formatters reused across hundreds of sessions');
const constructions=formatterCount;
const again=engine.getSessionsInRange(from,to);
assert.equal(formatterCount,constructions);
assert.equal(JSON.stringify(again),JSON.stringify(first));
const session=engine.getSessionByDate('2025-01-10','london');
session.style.color='#ffffff';
assert.notEqual(engine.getSessionByDate('2025-01-10','london').style.color,'#ffffff','cached session is isolated from callers');
const page=sandbox.window.PageBacktesting;
page.candles=[{time:from,date:new Date(from)}];page.sessionEngine=engine;
page.chartWindow=()=>{throw new Error('higher timeframe must not enumerate intraday sessions');};
for(const tf of ['4h','1d']) {page.timeframe=tf;assert.equal(page.visibleSessionStats().length,0);}
engine.setConfig({definitions:{london:{startTime:'09:00'}}});
assert.notEqual(engine.getSessionByDate('2025-01-10','london').start,session.start,'settings invalidate session cache');
console.log('chart_performance.test.js passed: formatter/session reuse, cache isolation/invalidation, bounded 4H/D1 overlay work');
