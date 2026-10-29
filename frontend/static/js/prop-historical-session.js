/* Locked historical challenge UI. Loaded only for the Prop Firm Session route. */
(() => {
  "use strict";
  const API_ROOT = "/api/prop-challenge";
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const money = value => new Intl.NumberFormat("en-US", {style:"currency",currency:"USD",maximumFractionDigits:2}).format(Number(value)||0);
  const price = value => value == null ? "—" : Number(value).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
  const dayLabel = value => value ? new Date(value).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric",timeZone:"UTC"}) : "—";

  const HistoricalPropFirmSession = {
    challenges: [], selected: null, candles: [], creating: false, running: false,
    timer: null, busy: false, container: null, error: "", notice: "", model: "standard", balance: 5000, lots: 0.01,
    async request(path, options = {}) {
      const response = await fetch(API_ROOT + path, {
        credentials: "same-origin",
        headers: {"Content-Type":"application/json", ...(options.headers || {})},
        ...options
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "The historical challenge request failed.");
      return data;
    },
    rules() { return this.selected?.rules || {daily_loss_pct:5,max_loss_pct:10,targets:{"1":8,"2":5},min_days:3}; },
    targetAmount() { return (Number(this.selected?.starting_balance)||0) * (Number(this.rules().targets?.[String(this.selected?.phase||1)])||0) / 100; },
    render() { return this.pageMarkup(); },
    pageMarkup() {
      const selected = this.selected;
      const active = selected?.status === "active";
      const options = this.challenges.map(item => `<option value="${escapeHtml(item.id)}" ${item.id===selected?.id?"selected":""}>${escapeHtml(item.model.toUpperCase())} · ${money(item.starting_balance)} · ${escapeHtml(dayLabel(item.assigned_start))} · ${escapeHtml(item.status)}</option>`).join("");
      const createForm = `<div class="phs-create-backdrop" id="phsCreateBackdrop" ${this.creating?"":"hidden"}><section class="phs-create-card" role="dialog" aria-modal="true" aria-label="Create historical prop challenge"><header><div><span class="phs-kicker">NEW EVALUATION</span><h2>Create a historical challenge</h2></div><button class="phs-quiet" id="phsCloseCreate" type="button" aria-label="Close">×</button></header><p>Each challenge receives a different real XAUUSD month from 48–60 months ago. The first 15 trading days are available; future candles stay hidden.</p><div class="phs-form-grid"><label>Challenge model<select id="phsModel"><option value="standard" ${this.model==="standard"?"selected":""}>2-Step Standard</option><option value="pro" ${this.model==="pro"?"selected":""}>2-Step Pro</option></select></label><label>Starting balance<select id="phsBalance">${(this.model==="pro"?[5000,10000,25000,50000,100000,200000]:[5000,10000,25000,50000,100000]).map(v=>`<option value="${v}" ${v===Number(this.balance)?"selected":""}>${money(v)}</option>`).join("")}</select></label></div><button type="button" class="phs-primary" id="phsCreateButton">Assign historical month →</button><p class="phs-muted">Uses the project's local XAUUSD 1-minute dataset. No synthetic price data is generated.</p></section></div>`;
      if (!selected) return `<main class="phs-page"><header class="phs-header"><div><span class="phs-kicker">INTENSEFXTRADES · EVALUATION MODE</span><h1>Prop Firm Session</h1><p>Practice against a hidden historical XAUUSD month with a strict 15-trading-day limit.</p></div><span class="phs-lock-tag">LOCKED MARKET DATA</span></header><section class="phs-empty"><div class="phs-empty-icon">15</div><span class="phs-kicker">HISTORICAL EVALUATION</span><h2>Trade the market. Not the future.</h2><p>Create a challenge to receive a randomly assigned historical month from 4–5 years ago. Candles appear one at a time; no replay, seek, or future-data controls are available in this session.</p><button type="button" class="phs-primary" id="phsOpenCreate">Create challenge →</button><p class="phs-muted">${escapeHtml(this.error || "Real historical XAUUSD data · Server-checked risk rules · Maximum 15 trading days")}</p></section>${createForm}</main>`;
      const rules = this.rules();
      const pnl = Number(selected.realized_pnl)||0;
      const equity = Number(selected.equity)||Number(selected.starting_balance);
      const target = this.targetAmount();
      const dailyLimit = Number(selected.daily_start_equity||selected.starting_balance)*Number(rules.daily_loss_pct||0)/100;
      const dailyLoss = Math.max(0,Number(selected.daily_start_equity||selected.starting_balance)-equity);
      const maxLossLimit = Number(selected.starting_balance)*Number(rules.max_loss_pct||0)/100;
      const maxLoss = Math.max(0,Number(selected.starting_balance)-equity);
      const statusText = selected.status==="phase-ready" ? "PHASE 1 COMPLETE" : selected.status==="passed" ? "CHALLENGE PASSED" : selected.status==="failed" ? "CHALLENGE FAILED" : "MARKET READY";
      const monthText = `${dayLabel(selected.assigned_start)} – ${dayLabel(selected.assigned_end)}`;
      return `<main class="phs-page"><header class="phs-header"><div><span class="phs-kicker">INTENSEFXTRADES · HISTORICAL EVALUATION</span><h1>Prop Firm Session</h1><p>Assigned month: <strong>${escapeHtml(monthText)}</strong> · XAUUSD · 1-minute candles</p></div><span class="phs-lock-tag"><i></i> FUTURE DATA LOCKED</span></header>
        <section class="phs-toolbar"><label>Challenge history<select id="phsChallengeSelect">${options}</select></label><div class="phs-toolbar-actions"><span class="phs-status" data-status="${escapeHtml(selected.status)}">${statusText}</span><button type="button" class="phs-secondary" id="phsOpenCreate">+ New challenge</button></div></section>
        <section class="phs-stats"><article><span>Account balance</span><b>${money(Number(selected.starting_balance)+pnl)}</b><small>Starting ${money(selected.starting_balance)}</small></article><article><span>Live equity</span><b data-phs="equity">${money(equity)}</b><small>Realized P/L <em data-phs="pnl">${money(pnl)}</em></small></article><article><span>Trading days</span><b data-phs="days">${selected.trading_days.length} / 15</b><small>Challenge-wide limit</small></article><article><span>Profit target</span><b>${money(target)}</b><small>Phase ${selected.phase} · ${Number(rules.targets?.[String(selected.phase)]||0)}% target</small></article></section>
        <section class="phs-layout"><div class="phs-chart-card"><div class="phs-chart-head"><div><span class="phs-kicker">LIVE HISTORICAL FEED</span><h2>XAUUSD <small>1m</small></h2><p data-phs="candleTime">${selected.last_candle?escapeHtml(new Date(selected.last_candle.time).toLocaleString()):"Waiting for first candle"}</p></div><div class="phs-price"><span>Last price</span><b data-phs="price">${price(selected.last_candle?.close)}</b></div></div><canvas id="phsChart" aria-label="Revealed historical XAUUSD candles" role="img"></canvas><div class="phs-chart-footer"><span><i class="phs-dot"></i><span data-phs="marketState">${this.running?"Market running":"Market not started"}</span></span><span data-phs="candleCount">${this.candles.length} revealed candles</span><button type="button" class="phs-primary" id="phsStartMarket" ${!active||this.running?"disabled":""}>${this.running?"Market running…":"Start market"}</button></div><p class="phs-muted">The market advances automatically at a fixed rate. You cannot rewind, seek, change speed, or load unrevealed candles.</p></div>
          <aside class="phs-side"><section class="phs-card"><h3>Place XAUUSD order</h3><label>Lot size<input id="phsLots" type="number" min="0.01" max="100" step="0.01" value="${escapeHtml(this.lots)}" ${!active||selected.position?"disabled":""}></label><div class="phs-form-grid"><label>Stop loss price <input id="phsSL" type="number" min="0.01" step="0.01" placeholder="Optional" ${!active||selected.position?"disabled":""}></label><label>Take profit price <input id="phsTP" type="number" min="0.01" step="0.01" placeholder="Optional" ${!active||selected.position?"disabled":""}></label></div><div class="phs-order-buttons"><button type="button" class="phs-buy" id="phsBuy" ${!active||!!selected.position||!selected.last_candle?"disabled":""}>Buy</button><button type="button" class="phs-sell" id="phsSell" ${!active||!!selected.position||!selected.last_candle?"disabled":""}>Sell</button></div><div class="phs-position" data-phs="position">${this.positionMarkup(selected.position,selected.last_candle)}</div><button type="button" class="phs-secondary phs-close-position" id="phsClosePosition" ${!active||!selected.position?"disabled":""}>Close position at current market</button><p class="phs-muted">Simulated XAUUSD contract: 100 oz per lot. Orders and loss checks are evaluated by the server.</p></section>
          <section class="phs-card"><h3>Risk limits</h3><div class="phs-risk-row"><span>Daily loss</span><b data-phs="dailyLoss">${money(dailyLoss)} / ${money(dailyLimit)}</b></div><div class="phs-risk-track"><i data-phs="dailyTrack" style="width:${Math.min(100,dailyLoss/Math.max(1,dailyLimit)*100)}%"></i></div><div class="phs-risk-row"><span>Maximum loss</span><b data-phs="maxLoss">${money(maxLoss)} / ${money(maxLossLimit)}</b></div><div class="phs-risk-track"><i data-phs="maxTrack" style="width:${Math.min(100,maxLoss/Math.max(1,maxLossLimit)*100)}%"></i></div><p class="phs-muted">${rules.daily_loss_pct}% daily loss · ${rules.max_loss_pct}% maximum loss · ${rules.min_days} minimum trading days per phase</p></section></aside></section>
        <section class="phs-card phs-history"><div class="phs-section-title"><div><span class="phs-kicker">CHALLENGE LEDGER</span><h2>Trade history</h2></div><span data-phs="tradeCount">${selected.trades.length} closed trades</span></div><div data-phs="trades">${this.tradesMarkup(selected.trades)}</div></section>
        ${selected.status==="phase-ready"?'<section class="phs-result"><h2>Phase 1 objective achieved</h2><p>Your result has been checked against the server-side target and trading-day requirements.</p><button type="button" class="phs-primary" id="phsAdvancePhase">Start Phase 2 →</button></section>':""}
        ${["passed","failed"].includes(selected.status)?`<section class="phs-result" data-status="${escapeHtml(selected.status)}"><h2>${selected.status==="passed"?"Challenge passed":"Challenge failed"}</h2><p>${escapeHtml(selected.breach_reason || (selected.status==="passed"?"Both phases completed successfully.":"The challenge did not meet its objectives."))}</p><button type="button" class="phs-primary" id="phsOpenCreate">Start a different challenge →</button></section>`:""}
        ${this.notice?`<p class="phs-notice" role="status">${escapeHtml(this.notice)}</p>`:""}${this.error?`<p class="phs-error" role="alert">${escapeHtml(this.error)}</p>`:""}${createForm}</main>`;
    },
    positionMarkup(position, candle) {
      if (!position) return '<p class="phs-muted">No open position.</p>';
      const mark = candle?.close ?? position.entry;
      const delta = (Number(mark)-Number(position.entry))*(position.side==="sell"?-1:1)*100*Number(position.lots);
      return `<div class="phs-position-head"><b class="${position.side}">${position.side.toUpperCase()} ${Number(position.lots)} lot</b><strong>${money(delta)}</strong></div><div class="phs-position-grid"><span>Entry <b>${price(position.entry)}</b></span><span>Mark <b>${price(mark)}</b></span><span>Stop <b>${price(position.stop_loss)}</b></span><span>Target <b>${price(position.take_profit)}</b></span></div>`;
    },
    tradesMarkup(trades) {
      if (!trades?.length) return '<p class="phs-muted">No closed trades yet. Start the market and place your first order.</p>';
      return `<div class="phs-trade-table-wrap"><table class="phs-trade-table"><thead><tr><th>Side</th><th>Lots</th><th>Entry</th><th>Exit</th><th>Opened</th><th>Closed</th><th>P/L</th></tr></thead><tbody>${trades.slice().reverse().slice(0,25).map(t=>`<tr><td class="${escapeHtml(t.side)}">${escapeHtml(t.side.toUpperCase())}</td><td>${Number(t.lots).toFixed(2)}</td><td>${price(t.entry)}</td><td>${price(t.exit)}</td><td>${escapeHtml(new Date(t.opened_at).toLocaleString())}</td><td>${escapeHtml(new Date(t.closed_at).toLocaleString())}</td><td class="${Number(t.pnl)>=0?"positive":"negative"}">${money(t.pnl)}</td></tr>`).join("")}</tbody></table></div>`;
    },
    async afterRender(container) {
      this.container = container;
      this.mount();
      try {
        const data = await this.request("", {method:"GET"});
        this.challenges = data.challenges || [];
        const savedId = (()=>{try{return localStorage.getItem("ift_historical_prop_selected")}catch(_){return null}})();
        const chosen = this.challenges.find(c=>c.id===savedId) || this.challenges.find(c=>["active","phase-ready"].includes(c.status)) || this.challenges[0] || null;
        if (chosen) await this.loadChallenge(chosen.id, false);
        else this.mount();
      } catch (error) {
        this.error = error.message;
        this.mount();
      }
    },
    async loadChallenge(id, repaint = true) {
      this.stopMarket();
      this.error = ""; this.notice = "";
      this.selected = await this.request("/"+encodeURIComponent(id), {method:"GET"});
      const result = await this.request("/"+encodeURIComponent(id)+"/candles?limit=120", {method:"GET"});
      this.candles = result.candles || [];
      try { localStorage.setItem("ift_historical_prop_selected",id); } catch (_) {}
      if (repaint) this.mount();
    },
    mount() {
      if (!this.container) return;
      this.container.innerHTML = this.pageMarkup();
      this.bind();
      this.drawChart();
    },
    bind() {
      const root = this.container;
      root.querySelectorAll("#phsOpenCreate").forEach(button=>button.addEventListener("click",()=>{this.creating=true;this.error="";this.mount();}));
      root.querySelector("#phsCloseCreate")?.addEventListener("click",()=>{this.creating=false;this.mount();});
      root.querySelector("#phsCreateBackdrop")?.addEventListener("click",e=>{if(e.target===e.currentTarget){this.creating=false;this.mount();}});
      root.querySelector("#phsModel")?.addEventListener("change",e=>{this.model=e.target.value;if(this.model==="standard"&&this.balance===200000)this.balance=5000;this.mount();});
      root.querySelector("#phsBalance")?.addEventListener("change",e=>{this.balance=Number(e.target.value);});
      root.querySelector("#phsCreateButton")?.addEventListener("click",()=>this.createChallenge());
      root.querySelector("#phsChallengeSelect")?.addEventListener("change",e=>this.loadChallenge(e.target.value));
      root.querySelector("#phsStartMarket")?.addEventListener("click",()=>this.startMarket());
      root.querySelector("#phsBuy")?.addEventListener("click",()=>this.placeOrder("buy"));
      root.querySelector("#phsSell")?.addEventListener("click",()=>this.placeOrder("sell"));
      root.querySelector("#phsClosePosition")?.addEventListener("click",()=>this.closePosition());
      root.querySelector("#phsAdvancePhase")?.addEventListener("click",()=>this.advancePhase());
      root.querySelector("#phsLots")?.addEventListener("change",e=>{this.lots=Number(e.target.value)||0.01;});
    },
    async createChallenge() {
      const button=this.container.querySelector("#phsCreateButton");
      this.model=this.container.querySelector("#phsModel")?.value||this.model;
      this.balance=Number(this.container.querySelector("#phsBalance")?.value||this.balance);
      if(button){button.disabled=true;button.textContent="Assigning a real historical month…";}
      this.error="";this.notice="";
      try {
        const item=await this.request("",{method:"POST",body:JSON.stringify({model:this.model,starting_balance:this.balance})});
        this.challenges=await this.request("",{method:"GET"}).then(r=>r.challenges||[]);
        this.selected=item;this.candles=[];
        try{localStorage.setItem("ift_historical_prop_selected",item.id)}catch(_){}
        this.creating=false;this.mount();
      } catch(error) {
        this.error=error.message;this.mount();
      }
    },
    startMarket() {
      if(!this.selected||this.selected.status!=="active"||this.running)return;
      this.running=true;this.notice="Market is advancing automatically. Existing replay, seek and speed controls are unavailable.";
      this.mount();
      this.timer=setInterval(()=>this.tick(),100);
    },
    stopMarket() {
      if(this.timer)clearInterval(this.timer);
      this.timer=null;this.running=false;this.busy=false;
    },
    async tick() {
      if(this.busy||!this.running||!this.selected)return;
      this.busy=true;
      try {
        const result=await this.request("/"+encodeURIComponent(this.selected.id)+"/next-candle",{method:"POST",body:"{}"});
        this.selected=result;
        if(result.new_candle) {
          this.candles.push(result.new_candle);
          if(this.candles.length>180)this.candles=this.candles.slice(-180);
        }
        if(result.status!=="active") {
          this.stopMarket();this.notice=result.status==="phase-ready"?"Phase 1 complete. Advance to Phase 2 to continue.":result.status==="passed"?"Challenge passed.":"Challenge ended.";
          this.mount();return;
        }
        this.updateLive();
      } catch(error) {
        this.stopMarket();this.error=error.message;this.mount();
      } finally {this.busy=false;}
    },
    updateLive() {
      if(!this.container||!this.selected)return;
      const c=this.selected, rules=this.rules(), equity=Number(c.equity)||Number(c.starting_balance), pnl=Number(c.realized_pnl)||0;
      const set=(key,value)=>{const node=this.container.querySelector(`[data-phs="${key}"]`);if(node)node.textContent=value;};
      set("equity",money(equity));set("pnl",money(pnl));set("days",`${c.trading_days.length} / 15`);
      set("price",price(c.last_candle?.close));set("candleTime",c.last_candle?new Date(c.last_candle.time).toLocaleString():"Waiting for first candle");
      set("marketState","Market running");set("candleCount",`${this.candles.length} revealed candles`);
      set("position",this.positionMarkup(c.position,c.last_candle));set("trades",this.tradesMarkup(c.trades));set("tradeCount",`${c.trades.length} closed trades`);
      const dailyLimit=Number(c.daily_start_equity||c.starting_balance)*Number(rules.daily_loss_pct||0)/100;
      const dailyLoss=Math.max(0,Number(c.daily_start_equity||c.starting_balance)-equity);
      const maxLimit=Number(c.starting_balance)*Number(rules.max_loss_pct||0)/100;
      const maxLoss=Math.max(0,Number(c.starting_balance)-equity);
      set("dailyLoss",`${money(dailyLoss)} / ${money(dailyLimit)}`);set("maxLoss",`${money(maxLoss)} / ${money(maxLimit)}`);
      const dt=this.container.querySelector('[data-phs="dailyTrack"]');if(dt)dt.style.width=`${Math.min(100,dailyLoss/Math.max(1,dailyLimit)*100)}%`;
      const mt=this.container.querySelector('[data-phs="maxTrack"]');if(mt)mt.style.width=`${Math.min(100,maxLoss/Math.max(1,maxLimit)*100)}%`;
      const buy=this.container.querySelector("#phsBuy"),sell=this.container.querySelector("#phsSell"),close=this.container.querySelector("#phsClosePosition");
      if(buy)buy.disabled=!!c.position;if(sell)sell.disabled=!!c.position;if(close)close.disabled=!c.position;
      this.drawChart();
    },
    async placeOrder(side) {
      if(!this.selected)return;
      const lots=Number(this.container.querySelector("#phsLots")?.value||this.lots);
      const stop=this.container.querySelector("#phsSL")?.value||null;
      const take=this.container.querySelector("#phsTP")?.value||null;
      try {
        this.selected=await this.request("/"+encodeURIComponent(this.selected.id)+"/order",{method:"POST",body:JSON.stringify({side,lots,stop_loss:stop,take_profit:take})});
        this.lots=lots;this.notice=`${side.toUpperCase()} order placed at the last revealed market price.`;this.error="";this.mount();
      } catch(error) {this.error=error.message;this.mount();}
    },
    async closePosition() {
      if(!this.selected)return;
      try {
        this.selected=await this.request("/"+encodeURIComponent(this.selected.id)+"/close",{method:"POST",body:"{}"});
        this.notice="Position closed at the last revealed market price.";this.error="";
        if(this.selected.status!=="active")this.stopMarket();
        this.mount();
      } catch(error){this.error=error.message;this.mount();}
    },
    async advancePhase() {
      if(!this.selected)return;
      try {
        this.selected=await this.request("/"+encodeURIComponent(this.selected.id)+"/advance-phase",{method:"POST",body:"{}"});
        this.notice="Phase 2 started. The same assigned historical month continues; the 15-day limit does not reset.";this.error="";
        this.mount();
      } catch(error){this.error=error.message;this.mount();}
    },
    drawChart() {
      const canvas=this.container?.querySelector("#phsChart");
      if(!canvas)return;
      const width=Math.max(300,canvas.clientWidth||800),height=320,dpr=window.devicePixelRatio||1;
      canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);canvas.style.height=height+"px";
      const ctx=canvas.getContext("2d");if(!ctx)return;ctx.scale(dpr,dpr);ctx.clearRect(0,0,width,height);
      const data=this.candles.slice(-100);
      if(!data.length){ctx.fillStyle="#8a96aa";ctx.font="13px Inter, sans-serif";ctx.fillText("Start the market to reveal historical candles.",20,40);return;}
      const low=Math.min(...data.map(c=>Number(c.low))),high=Math.max(...data.map(c=>Number(c.high))),span=Math.max(high-low,0.01);
      const pad={l:14,r:14,t:18,b:24},plotW=width-pad.l-pad.r,plotH=height-pad.t-pad.b;
      ctx.font="10px JetBrains Mono, monospace";ctx.strokeStyle="rgba(145,160,184,.16)";ctx.fillStyle="#8794aa";ctx.lineWidth=1;
      for(let i=0;i<=4;i++){const y=pad.t+plotH*i/4;ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(width-pad.r,y);ctx.stroke();ctx.fillText((high-span*i/4).toFixed(2),pad.l+3,y-4);}
      const step=plotW/data.length,bodyW=Math.max(2,step*.58);
      const yFor=v=>pad.t+(high-Number(v))/span*plotH;
      data.forEach((c,i)=>{const x=pad.l+step*(i+.5),up=Number(c.close)>=Number(c.open),col=up?"#28c99a":"#f06478";ctx.strokeStyle=col;ctx.fillStyle=col;ctx.beginPath();ctx.moveTo(x,yFor(c.high));ctx.lineTo(x,yFor(c.low));ctx.stroke();const y1=yFor(c.open),y2=yFor(c.close);ctx.fillRect(x-bodyW/2,Math.min(y1,y2),bodyW,Math.max(1,Math.abs(y2-y1));});
      ctx.fillStyle="#8a96aa";ctx.fillText("Only revealed candles are drawn",pad.l,height-6);
    },
    cleanup() { this.stopMarket();this.container=null; },
  };
  // The ordinary Backtesting page remains untouched; only this router entry is replaced.
  window.PagePropFirmSession = HistoricalPropFirmSession;
})();
