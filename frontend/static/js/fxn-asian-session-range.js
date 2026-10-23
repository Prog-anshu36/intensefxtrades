/* JavaScript port of the user-supplied FXN - Asian Session Range (RobMinty).
 * Retains input names/defaults. Replaces Pine lookahead_on with replay-prefix data.
 * Uses the existing chart's timestamp/price projector; never creates candles.
 */
(function(){
  const DAY=86400000, HOUR=3600000, EST=5*HOUR;
  const colors={aqua:'#00bcd4',black:'#363a45',blue:'#2196f3',fuchsia:'#e040fb',gray:'#787b86',green:'#4caf50',lime:'#00e676',maroon:'#880e4f',navy:'#311b92',olive:'#808000',orange:'#ff9800',purple:'#9c27b0',red:'#f23645',silver:'#b2b5be',teal:'#089981',white:'#ffffff',yellow:'#ffeb3b'};
  const defaults={enabled:false,user_ssth:'20',user_sstm:'00',user_esth:'02',user_estm:'00',user_elth:'11',user_eltm:'30',user_box_line_color:'blue',boxLineWidth:1,user_box_line_style:'solid',sessionLineWidth:2,user_upperlower_line_style:'dotted',user_midline_color:'orange',user_middle_line_style:'dotted',user_text_color:'blue',user_label_size:'normal',show_london_session:true,show_london_session_rng:true,london_ssth:'03',london_sstm:'00',london_esth:'07',london_estm:'00',show_ny_session:true,show_ny_session_rng:true,ny_ssth:'08',ny_sstm:'00',ny_esth:'12',ny_estm:'00',showADR:true,is_forex_pips:true,daily_adr_user:1,daily_adr_length:21,showPreviousDayHiLo:true,previousDayHiLoColor:'yellow',supportLineWidth:1,previousDayHiLoLineStyle:'dashed',showHiLoPriceRange:false,showHiLoPriceLabel:false,showLastWeeklyHiLo:true,lastWeeklyHiLoColor:'orange',supportLastWeekLineWidth:1,lastWeeklyHiLoStyle:'dashed',lastWeeklyHiLoShowLabel:true,showWeeklyHiLo:false,weeklyHiLoColor:'olive',supportWeekLineWidth:1,weeklyHiLoStyle:'dashed',weeklyHiLoShowLabel:false,showHiLoTime:false,fillOpacity:.1,dailyUtcOffset:0,dailyStartHour:0};
  for(const [prefix,color] of [['l','teal'],['n','silver']])Object.assign(defaults,{[prefix+'user_box_line_color']:color,[prefix+'boxLineWidth']:1,[prefix+'user_box_line_style']:'solid',[prefix+'sessionLineWidth']:2,[prefix+'user_upperlower_line_style']:'dotted',[prefix+'user_midline_color']:color,[prefix+'user_middle_line_style']:'dotted',[prefix+'user_text_color']:color,[prefix+'user_label_size']:'normal'});
  const times=['user_ssth','user_sstm','user_esth','user_estm','user_elth','user_eltm','london_ssth','london_sstm','london_esth','london_estm','ny_ssth','ny_sstm','ny_esth','ny_estm'];
  defaults.sessionTimezone='America/New_York';
  defaults.showPreviousDayHiLo=false;
  defaults.showLastWeeklyHiLo=false;
  defaults.showAsianMidpoint=false;
  defaults.showRangeBreaks=false;
  const minute=(c,h,m)=>Number(c[h])*60+Number(c[m]);
  const stamp=c=>c.date instanceof Date?c.date.getTime():Number(c.time ?? c.timestamp);
  const dash=style=>style==='dashed'?[6,4]:style==='dotted'?[2,4]:[];
  class FXNAsianSessionRange {
    constructor(config={}){this.setConfig(config);}
    setConfig(patch){
      const next={...defaults,...this.config};
      for(const key of Object.keys(defaults))if(key in patch){
        let value=patch[key];
        if(typeof defaults[key]==='boolean')value=!!value;
        else if(typeof defaults[key]==='number'){
          value=Number(value);if(!Number.isFinite(value))continue;
          const min=key==='dailyUtcOffset'?-12:0,max=key==='dailyUtcOffset'?14:key==='dailyStartHour'?23:key==='fillOpacity'?1:key.includes('Width')?20:500;
          value=Math.max(min,Math.min(max,value));
          if(key!=='fillOpacity' && key!=='dailyUtcOffset')value=Math.round(value);
        }else if(key==='sessionTimezone'){
          if(!['America/New_York','Etc/GMT+5'].includes(value))continue;
        }else if(times.includes(key)){
          if(!/^\d{2}$/.test(value)||Number(value)>(key.endsWith('m')?59:23))continue;
        }else if(key.toLowerCase().includes('color')){if(!colors[value])continue;}
        else if(key.toLowerCase().includes('style')){if(!['solid','dashed','dotted'].includes(value))continue;}
        else if(!['tiny','small','normal','large'].includes(value))continue;
        next[key]=value;
      }
      this.config=next;this.reset();return {...next};
    }
    reset(){this.candles=null;this.processed=-1;this.sessions=new Map();this.days=new Map();this.weeks=new Map();this.breaks=[];this.extremaTimes=[];this.boundaryCache=new Map();}
    clockSettings(time,zone='Asia/Kolkata'){
      const parts=window.IntenseSessions.partsInZone;
      const source=parts(time,this.config.sessionTimezone),target=parts(time,zone);
      const shift=(target.hour-source.hour)*60+target.minute-source.minute;
      const values={...this.config};
      for(let i=0;i<times.length;i+=2){const h=times[i],m=times[i+1],n=(minute(this.config,h,m)+shift+2880)%1440;values[h]=String(Math.floor(n/60)).padStart(2,'0');values[m]=String(n%60).padStart(2,'0');}
      return {values,shift};
    }
    bounds(time,type){
      const c=this.config,keys=type==='asia'?['user_ssth','user_sstm','user_esth','user_estm']:type==='london'?['london_ssth','london_sstm','london_esth','london_estm']:['ny_ssth','ny_sstm','ny_esth','ny_estm'];
      const startMin=minute(c,keys[0],keys[1]),endMin=minute(c,keys[2],keys[3]);
      if(window.IntenseSessions?.zonedTimeToUtc){
        const utcDay=Math.floor(time/DAY),cacheKey=type+':'+utcDay;
        let candidates=this.boundaryCache.get(cacheKey);
        if(!candidates){
          const {zonedTimeToUtc,partsInZone}=window.IntenseSessions,zone=c.sessionTimezone;
          candidates=[-2,-1,0,1].map(delta=>{
            const date=new Date((utcDay+delta)*DAY).toISOString().slice(0,10);
            const next=new Date((utcDay+delta+1)*DAY).toISOString().slice(0,10);
            const start=zonedTimeToUtc(date,`${c[keys[0]]}:${c[keys[1]]}`,zone);
            const end=zonedTimeToUtc(endMin<=startMin?next:date,`${c[keys[2]]}:${c[keys[3]]}`,zone);
            let extendDate=partsInZone(end,zone).dateKey;
            let extend=zonedTimeToUtc(extendDate,`${c.user_elth}:${c.user_eltm}`,zone);
            if(extend<end){extendDate=new Date(Date.parse(extendDate+'T00:00:00Z')+DAY).toISOString().slice(0,10);extend=zonedTimeToUtc(extendDate,`${c.user_elth}:${c.user_eltm}`,zone);}
            return{start,end,extend};
          });
          this.boundaryCache.set(cacheKey,candidates);
        }
        return candidates.filter(b=>b.start<=time).at(-1);
      }
      let start=Math.floor((time-EST)/DAY)*DAY+EST+startMin*60000;
      if(start>time)start-=DAY;
      const end=start+((endMin-startMin+1440)%1440 || 1440)*60000;
      let extend=Math.floor((end-EST)/DAY)*DAY+EST+minute(c,'user_elth','user_eltm')*60000;
      if(extend<end)extend+=DAY;
      return {start,end,extend};
    }
    add(map,key,c,time,extra={}){
      let row=map.get(key);
      if(!row){row={start:key,high:-Infinity,low:Infinity,count:0,...extra};map.set(key,row);}
      if(c.high>row.high){row.high=Number(c.high);row.highTime=time;}
      if(c.low<row.low){row.low=Number(c.low);row.lowTime=time;}
      row.close=Number(c.close);row.lastTime=time;row.count++;return row;
    }
    lowerBound(candles,time){let lo=0,hi=candles.length;while(lo<hi){const mid=(lo+hi)>>1;if(stamp(candles[mid])<time)lo=mid+1;else hi=mid;}return lo;}
    calculate(candles,limit,timeframeMs,startTime=null){
      limit=Math.min(candles.length-1,Math.max(-1,limit));
      const startIndex=startTime==null?0:Math.min(Math.max(0,limit),this.lowerBound(candles,startTime));
      if(this.candles!==candles || limit<this.processed || startIndex<(this.startIndex||0) || (candles.length && this.datasetFirst!==stamp(candles[0]))){
        this.reset();this.candles=candles;this.startIndex=startIndex;this.processed=startIndex-1;
        this.datasetFirst=candles.length?stamp(candles[0]):0;
        this.firstTime=candles.length?stamp(candles[startIndex]):0;
      }
      const offset=this.config.dailyUtcOffset*HOUR-this.config.dailyStartHour*HOUR;
      for(let i=this.processed+1;i<=limit;i++){
        const c=candles[i],time=stamp(c);
        if(![time,c.high,c.low,c.close].every(Number.isFinite))continue;
        const day=Math.floor((time+offset)/DAY)*DAY-offset;
        const weekday=new Date(day+offset).getUTCDay();
        const week=day-((weekday+6)%7)*DAY;
        this.add(this.days,day,c,time,{end:day+DAY,partial:this.firstTime>day});
        this.add(this.weeks,week,c,time,{end:week+7*DAY,partial:this.firstTime>week});
        // Pine highestbars/lowestbars(95), emitted at 16:45 session-local time.
        const localClock=this.config.showHiLoTime ? window.IntenseSessions?.partsInZone?.(time,this.config.sessionTimezone) : null;
        if(this.config.showHiLoTime && (localClock ? localClock.hour===16 && localClock.minute===45 : ((time-EST)%DAY+DAY)%DAY === (16*60+45)*60000) && i>=94){
          let highBar=c,lowBar=c;
          for(let j=i-94;j<=i;j++){
            if(candles[j].high>=highBar.high)highBar=candles[j];
            if(candles[j].low<=lowBar.low)lowBar=candles[j];
          }
          this.extremaTimes.push({time:stamp(candles[Math.max(0,i-10)]),high:highBar.high,low:lowBar.low,highTime:stamp(highBar),lowTime:stamp(lowBar)});
        }
        for(const type of ['asia','london','ny']){
          const b=this.bounds(time,type);
          if(time<b.end)this.add(this.sessions,type+':'+b.start,c,time,{...b,type,partial:this.firstTime>b.start});
        }
        const b=this.bounds(time,'asia'),asia=this.sessions.get('asia:'+b.start);
        const nyEnd=this.bounds(b.end+12*HOUR,'ny').end;
        const prev=candles[i-1];
        if(asia && !asia.partial && time>=b.end && time<nyEnd && prev){
          const direction=prev.close>=asia.low && c.close<asia.low?'below':prev.close<=asia.high && c.close>asia.high?'above':null;
          if(direction)this.breaks.push({time,price:c.close,direction});
        }
      }
      this.processed=limit;this.now=limit>=0?stamp(candles[limit])+timeframeMs:0;
      return this;
    }
    adr(at){
      const completed=[...this.days.values()].filter(d=>!d.partial && d.end<=at);
      const n=this.config.daily_adr_length;
      if(!n || completed.length<n)return null;
      return completed.slice(-n).reduce((sum,d)=>sum+d.high-d.low,0)/n;
    }
    render(ctx,{candles,limit,timeframeMs,from,to,x,y,width,tickSize}){
      if(!this.config.enabled || timeframeMs>=2*HOUR || !candles.length)return;
      // Index a bounded viewport plus sufficient ADR/week context, not millions
      // of offscreen bars. Subsequent replay steps append only newly revealed bars.
      const replayTime=stamp(candles[Math.min(limit,candles.length-1)]);
      const endLimit=Math.min(limit,this.lowerBound(candles,to+DAY));
      this.calculate(candles,endLimit,timeframeMs,Math.min(from,replayTime)-(Math.max(35,this.config.daily_adr_length*2+14))*DAY);
      this.now=replayTime+timeframeMs;
      const c=this.config,unit=Math.max(tickSize || .01,1e-10),pips=v=>Math.round(v/unit/10*100)/100;
      const line=(a,b,price,color,style,w)=>{if(w<=0 || b<from || a>to)return;ctx.strokeStyle=colors[color]||color;ctx.lineWidth=w;ctx.setLineDash(dash(style));ctx.beginPath();ctx.moveTo(Math.max(0,x(a)),y(price));ctx.lineTo(Math.min(width,x(b)),y(price));ctx.stroke();};
      const label=(time,price,text,color,size='normal')=>{ctx.setLineDash([]);ctx.fillStyle=colors[color]||color;ctx.font=`${({tiny:9,small:10,normal:12,large:14})[size]}px Inter, sans-serif`;ctx.textAlign='left';text.split('\n').forEach((t,i)=>ctx.fillText(t,Math.max(4,x(time)),y(price)+14+i*14));};
      ctx.save();
      for(const s of this.sessions.values()){
        const a=s.type==='asia',prefix=a?'':s.type==='london'?'l':'n';
        if((s.type==='london'&&!c.show_london_session)||(s.type==='ny'&&!c.show_ny_session)||s.partial || s.start>this.now || (a?s.extend:s.end)<from || s.start>to)continue;
        const border=c[prefix+'user_box_line_color'],style=c[prefix+'user_box_line_style'],bw=c[prefix+'boxLineWidth'],lw=c[prefix+'sessionLineWidth'];
        const left=x(s.start),right=x(s.end),top=y(s.high),bottom=y(s.low),mid=(s.high+s.low)/2;
        ctx.globalAlpha=c.fillOpacity;ctx.fillStyle=colors[border];ctx.fillRect(left,top,right-left,bottom-top);ctx.globalAlpha=1;
        line(s.start,s.end,s.high,border,style,bw);line(s.start,s.end,s.low,border,style,bw);
        ctx.strokeStyle=colors[border];ctx.lineWidth=bw;ctx.setLineDash(dash(style));
        if(bw>0){ctx.beginPath();ctx.moveTo(left,top);ctx.lineTo(left,bottom);ctx.moveTo(right,top);ctx.lineTo(right,bottom);ctx.stroke();}
        if(!a || c.showAsianMidpoint)line(s.start,s.end,mid,c[prefix+'user_midline_color'],c[prefix+'user_middle_line_style'],lw);
        if(a){line(s.end,s.extend,s.high,border,c.user_upperlower_line_style,lw);line(s.end,s.extend,s.low,border,c.user_upperlower_line_style,lw);if(c.showAsianMidpoint)line(s.end,s.extend,mid,c.user_midline_color,c.user_middle_line_style,lw);}
        if(this.now>=s.end && (a || (s.type==='london'?c.show_london_session_rng:c.show_ny_session_rng))){
          let text=`${a?'A':s.type==='london'?'L':'N'} = ${pips(s.high-s.low)}`;
          const adr=this.adr(s.end);
          if(a && c.showADR && this.now-s.end<c.daily_adr_user*DAY && adr!=null)text+=`\nADR = ${Math.round(adr/unit/(c.is_forex_pips?10:1))}`;
          label(s.end-3*HOUR,s.low,text,c[prefix+'user_text_color'],c[prefix+'user_label_size']);
        }
      }
      const days=[...this.days.values()],weeks=[...this.weeks.values()];
      for(let i=0;i<days.length;i++){
        const d=days[i];if(d.end<from || d.start>to)continue;
        const previous=days[i-1],week=weeks.find(w=>w.start<=d.start && w.end>d.start),wi=weeks.indexOf(week),pw=weeks[wi-1];
        const levels=(row,on,color,style,w,labels,hi,lo,range=false)=>{
          if(!row || row.partial || !on)return;
          line(d.start,d.end,row.high,color,style,w);line(d.start,d.end,row.low,color,style,w);
          if(labels||range){label(d.start,row.high,`${labels?hi:''}${range?' ('+pips(row.high-row.low)+')':''}`,color);if(labels)label(d.start,row.low,lo,color);}
        };
        levels(previous,c.showPreviousDayHiLo,c.previousDayHiLoColor,c.previousDayHiLoLineStyle,c.supportLineWidth,c.showHiLoPriceLabel,'YH','YL',c.showHiLoPriceRange);
        levels(pw,c.showLastWeeklyHiLo,c.lastWeeklyHiLoColor,c.lastWeeklyHiLoStyle,c.supportLastWeekLineWidth,c.lastWeeklyHiLoShowLabel,'PWH','PWL');
        // Historical days need their own developing prefix, never the final week's range.
        const prefix=week?days.filter(p=>p.start>=week.start && p.start<=d.start):[];
        const developing=week?{...week,high:Math.max(...prefix.map(p=>p.high)),low:Math.min(...prefix.map(p=>p.low))}:null;
        levels(developing,c.showWeeklyHiLo,c.weeklyHiLoColor,c.weeklyHiLoStyle,c.supportWeekLineWidth,c.weeklyHiLoShowLabel,'WH','WL');
      }
      if(c.showHiLoTime)for(const row of this.extremaTimes)if(row.time>=from && row.time<=to){
        const clock=t=>{const p=window.IntenseSessions?.partsInZone?.(t,'Asia/Kolkata');return p?`${String(p.hour).padStart(2,'0')}:${String(p.minute).padStart(2,'0')}`:new Date(t+5.5*HOUR).toISOString().slice(11,16);};
        label(row.time,row.high,'HOD: '+clock(row.highTime),'silver');label(row.time,row.low,'LOD: '+clock(row.lowTime),'silver');
      }
      if(c.showRangeBreaks)for(const b of this.breaks)if(b.time>=from && b.time<=to)label(b.time,b.price,`Asian Range Break ${b.direction==='above'?'↑':'↓'}`,'orange','tiny');
      ctx.restore();
    }
  }
  window.FXNAsianSessionRange=FXNAsianSessionRange;
  window.FXNAsianSessionRange.defaults=Object.freeze(defaults);
  window.FXNAsianSessionRange.colors=colors;
})();
