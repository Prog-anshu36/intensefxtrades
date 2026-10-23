/* Execute the exact browser Python bridge in Node's matching WASM runtime. */
const fs=require('fs'),assert=require('assert');
const {loadPyodide}=require('../deployment-check/node_modules/pyodide');
(async()=>{
 const py=await loadPyodide();
 await py.loadPackage(['micropip','markupsafe','pycryptodome']);
 await py.runPythonAsync("import micropip\nawait micropip.install(['flask==3.1.2','flask-cors==6.0.1'])");
 py.FS.mkdirTree('/workspace/backend');
 for(const name of ['app.py','trade_importer.py','xauusd_data_provider.py'])py.FS.writeFile('/workspace/backend/'+name,fs.readFileSync('backend/'+name,'utf8'));
 await py.runPythonAsync(fs.readFileSync('frontend/pages-runtime.py','utf8'));
 const call=(path,body,method=body?'POST':'GET')=>{
  py.globals.set('_request_json',JSON.stringify({path,method,body:body?JSON.stringify(body):null}));
  const r=JSON.parse(py.runPython('dispatch(_request_json)'));assert.ok(r.status<500,JSON.stringify(r));
  return {status:r.status,value:JSON.parse(Buffer.from(r.body,'base64').toString()),state:r.state};
 };
 const state=call('/api/state').value;assert.equal(state.settings.symbol,'XAUUSD');
 const trade=call('/api/trades/open',{symbol:'XAUUSD',type:'BUY',entry:2650,lots:.1,sl:2640,tp:2670,opened_at:'2025-01-01T09:00:00Z'}).value;
 assert.ok(trade.id);
 assert.equal(call('/api/trades/protection',{account_id:state.id,id:trade.id,sl:2645,tp:2670,mark:2650}).status,200);
 call('/api/trades/update',{ticks:{XAUUSD:{time:Date.parse('2025-01-01T09:01Z'),closed_time:Date.parse('2025-01-01T09:02Z'),high:2671,low:2649,close:2670}}});
 const after=call('/api/state');assert.equal(after.value.active_trades.length,0);assert.equal(after.value.balance,10200);
 call('/api/journal',{title:'Local WASM test',note:'persisted in this browser'});
 assert.equal(call('/api/journal').value.length,1);
 const snapshot=call('/api/state').state;assert.ok(snapshot.includes('Local WASM test'));
 py.FS.writeFile('/workspace/browser-state.json',snapshot);
 assert.equal(call('/api/state').value.history.length,1);
 const signup=call('/api/auth/signup',{email:'browser-test@example.invalid',password:'test-password',name:'Browser test'});assert.equal(signup.status,200);
 assert.equal(call('/api/auth/login',{email:'browser-test@example.invalid',password:'test-password'}).status,200);
 console.log('browser_python_runtime.cjs passed: real Flask routes run in WASM; order, protection, replay, P&L, journal, persistence, local login');
})().catch(error=>{console.error(error);process.exitCode=1;});
