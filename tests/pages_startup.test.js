/* First-visit module loading must never drop the initial workspace request. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function setup(){
  const timers=new Map();let next=0,worker;
  class Worker {
    constructor(){worker=this;this.messages=[];}
    postMessage(message){this.messages.push(message);}
    emit(data){this.onmessage({data});}
  }
  const context={Worker,URL,Headers,Response,DOMException,Uint8Array,atob,
    console:{error(){}},location:{href:'https://example.com/app/',origin:'https://example.com'},
    fetch:async()=>{},localStorage:{},
    document:{currentScript:{src:'https://example.com/app/static/js/pages-bridge.js?v=test'},
      querySelector:()=>null,getElementById:()=>null,addEventListener(){}},
    setTimeout(fn,ms){const id=++next;timers.set(id,{fn,ms});return id;},
    clearTimeout(id){timers.delete(id);}};
  context.window=context;
  vm.runInNewContext(fs.readFileSync('frontend/static/js/pages-bridge.js','utf8'),context);
  return {context,worker,timers};
}
(async()=>{
  const first=setup();
  const request=first.context.fetch('/api/state');
  await Promise.resolve();
  assert.equal(first.worker.messages.length,0,'Do not post while the module import is pending');
  first.worker.emit({type:'worker-ready'});
  await Promise.resolve();
  assert.equal(first.worker.messages.length,1,'Send the queued first request once receiver exists');
  const {id}=first.worker.messages[0];
  first.worker.emit({id,result:{status:200,headers:{},text:'{"balance":10000}'}});
  assert.equal((await (await request).json()).balance,10000);
  assert.equal(first.timers.size,0,'Completed startup leaves no timeout listeners behind');
  const scoped=first.context.fetch('/api/state',{headers:{'X-Practice-Id':'round-phase-1','X-Practice-Owner':'demo'}});
  await Promise.resolve();
  const message=first.worker.messages.at(-1);
  assert.equal(message.headers['x-practice-id'],'round-phase-1','practice identity reaches the browser Python transport');
  assert.equal(message.headers['x-practice-owner'],'demo');
  first.worker.emit({id:message.id,result:{status:200,headers:{},text:'{"balance":5000}'}});
  assert.equal((await (await scoped).json()).balance,5000);
  const failed=setup();
  failed.worker.onerror({message:'Module download failed'});
  await assert.rejects(failed.context.fetch('/api/state'),/Module download failed/);
  const stalled=setup();
  const stuck=stalled.context.fetch('/api/state');
  [...stalled.timers.values()].find(x=>x.ms===30000).fn();
  await assert.rejects(stuck,/worker did not start/);
  const runtime=setup();runtime.worker.emit({type:'worker-ready'});
  const slow=runtime.context.fetch('/api/state');await Promise.resolve();
  [...runtime.timers.values()].find(x=>x.ms===180000).fn();
  await assert.rejects(slow,/timed out/);
  console.log('pages_startup.test.js passed: delayed module handshake, early failure, startup and request timeouts');
})().catch(error=>{console.error(error);process.exitCode=1;});
