const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
(async () => {
  const entries = new Map();
  const remote = new Map();
  let calls = 0;
  const sandbox = { console, Store: {state:{active_account_id:'owner',active_user_id:'user'},subscribe(){}},
    localStorage:{getItem:k=>entries.get(k)||null,setItem:(k,v)=>entries.set(k,v)},
    addEventListener(){}, document:{querySelector:()=>null}, Router:{current:'prop-firm-session'},
    PagePerformance:{},PageTradeAnalysis:{},PageAICoach:{},
    API:{forPractice(id,owner){return {
      async initializePractice({balance}) {calls++; if(!remote.has(id))remote.set(id,{id, balance,history:[],active_trades:[],pending_orders:[],settings:{}});return remote.get(id);},
      async getState(){return remote.get(id);}
    };}}, ChartAccountState:{storageFor:()=>({getItem:()=>null})} };
  sandbox.window=sandbox;
  vm.createContext(sandbox);
  for(const file of ['prop-firm-session','prop-practice-workspace'])vm.runInContext(fs.readFileSync(`frontend/static/js/${file}.js`,'utf8'),sandbox);
  const page=sandbox.PropFirmSession;
  const a=page.create('standard',5000).attempt;
  const b=page.create('pro',10000).attempt;
  const context=await sandbox.PropPracticeWorkspace.ensure(a);
  context.store.state.history.push({id:1,pnl:100,opened_at:'2026-01-01T00:00:00Z',closed_at:'2026-01-01T01:00:00Z'});
  const container={querySelector:()=>null,querySelectorAll:()=>[]};
  let refreshed=0;
  page.refreshView=()=>refreshed++;
  page.afterRender(container);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(sandbox.PropPracticeWorkspace.hasState(b),true,'all account cards hydrate, not only selected');
  assert.equal(calls,2,'loaded ledger is reused');
  assert.equal(page.summary(a).closedPnl,100);
  assert.equal(page.summary(b).closedPnl,0);
  assert.equal(refreshed,1);
  page.activate(a.id);
  page.afterRender(container);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(refreshed,1,'hydration does not cause a rerender loop');
  page.advance(a.id); // active rounds cannot advance prematurely
  assert.equal(a.phase,1);
  console.log('prop_workspace_lifecycle.test.js passed: all-account hydration, ledger reuse, balances, selection and no refresh loop');
})().catch(error=>{console.error(error);process.exitCode=1;});
