const fs=require('fs'),vm=require('vm'),assert=require('assert');
const sandbox={window:{},Intl,Date,Map,JSON,Math,structuredClone};
vm.createContext(sandbox);
for(const file of ['session-engine','page_backtesting'])vm.runInContext(fs.readFileSync(`frontend/static/js/${file}.js`,'utf8'),sandbox);
const page=sandbox.window.PageBacktesting;
page.sessionEngine=new sandbox.window.IntenseSessions.SessionEngine();
page.saveSessionSettings=()=>{};page.rerender=()=>{};
page.toggleAsianRange();
const config=page.sessionEngine.getConfig();
assert.equal(config.asianRange,true);
assert.equal(config.definitions.london.enabled,false);
for(const date of ['2026-01-15','2026-08-13']){
 const session=page.sessionEngine.getSessionByDate(date,'asia');
 assert.equal(new Date(session.start).toISOString().slice(11,16),'01:00');
 assert.equal(session.end-session.start,6*3600000);
}
page.sessionEngine.setConfig(config);
assert.equal(page.sessionEngine.getConfig().asianRange,true,'preset persists through normalization');
page.toggleAsianRange();assert.equal(page.sessionEngine.getConfig().enabled,false);
page.volumeVisible=true;page.indicator='sma';assert.equal(page.isVolumeVisible(),true);
page.volumeVisible=false;page.indicator='ema';assert.equal(page.isVolumeVisible(),false);
console.log('asian_range_indicator.test.js passed');
