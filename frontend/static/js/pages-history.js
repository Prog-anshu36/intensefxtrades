/* Bounded real-CSV binary history reader, shared by the Pages worker and tests. */
(function(scope){
  class PagesHistory {
    constructor(base,fetcher=globalThis.fetch.bind(globalThis)){this.base=base;this.fetch=fetcher;this.cache=new Map();this.pending=new Map();}
    async info(){if(!this.manifest)this.manifest=await this.fetch(new URL('history/manifest.json',this.base),{cache:'no-cache'}).then(r=>{if(!r.ok)throw Error('XAUUSD historical dataset could not be loaded.');return r.json();});return this.manifest;}
    async chunk(frame,index){
      const item=frame.chunks[index],key=item.path;
      if(this.cache.has(key)){const data=this.cache.get(key);this.cache.delete(key);this.cache.set(key,data);return data;}
      if(this.pending.has(key))return this.pending.get(key);
      const job=(async()=>{
        const response=await this.fetch(new URL('history/'+key,this.base));if(!response.ok)throw Error('XAUUSD historical dataset could not be loaded.');
        const bytes=await response.arrayBuffer();
        const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
        if(hash!==item.sha256)throw Error('Historical data checksum failed.');
        const raw=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
        if(raw.byteLength!==item.rows*frame.stride*8)throw Error('Invalid historical data chunk.');
        const data=new DataView(raw);this.cache.set(key,data);
        while(this.cache.size>8)this.cache.delete(this.cache.keys().next().value);
        return data;
      })();this.pending.set(key,job);try{return await job;}finally{this.pending.delete(key);}
    }
    async bound(frame,time,upper=false){
      let lo=0,hi=frame.chunks.length;
      while(lo<hi){const mid=(lo+hi)>>1;if(upper?frame.chunks[mid].last<=time:frame.chunks[mid].last<time)lo=mid+1;else hi=mid;}
      if(lo===frame.chunks.length)return frame.rows;
      const item=frame.chunks[lo],data=await this.chunk(frame,lo);let a=0,b=item.rows;
      while(a<b){const mid=(a+b)>>1,t=data.getFloat64(mid*frame.stride*8,true);if(upper?t<=time:t<time)a=mid+1;else b=mid;}
      return item.offset+a;
    }
    async rows(frame,start,end){
      const rows=[];
      for(let i=0;i<frame.chunks.length;i++){
        const item=frame.chunks[i];if(item.offset+item.rows<=start)continue;if(item.offset>=end)break;
        const data=await this.chunk(frame,i);
        for(let j=Math.max(0,start-item.offset);j<Math.min(item.rows,end-item.offset);j++){
          const read=k=>data.getFloat64((j*frame.stride+k)*8,true);
          const row={time:read(0),open:read(1),high:read(2),low:read(3),close:read(4),volume:read(5)};
          frame.sides.forEach((side,n)=>{const at=6+n*5;if(Number.isFinite(read(at)))row[side]={open:read(at),high:read(at+1),low:read(at+2),close:read(at+3),volume:read(at+4)};});
          rows.push(row);
        }
      }return rows;
    }
    timestamp(value,end=false){if(/^\d+(\.\d+)?$/.test(value)){const n=Number(value);return n<1e11?n*1000:n;}let normalized=/^\d{4}-\d{2}-\d{2}$/.test(value)?value+'T00:00:00Z':value;if(!/(Z|[+-]\d{2}:?\d{2})$/i.test(normalized))normalized+='Z';const n=Date.parse(normalized);if(!Number.isFinite(n))throw Error('Invalid history date');return n+(end && value.length===10?86400000-1:0);}
    async history(params){
      const symbol=(params.get('symbol')||'XAUUSD').toUpperCase();
      if(!['XAUUSD','GOLD'].includes(symbol))throw Error('Only the real local XAUUSD dataset is available in the browser edition.');
      const manifest=await this.info(),tf=params.get('timeframe')||'1m',frame=manifest.timeframes[tf],meta=manifest.info.timeframes[tf];
      if(!frame)throw Error('No real dataset can supply this timeframe.');
      const limit=Math.max(1,Math.min(10000,Number(params.get('limit')||params.get('count')||5000)));
      if(!Number.isFinite(limit))throw Error('Invalid history limit');
      const start=params.get('start'),end=params.get('end'),anchor=params.get('anchor');
      if(start&&end&&this.timestamp(start)>this.timestamp(end,true))throw Error('start must not exceed end');
      const first=start?await this.bound(frame,this.timestamp(start)):0,last=end?await this.bound(frame,this.timestamp(end,true),true):frame.rows;
      let lo,hi;
      if(anchor){const at=Math.max(first,Math.min(last,await this.bound(frame,this.timestamp(anchor),true)));const before=Math.min(at-first,Math.max(1,Math.floor(limit/2)));lo=at-before;hi=Math.min(last,at+limit-before);}
      else if(start){lo=first;hi=Math.min(last,first+limit);}else{lo=Math.max(first,last-limit);hi=last;}
      const candles=hi>lo?await this.rows(frame,lo,hi):[];
      return{symbol,timeframe:tf,source:'local-csv',storage:'static-csv-export',candles,total_candles:meta.rows,first_timestamp:meta.first_timestamp,last_timestamp:meta.last_timestamp,price_side:meta.price_side,derived_from:meta.derived_from,returned_candles:candles.length};
    }
  }
  scope.PagesHistory=PagesHistory;
})(globalThis);
