/* Local Python trading API and bounded real history, off the UI thread. */
await import(new URL('./pages-history.js'+new URL(import.meta.url).search,import.meta.url));
const base=new URL('../../',import.meta.url);
const history=new globalThis.PagesHistory(base);
let python,ready,db,lastSaved=null;
const status=text=>postMessage({type:'status',text});
function openDatabase(){return new Promise((resolve,reject)=>{const r=indexedDB.open('intensefxtrades-browser-v1:'+base.pathname,1);r.onupgradeneeded=()=>r.result.createObjectStore('workspace');r.onsuccess=()=>{r.result.onversionchange=()=>r.result.close();resolve(r.result);};r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error('Browser storage is blocked by another tab. Close older app tabs and retry.'));});}
function readState(){return new Promise((resolve,reject)=>{const tx=db.transaction('workspace','readonly'),r=tx.objectStore('workspace').get('state');r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error);});}
function saveState(value){return new Promise((resolve,reject)=>{const tx=db.transaction('workspace','readwrite');tx.objectStore('workspace').put(value,'state');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error || Error('Browser storage write failed'));});}
async function initialize(){
  status('Starting your private browser workspace…');
  db=await openDatabase();lastSaved=await readState();
  const {loadPyodide}=await import('https://cdn.jsdelivr.net/pyodide/v314.0.7/full/pyodide.mjs');
  python=await loadPyodide({indexURL:'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/'});
  status('Loading the trading engine—first visit may take a moment…');
  await python.loadPackage(['micropip','markupsafe','pycryptodome']);
  await python.runPythonAsync("import micropip\nawait micropip.install(['flask==3.1.2', 'flask-cors==6.0.1'])");
  python.FS.mkdirTree('/workspace/backend');
  for(const name of ['backend/app.py','backend/trade_importer.py','backend/xauusd_data_provider.py','pages_runtime.py']){
    const r=await fetch(new URL('python/'+name,base),{cache:'no-cache'});if(!r.ok)throw Error('Browser trading engine source could not be loaded.');
    python.FS.writeFile('/workspace/'+name,await r.text());
  }
  if(lastSaved)python.FS.writeFile('/workspace/browser-state.json',lastSaved);
  await python.runPythonAsync(python.FS.readFile('/workspace/pages_runtime.py',{encoding:'utf8'}));
  status('Ready · real CSV history · saved on this device');
}
async function handle(data){
  await (ready ||= initialize());
  if(data.path==='/browser/backup')return{status:200,headers:{'Content-Type':'application/json'},text:JSON.stringify({format:'intensefxtrades-browser-v1',state:JSON.parse(lastSaved || python.runPython('json.dumps(backend.DEFAULT_STATE)'))})};
  if(data.path==='/browser/restore'){
    const backup=JSON.parse(data.body);
    if(backup.format!=='intensefxtrades-browser-v1'||!Array.isArray(backup.state?.accounts)||!backup.state.accounts.length)throw Error('Invalid browser workspace backup.');
    const value=JSON.stringify(backup.state);await saveState(value);lastSaved=value;python.FS.writeFile('/workspace/browser-state.json',value);
    python.runPython('client = backend.app.test_client()');
    return{status:200,headers:{'Content-Type':'application/json'},text:'{"ok":true}'};
  }
  if(data.path.startsWith('/api/market/')){
    const url=new URL(data.path,base);
    const value=url.pathname.endsWith('/dataset-info')?(await history.info()).info:await history.history(url.searchParams);
    return{status:200,headers:{'Content-Type':'application/json'},text:JSON.stringify(value)};
  }
  python.globals.set('_request_json',JSON.stringify(data));
  const latest=await readState();
  if(latest && latest!==lastSaved){python.FS.writeFile('/workspace/browser-state.json',latest);lastSaved=latest;}
  const result=JSON.parse(python.runPython('dispatch(_request_json)'));
  if(result.state && result.state!==lastSaved){
    try{await saveState(result.state);lastSaved=result.state;}
    catch(error){if(lastSaved)python.FS.writeFile('/workspace/browser-state.json',lastSaved);else python.FS.unlink('/workspace/browser-state.json');throw Error('Browser storage is full or unavailable. The change was not saved. Export a backup before clearing browser data.');}
  }
  delete result.state;return result;
}
let queue=Promise.resolve();
self.onmessage=event=>{queue=queue.then(async()=>{
  const {id,...request}=event.data;
  try{
    // Runtime downloads must not hold the cross-tab state lock. A slow or
    // background tab should never prevent another tab from starting.
    await (ready ||= initialize());
    const result=navigator.locks?await navigator.locks.request('intensefxtrades-state:'+base.pathname,{signal:AbortSignal.timeout(15000)},()=>handle(request)):await handle(request);
    postMessage({id,result});
  }catch(error){console.error(error);postMessage({id,error:error.message || String(error)});}
});};
// The module's awaited import is complete and the receiver is installed.
// The page must wait for this before posting its first request.
postMessage({type:'worker-ready'});
