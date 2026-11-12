/* Prop Firm Session: rule-based practice rounds, scored from new chart trades. */
(() => {
  "use strict";

  const DAY_MS = 24 * 60 * 60 * 1000;
  const PLATFORM_OFFSET_MS = 3 * 60 * 60 * 1000;
  const MODELS = {
    standard: { name: "2 Step Standard", kicker: "2 STEP STANDARD", title: "Maximum Drawdown Space", summary: "More breathing room · higher overall drawdown", dailyLossPct: 5, maxLossPct: 10, targets: { 1: 8, 2: 5 }, minDays: 3, sizes: [5000, 10000, 25000, 50000, 100000] },
    pro: { name: "2 Step Pro", kicker: "2 STEP PRO", title: "Lean, Fast Efficient", summary: "Lower daily loss limit · built for focused traders", dailyLossPct: 3, maxLossPct: 6, targets: { 1: 6, 2: 6 }, minDays: 0, sizes: [5000, 10000, 25000, 50000, 100000, 200000] },
    instant: { name: "1 Step Instant", kicker: "1 STEP INSTANT", title: "Single Evaluation, Straight Through", summary: "One phase only · hit the target once, no second round", dailyLossPct: 4, maxLossPct: 8, targets: { 1: 10 }, minDays: 0, sizes: [5000, 10000, 25000, 50000, 100000] },
  };

  // A real prop firm evaluation trades one fixed, unseen stretch of history — never
  // a window the trader chose. Each account is sealed to one random calendar month
  // from the supported local XAUUSD dataset (full months, 2021 through Jan 2026).
  // The two most recent years (2025 and Jan 2026) are 30% more likely to be picked
  // than any other month, and a month already used on one of this account's own
  // practice accounts is never repeated (until every month has been used once).
  const EVAL_MONTHS = (() => {
    const months = [];
    for (let year = 2021; year <= 2025; year++) for (let month = 0; month < 12; month++) months.push({ year, month });
    months.push({ year: 2026, month: 0 }); // Jan 2026: the only complete month of that year in the dataset.
    return months;
  })();
  const RECENT_BOOST = 1.3;
  const isRecentEvalMonth = m => m.year === 2025 || (m.year === 2026 && m.month === 0);
  function pickWeighted(pool) {
    const weights = pool.map(m => isRecentEvalMonth(m) ? RECENT_BOOST : 1);
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = Math.random() * total;
    for (let i = 0; i < pool.length; i++) { roll -= weights[i]; if (roll <= 0) return pool[i]; }
    return pool[pool.length - 1];
  }
  function randomEvaluationWindow(usedMonths = []) {
    const used = new Set(usedMonths.map(m => `${m.year}-${m.month}`));
    let pool = EVAL_MONTHS.filter(m => !used.has(`${m.year}-${m.month}`));
    if (!pool.length) pool = EVAL_MONTHS; // every month already used on this account: allow repeats again
    const { year, month } = pickWeighted(pool);
    return evaluationWindowFor(year, month);
  }
  // Golden VIP only: pick any supported month yourself instead of a random one.
  function evaluationWindowFor(year, month) {
    const start = Date.UTC(year, month, 1, 0, 0, 0);
    const end = Date.UTC(year, month + 1, 1, 0, 0, 0) - 1; // last millisecond of the month
    return { start, end, year, month, label: new Date(start).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }) };
  }

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
      this.customMonth = null;
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
      window.IntenseFXCloudHistory?.schedule?.();
      this.syncChartBadge();
    },
    selected() { return this.attempts.find(a => a.id === this.selectedId) || null; },
    practiceAttempt() { return this.attempts.find(a => !a.archived && (a.status === "active" || a.status === "phase-ready")) || null; },
    rulesFor(attempt) { return attempt?.rules || MODELS[attempt?.model || this.model]; },
    isGoldenVip() { return window.SubscriptionSystem?.getUserPlan?.()?.productCode === 'golden_vip'; },
    evalMonthOptions() { return EVAL_MONTHS; },
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
    remove(id) {
      const i = this.attempts.findIndex(a => a.id === id);
      if (i < 0) return {ok:false, message:'Account not found.'};
      this.attempts.splice(i, 1);
      if (this.selectedId === id) this.selectedId = this.attempts.find(a => !a.archived)?.id || this.attempts[0]?.id || null;
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
      const rules = MODELS[model];
      const amount = Number(size);
      if (!rules || !rules.sizes.includes(amount)) return { ok: false, message: "Choose a supported account size." };
      const dailyLossPct = model === 'standard' ? Number(options.dailyLossPct ?? this.standardDailyLoss) : rules.dailyLossPct;
      const minDays = model === 'standard' ? Number(options.minDays ?? this.standardMinDays) : rules.minDays;
      if ((model === 'standard' && (![3,5].includes(dailyLossPct) || ![0,3].includes(minDays)))) return {ok:false, message:'Choose a supported Standard rule variant.'};
      // Golden VIP can pick its own month instead of a random one; everyone
      // else's choice is ignored (re-checked here, not just hidden in the UI).
      let evaluationWindow = null;
      if (options.customMonth && this.isGoldenVip()) {
        const [y, m] = String(options.customMonth).split("-").map(Number);
        if (EVAL_MONTHS.some(em => em.year === y && em.month === m)) evaluationWindow = evaluationWindowFor(y, m);
      }
      if (!evaluationWindow) evaluationWindow = randomEvaluationWindow(this.attempts.map(a => a.evaluationWindow).filter(Boolean));
      const state = window.PropPracticeWorkspace ? {} : (window.Store?.state || {});
      const now = Date.now();
      const attempt = { id: `practice-${now}-${Math.random().toString(36).slice(2, 8)}`, model, startingBalance: amount,
        rules: { ...rules, dailyLossPct, minDays, targets: {...rules.targets} }, archived: false,
        name: `${rules.name} ${this.attempts.length + 1}`, phase: 1, status: "active", startedAt: new Date(now).toISOString(), phaseStartedAt: new Date(now).toISOString(),
        deadlineAt: new Date(now + 14 * DAY_MS).toISOString(), phaseBaselineKeys: this.baselineKeys(state), dailyBaselines: {},
        lastMarketTimestamp: null, breachReason: "", completedAt: null,
        evaluationWindow };
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
    activate(attemptId) { this.workspaceError = null; this.selectedId = attemptId; this.currentMarketTime = timestamp(this.selected()?.lastMarketTimestamp); this.save(); },
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
        // Like a real evaluation: hitting the target advances the account
        // immediately — no manual "Start Phase 2" click required. A 1-step
        // model (no phase 2 target) or an account already on its final
        // phase goes straight to "passed" instead.
        if (attempt.phase === 2 || !this.rulesFor(attempt).targets[2]) {
          attempt.status = "passed";
          attempt.completedAt = new Date().toISOString();
        } else {
          attempt.phase = 2;
          attempt.status = "active";
          attempt.phaseStartedAt = new Date().toISOString();
          attempt.deadlineAt = new Date(Date.now() + 14 * DAY_MS).toISOString();
          attempt.phaseBaselineKeys = window.PropPracticeWorkspace ? [] : this.baselineKeys(state);
          attempt.dailyBaselines = {};
          attempt.lastMarketTimestamp = null;
          if (attempt.id === this.selectedId) this.currentMarketTime = null;
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
        ${attempt.archived||['failed','expired','passed','phase-ready'].includes(attempt.status)?`<div class="prop-round-result" role="status">${escape(attempt.archived?'Archived account · Restore it to resume trading.':attempt.breachReason||(attempt.status==='passed'?(rules.targets[2]?'Both practice phases completed successfully.':'Practice evaluation completed successfully.'):attempt.status==='phase-ready'?'Phase objectives met. Start the next phase below.':attempt.status))}</div>`:''}
        <details class="prop-account-settings"><summary>Manage account · Rename / ${attempt.archived?'Restore':'Archive'} / Delete</summary><form id="propRenameForm" class="propfirm-manage-row"><label>Account name<input id="propAccountName" aria-label="Account name" value="${escape(title)}" maxlength="60" required></label><button type="submit" class="propfirm-secondary">Save name</button><button type="button" id="propArchive" class="propfirm-secondary">${attempt.archived?'Restore account':'Archive account'}</button><button type="button" id="propDelete" class="propfirm-secondary" style="color:#f23645">Delete account</button><span role="status" id="propManageStatus"></span></form></details>
        <div class="propfirm-overview-stats"><article><span>Account size</span><b>${money(attempt.startingBalance)}</b></article><article><span>Today's profit</span><b class="${todayPnl>=0?'positive':'negative'}">${money(todayPnl)}</b></article><article><span>Start date</span><b>${new Date(attempt.phaseStartedAt||attempt.startedAt).toLocaleDateString()}</b></article><article><span>End date</span><b>${new Date(attempt.deadlineAt).toLocaleDateString()}</b></article></div>
        ${window.PropPracticeAnalytics?.render(this,attempt,summary)||this.renderEquityChart(attempt,summary)+this.renderObjectives(attempt,summary)}
        <details class="prop-practice-info"><summary>Practice rules and scoring</summary><p>Independent simulation. Daily loss resets at 00:00 UTC+3; the chart can display IST. Drawings, replay and trades belong to this account and phase. Archived accounts retain their records. Provider spreads, execution and private scoring are not reproduced.</p></details>
      </section>`;
    },
    renderPortal(createMarkup, attempt, rules, summary) {
      const current=this.attempts.filter(a=>!a.archived), passed=current.filter(a=>a.status==='passed').length;
      return `<section class="propfirm-page prop-portal">
        <aside class="prop-account-sidebar" aria-label="Prop firm accounts"><header class="prop-account-welcome"><span class="propfirm-eyebrow">YOUR PRACTICE WORKSPACE</span><h2>Prop Firm Accounts</h2><p>${current.length} current · ${passed} passed · ${this.attempts.filter(a=>a.archived).length} archived</p></header><button class="propfirm-primary prop-new-account" id="propOpenCreate">+ New practice account</button><button type="button" class="propfirm-secondary" id="propToggleArchive" style="width:100%;margin-top:8px">${this.filters.archive==='archived'?'← Back to current accounts':`Check archive (${this.attempts.filter(a=>a.archived).length})`}</button><div class="prop-account-load-state" role="status" id="propWorkspaceStatus">${escape(this.workspaceError || '')}</div>${this.workspaceError?'<button class="propfirm-secondary" id="propRetryAccounts">Retry account data</button>':''}${this.renderAccounts()}<div class="prop-account-rail-links"><button data-prop-overview-route="prop-chart">XAUUSD practice chart →</button><button data-prop-overview-route="prop-performance">Performance →</button><button data-prop-overview-route="prop-trade-analysis">Trade Analysis →</button><button data-prop-overview-route="prop-ai-coach">AI Coach →</button></div></aside>
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
      const active = MODELS[this.model];
      const dailyLossPctDisplay = this.model === "standard" ? this.standardDailyLoss : active.dailyLossPct;
      const minDaysDisplay = this.model === "standard" ? this.standardMinDays : active.minDays;
      const targetsText = active.targets[2] ? `Phase 1 target ${active.targets[1]}% · Phase 2 target ${active.targets[2]}%` : `Single-phase target ${active.targets[1]}%`;
      return `<section class="propfirm-card propfirm-create"><div class="propfirm-section-head"><div><span class="propfirm-eyebrow">CREATE ACCOUNT</span><h3>Add a practice account</h3><p>Create multiple independent rounds. Each account keeps its own balance, trades, replay, drawings, and objectives.</p></div><span class="propfirm-badge">XAUUSD PRACTICE</span></div><div class="propfirm-plan-grid">${Object.entries(MODELS).map(([code, model]) => `<button type="button" class="propfirm-plan-card ${code} ${this.model === code ? "selected" : ""}" data-select-model="${code}" aria-pressed="${this.model === code}"><span class="propfirm-plan-kicker">${model.kicker}</span><b class="propfirm-plan-title">${model.title}</b><span class="propfirm-plan-summary">${model.summary}</span><span class="propfirm-plan-metrics"><span>${model.targets[2] ? "Phase 1 target" : "Evaluation target"} <b>${model.targets[1]}%</b></span>${model.targets[2] ? `<span>Phase 2 target <b>${model.targets[2]}%</b></span>` : ""}<span>Daily loss limit <b>${code === "standard" ? this.standardDailyLoss : model.dailyLossPct}%</b></span><span>Max drawdown <b>${model.maxLossPct}% static</b></span><span>Leverage reference <b>up to 1:100</b></span><span>Min. trading days <b>${code === "standard" ? this.standardMinDays : model.minDays}${model.targets[2] ? " / phase" : ""}</b></span></span><span class="propfirm-plan-select">${this.model === code ? "Selected" : "Select this model"} <i>→</i></span></button>`).join("")}</div><div class="propfirm-create-grid"><label>Challenge model<select id="propFirmModel">${Object.entries(MODELS).map(([code, model]) => `<option value="${code}" ${this.model === code ? "selected" : ""}>${model.name}</option>`).join("")}</select></label><label>Virtual starting balance<select id="propFirmSize">${MODELS[this.model].sizes.map(size => `<option value="${size}" ${Number(this.size) === size ? "selected" : ""}>${money(size)}</option>`).join("")}</select></label><label ${this.model !== 'standard' ? 'hidden' : ''}>Standard daily loss<select id="propStandardLoss"><option value="3" ${this.standardDailyLoss === 3 ? 'selected' : ''}>3%</option><option value="5" ${this.standardDailyLoss === 5 ? 'selected' : ''}>5%</option></select></label><label ${this.model !== 'standard' ? 'hidden' : ''}>Minimum trading days<select id="propStandardDays"><option value="0" ${this.standardMinDays === 0 ? 'selected' : ''}>0 per phase</option><option value="3" ${this.standardMinDays === 3 ? 'selected' : ''}>3 per phase</option></select></label></div>${this.renderEvalMonthPicker()}<div class="propfirm-create-grid"><button class="propfirm-primary" id="propFirmStart">Create practice account <span>→</span></button></div><div class="propfirm-rule-preview" id="propFirmRulePreview">${targetsText} · Daily loss ${dailyLossPctDisplay}% · Max loss ${active.maxLossPct}% · ${minDaysDisplay} minimum trading days${active.targets[2] ? " per phase" : ""} · 14 calendar days${active.targets[2] ? " per phase" : ""}</div></section>`;
    },
    renderEvalMonthPicker() {
      const names = ["January","February","March","April","May","June","July","August","September","October","November","December"];
      if (!this.isGoldenVip()) {
        return `<p class="propfirm-eval-month-note">Evaluation month: picked at random from 2021–2025 (plus Jan 2026), weighted toward the most recent years. <b>Golden VIP</b> can choose any month instead.</p>`;
      }
      const months = this.evalMonthOptions();
      return `<label class="propfirm-eval-month-picker"><span class="propfirm-badge" style="margin-bottom:6px;display:inline-block">GOLDEN VIP</span><br>Evaluation month<select id="propEvalMonth"><option value="">Random (default)</option>${months.map(m => `<option value="${m.year}-${m.month}" ${this.customMonth === `${m.year}-${m.month}` ? "selected" : ""}>${names[m.month]} ${m.year}</option>`).join("")}</select><small>Choose any of the ${months.length} supported months instead of a random one, for this account.</small></label>`;
    },
    renderAccounts() {
      const rows = this.filteredAccounts(), f = this.filters;
      const select = (key, label, values) => `<label>${label}<select data-prop-filter="${key}">${values.map(([v,l]) => `<option value="${v}" ${f[key] === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
      return `<section class="propfirm-card"><div class="propfirm-section-head"><div><span class="propfirm-eyebrow">YOUR ACCOUNTS</span><h3>Practice accounts (${this.attempts.length})</h3><p>${rows.length} matching · Archived accounts retain their trades, drawings and replay.</p></div></div><div class="propfirm-filters"><label>Search accounts<input id="propAccountSearch" value="${escape(f.search)}" placeholder="Name, balance or account ID"></label>${select('model','Model',[['all','All models'],['standard','Standard'],['pro','Pro'],['instant','Instant']])}${select('status','Status',[['all','All statuses'],['active','In progress'],['phase-ready','Phase ready'],['passed','Passed'],['failed','Breached'],['expired','Expired']])}${select('phase','Phase',[['all','All phases'],['1','Phase 1'],['2','Phase 2']])}${select('archive','Accounts',[['active','Current'],['archived','Archived'],['all','All accounts']])}</div><div id="propAccountResults"><div class="propfirm-account-grid">${rows.map(item => {
        const summary = this.summary(item), rules = this.rulesFor(item), loaded=!window.PropPracticeWorkspace||window.PropPracticeWorkspace.hasState(item);
        return `<article class="propfirm-account-item"><button class="propfirm-account-card ${item.id === this.selectedId ? 'selected' : ''}" data-prop-attempt="${escape(item.id)}"><span class="propfirm-account-card-top"><b>${item.archived ? 'Archived' : escape(item.status)}</b><span>Phase ${item.phase}</span></span><b>${escape(item.name || rules.name)}</b><small>${escape(rules.name)} · ${money(item.startingBalance)} · ${rules.dailyLossPct}% daily · ${rules.minDays} days</small><span class="propfirm-account-balance"><b>${loaded?money(item.startingBalance + summary.closedPnl):'Loading…'}</b><b class="${summary.pnl >= 0 ? 'positive' : 'negative'}">${loaded?money(summary.pnl):'—'}</b></span><span class="propfirm-account-progress"><i style="width:${summary.targetProgress}%"></i></span><small>Target ${summary.targetPct}% · ${loaded?summary.targetProgress.toFixed(1)+'%':'Ledger not loaded'}</small><small>${escape(item.id)}</small></button><button type="button" class="propfirm-secondary" data-prop-archive="${escape(item.id)}">${item.archived ? 'Restore' : 'Archive'}</button><button type="button" class="propfirm-secondary" style="color:#f23645" data-prop-delete="${escape(item.id)}">Delete</button></article>`;
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
      const del = id => {
        const attempt = this.attempts.find(a => a.id === id); if (!attempt) return;
        if (!confirm(`Permanently delete "${attempt.name || this.rulesFor(attempt).name}"? Its account record is removed and this cannot be undone.`)) return;
        const result = this.remove(id);
        if (result.ok) this.refreshView(); else window.UI?.showToast?.(result.message, 'info');
      };
      container.querySelector('#propDelete')?.addEventListener('click', () => del(this.selectedId));
      container.querySelectorAll('[data-prop-delete]').forEach(button => button.addEventListener('click', () => del(button.dataset.propDelete)));
      container.querySelector('#propToggleArchive')?.addEventListener('click', () => { this.filters.archive = this.filters.archive === 'archived' ? 'active' : 'archived'; this.refreshView(); });
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
      container.querySelector("#propEvalMonth")?.addEventListener("change", event => { this.customMonth = event.target.value || null; });
      container.querySelector("#propFirmStart")?.addEventListener("click", () => {
        const result = this.create(model?.value || this.model, Number(size?.value || this.size), { customMonth: this.isGoldenVip() ? this.customMonth : null });
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
