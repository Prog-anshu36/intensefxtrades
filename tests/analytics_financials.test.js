const fs=require('fs'),vm=require('vm'),assert=require('assert');
const fxnBounds={start:Date.parse('2025-01-01T13:00:00Z'),end:Date.parse('2025-01-01T17:00:00Z')};
const context={window:{PageBacktesting:{getFxnIndicator:()=>({bounds:(time,type)=>type==='london'?fxnBounds:{start:Date.parse('2025-01-01T20:00:00Z'),end:Date.parse('2025-01-02T02:00:00Z')}})}}};vm.createContext(context);vm.runInContext(fs.readFileSync('frontend/static/js/analytics_engine.js','utf8')+'\nthis.engine=TradeAnalyticsEngine;',context);
const engine=context.engine;
assert.equal(engine.estimateRisk({symbol:'XAUUSD',entry:2650,sl:2645,lots:.5}),250);
assert.equal(engine.estimateRisk({symbol:'XAUUSD',pnl:500}),null);
assert.equal(engine.estimateRR({symbol:'XAUUSD',pnl:-125,risk:250}),-.5);
const metrics=engine.performance([{pnl:100},{pnl:-50},{pnl:0}],1000);
assert.equal(metrics.losingTrades,1);assert.equal(metrics.profitFactor,2);assert.equal(metrics.expectancy,50/3);
assert.equal(engine.normalizeTrades([{id:1,pnl:10,strategy:'NY',opened_at:'2025-01-01',closed_at:'2025-01-02'}],[])[0].strategy,'NY');
assert.equal(engine.sessionForDate(new Date('2025-01-01T14:00:00Z')),'London','trade session analytics follow the configured FXN session window');
assert.equal(engine.sessionForDate(new Date('2025-01-01T18:00:00Z')),'Off session','outside FXN windows is not forced into a legacy session');
console.log('analytics_financials.test.js passed');

