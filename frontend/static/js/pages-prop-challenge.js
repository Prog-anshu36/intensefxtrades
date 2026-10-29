/* Browser-Pages implementation of the locked Prop Firm Session API.
   Uses only the real bounded XAUUSD history reader and device-local IndexedDB. */
export function createPropChallengeService({history, read, write, owner}) {
  const MAX_DAYS = 15;
  const RULES = {
    standard: {daily_loss_pct:5,max_loss_pct:10,targets:{"1":8,"2":5},min_days:3},
    pro: {daily_loss_pct:3,max_loss_pct:6,targets:{"1":6,"2":6},min_days:0}
  };
  const iso = ms => new Date(ms).toISOString();
  const dayKey = ms => new Date(ms).toISOString().slice(0,10);
  const bounds = (year,month) => [Date.UTC(year,month-1,1),Date.UTC(year,month,1)-1];
  const error = (status,message) => ({status,headers:{"Content-Type":"application/json"},text:JSON.stringify({error:message})});
  const ok = (value,status=200) => ({status,headers:{"Content-Type":"application/json"},text:JSON.stringify(value)});
  const publicChallenge = c => {
    const floating = c.position && c.last_candle ? (Number(c.last_candle.close)-Number(c.position.entry))*(c.position.side==="sell"?-1:1)*100*Number(c.position.lots) : 0;
    const equity = c.starting_balance + c.realized_pnl + floating;
    return {
      id:c.id,model:c.model,starting_balance:c.starting_balance,phase:c.phase,status:c.status,rules:c.rules,
      assigned_start:iso(c.start_ms),assigned_end:iso(c.end_ms),cursor:iso(c.cursor_ms),
      trading_days:c.trading_days,phase_days:c.phase_days,trading_day_limit:MAX_DAYS,
      breach_reason:c.breach_reason,realized_pnl:Number(c.realized_pnl.toFixed(2)),equity:Number(equity.toFixed(2)),
      daily_start_equity:Number((c.daily_start_equity||c.starting_balance).toFixed(2)),
      position:c.position,trades:c.trades,last_candle:c.last_candle,
      created_at:c.created_at,progress_pct:Math.round(Math.min(100,c.trading_days.length/MAX_DAYS*100)*100)/100
    };
  };
  const floating = (position,candle) => {
    if(!position||!candle)return 0;
    const delta=Number(candle.close)-Number(position.entry);
    return (position.side==="sell"?-delta:delta)*100*Number(position.lots);
  };
  async function loadState(){return (await read())||{challenges:[]};}
  async function saveState(state){await write(state);}
  function find(state,id){return state.challenges.find(c=>c.id===id&&c.owner===owner())||null;}
  async function pickMonth(state,manifest){
    const frame=manifest.timeframes?.["1m"],meta=manifest.info?.timeframes?.["1m"];
    if(!frame||!meta||meta.first_timestamp==null||meta.last_timestamp==null)throw Error("Verified local XAUUSD 1-minute history is unavailable.");
    const now=new Date(),used=new Set(state.challenges.filter(c=>c.owner===owner()).map(c=>c.start_ms));
    const candidates=[];
    for(let offset=48;offset<=60;offset++){
      const total=now.getUTCFullYear()*12+now.getUTCMonth()-offset;
      const year=Math.floor(total/12),month=total%12+1,[start,end]=bounds(year,month);
      if(start>=meta.first_timestamp&&end<=meta.last_timestamp&&end<Date.now()&&!used.has(start))candidates.push({start,end});
    }
    for(let i=candidates.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[candidates[i],candidates[j]]=[candidates[j],candidates[i]];}
    for(const candidate of candidates){
      const params=new URLSearchParams({symbol:"XAUUSD",timeframe:"1m",start:String(candidate.start),end:String(candidate.end),limit:"1"});
      const result=await history.history(params);
      if(result.candles?.length)return candidate;
    }
    throw Error("No unused complete XAUUSD month is available in the 4–5 year window.");
  }
  function evaluate(c,realized,position,candle,phaseDays,dailyStart,currentDay){
    const rules=c.rules, dailyFloor=dailyStart*(1-rules.daily_loss_pct/100), maxFloor=c.starting_balance*(1-rules.max_loss_pct/100);
    const adverse=position&&candle?{...candle,close:position.side==="buy"?candle.low:candle.high}:candle;
    const riskEquity=c.starting_balance+realized+floating(position,adverse);
    if(riskEquity<=maxFloor)return ["failed",`Maximum loss limit breached. Adverse equity ${riskEquity.toFixed(2)} reached floor ${maxFloor.toFixed(2)}.`];
    if(riskEquity<=dailyFloor)return ["failed",`Daily loss limit breached on ${currentDay}. Adverse equity ${riskEquity.toFixed(2)} reached floor ${dailyFloor.toFixed(2)}.`];
    const target=c.starting_balance*rules.targets[String(c.phase)]/100;
    if(!position&&realized>=target&&phaseDays.length>=rules.min_days)return [c.phase===2?"passed":"phase-ready",""];
    return ["active",""];
  }
  function closePosition(c,price,time,position,trades,realized){
    if(!position)return {position,trades,realized};
    const move=(Number(price)-Number(position.entry))*(position.side==="sell"?-1:1);
    const pnl=move*100*Number(position.lots);
    trades.push({...position,exit:Number(price),closed_at:iso(time),pnl:Number(pnl.toFixed(2))});
    return {position:null,trades,realized:realized+pnl};
  }
  async function handle(data){
    const url=new URL(data.path,"https://browser.local"),path=url.pathname,method=(data.method||"GET").toUpperCase();
    const body=(()=>{try{return JSON.parse(data.body||"{}")}catch(_){return {}}})();
    try{
      if(path==="/api/prop-challenge/coverage"&&method==="GET"){
        const manifest=await history.info();
        return ok({symbol:"XAUUSD",source:"local-csv",timeframes:manifest.info.timeframes,first_timestamp:manifest.info.first_timestamp,last_timestamp:manifest.info.last_timestamp});
      }
      if(path==="/api/prop-challenge"&&method==="GET"){
        const state=await loadState();
        return ok({challenges:state.challenges.filter(c=>c.owner===owner()).sort((a,b)=>b.created_at.localeCompare(a.created_at)).map(publicChallenge)});
      }
      if(path==="/api/prop-challenge"&&method==="POST"){
        const model=String(body.model||"standard").toLowerCase(),balance=Number(body.starting_balance||5000);
        if(!RULES[model])return error(409,"Unsupported challenge model.");
        const allowed=[5000,10000,25000,50000,100000,...(model==="pro"?[200000]:[])];
        if(!allowed.includes(balance))return error(409,"Unsupported account size for this model.");
        const state=await loadState(),manifest=await history.info(),range=await pickMonth(state,manifest),now=Date.now();
        const challenge={id:crypto.randomUUID(),owner:owner(),model,starting_balance:balance,phase:1,status:"active",rules:RULES[model],
          start_ms:range.start,end_ms:range.end,cursor_ms:range.start,trading_days:[],phase_days:[],breach_reason:"",
          realized_pnl:0,position:null,trades:[],current_day:"",daily_start_equity:balance,last_candle:null,revealed:[],
          created_at:iso(now),updated_at:iso(now)};
        state.challenges.push(challenge);await saveState(state);return ok(publicChallenge(challenge),201);
      }
      const match=path.match(/^\/api\/prop-challenge\/([^/]+)(?:\/(.*))?$/);
      if(!match)return error(404,"Challenge endpoint not found.");
      const id=decodeURIComponent(match[1]),action=match[2]||"",state=await loadState(),c=find(state,id);
      if(!c)return error(404,"Challenge not found.");
      const persist=async(status=200)=>{c.updated_at=iso(Date.now());await saveState(state);return ok(publicChallenge(c),status);};
      if(!action&&method==="GET")return ok(publicChallenge(c));
      if(action==="candles"&&method==="GET"){
        const limit=Math.max(1,Math.min(500,Number(url.searchParams.get("limit")||120)));
        return ok({candles:c.revealed.slice(-limit)});
      }
      if(action==="next-candle"&&method==="POST"){
        if(c.status!=="active")return ok({...publicChallenge(c),new_candle:null});
        const params=new URLSearchParams({symbol:"XAUUSD",timeframe:"1m",start:String(c.cursor_ms),end:String(c.end_ms),limit:"1"});
        const found=(await history.history(params)).candles||[];
        if(!found.length){c.status="failed";c.breach_reason="The assigned historical month ended before the challenge was passed.";await saveState(state);return ok({...publicChallenge(c),new_candle:null});}
        const candle=found[0],time=Number(candle.time),day=dayKey(time);
        if(!c.trading_days.includes(day)&&c.trading_days.length>=MAX_DAYS){c.status="failed";c.breach_reason="Challenge not passed within 15 trading days.";await saveState(state);return ok({...publicChallenge(c),new_candle:null});}
        let position=c.position,trades=c.trades,realized=c.realized_pnl,currentDay=c.current_day,dailyStart=c.daily_start_equity;
        if(day!==currentDay){currentDay=day;dailyStart=c.starting_balance+realized+floating(position,c.last_candle);if(!c.trading_days.includes(day))c.trading_days.push(day);}
        if(position){
          const stop=position.stop_loss,take=position.take_profit;
          const hitStop=stop!=null&&(position.side==="buy"?candle.low<=stop:candle.high>=stop);
          const hitTake=take!=null&&(position.side==="buy"?candle.high>=take:candle.low<=take);
          if(hitStop||hitTake){const closed=closePosition(c,hitStop?stop:take,time,position,trades,realized);position=closed.position;trades=closed.trades;realized=closed.realized;}
        }
        const [status,reason]=evaluate(c,realized,position,candle,c.phase_days,dailyStart,currentDay);
        if(status==="failed"&&position){const closed=closePosition(c,candle.close,time,position,trades,realized);position=closed.position;trades=closed.trades;realized=closed.realized;}
        c.cursor_ms=time+1;c.current_day=currentDay;c.daily_start_equity=dailyStart;c.position=position;c.trades=trades;c.realized_pnl=realized;c.last_candle=candle;c.status=status;c.breach_reason=reason;c.revealed.push(candle);if(c.revealed.length>500)c.revealed=c.revealed.slice(-500);
        await saveState(state);return ok({...publicChallenge(c),new_candle:candle});
      }
      if(action==="order"&&method==="POST"){
        if(c.status!=="active")return error(409,"This challenge is not active.");
        const side=String(body.side||"").toLowerCase(),lots=Number(body.lots);
        if(!["buy","sell"].includes(side))return error(409,"Order side must be buy or sell.");
        if(!Number.isFinite(lots)||lots<=0||lots>100)return error(409,"Lot size must be greater than 0 and no more than 100.");
        if(c.position)return error(409,"Only one open XAUUSD position is allowed. Close it before opening another.");
        if(!c.last_candle)return error(409,"Wait until the historical market starts before placing an order.");
        const entry=Number(c.last_candle.close),optional=value=>value==null||String(value).trim()===""?null:Number(value);
        const stop=optional(body.stop_loss),take=optional(body.take_profit);
        if([stop,take].some(v=>v!=null&&(!Number.isFinite(v)||v<=0)))return error(409,"Stop loss and take profit must be positive prices.");
        if(stop!=null&&((side==="buy"&&stop>=entry)||(side==="sell"&&stop<=entry)))return error(409,"Stop loss must be below entry for Buy and above entry for Sell.");
        if(take!=null&&((side==="buy"&&take<=entry)||(side==="sell"&&take>=entry)))return error(409,"Take profit must be above entry for Buy and below entry for Sell.");
        c.position={side,lots,entry,opened_at:iso(Number(c.last_candle.time)),stop_loss:stop,take_profit:take};
        const tradeDay=dayKey(Number(c.last_candle.time));if(!c.phase_days.includes(tradeDay))c.phase_days.push(tradeDay);
        return persist();
      }
      if(action==="close"&&method==="POST"){
        if(c.status!=="active")return error(409,"This challenge is not active.");
        if(!c.position||!c.last_candle)return error(409,"There is no open position to close.");
        const closed=closePosition(c,Number(c.last_candle.close),Number(c.last_candle.time),c.position,c.trades,c.realized_pnl);
        c.position=closed.position;c.trades=closed.trades;c.realized_pnl=closed.realized;
        const [status,reason]=evaluate(c,c.realized_pnl,null,c.last_candle,c.phase_days,c.daily_start_equity,c.current_day);
        c.status=status;c.breach_reason=reason;return persist();
      }
      if(action==="advance-phase"&&method==="POST"){
        if(c.status!=="phase-ready"||c.phase!==1)return error(409,"Phase 1 objectives must be completed before Phase 2.");
        c.phase=2;c.status="active";c.realized_pnl=0;c.position=null;c.phase_days=[];c.current_day="";c.daily_start_equity=c.starting_balance;c.breach_reason="";
        return persist();
      }
      return error(404,"Challenge endpoint not found.");
    }catch(err){return error(409,err?.message||"Historical challenge request failed.");}
  }
  return {handle};
}
