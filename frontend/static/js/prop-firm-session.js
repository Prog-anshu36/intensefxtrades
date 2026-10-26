/* Prop Firm Session: rule-based practice rounds, scored from new chart trades. */
(() => {
  "use strict";

  const DAY_MS = 24 * 60 * 60 * 1000;
  const PLATFORM_OFFSET_MS = 3 * 60 * 60 * 1000;
  const MODELS = {
    standard: { name: "2 Step Standard", dailyLossPct: 5, maxLossPct: 10, targets: { 1: 8, 2: 5 }, minDays: 3, sizes: [5000, 10000, 25000, 50000, 100000] },
    pro: { name: "2 Step Pro", dailyLossPct: 3, maxLossPct: 6, targets: { 1: 6, 2: 6 }, minDays: 2, sizes: [5000, 10000, 25000, 50000, 100000, 200000] },
  };

  function timestamp(value) {
    if (value == null || value === "") return null;
    if (Number.isFinite(Number(value))) {
      const n = Number(value);
      return n < 1e11 ? n * 1000 : n;
    }
    const parsed = Date.parse(value || "");
    return Number.isFinite(parsed) ? parsed : null;
  }
  function dayKey(value) {
    const ms = timestamp(value);
    if (ms == null) return "";
    const d = new Date(ms + PLATFORM_OFFSET_MS);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }
  function tradeKey(trade) {
    const id = trade?.id ?? "";
    return `${id}|${trade?.opened_at || trade?.created_at || ""}|${trade?.symbol || ""}|${trade?.type || ""}|${trade?.entry ?? ""}`;
  }
  function allTrades(state) { return [...(state?.history || []), ...(state?.active_trades || [])]; }
  function accountScope() {
    const state = window.Store?.state || {};
    return `${encodeURIComponent(state.active_user_id || "local")}:${encodeURIComponent(state.active_account_id || state.id || "browser")}`;
  }
  function escape(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }
  function money(value, compact = false) {
    const number = Number(value) || 0;
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2,
      notation: compact ? "compact" : "standard" }).format(number);
  }

  const PagePropFirmSession = {
    model: "standard",
    size: 5000,
    selectedId: null,
    attempts: [],
    currentMarketTime: null,
    _scope: null,
    init() { this.load(); },
    storageKey() { return `tfb_prop_firm_practice_v1:${accountScope()}`; },
    load() {
      const scope = accountScope();
      if (this._scope === scope) return;
      this._scope = scope;
      this.currentMarketTime = null;
      try {
        const stored = JSON.parse(localStorage.getItem(this.storageKey()) || "{}");
        this.attempts = Array.isArray(stored.attempts) ? stored.attempts : [];
        this.selectedId = stored.selectedId || this.attempts.find(a => ["active", "phase-ready"].includes(a.status))?.id || this.attempts[0]?.id || null;
        this.currentMarketTime = timestamp(this.attempts.find(a => a.id === this.selectedId)?.lastMarketTimestamp);
      } catch (_) { this.attempts = []; this.selectedId = null; }
    },
    save() {
      this._scope = accountScope();
      try { localStorage.setItem(this.storageKey(), JSON.stringify({ version: 1, selectedId: this.selectedId, attempts: this.attempts })); }
      catch (_) { /* Private mode or full storage: current session remains usable in memory. */ }
      this.syncChartBadge();
    },
    selected() { return this.attempts.find(a => a.id === this.selectedId) || null; },
    practiceAttempt() { return this.attempts.find(a => a.status === "active" || a.status === "phase-ready") || null; },
    baselineKeys(state) { return [...new Set(allTrades(state).map(tradeKey))]; },
    newTrades(attempt, state) {
      const baseline = new Set(state?.practice_workspace ? [] : (attempt.phaseBaselineKeys || []));
      const closed = (state?.history || []).filter(t => !baseline.has(tradeKey(t)));
      const open = (state?.active_trades || []).filter(t => !baseline.has(tradeKey(t)));
      return { closed, open };
    },
    tradingState(attempt = this.selected()) {
      return window.PropPracticeWorkspace ? window.PropPracticeWorkspace.stateForAttempt(attempt) : (window.Store?.state || {});
    },
    summary(attempt = this.selected(), state = this.tradingState(attempt)) {
      if (!attempt) return null;
      const { closed, open } = this.newTrades(attempt, state);
      const closedPnl = closed.reduce((sum, trade) => sum + (Number(trade.pnl) || 0), 0);
      const floating = open.reduce((sum, trade) => sum + (Number(trade.floating_pnl) || 0), 0);
      const equity = attempt.startingBalance + closedPnl + floating;
      const tradedDays = [...new Set([...closed, ...open].map(t => dayKey(t.opened_at || t.closed_at)).filter(Boolean))].sort();
      const currentDay = dayKey(this.currentMarketTime || open.at(-1)?.opened_at || closed.at(-1)?.closed_at || Date.now());
      const dayClosed = closed.filter(t => dayKey(t.closed_at || t.opened_at) === currentDay).reduce((s, t) => s + (Number(t.pnl) || 0), 0);
      const dayOpen = attempt.dailyBaselines?.[currentDay] || null;
      const dailyFloor = dayOpen ? dayOpen.equity - Math.max(dayOpen.balance, dayOpen.equity) * (MODELS[attempt.model].dailyLossPct / 100) : null;
      const maxFloor = attempt.startingBalance * (1 - MODELS[attempt.model].maxLossPct / 100);
      const dailyDrawdown = dayOpen ? Math.max(0, dayOpen.equity - equity) : Math.max(0, -dayClosed - floating);
      const targetPct = MODELS[attempt.model].targets[attempt.phase];
      const target = attempt.startingBalance * targetPct / 100;
      const pnl = closedPnl + floating;
      const deadline = timestamp(attempt.deadlineAt);
      const remainingMs = deadline == null ? 0 : Math.max(0, deadline - Date.now());
      return { closed, open, closedPnl, floating, pnl, equity, tradedDays, currentDay, dailyFloor, dailyDrawdown,
        maxFloor, maxDrawdown: Math.max(0, attempt.startingBalance - equity), target, targetPct,
        targetProgress: Math.max(0, Math.min(100, pnl / target * 100)), remainingMs,
        tradingDaysNeeded: Math.max(0, MODELS[attempt.model].minDays - tradedDays.length),
        balanceAtDayStart: dayOpen?.balance ?? attempt.startingBalance };
    },
    create(model = this.model, size = this.size) {
      this.load();
      const rules = MODELS[model];
      const amount = Number(size);
      if (!rules || !rules.sizes.includes(amount)) return { ok: false, message: "Choose a supported account size." };
      const state = window.PropPracticeWorkspace ? {} : (window.Store?.state || {});
      const now = Date.now();
      const attempt = { id: `practice-${now}-${Math.random().toString(36).slice(2, 8)}`, model, startingBalance: amount,
        phase: 1, status: "active", startedAt: new Date(now).toISOString(), phaseStartedAt: new Date(now).toISOString(),
        deadlineAt: new Date(now + 14 * DAY_MS).toISOString(), phaseBaselineKeys: this.baselineKeys(state), dailyBaselines: {},
        lastMarketTimestamp: null, breachReason: "", completedAt: null };
      this.attempts.unshift(attempt);
      this.currentMarketTime = null;
      this.selectedId = attempt.id;
      this.model = model;
      this.size = amount;
      this.save();
      return { ok: true, attempt };
    },
    advance(attemptId = this.selectedId) {
      const attempt = this.attempts.find(a => a.id === attemptId);
      if (!attempt || attempt.status !== "phase-ready") return { ok: false, message: "Complete the phase objectives first." };
      if (attempt.phase === 2) {
        attempt.status = "passed";
        attempt.completedAt = new Date().toISOString();
      } else {
        attempt.phase = 2;
        attempt.status = "active";
        attempt.phaseStartedAt = new Date().toISOString();
        attempt.deadlineAt = new Date(Date.now() + 14 * DAY_MS).toISOString();
        attempt.phaseBaselineKeys = window.PropPracticeWorkspace ? [] : this.baselineKeys(window.Store?.state || {});
        attempt.dailyBaselines = {};
        attempt.lastMarketTimestamp = null;
        this.currentMarketTime = null;
      }
      this.save();
      return { ok: true, attempt };
    },
    activate(attemptId) { this.selectedId = attemptId; this.currentMarketTime = timestamp(this.selected()?.lastMarketTimestamp); this.save(); },
    evaluate(attempt = this.selected() || this.practiceAttempt(), state = this.tradingState(attempt)) {
      if (!attempt || attempt.status !== "active") return { attempt, failed: false, liquidate: [] };
      const model = MODELS[attempt.model];
      const summary = this.summary(attempt, state);
      const previousStatus = attempt.status;
      if (Date.now() >= timestamp(attempt.deadlineAt)) {
        attempt.status = "expired";
        attempt.breachReason = "The 14-calendar-day phase window expired.";
      } else if (summary.equity <= summary.maxFloor) {
        attempt.status = "failed";
        attempt.breachReason = `Maximum loss breached at ${money(summary.equity)}.`;
      } else if (summary.dailyFloor != null && summary.equity <= summary.dailyFloor) {
        attempt.status = "failed";
        attempt.breachReason = `Daily loss limit breached at ${money(summary.equity)}.`;
      } else if (summary.closedPnl >= summary.target && summary.open.length === 0 && !(state.pending_orders || []).length && summary.tradingDaysNeeded === 0) {
        attempt.status = "phase-ready";
        if (attempt.phase === 2) {
          attempt.status = "passed";
          attempt.completedAt = new Date().toISOString();
        }
      }
      const failed = previousStatus === "active" && ["failed", "expired"].includes(attempt.status);
      this.save();
      return { attempt, failed, liquidate: failed ? this.summary(attempt, state).open : [], reason: attempt.breachReason };
    },
    onMarketCandle(time, state = this.tradingState()) {
      this.load();
      this.currentMarketTime = timestamp(time);
      const attempt = this.selected() || this.practiceAttempt();
      if (!attempt || attempt.status !== "active") { this.syncChartBadge(); return { attempt, failed: false, liquidate: [] }; }
      const candleTime = Number(this.currentMarketTime);
      if (!Number.isFinite(candleTime) || (attempt.lastMarketTimestamp && candleTime < attempt.lastMarketTimestamp)) {
        return { attempt, failed: false, liquidate: [], outOfOrder: true };
      }
      const day = dayKey(candleTime);
      if (day && !attempt.dailyBaselines[day]) {
        const { closed, open } = this.newTrades(attempt, state);
        const realizedBeforeDay = closed.filter(t => dayKey(t.closed_at || t.opened_at) < day).reduce((sum, t) => sum + (Number(t.pnl) || 0), 0);
        const balance = attempt.startingBalance + realizedBeforeDay;
        const floating = open.reduce((sum, t) => sum + (Number(t.floating_pnl) || 0), 0);
        attempt.dailyBaselines[day] = { balance, equity: balance + floating, capturedAt: new Date(candleTime).toISOString() };
      }
      attempt.lastMarketTimestamp = Math.max(attempt.lastMarketTimestamp || 0, candleTime);
      const result = this.evaluate(attempt, state);
      return result;
    },
    canTradeAt(time, symbol = "") {
      const attempt = this.selected() || this.practiceAttempt();
      if (!attempt) return { ok: false, message: "Start a prop practice round first." };
      if (symbol !== "XAUUSD") return { ok: false, message: "Prop practice uses XAUUSD only." };
      if (attempt.status !== "active") return { ok: false, message: attempt.status === "phase-ready" ? "This phase met its target. Start the next phase from Prop Firm Session." : `This round is ${attempt.status}. Start a new practice round to place more trades.` };
      const ms = timestamp(time);
      if (attempt.lastMarketTimestamp && ms != null && ms < attempt.lastMarketTimestamp) return { ok: false, message: "Practice trades must follow replay time. Move the replay forward before placing an order." };
      const otherSymbol = this.summary(attempt).open.find(trade => trade.symbol && trade.symbol !== symbol)?.symbol;
      if (otherSymbol) return { ok: false, message: `Close the active ${otherSymbol} practice position before placing a ${symbol} trade.` };
      return { ok: true, attempt };
    },
    sync() {
      if (this._scope !== accountScope()) this.load();
      this.syncChartBadge();
    },
    syncChartBadge() {
      const node = window.PropPracticeWorkspace ? window.PropPracticeWorkspace.activeChart()?.container?.querySelector("#propFirmChartBadge") : document.querySelector("#propFirmChartBadge");
      if (!node) return;
      const attempt = this.selected() || this.practiceAttempt();
      if (!attempt) { node.hidden = true; return; }
      const summary = this.summary(attempt);
      node.hidden = false;
      node.dataset.status = attempt.status;
      node.textContent = `${MODELS[attempt.model].name} · Phase ${attempt.phase} · Equity ${money(summary.equity)}`;
      node.title = attempt.status === "phase-ready" ? "Phase objective met; advance from Prop Firm Session." : "Orders placed on the chart are scored in this practice round.";
    },
    renderEquityChart(attempt, summary) {
      const points = [{ time: timestamp(attempt.phaseStartedAt) || Date.now(), equity: attempt.startingBalance }];
      let equity = attempt.startingBalance;
      [...summary.closed].sort((a, b) => (timestamp(a.closed_at) || 0) - (timestamp(b.closed_at) || 0)).forEach(trade => {
        equity += Number(trade.pnl) || 0;
        points.push({ time: timestamp(trade.closed_at || trade.opened_at) || points.at(-1).time + 1, equity });
      });
      if (summary.open.length) points.push({ time: Date.now(), equity: summary.equity });
      const low = Math.min(attempt.startingBalance, ...points.map(point => point.equity));
      const span = Math.max(1, Math.max(attempt.startingBalance, ...points.map(point => point.equity)) - low);
      const coords = points.map((point, index) => [24 + index * (552 / Math.max(1, points.length - 1)), 106 - ((point.equity - low) / span) * 82]);
      const line = coords.map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
      const fill = `${line} L${coords.at(-1)[0].toFixed(1)},114 L${coords[0][0].toFixed(1)},114 Z`;
      return `<div class="propfirm-equity-chart"><div class="propfirm-chart-heading"><div><span>Account equity</span><b>${money(summary.equity)}</b></div><small>${summary.closed.length} closed · ${summary.open.length} open</small></div><svg viewBox="0 0 600 132" role="img" aria-label="Prop practice account equity history"><defs><linearGradient id="propEquityFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#2f7cf6" stop-opacity=".28"/><stop offset="1" stop-color="#2f7cf6" stop-opacity="0"/></linearGradient></defs><path class="propfirm-equity-fill" d="${fill}"/><path class="propfirm-equity-line" d="${line}"/><line x1="24" x2="576" y1="114" y2="114"/><text x="24" y="129">Start ${money(attempt.startingBalance)}</text><text x="576" y="129" text-anchor="end">${summary.tradedDays.length} trading days</text></svg></div>`;
    },
    renderAccountDashboard(attempt, rules, summary) {
      const today = dayKey(this.currentMarketTime || attempt.lastMarketTimestamp || Date.now());
      const todayTrades = [...summary.closed, ...summary.open].filter(trade => dayKey(trade.closed_at || trade.opened_at) === today);
      const todayPnl = todayTrades.reduce((total, trade) => total + (Number(trade.pnl ?? trade.floating_pnl) || 0), 0);
      const deadline = attempt.deadlineAt ? new Date(attempt.deadlineAt) : null;
      const title = `${rules.name} · ${money(attempt.startingBalance)}`;
      const detailRows = summary.closed.slice().sort((a, b) => (timestamp(b.closed_at) || 0) - (timestamp(a.closed_at) || 0)).slice(0, 10);
      return `<section class="propfirm-overview" aria-label="Selected practice account details">
        <div class="propfirm-breadcrumb"><span>Prop Firm Accounts</span><b>›</b><strong>${escape(title)}</strong><span class="propfirm-status-tag" data-status="${escape(attempt.status)}">${escape(attempt.status === 'active' ? 'Ongoing' : attempt.status === 'phase-ready' ? 'Phase ready' : attempt.status)}</span></div>
        <header class="propfirm-overview-head"><div><span class="propfirm-eyebrow">SELECTED PRACTICE ACCOUNT · XAUUSD</span><h2>${escape(title)}</h2><div class="propfirm-overview-tags"><span>Phase ${attempt.phase}</span><span>${escape(attempt.model === 'pro' ? '2 Step Pro' : '2 Step Standard')}</span><span>Simulation</span></div></div><button class="propfirm-primary" id="propFirmChart">${attempt.status === 'phase-ready' ? 'Manage phase →' : 'Open practice chart →'}</button></header>
        <div class="propfirm-overview-stats"><article><span>Account size</span><b>${money(attempt.startingBalance)}</b></article><article><span>Today's profit</span><b class="${todayPnl >= 0 ? 'positive' : 'negative'}">${todayPnl >= 0 ? '+' : ''}${money(todayPnl)}</b></article><article><span>Start date</span><b>${new Date(attempt.phaseStartedAt || attempt.startedAt).toLocaleDateString()}</b></article><article><span>Phase end</span><b>${deadline && Number.isFinite(deadline.getTime()) ? deadline.toLocaleDateString() : '—'}</b></article></div>
        <div class="propfirm-overview-grid"><div class="propfirm-overview-main">${this.renderEquityChart(attempt, summary)}<section class="propfirm-detail-card"><div class="propfirm-detail-heading"><div><span class="propfirm-eyebrow">TRADING HISTORY</span><h3>Closed positions <small>(${summary.closed.length})</small></h3></div><span class="propfirm-detail-caption">XAUUSD · Phase ${attempt.phase}</span></div>${detailRows.length ? `<div class="propfirm-trade-table-wrap"><table class="propfirm-trade-table"><thead><tr><th>Side</th><th>Open</th><th>Close</th><th>Size</th><th>Result</th></tr></thead><tbody>${detailRows.map(trade => `<tr><td class="${trade.type === 'BUY' ? 'positive' : 'negative'}">${escape(trade.type)}</td><td>${Number(trade.entry || 0).toFixed(2)}</td><td>${Number(trade.exit || 0).toFixed(2)}</td><td>${Number(trade.lots || 0).toFixed(2)}</td><td class="${Number(trade.pnl) >= 0 ? 'positive' : 'negative'}">${Number(trade.pnl) >= 0 ? '+' : ''}${money(trade.pnl)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="propfirm-empty-inline">No closed positions in this phase yet. Open the practice chart to place a simulated XAUUSD trade.</div>'}</section></div><aside class="propfirm-overview-side"><section class="propfirm-score-card"><div><span>Virtual balance</span><b>${money(attempt.startingBalance + summary.closedPnl)}</b></div><div class="propfirm-balance-track"><i style="width:${Math.max(0,Math.min(100,(summary.equity / (attempt.startingBalance * 1.1))*100))}%"></i></div><small>Equity ${money(summary.equity)} · starting ${money(attempt.startingBalance)}</small></section><section class="propfirm-detail-card"><div class="propfirm-detail-heading"><div><span class="propfirm-eyebrow">TRADING OBJECTIVES</span><h3>Phase ${attempt.phase} progress</h3></div></div><div class="propfirm-objective-row"><span>Minimum trading days</span><b>${summary.tradedDays.length} / ${rules.minDays}</b></div><div class="propfirm-mini-track"><i style="width:${Math.min(100,summary.tradedDays.length / Math.max(1,rules.minDays) * 100)}%"></i></div><div class="propfirm-objective-row"><span>Maximum daily loss</span><b>${rules.dailyLossPct}% · ${money(summary.dailyDrawdown)} used</b></div><div class="propfirm-objective-row"><span>Maximum loss</span><b>${rules.maxLossPct}% · ${money(summary.maxDrawdown)} used</b></div><div class="propfirm-objective-row"><span>Profit target</span><b>${money(Math.max(0,summary.pnl))} / ${money(summary.target)}</b></div><div class="propfirm-mini-track"><i style="width:${summary.targetProgress}%"></i></div><div class="propfirm-objective-row"><span>Phase deadline</span><b>${Math.ceil(summary.remainingMs / DAY_MS)} days left</b></div>${attempt.status === 'phase-ready' ? `<button class="propfirm-primary propfirm-wide" id="propFirmAdvance">${attempt.phase === 2 ? 'Complete round' : 'Start Phase 2 →'}</button>` : ''}</section><section class="propfirm-detail-card"><div class="propfirm-detail-heading"><div><span class="propfirm-eyebrow">OPEN POSITIONS</span><h3>Active · ${summary.open.length}</h3></div></div>${summary.open.length ? summary.open.map(trade => `<div class="propfirm-open-row"><span class="${trade.type === 'BUY' ? 'positive' : 'negative'}">${escape(trade.type)} XAUUSD</span><b class="${Number(trade.floating_pnl) >= 0 ? 'positive' : 'negative'}">${Number(trade.floating_pnl) >= 0 ? '+' : ''}${money(trade.floating_pnl)}</b></div>`).join('') : '<div class="propfirm-empty-inline">No open positions</div>'}</section></aside></div>
        <div class="propfirm-detail-foot">Practice simulator only · Your ordinary TradeFXBook backtesting history remains separate from this account.</div>
      </section>`;
    },
    render() {
      this.load();
      const attempts = this.attempts;
      const selected = this.selected();
      const attempt = selected || this.practiceAttempt();
      if (attempt?.status === "active" && (!window.PropPracticeWorkspace || window.PropPracticeWorkspace.hasState(attempt))) this.evaluate(attempt);
      const rules = attempt ? MODELS[attempt.model] : MODELS[this.model];
      const summary = attempt ? this.summary(attempt) : null;
      const daysLeft = summary ? Math.ceil(summary.remainingMs / DAY_MS) : null;
      const clock = ms => { const d = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(d / 86400)}d ${String(Math.floor(d % 86400 / 3600)).padStart(2,"0")}h ${String(Math.floor(d % 3600 / 60)).padStart(2,"0")}m`; };
      const statusLabel = status => ({ active: "In progress", "phase-ready": "Phase objective met", passed: "Passed · practice only", failed: "Breached", expired: "Expired" }[status] || status);
      const progress = (value, max) => Math.max(0, Math.min(100, (value / max) * 100));
      return `<section class="propfirm-page">
        <header class="propfirm-hero"><div><span class="propfirm-eyebrow">INTENSEFXTRADES · SIMULATED EVALUATION</span><h2>Prop Firm Session</h2><p>Practice evaluation rounds in a dedicated XAUUSD chart with its own replay, drawings, orders, and analysis. Choose a model, trade by its published objectives, and review each attempt.</p></div><div class="propfirm-hero-mark"><b>PF</b><span>Practice mode</span></div></header>
        <div class="propfirm-notice"><b>Independent practice simulator.</b> Rule values below reference the provider’s public Free Trial rules. Trade execution and market conditions come from TradeFXBook’s local replay engine; this does not create a provider account, copy live credentials, or guarantee identical spreads, leverage, commissions, or fills.</div>
        <section class="propfirm-card propfirm-create"><div class="propfirm-section-head"><div><span class="propfirm-eyebrow">CREATE ACCOUNT</span><h3>Add a practice account</h3><p>Create multiple independent rounds. Each account keeps its own balance, trades, replay, drawings, and objectives.</p></div><span class="propfirm-badge">XAUUSD PRACTICE</span></div><div class="propfirm-plan-grid">${Object.entries(MODELS).map(([code, model]) => `<button type="button" class="propfirm-plan-card ${code === "pro" ? "pro" : "standard"} ${this.model === code ? "selected" : ""}" data-select-model="${code}" aria-pressed="${this.model === code}"><span class="propfirm-plan-kicker">${code === "pro" ? "2 STEP PRO" : "2 STEP STANDARD"}</span><b class="propfirm-plan-title">${code === "pro" ? "Lean, Fast Efficient" : "Maximum Drawdown Space"}</b><span class="propfirm-plan-summary">${code === "pro" ? "Lower daily loss limit · built for focused traders" : "More breathing room · higher overall drawdown"}</span><span class="propfirm-plan-metrics"><span>Phase 1 target <b>${model.targets[1]}%</b></span><span>Phase 2 target <b>${model.targets[2]}%</b></span><span>Daily loss limit <b>${model.dailyLossPct}%</b></span><span>Max drawdown <b>${model.maxLossPct}% static</b></span><span>Leverage reference <b>up to 1:100</b></span><span>Min. trading days <b>${model.minDays} / phase</b></span></span><span class="propfirm-plan-select">${this.model === code ? "Selected" : "Select this model"} <i>→</i></span></button>`).join("")}</div><div class="propfirm-create-grid"><label>Challenge model<select id="propFirmModel"><option value="standard" ${this.model === "standard" ? "selected" : ""}>2 Step Standard</option><option value="pro" ${this.model === "pro" ? "selected" : ""}>2 Step Pro</option></select></label><label>Virtual starting balance<select id="propFirmSize">${MODELS[this.model].sizes.map(size => `<option value="${size}" ${Number(this.size) === size ? "selected" : ""}>${money(size)}</option>`).join("")}</select></label><button class="propfirm-primary" id="propFirmStart">Create practice account <span>→</span></button></div><div class="propfirm-rule-preview" id="propFirmRulePreview">${this.model === "standard" ? "Phase 1 target 8% · Phase 2 target 5% · Daily loss 5% · Max loss 10% · 3 minimum trading days per phase" : "Phase 1 and 2 target 6% · Daily loss 3% · Max loss 6% · 2 minimum trading days per phase"} · 14 calendar days per phase</div></section>
        ${attempt ? this.renderAccountDashboard(attempt, rules, summary) : ""}
        ${attempt && ["passed", "failed", "expired"].includes(attempt.status) ? `<section class="propfirm-result-card" data-status="${attempt.status}"><div><span class="propfirm-eyebrow">ROUND ${escape(statusLabel(attempt.status).toUpperCase())}</span><h3>${attempt.status === "passed" ? "Practice evaluation complete" : attempt.status === "expired" ? "Phase time limit reached" : "Loss rule breached"}</h3><p>${escape(attempt.breachReason || "Both phases met their objectives. This result is for practice only.")}</p><b>Final virtual equity · ${money(summary.equity)}</b></div><button class="propfirm-secondary" id="propFirmNewRound">Start another round</button></section>` : ""}
        <section class="propfirm-card"><div class="propfirm-section-head"><div><span class="propfirm-eyebrow">MODEL RULES</span><h3>Round objectives at a glance</h3><p>The selected model uses different drawdown and target thresholds.</p></div></div><div class="propfirm-model-grid">${Object.entries(MODELS).map(([code, model]) => `<article class="propfirm-model-card ${attempt?.model === code || (!attempt && this.model === code) ? "selected" : ""}"><div><b>${escape(model.name)}</b><span>${model.sizes.map(x => `$${x/1000}K`).join(" · ")}</span></div><div class="propfirm-model-metrics"><span>Daily loss <b>${model.dailyLossPct}%</b></span><span>Max loss <b>${model.maxLossPct}%</b></span><span>Phase 1 target <b>${model.targets[1]}%</b></span><span>Phase 2 target <b>${model.targets[2]}%</b></span><span>Min. active days <b>${model.minDays} / phase</b></span><span>Time limit <b>14 calendar days / phase</b></span></div></article>`).join("")}</div><p class="propfirm-rule-footnote">Daily loss is based on the higher day-opening balance or equity and resets at 00:00 platform time (UTC+3). Maximum loss is static from starting balance. Open-position floating loss counts toward both limits.</p></section>
        <section class="propfirm-card"><div class="propfirm-section-head"><div><span class="propfirm-eyebrow">YOUR ACCOUNTS</span><h3>Practice accounts <small>(${attempts.length})</small></h3><p>Select an account to open its balance, objectives, trading history, and open positions.</p></div><span class="propfirm-count-badge">${attempts.length} ${attempts.length === 1 ? "account" : "accounts"}</span></div>${attempts.length ? `<div class="propfirm-account-grid">${attempts.map(item => { const r=MODELS[item.model];const pnl=this.summary(item)?.pnl || 0;return `<button class="propfirm-account-card ${item.id===attempt?.id?"selected":""}" data-prop-attempt="${escape(item.id)}"><span class="propfirm-account-card-top"><span class="propfirm-history-icon ${item.model}">${item.model === "pro" ? "P" : "S"}</span><span class="propfirm-history-status" data-status="${item.status}">${escape(statusLabel(item.status))}</span><span class="propfirm-account-arrow">↗</span></span><b class="propfirm-account-name">${escape(r.name)} · ${money(item.startingBalance)}</b><span class="propfirm-account-meta">XAUUSD · Phase ${item.phase} · ${new Date(item.startedAt).toLocaleDateString()}</span><span class="propfirm-account-balance-label"><span>Balance</span><span>Phase P&amp;L</span></span><span class="propfirm-account-balance"><b>${money(item.startingBalance + (this.summary(item)?.closedPnl || 0))}</b><b class="${pnl >= 0 ? "positive" : "negative"}">${pnl >= 0 ? "+" : ""}${money(pnl)}</b></span><span class="propfirm-account-progress"><i style="width:${this.summary(item)?.targetProgress || 0}%"></i></span><span class="propfirm-account-foot">Profit target ${r.targets[item.phase]}% <b>${Math.round(this.summary(item)?.targetProgress || 0)}%</b></span></button>`;}).join("")}</div>` : `<div class="propfirm-empty"><span>◎</span><b>No practice accounts yet</b><p>Select a challenge model above and start your first simulated evaluation.</p></div>`}</section>
        <section class="propfirm-disclaimer"><b>How chart trades are scored</b><p>Each round and phase has an independent practice ledger and XAUUSD chart workspace. Prop practice trades do not enter your normal backtesting history. Drawings and replay are restored for the selected round and phase. Open the dedicated Practice Chart to trade. FXN/session overlays are not used to determine prop-firm trading days; the round follows UTC+3 platform-day boundaries.</p></section>
      </section>`;
    },
    afterRender(container) {
      const attempt = this.selected();
      if (attempt && window.PropPracticeWorkspace && !window.PropPracticeWorkspace.hasState(attempt)) {
        window.PropPracticeWorkspace.ensure(attempt).then(() => {
          if (window.Router.current === 'prop-firm-session' && this.selectedId === attempt.id) this.refreshView();
        }).catch(error => {
          const notice = container.querySelector('.propfirm-notice');
          if (notice) notice.textContent = error.message;
        });
      }
      this.load();
      const model = container.querySelector("#propFirmModel");
      const size = container.querySelector("#propFirmSize");
      container.querySelectorAll("[data-select-model]").forEach(button => button.addEventListener("click", () => {
        this.model = button.dataset.selectModel;
        const allowed = MODELS[this.model].sizes;
        if (!allowed.includes(Number(this.size))) this.size = allowed[0];
        this.refreshView();
      }));
      model?.addEventListener("change", () => {
        this.model = model.value;
        const allowed = MODELS[this.model].sizes;
        if (!allowed.includes(Number(this.size))) this.size = allowed[0];
        if (size) size.innerHTML = allowed.map(n => `<option value="${n}" ${n === Number(this.size) ? "selected" : ""}>${money(n)}</option>`).join("");
        const preview = container.querySelector("#propFirmRulePreview");
        if (preview) preview.textContent = this.model === "standard" ? "Phase 1 target 8% · Phase 2 target 5% · Daily loss 5% · Max loss 10% · 3 minimum trading days per phase · 14 calendar days per phase" : "Phase 1 and 2 target 6% · Daily loss 3% · Max loss 6% · 2 minimum trading days per phase · 14 calendar days per phase";
        container.querySelectorAll("[data-select-model]").forEach(card => { const selected = card.dataset.selectModel === this.model; card.classList.toggle("selected", selected); card.setAttribute("aria-pressed", String(selected)); });
      });
      size?.addEventListener("change", () => { this.size = Number(size.value); });
      container.querySelector("#propFirmStart")?.addEventListener("click", () => {
        const result = this.create(model?.value || this.model, Number(size?.value || this.size));
        if (!result.ok) { window.UI?.showToast?.(result.message, "info"); return; }
        window.Router.go("prop-firm-session");
      });
      container.querySelector("#propFirmChart")?.addEventListener("click", () => window.Router.go("prop-chart"));
      container.querySelector("#propFirmAdvance")?.addEventListener("click", () => { this.advance(); window.Router.go("prop-firm-session"); });
      container.querySelector("#propFirmNewRound")?.addEventListener("click", () => { this.selectedId = null; this.save(); window.Router.go("prop-firm-session"); });
      container.querySelectorAll("[data-prop-attempt]").forEach(button => button.addEventListener("click", () => { this.activate(button.dataset.propAttempt); window.Router.go("prop-firm-session"); }));
    },
    refreshView() { if (window.Router?.current === "prop-firm-session") window.Router.go("prop-firm-session"); },
  };

  window.PagePropFirmSession = PagePropFirmSession;
  window.PropFirmSession = PagePropFirmSession;
  window.PropFirmRules = MODELS;
  window.addEventListener("hashchange", () => PagePropFirmSession.syncChartBadge());
  window.Store?.subscribe?.(() => PagePropFirmSession.sync());
})();

