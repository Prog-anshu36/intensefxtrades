/* Prop Firm Session: rule-based practice rounds, scored from new chart trades. */
(() => {
  "use strict";

  const DAY_MS = 24 * 60 * 60 * 1000;
  const PLATFORM_OFFSET_MS = 3 * 60 * 60 * 1000;
  const MODELS = {
    standard: { name: "2 Step Standard", dailyLossPct: 5, maxLossPct: 10, targets: { 1: 8, 2: 5 }, minDays: 3, sizes: [5000, 10000, 25000, 50000, 100000] },
    pro: { name: "2 Step Pro", dailyLossPct: 3, maxLossPct: 6, targets: { 1: 6, 2: 6 }, minDays: 0, sizes: [5000, 10000, 25000, 50000, 100000, 200000] },
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
    standardDailyLoss: 5, standardMinDays: 3,
    creating: false,
    workspaceError: null,
    filters: { search: "", model: "all", status: "all", phase: "all", archive: "active" },
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
      this.creating = false;
      this.workspaceError = null;
      try {
        const stored = JSON.parse(localStorage.getItem(this.storageKey()) || "{}");
        this.attempts = Array.isArray(stored.attempts) ? stored.attempts : [];
        // Preserve the rules used by legacy accounts when model defaults evolve.
        this.attempts.forEach(a => { if (!a.rules) a.rules = { ...MODELS[a.model], minDays: a.model === 'pro' ? 2 : 3, targets: {...MODELS[a.model].targets} }; });
        this.filters = { search: "", model: "all", status: "all", phase: "all", archive: "active" };
        this.selectedId = stored.selectedId || this.attempts.find(a => !a.archived && ["active", "phase-ready"].includes(a.status))?.id || this.attempts.find(a => !a.archived)?.id || null;
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
    practiceAttempt() { return this.attempts.find(a => !a.archived && (a.status === "active" || a.status === "phase-ready")) || null; },
    rulesFor(attempt) { return attempt?.rules || MODELS[attempt?.model || this.model]; },
    rename(id, name) {
      const attempt = this.attempts.find(a => a.id === id);
      const clean = String(name || '').trim();
      if (!attempt || !clean || clean.length > 60) return {ok:false, message:'Use an account name between 1 and 60 characters.'};
      attempt.name = clean; this.save(); return {ok:true};
    },
    archive(id, archived = true) {
      const attempt = this.attempts.find(a => a.id === id);
      if (!attempt) return {ok:false, message:'Account not found.'};
      const state = this.tradingState(attempt);
      if (archived && ((state.active_trades || []).length || (state.pending_orders || []).length)) return {ok:false, message:'Close positions and cancel pending orders before archiving.'};
      attempt.archived = archived;
      if (archived && this.selectedId === id) this.selectedId = this.attempts.find(a => !a.archived)?.id || null;
      this.currentMarketTime = timestamp(this.selected()?.lastMarketTimestamp);
      this.save(); return {ok:true};
    },
    filteredAccounts() {
      const f = this.filters;
      return this.attempts.filter(a => (f.archive === 'all' || Boolean(a.archived) === (f.archive === 'archived')) &&
        (f.model === 'all' || a.model === f.model) && (f.status === 'all' || a.status === f.status) &&
        (f.phase === 'all' || String(a.phase) === f.phase) &&
        `${a.name || ''} ${a.id} ${MODELS[a.model].name} ${a.startingBalance}`.toLowerCase().includes(f.search.toLowerCase()));
    },
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
      const currentDay = dayKey(attempt.lastMarketTimestamp || (attempt.id === this.selectedId && this.currentMarketTime) || open.at(-1)?.opened_at || closed.at(-1)?.closed_at || Date.now());
      const dayClosed = closed.filter(t => dayKey(t.closed_at || t.opened_at) === currentDay).reduce((s, t) => s + (Number(t.pnl) || 0), 0);
      const dayOpen = attempt.dailyBaselines?.[currentDay] || null;
      const dailyReference = dayOpen ? Math.max(dayOpen.balance, dayOpen.equity) : null;
      const dailyFloor = dayOpen ? dailyReference * (1 - this.rulesFor(attempt).dailyLossPct / 100) : null;
      const maxFloor = attempt.startingBalance * (1 - this.rulesFor(attempt).maxLossPct / 100);
      const dailyDrawdown = dayOpen ? Math.max(0, dailyReference - equity) : Math.max(0, -dayClosed - floating);
      const targetPct = this.rulesFor(attempt).targets[attempt.phase];
      const target = attempt.startingBalance * targetPct / 100;
      const pnl = closedPnl + floating;
      const deadline = timestamp(attempt.deadlineAt);
      const remainingMs = deadline == null ? 0 : Math.max(0, deadline - Date.now());
      return { closed, open, closedPnl, floating, pnl, equity, tradedDays, currentDay, dailyFloor, dailyDrawdown,
        maxFloor, maxDrawdown: Math.max(0, attempt.startingBalance - equity), target, targetPct,
        targetProgress: Math.max(0, Math.min(100, pnl / target * 100)), remainingMs,
        tradingDaysNeeded: Math.max(0, this.rulesFor(attempt).minDays - tradedDays.length),
        balanceAtDayStart: dayOpen?.balance ?? attempt.startingBalance };
    },
    create(model = this.model, size = this.size, options = {}) {
      this.load();
      if (window.SubscriptionSystem?.canCreatePerformanceSession && !window.SubscriptionSystem.canCreatePerformanceSession(this.attempts.length)) {
        const plan = window.SubscriptionSystem.getUserPlan();
        return { ok: false, message: `Your ${plan.name} plan allows up to ${plan.performanceSessionLimit} performance session(s). Archive status does not free a slot.` };
      }
      const rules = MODELS[model];
      const amount = Number(size);
      if (!rules || !rules.sizes.includes(amount)) return { ok: false, message: "Choose a supported account size." };
      const dailyLossPct = model === 'standard' ? Number(options.dailyLossPct ?? this.standardDailyLoss) : rules.dailyLossPct;
      const minDays = model === 'standard' ? Number(options.minDays ?? this.standardMinDays) : rules.minDays;
      if ((model === 'standard' && (![3,5].includes(dailyLossPct) || ![0,3].includes(minDays)))) return {ok:false, message:'Choose a supported Standard rule variant.'};
      const state = window.PropPracticeWorkspace ? {} : (window.Store?.state || {});
      const now = Date.now();
      const attempt = { id: `practice-${now}-${Math.random().toString(36).slice(2, 8)}`, model, startingBalance: amount,
        rules: { ...rules, dailyLossPct, minDays, targets: {...rules.targets} }, archived: false,
        name: `${rules.name} ${this.attempts.length + 1}`, phase: 1, status: "active", startedAt: new Date(now).toISOString(), phaseStartedAt: new Date(now).toISOString(),
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
    activate(attemptId) {
      this.workspaceError = null;
      this.selectedId = attemptId;
      this.currentMarketTime = timestamp(this.selected()?.lastMarketTimestamp);
      this.save();
      if (typeof window.dispatchEvent === "function" && typeof CustomEvent === "function") {
        window.dispatchEvent(new CustomEvent("tfb:prop-account-change", { detail: { attemptId } }));
      }
    },
    evaluate(attempt = this.selected() || this.practiceAttempt(), state = this.tradingState(attempt)) {
      if (!attempt || attempt.archived || attempt.status !== "active") return { attempt, failed: false, liquidate: [] };
      const model = this.rulesFor(attempt);
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
    tradingTimeFloor(attempt = this.selected(), state = this.tradingState(attempt)) {
      if (!attempt) return null;
      const { closed, open } = this.newTrades(attempt, state);
      return closed.length || open.length || (state.pending_orders || []).length ? timestamp(attempt.lastMarketTimestamp) : null;
    },
    onMarketCandle(time, state = this.tradingState()) {
      this.load();
      this.currentMarketTime = timestamp(time);
      const attempt = this.selected() || this.practiceAttempt();
      if (!attempt || attempt.archived || attempt.status !== "active") { this.syncChartBadge(); return { attempt, failed: false, liquidate: [] }; }
      const candleTime = Number(this.currentMarketTime);
      const floor = this.tradingTimeFloor(attempt, state);
      if (!Number.isFinite(candleTime) || (floor != null && candleTime < floor)) {
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
      attempt.lastMarketTimestamp = floor == null ? candleTime : Math.max(floor, candleTime);
      const result = this.evaluate(attempt, state);
      return result;
    },
    canTradeAt(time, symbol = "") {
      const attempt = this.selected() || this.practiceAttempt();
      if (!attempt) return { ok: false, message: "Start a prop practice round first." };
      if (attempt.archived) return {ok:false, message:'Restore this archived account before trading.'};
      if (symbol !== "XAUUSD") return { ok: false, message: "Prop practice uses XAUUSD only." };
      if (attempt.status !== "active") return { ok: false, message: attempt.status === "phase-ready" ? "This phase met its target. Start the next phase from Prop Firm Session." : `This round is ${attempt.status}. Start a new practice round to place more trades.` };
      const ms = timestamp(time);
      if (ms == null) return { ok: false, message: "Wait for a historical candle to load before placing an order." };
      if (Date.now() >= timestamp(attempt.deadlineAt)) {
        this.evaluate(attempt);
        return { ok: false, message: "This practice phase has expired. Create a new practice account." };
      }
      const floor = this.tradingTimeFloor(attempt);
      if (floor != null && ms < floor) return { ok: false, message: "Practice trades must follow replay time. Move the replay forward before placing an order." };
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
    renderObjectives(attempt, summary) {
      const rules=this.rulesFor(attempt), dailyAllowance=(summary.dailyFloor == null ? attempt.startingBalance : (attempt.dailyBaselines?.[summary.currentDay] ? Math.max(attempt.dailyBaselines[summary.currentDay].balance,attempt.dailyBaselines[summary.currentDay].equity) : attempt.startingBalance))*rules.dailyLossPct/100;
      const rows=[['Minimum trading days', rules.minDays ? `${summary.tradedDays.length} / ${rules.minDays}` : `${summary.tradedDays.length} completed`,rules.minDays ? summary.tradedDays.length/rules.minDays*100 : 100, rules.minDays ? `${summary.tradingDaysNeeded} more qualifying days needed` : 'No minimum trading days'],['Maximum daily loss',`${money(summary.dailyDrawdown)} / ${money(dailyAllowance)}`,summary.dailyDrawdown/Math.max(1,dailyAllowance)*100,`${rules.dailyLossPct}% limit · Reset at 00:00 UTC+3 · Floor ${money(summary.dailyFloor ?? attempt.startingBalance-dailyAllowance)}`],['Maximum loss',`${money(summary.maxDrawdown)} / ${money(attempt.startingBalance*rules.maxLossPct/100)}`,summary.maxDrawdown/(attempt.startingBalance*rules.maxLossPct/100)*100,`${rules.maxLossPct}% static · Equity floor ${money(summary.maxFloor)}`],['Profit target',`${money(summary.closedPnl)} / ${money(summary.target)}`,summary.target?summary.closedPnl/summary.target*100:0,`${summary.targetPct}% realized profit · Close positions and pending orders to complete the phase`],['Challenge duration',`${Math.ceil(summary.remainingMs/DAY_MS)} days remaining`,(1-summary.remainingMs/(14*DAY_MS))*100,`Phase ends ${new Date(attempt.deadlineAt).toLocaleDateString()}`]];
      return `<section class="prop-objectives"><h3>Trading objectives</h3>${rows.map(([label,value,progress,detail])=>`<article class="prop-objective-card"><div><b>${label}</b><strong>${value}</strong></div><p>${escape(detail)}</p><div class="propfirm-mini-track"><i style="width:${Math.max(0,Math.min(100,progress))}%"></i></div></article>`).join('')}${attempt.status==='phase-ready'?'<button class="propfirm-primary" id="propFirmAdvance">Start Phase 2 →</button>':''}</section>`;
    },
    renderAccountDashboard(attempt, rules, summary) {
      const today=summary.currentDay;
      const todayPnl=summary.closed.filter(t=>dayKey(t.closed_at||t.opened_at)===today).reduce((total,t)=>total+(Number(t.pnl)||0),0)+summary.floating;
      const title=attempt.name||rules.name;
      return `<section class="propfirm-overview prop-account-overview" aria-label="Selected practice account details">
        <div class="propfirm-breadcrumb"><span>Accounts</span><b>›</b><strong>${escape(title)}</strong><span class="propfirm-status-tag" data-status="${escape(attempt.status)}">${escape(attempt.archived?'Archived':attempt.status==='active'?'Ongoing':attempt.status)}</span></div>
        <header class="propfirm-overview-head"><div><span class="propfirm-eyebrow">INTENSEFXTRADES · PRACTICE ACCOUNT</span><h2>${escape(title)}</h2><div class="propfirm-overview-tags"><span>${escape(rules.name)}</span><span>Phase ${attempt.phase}</span><span>XAUUSD</span><span>${rules.dailyLossPct}% daily · ${rules.minDays} minimum days</span></div></div><button class="propfirm-primary" id="propFirmChart">Open XAUUSD chart & trade →</button></header>
        ${attempt.archived||['failed','expired','passed','phase-ready'].includes(attempt.status)?`<div class="prop-round-result" role="status">${escape(attempt.archived?'Archived account · Restore it to resume trading.':attempt.breachReason||(attempt.status==='passed'?'Both practice phases completed successfully.':attempt.status==='phase-ready'?'Phase objectives met. Start the next phase below.':attempt.status))}</div>`:''}
        <details class="prop-account-settings"><summary>Manage account · Rename / ${attempt.archived?'Restore':'Archive'}</summary><form id="propRenameForm" class="propfirm-manage-row"><label>Account name<input id="propAccountName" aria-label="Account name" value="${escape(title)}" maxlength="60" required></label><button type="submit" class="propfirm-secondary">Save name</button><button type="button" id="propArchive" class="propfirm-secondary">${attempt.archived?'Restore account':'Archive account'}</button><span role="status" id="propManageStatus"></span></form></details>
        <div class="propfirm-overview-stats"><article><span>Account size</span><b>${money(attempt.startingBalance)}</b></article><article><span>Today's profit</span><b class="${todayPnl>=0?'positive':'negative'}">${money(todayPnl)}</b></article><article><span>Start date</span><b>${new Date(attempt.phaseStartedAt||attempt.startedAt).toLocaleDateString()}</b></article><article><span>End date</span><b>${new Date(attempt.deadlineAt).toLocaleDateString()}</b></article></div>
        ${window.PropPracticeAnalytics?.render(this,attempt,summary)||this.renderEquityChart(attempt,summary)+this.renderObjectives(attempt,summary)}
        <details class="prop-practice-info"><summary>Practice rules and scoring</summary><p>Independent simulation. Daily loss resets at 00:00 UTC+3; the chart can display IST. Drawings, replay and trades belong to this account and phase. Archived accounts retain their records. Provider spreads, execution and private scoring are not reproduced.</p></details>
      </section>`;
    },
    renderPortal(createMarkup, attempt, rules, summary) {
      const current=this.attempts.filter(a=>!a.archived), passed=current.filter(a=>a.status==='passed').length;
      return `<section class="propfirm-page prop-portal">
        <aside class="prop-account-sidebar" aria-label="Prop firm accounts"><header class="prop-account-welcome"><span class="propfirm-eyebrow">YOUR PRACTICE WORKSPACE</span><h2>Prop Firm Accounts</h2><p>${current.length} current · ${passed} passed · ${this.attempts.filter(a=>a.archived).length} archived</p></header><button class="propfirm-primary prop-new-account" id="propOpenCreate">+ New practice account</button><div class="prop-account-load-state" role="status" id="propWorkspaceStatus">${escape(this.workspaceError || '')}</div>${this.workspaceError?'<button class="propfirm-secondary" id="propRetryAccounts">Retry account data</button>':''}${this.renderAccounts()}<div class="prop-account-rail-links"><button data-prop-overview-route="prop-chart">XAUUSD practice chart →</button><button data-prop-overview-route="prop-performance">Performance →</button><button data-prop-overview-route="prop-trade-analysis">Trade Analysis →</button><button data-prop-overview-route="prop-ai-coach">AI Coach →</button></div></aside>
        <div class="prop-account-detail">${attempt?(window.PropPracticeWorkspace&&!window.PropPracticeWorkspace.hasState(attempt)?`<section class="prop-account-empty"><span class="propfirm-eyebrow">${escape(attempt.name||rules.name)}</span><h2>${this.workspaceError?'Account data could not be loaded':'Opening your account…'}</h2><p>${escape(this.workspaceError||'Loading this account’s saved trades, balance and objectives.')}</p></section>`:this.renderAccountDashboard(attempt,rules,summary)):'<section class="prop-account-empty"><span class="propfirm-eyebrow">PROP FIRM PRACTICE</span><h2>Select your practice account</h2><p>Choose an account from the list or create a Standard / Pro round. Each round has its own XAUUSD chart, trades, replay and objectives.</p><button id="propEmptyCreate" class="propfirm-primary">Create practice account</button></section>'}</div>
        ${this.creating?`<div class="prop-create-backdrop"><section class="prop-create-dialog" role="dialog" aria-modal="true" aria-label="Create prop practice account"><header><div><span class="propfirm-eyebrow">NEW PRACTICE ACCOUNT</span><h2>Choose your evaluation</h2></div><button class="propfirm-secondary" id="propCloseCreate" aria-label="Close account creation">×</button></header>${createMarkup}</section></div>`:''}
      </section>`;
    },
    render() {
      this.load();
      const attempt=this.selected()||this.practiceAttempt();
      if(attempt?.status==='active'&&!attempt.archived&&(!window.PropPracticeWorkspace||window.PropPracticeWorkspace.hasState(attempt))) this.evaluate(attempt);
      const rules=attempt?this.rulesFor(attempt):MODELS[this.model];
      const summary=attempt?this.summary(attempt):null;
      const createMarkup=this.renderCreation();
      return this.renderPortal(createMarkup,attempt,rules,summary);
    },
    renderCreation() {
      const plan=window.SubscriptionSystem?.getUserPlan?.();
      const atLimit=Boolean(plan && !window.SubscriptionSystem.canCreatePerformanceSession(this.attempts.length));
      const quota=plan?`Plan quota: ${this.attempts.length}/${plan.performanceSessionLimit} performance sessions · ${plan.name}`:'';
      return `<section class="propfirm-card propfirm-create"><div class="propfirm-section-head"><div><span class="propfirm-eyebrow">CREATE PERFORMANCE SESSION</span><h3>Add a practice session</h3><p>Create independent XAUUSD evaluation sessions. Your plan controls how many you can create.</p><p class="propfirm-muted">${escape(quota)}</p></div><span class="propfirm-badge">XAUUSD PRACTICE</span></div><div class="propfirm-plan-grid">${Object.entries(MODELS).map(([code, model]) => `<button type="button" class="propfirm-plan-card ${code === "pro" ? "pro" : "standard"} ${this.model === code ? "selected" : ""}" data-select-model="${code}" aria-pressed="${this.model === code}"><span class="propfirm-plan-kicker">${code === "pro" ? "2 STEP PRO" : "2 STEP STANDARD"}</span><b class="propfirm-plan-title">${code === "pro" ? "Lean, Fast Efficient" : "Maximum Drawdown Space"}</b><span class="propfirm-plan-summary">${code === "pro" ? "Lower daily loss limit · built for focused traders" : "More breathing room · higher overall drawdown"}</span><span class="propfirm-plan-metrics"><span>Phase 1 target <b>${model.targets[1]}%</b></span><span>Phase 2 target <b>${model.targets[2]}%</b></span><span>Daily loss limit <b>${code === "standard" ? this.standardDailyLoss : model.dailyLossPct}%</b></span><span>Max drawdown <b>${model.maxLossPct}% static</b></span><span>Leverage reference <b>up to 1:100</b></span><span>Min. trading days <b>${code === "standard" ? this.standardMinDays : model.minDays} / phase</b></span></span><span class="propfirm-plan-select">${this.model === code ? "Selected" : "Select this model"} <i>→</i></span></button>`).join("")}</div><div class="propfirm-create-grid"><label>Challenge model<select id="propFirmModel"><option value="standard" ${this.model === "standard" ? "selected" : ""}>2 Step Standard</option><option value="pro" ${this.model === "pro" ? "selected" : ""}>2 Step Pro</option></select></label><label>Virtual starting balance<select id="propFirmSize">${MODELS[this.model].sizes.map(size => `<option value="${size}" ${Number(this.size) === size ? "selected" : ""}>${money(size)}</option>`).join("")}</select></label><label ${this.model !== 'standard' ? 'hidden' : ''}>Standard daily loss<select id="propStandardLoss"><option value="3" ${this.standardDailyLoss === 3 ? 'selected' : ''}>3%</option><option value="5" ${this.standardDailyLoss === 5 ? 'selected' : ''}>5%</option></select></label><label ${this.model !== 'standard' ? 'hidden' : ''}>Minimum trading days<select id="propStandardDays"><option value="0" ${this.standardMinDays === 0 ? 'selected' : ''}>0 per phase</option><option value="3" ${this.standardMinDays === 3 ? 'selected' : ''}>3 per phase</option></select></label><button class="propfirm-primary" id="propFirmStart" ${atLimit?'disabled':''}>Create performance session <span>→</span></button></div><div class="propfirm-rule-preview" id="propFirmRulePreview">${this.model === "standard" ? `Phase 1 target 8% · Phase 2 target 5% · Daily loss ${this.standardDailyLoss}% · Max loss 10% · ${this.standardMinDays} minimum trading days per phase` : "Phase 1 and 2 target 6% · Daily loss 3% · Max loss 6% · No minimum trading days"} · 14 calendar days per phase</div></section>`;
    },
    renderAccounts() {
      const rows = this.filteredAccounts(), f = this.filters;
      const select = (key, label, values) => `<label>${label}<select data-prop-filter="${key}">${values.map(([v,l]) => `<option value="${v}" ${f[key] === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
      return `<section class="propfirm-card"><div class="propfirm-section-head"><div><span class="propfirm-eyebrow">YOUR ACCOUNTS</span><h3>Practice accounts (${this.attempts.length})</h3><p>${rows.length} matching · Archived accounts retain their trades, drawings and replay.</p></div></div><div class="propfirm-filters"><label>Search accounts<input id="propAccountSearch" value="${escape(f.search)}" placeholder="Name, balance or account ID"></label>${select('model','Model',[['all','All models'],['standard','Standard'],['pro','Pro']])}${select('status','Status',[['all','All statuses'],['active','In progress'],['phase-ready','Phase ready'],['passed','Passed'],['failed','Breached'],['expired','Expired']])}${select('phase','Phase',[['all','All phases'],['1','Phase 1'],['2','Phase 2']])}${select('archive','Accounts',[['active','Current'],['archived','Archived'],['all','All accounts']])}</div><div id="propAccountResults"><div class="propfirm-account-grid">${rows.map(item => {
        const summary = this.summary(item), rules = this.rulesFor(item), loaded=!window.PropPracticeWorkspace||window.PropPracticeWorkspace.hasState(item);
        return `<article class="propfirm-account-item"><button class="propfirm-account-card ${item.id === this.selectedId ? 'selected' : ''}" data-prop-attempt="${escape(item.id)}"><span class="propfirm-account-card-top"><b>${item.archived ? 'Archived' : escape(item.status)}</b><span>Phase ${item.phase}</span></span><b>${escape(item.name || rules.name)}</b><small>${escape(rules.name)} · ${money(item.startingBalance)} · ${rules.dailyLossPct}% daily · ${rules.minDays} days</small><span class="propfirm-account-balance"><b>${loaded?money(item.startingBalance + summary.closedPnl):'Loading…'}</b><b class="${summary.pnl >= 0 ? 'positive' : 'negative'}">${loaded?money(summary.pnl):'—'}</b></span><span class="propfirm-account-progress"><i style="width:${summary.targetProgress}%"></i></span><small>Target ${summary.targetPct}% · ${loaded?summary.targetProgress.toFixed(1)+'%':'Ledger not loaded'}</small><small>${escape(item.id)}</small></button><button type="button" class="propfirm-secondary" data-prop-archive="${escape(item.id)}">${item.archived ? 'Restore' : 'Archive'}</button></article>`;
      }).join('')}</div>${rows.length ? '' : '<p class="propfirm-empty-inline">No accounts match these filters.</p>'}</div></section>`;
    },
    afterRender(container) {
      this.load();
      const scope = this._scope;
      const missing = window.PropPracticeWorkspace ? this.attempts.filter(item => !window.PropPracticeWorkspace.hasState(item)) : [];
      if (missing.length && !this.workspaceError) {
        const status=container.querySelector('#propWorkspaceStatus'); if(status)status.textContent='Loading account ledgers…';
        Promise.all(missing.map(item => window.PropPracticeWorkspace.ensure(item))).then(() => {
          this.workspaceError=null;
          if (window.Router.current === 'prop-firm-session' && this._scope === scope) this.refreshView();
        }).catch(error => {
          if (this._scope !== scope || window.Router.current !== 'prop-firm-session') return;
          this.workspaceError=error.message||'Unable to load saved account data.';
          this.refreshView();
        });
      }
      this.load();
      window.PropPracticeAnalytics?.bind(container, this);
      container.querySelector('#propRetryAccounts')?.addEventListener('click',()=>{this.workspaceError=null;this.refreshView();});
      const openCreate=()=>{this.creating=true;this.refreshView();};
      container.querySelector('#propOpenCreate')?.addEventListener('click',openCreate);
      container.querySelector('#propEmptyCreate')?.addEventListener('click',openCreate);
      container.querySelector('#propCloseCreate')?.addEventListener('click',()=>{this.creating=false;this.refreshView();});
      container.querySelector('.prop-create-backdrop')?.addEventListener('click',event=>{if(event.target===event.currentTarget){this.creating=false;this.refreshView();}});
      container.querySelector('.prop-create-dialog')?.addEventListener('keydown',event=>{if(event.key==='Escape'){event.stopPropagation();this.creating=false;this.refreshView();}});
      if(this.creating) container.querySelector('#propFirmModel')?.focus();
      container.querySelectorAll('[data-prop-overview-route]').forEach(button=>button.addEventListener('click',()=>window.Router.go(button.dataset.propOverviewRoute)));
      container.querySelector('#propRenameForm')?.addEventListener('submit', event => {
        event.preventDefault(); const result = this.rename(this.selectedId, container.querySelector('#propAccountName').value);
        if (result.ok) this.refreshView(); else container.querySelector('#propManageStatus').textContent = result.message;
      });
      const archive = async id => {
        const attempt = this.attempts.find(a => a.id === id);
        try { if (window.PropPracticeWorkspace) { const context = await PropPracticeWorkspace.ensure(attempt); await context.store.refresh(); } } catch(error) { window.UI?.showToast?.(error.message, 'error'); return; }
        const result = this.archive(id, !attempt.archived);
        if (result.ok) this.refreshView(); else window.UI?.showToast?.(result.message, 'info');
      };
      container.querySelector('#propArchive')?.addEventListener('click', () => archive(this.selectedId));
      container.querySelectorAll('[data-prop-archive]').forEach(button => button.addEventListener('click', () => archive(button.dataset.propArchive)));
      container.querySelectorAll('[data-prop-filter]').forEach(input => input.addEventListener('change', () => {this.filters[input.dataset.propFilter] = input.value; this.refreshView();}));
      container.querySelector('#propAccountSearch')?.addEventListener('input', event => {
        this.filters.search = event.target.value;
        const start = event.target.selectionStart;
        this.refreshView();
        const input = document.querySelector('#propAccountSearch'); input?.focus(); input?.setSelectionRange(start,start);
      });
      this.bindCreation(container);
      container.querySelector("#propFirmChart")?.addEventListener("click", () => window.Router.go("prop-chart"));
      container.querySelector("#propFirmOpenChart")?.addEventListener("click", () => window.Router.go("prop-chart"));
      container.querySelector("#propFirmAdvance")?.addEventListener("click", () => { this.advance(); window.Router.go("prop-firm-session"); });
      container.querySelector("#propFirmNewRound")?.addEventListener("click", () => { this.selectedId = null; this.save(); window.Router.go("prop-firm-session"); });
      container.querySelectorAll("[data-prop-attempt]").forEach(button => button.addEventListener("click", () => { this.activate(button.dataset.propAttempt); window.Router.go("prop-firm-session"); }));
    },
    bindCreation(container) {
      container.querySelector('#propStandardLoss')?.addEventListener('change', event => {this.standardDailyLoss=Number(event.target.value);this.refreshView();});
      container.querySelector('#propStandardDays')?.addEventListener('change', event => {this.standardMinDays=Number(event.target.value);this.refreshView();});
      const model = container.querySelector("#propFirmModel");
      const size = container.querySelector("#propFirmSize");
      container.querySelectorAll("[data-select-model]").forEach(button => button.addEventListener("click", () => {
        this.model = button.dataset.selectModel;
        const allowed = MODELS[this.model].sizes;
        if (!allowed.includes(Number(this.size))) this.size = allowed[0];
        this.refreshView();
      }));
      model?.addEventListener("change", () => { this.model=model.value; if (!MODELS[this.model].sizes.includes(this.size)) this.size=MODELS[this.model].sizes[0]; this.refreshView(); });
      size?.addEventListener("change", () => { this.size = Number(size.value); });
      container.querySelector("#propFirmStart")?.addEventListener("click", () => {
        const result = this.create(model?.value || this.model, Number(size?.value || this.size));
        if (!result.ok) { window.UI?.showToast?.(result.message, "info"); return; }
        this.creating=false;
        window.Router.go("prop-firm-session");
      });
    },
    refreshView() { if (["prop-firm-session","accounts"].includes(window.Router?.current)) window.Router.go(window.Router.current); },
  };

  window.PagePropFirmSession = PagePropFirmSession;
  window.PropFirmSession = PagePropFirmSession;
  window.PropFirmRules = MODELS;
  window.addEventListener("hashchange", () => PagePropFirmSession.syncChartBadge());
  window.Store?.subscribe?.(() => PagePropFirmSession.sync());
})();
