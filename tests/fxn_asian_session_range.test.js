const fs=require('fs'),vm=require('vm'),assert=require('assert');
const sandbox={window:{},Date,Map,Math,JSON};vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('frontend/static/js/session-engine.js','utf8'),sandbox);
vm.runInContext(fs.readFileSync('frontend/static/js/fxn-asian-session-range.js','utf8'),sandbox);
const FXN=sandbox.window.FXNAsianSessionRange;
const zoned=new FXN();
assert.equal(zoned.clockSettings(Date.parse('2026-01-23T12:00Z')).values.ny_ssth,'18');
assert.equal(zoned.clockSettings(Date.parse('2026-01-23T12:00Z')).values.ny_sstm,'30');
assert.equal(zoned.clockSettings(Date.parse('2026-10-23T12:00Z')).values.ny_ssth,'17');
for(const [date,utc] of [['2026-01-23','13:00'],['2026-10-23','12:00'],['2026-03-06','13:00'],['2026-03-09','12:00'],['2026-10-30','12:00'],['2026-11-02','13:00']]){
 const bounds=zoned.bounds(Date.parse(date+'T18:00:00Z'),'ny');
 assert.equal(new Date(bounds.start).toISOString().slice(11,16),utc,`${date} observes New York DST`);
 assert.equal(bounds.end-bounds.start,4*3600000);
}
const fixed=new FXN({sessionTimezone:'Etc/GMT+5'});
assert.equal(new Date(fixed.bounds(Date.parse('2026-10-23T18:00:00Z'),'ny').start).toISOString().slice(11,16),'13:00','fixed EST stays available');
const fxn=new FXN({enabled:true,daily_adr_length:2});
const day=Date.UTC(2026,0,5),minute=60000;
// Deterministic unit fixtures test calculations, never supplied to the app.
const bars=Array.from({length:5*1440},(_,i)=>({time:day+i*minute,open:100,high:101+(i%60)/100,low:99-(i%60)/100,close:100}));
const b=fxn.bounds(day+2*3600000,'asia');
assert.equal(new Date(b.start).toISOString(),'2026-01-05T01:00:00.000Z');
assert.equal(new Date(b.end).toISOString(),'2026-01-05T07:00:00.000Z');
assert.equal(new Date(b.extend).toISOString(),'2026-01-05T16:30:00.000Z');
fxn.calculate(bars,120,minute);
const active=fxn.sessions.get('asia:'+b.start);
assert.equal(active.count,61,'replay includes current completed bar');
assert.equal(active.high,101.59);assert.equal(active.low,98.41);
const frozen=active.high;
bars[200].high=9999;
fxn.calculate(bars,121,minute);assert.equal(active.high,frozen,'future candle does not leak');
fxn.calculate(bars,200,minute);assert.equal(active.high,9999,'later step reveals actual high');
fxn.calculate(bars,120,minute);assert.equal(fxn.sessions.get('asia:'+b.start).high,frozen,'rewind drops future values');
bars[200].high=101.2;
fxn.calculate(bars,3*1440,minute);assert.ok(fxn.adr(day+3*86400000)>0);
const processed=fxn.processed;fxn.calculate(bars,processed,minute);assert.equal(fxn.processed,processed);
const labels=[],lines=[],fills=[];
const strokeColors=[];
const ctx=new Proxy({fillText:t=>labels.push(t),lineTo:(x,y)=>lines.push([x,y]),fillRect:(...a)=>fills.push(a)},{get:(o,k)=>o[k]||(()=>{}),set:(o,k,v)=>(o[k]=v,true)});
ctx.stroke=()=>strokeColors.push(ctx.strokeStyle);
fxn.render(ctx,{candles:bars,limit:4*1440,timeframeMs:minute,from:day,to:day+5*86400000,x:t=>(t-day)/minute,y:p=>200-p,width:7200,tickSize:.01});
assert.ok(!strokeColors.includes(FXN.colors.yellow),'previous-day yellow lines are hidden');
assert.ok(!strokeColors.includes(FXN.colors.orange),'Asian midpoint and previous-week orange lines are hidden');
assert.ok(!labels.some(t=>t.includes('Asian Range Break')),'range-break text is hidden');
assert.ok(strokeColors.includes(FXN.colors.blue) && strokeColors.includes(FXN.colors.silver),'session boxes remain');
assert.ok(labels.some(t=>t.startsWith('A =')));assert.ok(labels.some(t=>t.startsWith('L =')));assert.ok(labels.some(t=>t.startsWith('N =')));assert.ok(labels.some(t=>t.startsWith('ADR =')));assert.ok(fills.length>0);assert.ok(lines.length>0);
const count=fills.length;
fxn.render(ctx,{candles:bars,limit:4*1440,timeframeMs:4*3600000});assert.equal(fills.length,count,'unsupported higher timeframes do not draw misleading boxes');
fxn.setConfig({user_ssth:'22',user_esth:'01',user_elth:'10',user_eltm:'15'});
const custom=fxn.bounds(day+4*3600000,'asia');assert.equal(custom.end-custom.start,3*3600000);
const partial=new FXN({enabled:true});partial.calculate(bars.slice(120),400,minute);assert.equal([...partial.sessions.values()].find(s=>s.type==='asia').partial,true,'truncated session cannot masquerade as complete');
// Real CSV values also flow through the port unchanged.
const buffer=Buffer.alloc(50000),fd=fs.openSync('XAUUSD_Data/XAU_5m_data.csv','r'),bytes=fs.readSync(fd,buffer,0,buffer.length,0);fs.closeSync(fd);
const real=buffer.toString('utf8',0,bytes).split(/\r?\n/).slice(1,-1).map(row=>{const [s,o,h,l,c]=row.split(';'),[Y,M,D,H,m]=s.match(/\d+/g).map(Number);return{time:Date.UTC(Y,M-1,D,H,m),open:+o,high:+h,low:+l,close:+c};});
const csv=new FXN({enabled:true});csv.calculate(real,real.length-1,5*minute);
for(const session of csv.sessions.values()){
 const rows=real.filter(c=>c.time>=session.start&&c.time<session.end);
 assert.equal(session.high,Math.max(...rows.map(c=>c.high)));assert.equal(session.low,Math.min(...rows.map(c=>c.low)));
}
vm.runInContext(fs.readFileSync('frontend/static/js/page_backtesting.js','utf8'),sandbox);
const page=sandbox.window.PageBacktesting;
page.fxnIndicator=fxn;
const settings=page.renderFxnSettings();
assert.ok(settings.includes('Previous week high / low'));
assert.ok(!settings.includes('undefined'),'every setting has a user-facing label');
for(const key of Object.keys(FXN.defaults))assert.ok(settings.includes(`data-fxn-setting="${key}"`),`setting ${key} is editable`);
const stored=new Map([['tfb_fxn_asian_range_v1',JSON.stringify({enabled:true,showPreviousDayHiLo:true,showLastWeeklyHiLo:true,showAsianMidpoint:true,showRangeBreaks:true})],['tfb_fxn_hide_yellow_levels_v1','true']]);
sandbox.localStorage={getItem:k=>stored.get(k)??null,setItem:(k,v)=>stored.set(k,v)};
page.fxnIndicator=null;
const migrated=page.getFxnIndicator().config;
for(const key of ['showPreviousDayHiLo','showLastWeeklyHiLo','showAsianMidpoint','showRangeBreaks'])assert.equal(migrated[key],false,'older saved visibility migrates: '+key);
assert.equal(migrated.enabled,true,'indicator remains enabled');
assert.equal(migrated.dailyUtcOffset,5.5,'saved FXN settings migrate to IST daily boundary');
assert.equal(migrated.displayTimezone,'Asia/Kolkata','FXN display is IST');
const boundary=new FXN();
boundary.calculate([{time:Date.parse('2026-01-22T18:29:00Z'),high:10,low:9,close:9.5},{time:Date.parse('2026-01-22T18:30:00Z'),high:11,low:10,close:10.5}],1,60000);
assert.equal(boundary.days.size,2,'FXN daily boundary changes at midnight IST (18:30 UTC)');
page.sessionEngine=new sandbox.window.IntenseSessions.SessionEngine({config:{definitions:{'new-york':{timezone:'UTC',startTime:'08:00'}}}});
page.saveSessionSettings=()=>{};
page.syncNewYorkSession();
const synced=page.sessionEngine.getConfig();
for(const [id,keys] of [['asia',['user_ssth','user_sstm','user_esth','user_estm']],['london',['london_ssth','london_sstm','london_esth','london_estm']],['new-york',['ny_ssth','ny_sstm','ny_esth','ny_estm']]]){
 const [sh,sm,eh,em]=keys,definition=synced.definitions[id];
 assert.equal(definition.startTime,`${page.fxnIndicator.config[sh]}:${page.fxnIndicator.config[sm]}`,`${id} navigator open follows FXN`);
 assert.equal(definition.endTime,`${page.fxnIndicator.config[eh]}:${page.fxnIndicator.config[em]}`,`${id} navigator close follows FXN`);
 assert.equal(definition.timezone,page.fxnIndicator.config.sessionTimezone,`${id} navigator uses FXN timezone`);
}
assert.ok(page.renderSessionToolbar().includes('FXN - Asian Session Range'));
assert.ok(!page.renderSessionToolbar().includes('Sessions:'),'duplicate session indicator toggle is removed');
assert.ok(!page.renderSessionToolbar().includes('sessionMenuBtn'),'duplicate session settings menu is removed');
const istAsia=page.fxnSessionOnIstDate('2026-01-24','asia');
assert.ok(istAsia,'navigator resolves FXN session by its IST calendar date');
assert.equal(page.sessionDateValue(istAsia.start,'asia'),'2026-01-24');
for(const date of ['2026-01-23','2026-10-23']){
 const expected=page.fxnIndicator.bounds(Date.parse(date+'T18:00Z'),'ny');
 const nav=page.sessionEngine.getSessionByDate(date,'new-york');
 assert.equal(nav.start,expected.start,'navigator and FXN NY open agree on '+date);
 assert.equal(nav.end,expected.end,'navigator and FXN NY close agree on '+date);
}
assert.equal(page.sessionEngine.getConfig().displayTimezone,'Asia/Kolkata');
console.log('fxn_asian_session_range.test.js passed');
