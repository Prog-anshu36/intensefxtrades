const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const sandbox={window:{}};vm.createContext(sandbox);vm.runInContext(fs.readFileSync('frontend/static/js/router.js','utf8'),sandbox);
assert.ok(sandbox.window.Router,'router must be available to cross-module button handlers');
for(const route of ['prop-firm-session','prop-chart','prop-performance','prop-trade-analysis','prop-ai-coach'])assert.ok(sandbox.window.Router.pages[route],route);
const html=fs.readFileSync('frontend/templates/index.html','utf8');assert.ok(html.includes('data-group="prop-analysis"'));
for(const route of ['prop-performance','prop-trade-analysis','prop-ai-coach'])assert.ok(html.includes(`data-page="${route}"`));
console.log('prop_navigation.test.js passed: shared router export, five routes and separate prop analysis navigation');

// Use the real exported router object so a missing window.Router cannot be
// masked by independently injecting a fake router into the prop module.
const memory=new Map(),nodes=new Map(),routes=[];
function node(id,value='') {const n={value,dataset:{},listeners:{},addEventListener(k,fn){this.listeners[k]=fn;},focus(){},setSelectionRange(){}};nodes.set(id,n);return n;}
for(const id of ['#propOpenCreate','#propCloseCreate','#propEmptyCreate','#propFirmStart','#propFirmChart','#propFirmModel','#propFirmSize','#propRenameForm','#propAccountName','#propManageStatus'])node(id);
nodes.get('#propFirmModel').value='pro';nodes.get('#propFirmSize').value='10000';nodes.get('#propAccountName').value='Named prop account';
const store={state:{active_account_id:'normal',history:[],active_trades:[],pending_orders:[]},subscribe(){}};
sandbox.Store=store;sandbox.window.Store=store;sandbox.localStorage={getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v)};sandbox.window.addEventListener=()=>{};sandbox.document={querySelector:id=>nodes.get(id)||null};
sandbox.window.Router.current='prop-firm-session';sandbox.window.Router.go=route=>routes.push(route);
vm.runInContext(fs.readFileSync('frontend/static/js/prop-firm-session.js','utf8'),sandbox);
const page=sandbox.window.PropFirmSession;page.afterRender({querySelector:id=>nodes.get(id)||null,querySelectorAll:()=>[]});
nodes.get('#propOpenCreate').listeners.click();assert.equal(page.creating,true);
nodes.get('#propCloseCreate').listeners.click();assert.equal(page.creating,false);
nodes.get('#propFirmStart').listeners.click();assert.equal(page.selected().startingBalance,10000);assert.equal(page.selected().model,'pro');assert.equal(page.creating,false);assert.equal(routes.at(-1),'prop-firm-session');
nodes.get('#propFirmChart').listeners.click();assert.equal(routes.at(-1),'prop-chart');
nodes.get('#propRenameForm').listeners.submit({preventDefault(){}});assert.equal(page.selected().name,'Named prop account');
assert.ok(page.render().includes('prop-account-sidebar'));
assert.ok(page.render().includes('prop-account-detail'));
assert.ok(!page.render().includes('role="dialog"'),'creation UI must not displace the selected dashboard');
page.creating=true;assert.ok(page.render().includes('role="dialog"'));
console.log('prop_navigation.test.js passed: actual cross-module create/open/close/rename handlers and account portal composition');
