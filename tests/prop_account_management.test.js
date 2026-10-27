const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const memory=new Map();const s={console,Date,Math,Intl,Store:{state:{active_account_id:'audit'},subscribe(){}},localStorage:{getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v)},addEventListener(){},document:{querySelector:()=>null}};s.window=s;vm.createContext(s);
for(const file of ['prop-practice-analytics','prop-firm-session'])vm.runInContext(fs.readFileSync(`frontend/static/js/${file}.js`,'utf8'),s);
const page=s.PropFirmSession;
const a=page.create('standard',5000,{dailyLossPct:3,minDays:0}).attempt;
const b=page.create('standard',10000,{dailyLossPct:5,minDays:3}).attempt;
assert.equal(page.rulesFor(a).dailyLossPct,3);assert.equal(page.rulesFor(a).minDays,0);
assert.equal(page.rulesFor(b).dailyLossPct,5);assert.equal(page.rulesFor(b).minDays,3);
assert.equal(page.create('standard',5000,{dailyLossPct:20,minDays:0}).ok,false);
assert.equal(page.rename(a.id,'London Practice').ok,true);
assert.equal(page.rename(a.id,' ').ok,false);
page.filters.search='london';assert.equal(page.filteredAccounts().length,1);
page.filters.search='';page.filters.model='pro';assert.equal(page.filteredAccounts().length,0);
page.filters.model='all';assert.equal(page.archive(a.id).ok,true);assert.equal(page.filteredAccounts().length,1);
page.filters.archive='archived';assert.equal(page.filteredAccounts()[0].id,a.id);
assert.equal(page.archive(a.id,false).ok,true);page.activate(a.id);
s.Store.state.active_trades=[{id:1,symbol:'XAUUSD'}];assert.equal(page.archive(a.id).ok,false);s.Store.state.active_trades=[];
const key=page.storageKey();page._scope=null;page.load();assert.equal(page.selected().name,'London Practice');assert.equal(page.rulesFor(page.selected()).dailyLossPct,3);
const rows=[{type:'BUY',pnl:100,entry:2000,sl:1990,tp:2020,opened_at:'2026-01-01T08:00:00Z',closed_at:'2026-01-01T08:30:00Z'},{type:'SELL',pnl:-50,entry:2010,sl:2020,tp:1990,opened_at:'2026-01-02T08:00:00Z',closed_at:'2026-01-02T08:02:00Z'},{type:'BUY',pnl:0,opened_at:'2026-01-02T09:00:00Z',closed_at:'2026-01-02T09:01:00Z'}];
const m=s.PropPracticeAnalytics.metrics(rows);assert.equal(m.pnl,50);assert.equal(m.grossProfit,100);assert.equal(m.grossLoss,50);assert.equal(m.profitFactor,2);assert.equal(m.rr,2);assert.equal(m.biggestLoss,-50);assert.ok(Math.abs(m.winRate-100/3)<1e-10);assert.ok(m.score>=0&&m.score<=100);
assert.equal(s.PropPracticeAnalytics.dayKey('2026-01-01T21:30:00Z'),'2026-01-02');
const attempt=page.selected();const state={history:rows,active_trades:[],pending_orders:[],practice_workspace:true};
const summary=page.summary(attempt,state);const html=s.PropPracticeAnalytics.render(page,attempt,summary);
for(const label of ['Practice score','Daily summary','Short analysis','Long analysis','P&amp;L distribution','Trading records','Commission','P&amp;L'])assert.ok(html.includes(label),label);
assert.ok(!html.includes('NaN'));assert.ok(!html.includes('Infinity'));
console.log('prop_account_management.test.js passed: variants, frozen rules, rename, archive safety/restoration/filtering, persistence, analytics values and rendering');


// Dashboard must expose a persistent account rail and a single selected view.
page.creating=false;
const portal=page.render();
assert.ok(portal.includes('prop-account-sidebar'));
assert.ok(portal.includes('prop-account-detail'));
assert.ok(!portal.includes('propfirm-hero'));
assert.ok(portal.indexOf('Practice score')<portal.indexOf('Account equity'));
assert.ok(portal.indexOf('Account equity')<portal.indexOf('Trading objectives'));
page.creating=true;
assert.ok(page.render().includes('role="dialog"'));
console.log('Reference account-list/detail order and creation dialog checks passed');
