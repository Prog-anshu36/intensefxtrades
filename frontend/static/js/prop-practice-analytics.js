/* Prop account analytics. Every value derives from the selected phase ledger. */
(() => {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num = v => Number.isFinite(Number(v)) ? Number(v) : 0;
  const usd = v => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(num(v));
  const stamp = v => typeof v === 'number' ? (v < 1e11 ? v*1000:v) : Date.parse(v);
  const day = v => { const ms=stamp(v); return Number.isFinite(ms) ? new Date(ms+10800000).toISOString().slice(0,10) : ''; };
  const sum = (rows,key) => rows.reduce((s,t)=>s+num(t[key]),0);
  const quantile = (values,p) => { const a=[...values].sort((x,y)=>x-y);if(!a.length)return 0;const i=(a.length-1)*p;return a[Math.floor(i)]+(a[Math.ceil(i)]-a[Math.floor(i)])*(i%1); };
  const duration = t => {const a=stamp(t.opened_at), b=stamp(t.closed_at);return Number.isFinite(a)&&Number.isFinite(b)?Math.max(0,(b-a)/60000):null;};
  const states = new Map();
  function stateFor(a) {
    const key=`${a.id}:${a.phase}`;
    if(!states.has(key)) states.set(key,{month:day(a.lastMarketTimestamp || Date.now()).slice(0,7),from:'',to:'',tab:'closed',page:0});
    return states.get(key);
  }
  function metrics(rows) {
    const wins=rows.filter(t=>num(t.pnl)>0),losses=rows.filter(t=>num(t.pnl)<0);
    const grossProfit=sum(wins,'pnl'),grossLoss=Math.abs(sum(losses,'pnl'));
    const daily={}; rows.forEach(t=>{const key=day(t.closed_at||t.opened_at);if(key)daily[key]=(daily[key]||0)+num(t.pnl);});
    const positiveDays=Object.values(daily).filter(v=>v>0);
    const concentration=positiveDays.length ? Math.max(...positiveDays)/positiveDays.reduce((a,b)=>a+b,0):0;
    const consistency=positiveDays.length > 1 ? Math.max(0, Math.min(100,100*(1-concentration)/(1-1/positiveDays.length))):0;
    const protectedTrades=rows.filter(t=>num(t.sl)>0).length;
    const risks=rows.map(t=>{const risk=Math.abs(num(t.entry)-num(t.sl));const reward=Math.abs(num(t.tp)-num(t.entry));return num(t.sl)>0 && num(t.tp)>0 && risk>0 ? reward/risk:null;}).filter(v=>v!==null);
    const rr=risks.length?risks.reduce((a,b)=>a+b,0)/risks.length:null;
    const winRate=rows.length?wins.length/rows.length*100:0;
    const slUsage=rows.length?protectedTrades/rows.length*100:0;
    const axes=[consistency,slUsage,winRate,rr===null?0:Math.min(100,rr/3*100)];
    return {wins,losses,grossProfit,grossLoss,pnl:sum(rows,'pnl'),winRate,slUsage,rr,axes,score:axes.reduce((a,b)=>a+b,0)/4,daily,
      biggestWin:wins.length?Math.max(...wins.map(t=>num(t.pnl))):0,biggestLoss:losses.length?Math.min(...losses.map(t=>num(t.pnl))):0,
      profitFactor:grossLoss?grossProfit/grossLoss:null};
  }
  function radar(m) {
    const point=(i,r)=>[130+Math.sin(i*Math.PI/2)*r,100-Math.cos(i*Math.PI/2)*r];
    const poly=r=>[0,1,2,3].map(i=>point(i,r).join(',')).join(' ');
    return `<article class="prop-analytics-card prop-radar"><h3>Practice score <b>${m.score.toFixed(1)} / 100</b></h3><svg viewBox="0 0 260 200" role="img" aria-label="Consistency, stop loss usage, win rate and risk reward score">${[20,40,60,80].map(r=>`<polygon points="${poly(r)}" class="prop-radar-grid"/>`).join('')}<polygon points="${m.axes.map((v,i)=>point(i,v*.8).join(',')).join(' ')}" class="prop-radar-value"/><text x="130" y="12" text-anchor="middle">Consistency</text><text x="214" y="104">SL</text><text x="130" y="198" text-anchor="middle">Win rate</text><text x="12" y="104">R:R</text></svg><details><summary>How this score works</summary><p>Independent practice score; not a provider rating. Equal weighting: normalized daily profit concentration (one winning day has no consistency evidence), fraction of trades with a recorded SL, win rate, and average planned R:R scaled to 3R. Missing SL/TP contributes zero to R:R. Empty history scores zero.</p></details></article>`;
  }
  function breakdown(title,rows) {
    const m=metrics(rows),rate=m.winRate;
    return `<article class="prop-analytics-card"><h3>${title}</h3><div class="prop-donut" style="--win:${rate*3.6}deg;${rows.length?'':'background:rgba(128,145,180,.2)'}"><span><b>${rows.length}</b> trades</span></div><strong class="${m.pnl>=0?'positive':'negative'}">${usd(m.pnl)}</strong><div class="prop-analytics-pairs"><span>Wins <b>${m.wins.length} · ${usd(m.grossProfit)}</b></span><span>Win rate <b>${rate.toFixed(1)}%</b></span><span>Losses <b>${m.losses.length} · ${usd(m.grossLoss)}</b></span></div></article>`;
  }
  function calendar(a,m,ui) {
    const [year,month]=ui.month.split('-').map(Number);
    const offset=new Date(Date.UTC(year,month-1,1)).getUTCDay();
    const count=new Date(Date.UTC(year,month,0)).getUTCDate();
    const weeks=[];let cells=[];let weekTotal=0;
    const total=Math.ceil((offset+count)/7)*7;
    for(let i=0;i<total;i++) {
      const d=i-offset+1,key=`${ui.month}-${String(d).padStart(2,'0')}`,valid=d>0&&d<=count;
      const records=valid?m.daily[key]:undefined;
      if(records!==undefined)weekTotal+=records;
      cells.push(`<div class="prop-calendar-day ${records===undefined?'':records>=0?'profit':'loss'}">${valid?`<b>${d}</b>${records===undefined?'<small>—</small>':`<small>${usd(records)}</small>`}`:''}</div>`);
      if(i%7===6){weeks.push(`<div class="prop-calendar-week">${cells.join('')}<div class="prop-calendar-total"><small>Week</small><b>${usd(weekTotal)}</b></div></div>`);cells=[];weekTotal=0;}
    }
    return `<section class="prop-analytics-card"><div class="prop-analytics-heading"><h3>Daily summary · UTC+3</h3><div><button data-prop-month="-1" aria-label="Previous month">‹</button><b>${esc(ui.month)}</b><button data-prop-month="1" aria-label="Next month">›</button><button data-prop-month="today">Market month</button></div></div><div class="prop-calendar"><div class="prop-calendar-week prop-calendar-labels">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat','Summary'].map(d=>`<span>${d}</span>`).join('')}</div>${weeks.join('')}</div></section>`;
  }
  function scatter(rows) {
    const points=rows.map(t=>({minutes:duration(t),pnl:num(t.pnl)})).filter(p=>p.minutes!==null);
    const maxX=Math.max(1,...points.map(p=>p.minutes)),low=Math.min(0,...points.map(p=>p.pnl)),high=Math.max(1,...points.map(p=>p.pnl)),range=high-low;
    const y=v=>165-(v-low)/range*140;
    return `<article class="prop-analytics-card"><h3>P&amp;L by trade duration</h3><svg viewBox="0 0 540 210" role="img" aria-label="Trade duration in minutes versus realized P and L"><line x1="45" x2="520" y1="${y(0)}" y2="${y(0)}" class="prop-chart-zero"/>${points.map(p=>`<circle cx="${45+p.minutes/maxX*470}" cy="${y(p.pnl)}" r="4" fill="${p.pnl>=0?'#16b98c':'#ef5366'}"><title>${p.minutes.toFixed(1)} min · ${usd(p.pnl)}</title></circle>`).join('')}<text x="45" y="195">0 min</text><text x="500" y="195" text-anchor="end">${maxX.toFixed(1)} min</text><text x="6" y="20">${usd(high)}</text><text x="6" y="180">${usd(low)}</text></svg>${points.length?'':'<p>No trades with valid open and close times.</p>'}</article>`;
  }
  function distribution(rows) {
    const limits=[1,5,15,60,Infinity], names=['<1m','1–5m','5–15m','15–60m','≥60m'];
    const buckets=limits.map(()=>[]);
    rows.forEach(t=>{const d=duration(t);if(d!==null)buckets[limits.findIndex(l=>d<l)].push(num(t.pnl));});
    const values=buckets.flat(),lo=Math.min(0,...values),hi=Math.max(1,...values),y=v=>165-(v-lo)/(hi-lo)*140;
    return `<article class="prop-analytics-card"><h3>P&amp;L distribution by duration</h3><svg viewBox="0 0 540 210" role="img" aria-label="Duration buckets with minimum, quartiles, median and maximum P and L"><line x1="40" x2="520" y1="${y(0)}" y2="${y(0)}" class="prop-chart-zero"/>${buckets.map((v,i)=>{const x=80+i*95;if(!v.length)return `<text x="${x}" y="195" text-anchor="middle">${names[i]}</text>`;const min=Math.min(...v),max=Math.max(...v),q1=quantile(v,.25),q3=quantile(v,.75),med=quantile(v,.5);return `<g><title>${names[i]} · ${v.length} trades · median ${usd(med)}</title><line x1="${x}" x2="${x}" y1="${y(min)}" y2="${y(max)}" class="prop-chart-zero"/><rect x="${x-18}" y="${y(q3)}" width="36" height="${Math.max(2,y(q1)-y(q3))}" fill="${med>=0?'#16b98c':'#ef5366'}"/><line x1="${x-20}" x2="${x+20}" y1="${y(med)}" y2="${y(med)}" stroke="currentColor"/><text x="${x}" y="195" text-anchor="middle">${names[i]}</text></g>`;}).join('')}<text x="4" y="20">${usd(hi)}</text><text x="4" y="180">${usd(lo)}</text></svg></article>`;
  }
  function table(rows,open,ui) {
    const sorted=[...rows].sort((a,b)=>(stamp(b.closed_at||b.opened_at)||0)-(stamp(a.closed_at||a.opened_at)||0));
    const maxPage=Math.max(0,Math.ceil(sorted.length/20)-1);ui.page=Math.min(ui.page,maxPage);
    const page=sorted.slice(ui.page*20,ui.page*20+20);
    const date=v=>{const t=stamp(v);return Number.isFinite(t)?new Date(t).toISOString().replace('T',' ').slice(0,19)+' UTC':'—';};
    return `<section class="prop-analytics-card"><div class="prop-analytics-heading"><h3>Trading records</h3><div><button data-prop-records="closed" aria-pressed="${!open}">Trading history</button><button data-prop-records="open" aria-pressed="${open}">Open positions</button></div></div><div class="propfirm-trade-table-wrap"><table class="propfirm-trade-table"><thead><tr>${['Symbol','Side','Opened (UTC)','Entry','Closed (UTC)','Exit','TP','SL','Lots','Commission','P&L'].map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${page.map(t=>`<tr><td>${esc(t.symbol)}</td><td>${esc(t.type)}</td><td>${date(t.opened_at)}</td><td>${num(t.entry).toFixed(2)}</td><td>${open?'—':date(t.closed_at)}</td><td>${open?'—':num(t.exit).toFixed(2)}</td><td>${num(t.tp)||'—'}</td><td>${num(t.sl)||'—'}</td><td>${num(t.lots)}</td><td>${usd(t.commission)}</td><td class="${num(open?t.floating_pnl:t.pnl)>=0?'positive':'negative'}">${usd(open?t.floating_pnl:t.pnl)}</td></tr>`).join('')}</tbody></table>${page.length?'':'<p class="propfirm-empty-inline">No matching trades.</p>'}</div><div class="prop-analytics-heading"><span>${sorted.length} trades · Page ${ui.page+1} / ${maxPage+1}</span><div><button data-prop-trade-page="-1" ${ui.page===0?'disabled':''}>Previous</button><button data-prop-trade-page="1" ${ui.page===maxPage?'disabled':''}>Next</button></div></div></section>`;
  }
  const api={metrics,dayKey:day,stateFor,
    render(page,a,summary) {
      const ui=stateFor(a);
      const inRange=t=>{const key=day(t.closed_at||t.opened_at);return (!ui.from||key>=ui.from)&&(!ui.to||key<=ui.to);};
      const rows=summary.closed.filter(inRange),m=metrics(rows),balance=a.startingBalance+summary.closedPnl;
      const maxBalance=Math.max(a.startingBalance,...[...summary.closed].sort((a,b)=>(stamp(a.closed_at)||0)-(stamp(b.closed_at)||0)).reduce((arr,t)=>{arr.push((arr.at(-1)||a.startingBalance)+num(t.pnl));return arr;},[]));
      return `<section class="prop-analytics" aria-label="Practice account analytics"><div class="prop-analytics-heading"><div><span class="propfirm-eyebrow">ACCOUNT ANALYTICS · PHASE ${a.phase}</span><h2>Your trading performance</h2></div><div class="prop-analytics-dates"><label>From<input type="date" data-prop-date="from" value="${ui.from}"></label><label>To<input type="date" data-prop-date="to" value="${ui.to}"></label><button data-prop-clear-dates>All dates</button></div></div>${ui.from&&ui.to&&ui.from>ui.to?'<p role="alert">Start date must be before end date.</p>':''}<div class="prop-analytics-two">${radar(m)}<article class="prop-analytics-card"><h3>Balance and equity · current phase</h3>${[['Balance',balance],['Equity',summary.equity]].map(([label,value])=>`<div class="prop-analytics-heading"><span>${label}</span><b>${usd(value)}</b></div><div class="propfirm-balance-track"><i style="width:${Math.max(0,Math.min(100,value/Math.max(1,maxBalance)*100))}%"></i></div>`).join('')}<p>Highest realized balance ${usd(maxBalance)}</p><p>Daily loss remaining ${usd(Math.max(0,summary.equity-(summary.dailyFloor??a.startingBalance*(1-page.rulesFor(a).dailyLossPct/100))))}</p><p>Total loss remaining ${usd(Math.max(0,summary.equity-summary.maxFloor))}</p></article></div><div class="prop-analytics-stats">${[['Biggest win',usd(m.biggestWin)],['Biggest loss',usd(m.biggestLoss)],['Average trade',usd(rows.length?m.pnl/rows.length:0)],['Profit factor',m.profitFactor===null?(m.grossProfit?'No losses':'—'):m.profitFactor.toFixed(2)],['SL usage',m.slUsage.toFixed(1)+'%'],['Planned R:R',m.rr===null?'—':m.rr.toFixed(2)+'R']].map(([l,v])=>`<article class="prop-analytics-card"><span>${l}</span><b>${v}</b></article>`).join('')}</div>${calendar(a,m,ui)}<div class="prop-analytics-three">${breakdown('Short analysis',rows.filter(t=>t.type==='SELL'))}${breakdown('Profitability',rows)}${breakdown('Long analysis',rows.filter(t=>t.type==='BUY'))}</div><div class="prop-analytics-two">${distribution(rows)}${scatter(rows)}</div><div class="prop-analytics-two"><article class="prop-analytics-card"><h3>P&amp;L by instrument</h3><b>XAUUSD · ${usd(m.pnl)}</b><div class="propfirm-balance-track"><i style="width:${rows.length?100:0}%"></i></div></article><article class="prop-analytics-card"><h3>Trades by instrument</h3><b>XAUUSD · ${rows.length}</b><p>${m.wins.length} wins · ${m.losses.length} losses · ${rows.length-m.wins.length-m.losses.length} breakeven</p></article></div>${table(ui.tab==='open'?summary.open.filter(inRange):rows,ui.tab==='open',ui)}</section>`;
    },
    bind(container,page) {
      const a=page.selected();if(!a)return;const ui=stateFor(a);
      container.querySelectorAll('[data-prop-month]').forEach(b=>b.addEventListener('click',()=>{if(b.dataset.propMonth==='today')ui.month=day(a.lastMarketTimestamp||Date.now()).slice(0,7);else{const [y,m]=ui.month.split('-').map(Number);ui.month=new Date(Date.UTC(y,m-1+Number(b.dataset.propMonth),1)).toISOString().slice(0,7);}page.refreshView();}));
      container.querySelectorAll('[data-prop-date]').forEach(el=>el.addEventListener('change',()=>{ui[el.dataset.propDate]=el.value;ui.page=0;page.refreshView();}));
      container.querySelector('[data-prop-clear-dates]')?.addEventListener('click',()=>{ui.from='';ui.to='';ui.page=0;page.refreshView();});
      container.querySelectorAll('[data-prop-records]').forEach(b=>b.addEventListener('click',()=>{ui.tab=b.dataset.propRecords;ui.page=0;page.refreshView();}));
      container.querySelectorAll('[data-prop-trade-page]').forEach(b=>b.addEventListener('click',()=>{ui.page+=Number(b.dataset.propTradePage);page.refreshView();}));
    }
  };
  window.PropPracticeAnalytics=api;
})();
