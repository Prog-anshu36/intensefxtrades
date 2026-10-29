const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');

const DAY=86400000;
const source=fs.readFileSync('frontend/static/js/pages-prop-challenge.js','utf8')
  .replace('export function createPropChallengeService','globalThis.createPropChallengeService = function');
const context={URL,URLSearchParams,Date,Math,JSON,Number,String,Error,Set,Map,Promise,crypto:webcrypto};
context.globalThis=context;
vm.runInNewContext(source,context);
let saved={challenges:[]},owner='owner-a';
const manifest={
  info:{timeframes:{'1m':{first_timestamp:Date.UTC(2020,0,1),last_timestamp:Date.UTC(2026,11,31)}}},
  timeframes:{'1m':{chunks:[]}}
};
const history={
  async info(){return manifest;},
  async history(params){
    const start=Number(params.get('start')),end=Number(params.get('end'));
    const time=Math.ceil(start/DAY)*DAY;
    if(time>end)return {candles:[]};
    const close=time===start?2000:2001;
    return {candles:[{time,open:2000,high:2002,low:1998,close,volume:1}]};
  }
};
const api=context.createPropChallengeService({history,read:async()=>saved,write:async value=>{saved=value;},owner:()=>owner});
const call=async(path,method='GET',body=null)=>{
  const result=await api.handle({path,method,body:body?JSON.stringify(body):null});
  return {status:result.status,value:JSON.parse(result.text)};
};
(async()=>{
  const first=await call('/api/prop-challenge','POST',{model:'standard',starting_balance:5000});
  assert.equal(first.status,201);
  const second=await call('/api/prop-challenge','POST',{model:'standard',starting_balance:5000});
  assert.notEqual(first.value.assigned_start.slice(0,7),second.value.assigned_start.slice(0,7),'a new challenge gets a different month');
  owner='owner-b';
  assert.equal((await call('/api/prop-challenge/'+first.value.id)).status,404,'challenge state is owner scoped');
  owner='owner-a';
  const created=await call('/api/prop-challenge','POST',{model:'pro',starting_balance:5000});
  const id=created.value.id;
  let result;
  for(let i=0;i<15;i++)result=await call('/api/prop-challenge/'+id+'/next-candle','POST',{});
  assert.equal(result.value.trading_days.length,15);
  assert.equal(result.value.status,'active');
  result=await call('/api/prop-challenge/'+id+'/next-candle','POST',{});
  assert.equal(result.value.status,'failed');
  assert.match(result.value.breach_reason,/15 trading days/);
  const tradeChallenge=await call('/api/prop-challenge','POST',{model:'pro',starting_balance:5000});
  const tradeId=tradeChallenge.value.id;
  await call('/api/prop-challenge/'+tradeId+'/next-candle','POST',{});
  const opened=await call('/api/prop-challenge/'+tradeId+'/order','POST',{side:'buy',lots:0.01});
  assert.equal(opened.value.position.entry,2000);
  await call('/api/prop-challenge/'+tradeId+'/next-candle','POST',{});
  const closed=await call('/api/prop-challenge/'+tradeId+'/close','POST',{});
  assert.equal(closed.value.trades.length,1);
  assert.equal(closed.value.trades[0].pnl,1);
  console.log('pages_prop_challenge.test.js passed: unique months, owner isolation, single-candle progression, 15-day limit and simulated orders');
})().catch(error=>{console.error(error);process.exitCode=1;});
