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
      try {
        const stored = JSON.parse(localStorage.getItem(this.storageKey()) || "{}");
        this.attempts = Array.isArray(stored.attempts) ? stored.attempts : [];
        this.selectedId = stored.selectedId || this.attempts.find(a => ["active", "phase-ready"].includes(a.status))?.id || this.attempts[0]?.id || null;
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
      const baseline = new Set(attempt.phaseBaselineKeys || []);
      const closed = (state?.history || []).filter(t => !baseline.has(tradeKey(t)));
      const open = (state?.active_trades || []).filter(t => !baseline.has(tradeKey(t)));
      return { closed, open };
    },
    summary(attempt = this.selected(), state = window.Store?.state || {}) {
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
      const active = this.practiceAttempt();
      if (active) return { ok: false, message: "Finish or breach the current round before starting another." };
      const rules = MODELS[model];
      const amount = Number(size);
      if (!rules || !rules.sizes.includes(amount)) return { ok: false, message: "Choose a supported account size." };
      const state = window.Store?.state || {};
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
        attempt.phaseBaselineKeys = this.baselineKeys(window.Store?.state || {});
        attempt.dailyBaselines = {};
        attempt.lastMarketTimestamp = null;
      }
      this.save();
      return { ok: true, attempt };
    },
    activate(attemptId) { this.selectedId = attemptId; this.save(); },
    evaluate(attempt = this.practiceAttempt(), state = window.Store?.state || {}) {
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
      } else if (summary.pnl >= summary.target && summary.tradingDaysNeeded === 0) {
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
    onMarketCandle(time, state = window.Store?.state || {}) {
      this.currentMarketTime = Number(time) || timestamp(time);
      this.load();
      const attempt = this.practiceAttempt();
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
      return this.evaluate(attempt, state);
    },
    canTradeAt(time, symbol = "") {
      const attempt = this.practiceAttempt();
      if (!attempt) return { ok: true };
      if (attempt.status !== "active") return { ok: false, message: attempt.status === "phase-ready" ? "This phase met its target. Start the next phase from Prop Firm Session." : `This round is ${attempt.status}. Start a new practice round to place more trades.` };
      const ms = timestamp(time);
      if (attempt.lastMarketTimestamp && ms != null && ms < attempt.lastMarketTimestamp) return { ok: false, message: "Practice trades must follow replay time. Move the replay forward before placing an order." };
      const otherSymbol = this.summary(attempt).open.find(trade => trade.symbol && trade.symbol !== symbol)?.symbol;
      if (otherSymbol) return { ok: false, message: `Close the active ${otherSymbol} practice position before placing a ${symbol} trade.` };
      return { ok: true, attempt };
    },
    sync() {
      if (this._scope !== accountScope()) this.load();
      const attempt = this.practiceAttempt();
      if (attempt?.status === "active") this.evaluate(attempt);
      else this.syncChartBadge();
    },
    syncChartBadge() {
      const node = document.querySelector("#propFirmChartBadge");
      if (!node) return;
      const attempt = this.practiceAttempt();
      if (!attempt) { node.hidden = true; return; }
      const summary = this.summary(attempt);
      node.hidden = false;
      node.dataset.status = attempt.status;
      node.textContent = `${MODELS[attempt.model].name} · Phase ${attempt.phase} · Equity ${money(summary.equity)}`;
      node.title = attempt.status === "phase-ready" ? "Phase objective met; advance from Prop Firm Session." : "Orders placed on the chart are scored in this practice round.";
    },
    render() {
      this.load();
      const attempts = this.attempts;
      const selected = this.selected();
      const attempt = selected || this.practiceAttempt();
      if (attempt?.status === "active") this.evaluate(attempt);
      const activeExists = Boolean(this.practiceAttempt());
      const rules = attempt ? MODELS[attempt.model] : MODELS[this.model];
      const summary = attempt ? this.summary(attempt) : null;
      const daysLeft = summary ? Math.ceil(summary.remainingMs / DAY_MS) : null;
      const clock = ms => { const d = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(d / 86400)}d ${String(Math.floor(d % 86400 / 3600)).padStart(2,"0")}h ${String(Math.floor(d % 3600 / 60)).padStart(2,"0")}m`; };
      const statusLabel = status => ({ active: "In progress", "phase-ready": "Phase objective met", passed: "Passed · practice only", failed: "Breached", expired: "Expired" }[status] || status);
      const progress = (value, max) => Math.max(0, Math.min(100, (value / max) * 100));
      return `<section class="propfirm-page">
        <header class="propfirm-hero"><div><span class="propfirm-eyebrow">INTENSEFXTRADES · SIMULATED EVALUATION</span><h2>Prop Firm Session</h2><p>Practice evaluation rounds using the existing chart, replay, and simulated orders. Choose a model, trade by its published objectives, and review each attempt.</p></div><div class="propfirm-hero-mark"><b>PF</b><span>Practice mode</span></div></header>
        <div class="propfirm-notice"><b>Independent practice simulator.</b> Rule values below reference the provider’s public Free Trial rules. Trade execution and market conditions come from TradeFXBook’s local replay engine; this does not create a provider account, copy live credentials, or guarantee identical spreads, leverage, commissions, or fills.</div>
        ${!attempt || !["active", "phase-ready"].includes(attempt.status) ? `<section class="propfirm-card propfirm-create"><div class="propfirm-section-head"><div><span class="propfirm-eyebrow">START A ROUND</span><h3>Choose your practice challenge</h3><p>One active round at a time per TradeFXBook account. Completed attempts remain in your history.</p></div><span class="propfirm-badge">FREE PRACTICE</span></div><div class="propfirm-create-grid"><label>Challenge model<select id="propFirmModel"><option value="standard" ${this.model === "standard" ? "selected" : ""}>2 Step Standard</option><option value="pro" ${this.model === "pro" ? "selected" : ""}>2 Step Pro</option></select></label><label>Virtual starting balance<select id="propFirmSize">${MODELS[this.model].sizes.map(size => `<option value="${size}" ${Number(this.size) === size ? "selected" : ""}>${money(size)}</option>`).join("")}</select></label><button class="propfirm-primary" id="propFirmStart" ${activeExists ? "disabled" : ""}>Start practice round <span>→</span></button></div><div class="propfirm-rule-preview" id="propFirmRulePreview">${this.model === "standard" ? "Phase 1 target 8% · Phase 2 target 5% · Daily loss 5% · Max loss 10% · 3 minimum trading days per phase" : "Phase 1 and 2 target 6% · Daily loss 3% · Max loss 6% · 2 minimum trading days per phase"} · 14 calendar days per phase</div></section>` : ""}
        ${attempt && ["active", "phase-ready"].includes(attempt.status) ? `<section class="propfirm-active-card"><div class="propfirm-active-head"><div><span class="propfirm-eyebrow">${escape(rules.name.toUpperCase())} · $${(attempt.startingBalance / 1000).toLocaleString()}K PRACTICE</span><h3>${attempt.status === "phase-ready" ? "Phase objective reached" : `Phase ${attempt.phase} · ${attempt.phase === 1 ? "Evaluation" : "Verification"}`}</h3><div class="propfirm-status-pill" data-status="${attempt.status}"><i></i>${statusLabel(attempt.status)}</div></div><button class="propfirm-primary" id="propFirmChart">${attempt.status === "phase-ready" ? "Manage phase →" : "Practice on chart →"}</button></div><div class="propfirm-stats-grid"><article><span>Virtual equity</span><b>${money(summary.equity)}</b><small>Balance ${money(attempt.startingBalance + summary.closedPnl)} · Open P&amp;L ${money(summary.floating)}</small></article><article><span>Phase P&amp;L</span><b class="${summary.pnl >= 0 ? "positive" : "negative"}">${summary.pnl >= 0 ? "+" : ""}${money(summary.pnl)}</b><small>${summary.closed.length} closed · ${summary.open.length} open</small></article><article><span>Daily loss allowance</span><b>${money(Math.max(0, Math.max(summary.balanceAtDayStart, summary.dailyFloor == null ? summary.balanceAtDayStart : summary.dailyFloor + Math.max(summary.balanceAtDayStart, summary.dailyFloor) * rules.dailyLossPct / 100) * rules.dailyLossPct / 100 - summary.dailyDrawdown))}</b><small>${rules.dailyLossPct}% · reset 00:00 UTC+3</small></article><article><span>Phase time remaining</span><b>${daysLeft} days</b><small>${clock(summary.remainingMs)} · no pause or extension</small></article></div><div class="propfirm-progress-grid"><article><div class="propfirm-progress-label"><span>Profit target · ${rules.targets[attempt.phase]}%</span><b>${money(Math.max(0, summary.pnl))} / ${money(summary.target)}</b></div><div class="propfirm-progress-track"><i style="width:${summary.targetProgress}%"></i></div></article><article class="loss-progress"><div class="propfirm-progress-label"><span>Maximum total loss · ${rules.maxLossPct}%</span><b>${money(summary.maxDrawdown)} / ${money(attempt.startingBalance * rules.maxLossPct / 100)}</b></div><div class="propfirm-progress-track"><i style="width:${progress(summary.maxDrawdown, attempt.startingBalance * rules.maxLossPct / 100)}%"></i></div></article></div><div class="propfirm-objectives"><span>ROUND OBJECTIVES</span><div><i class="${summary.targetProgress >= 100 ? "done" : ""}">${summary.targetProgress >= 100 ? "✓" : "1"}</i><span>Reach ${rules.targets[attempt.phase]}% phase profit target</span></div><div><i class="${summary.tradingDaysNeeded === 0 ? "done" : ""}">${summary.tradingDaysNeeded === 0 ? "✓" : "2"}</i><span>${rules.minDays} minimum trading days <small>(${summary.tradedDays.length} completed)</small></span></div><div><i>3</i><span>Stay above the daily and max loss floors</span></div></div>${attempt.status === "phase-ready" ? `<div class="propfirm-phase-success"><div><b>${attempt.phase === 2 ? "Both practice phases passed" : "Phase 1 complete"}</b><span>${attempt.phase === 2 ? "Your simulated evaluation is complete. Practice only; no funded account is created." : "Start Phase 2 to continue this practice attempt."}</span></div><button class="propfirm-primary" id="propFirmAdvance">${attempt.phase === 2 ? "Finish round" : "Start Phase 2 →"}</button></div>` : ""}<div class="propfirm-active-foot">Started ${new Date(attempt.phaseStartedAt).toLocaleString()} · daily loss is measured against the higher of day-opening balance or equity · no automatic extension</div></section>` : ""}
        ${attempt && ["passed", "failed", "expired"].includes(attempt.status) ? `<section class="propfirm-result-card" data-status="${attempt.status}"><div><span class="propfirm-eyebrow">ROUND ${escape(statusLabel(attempt.status).toUpperCase())}</span><h3>${attempt.status === "passed" ? "Practice evaluation complete" : attempt.status === "expired" ? "Phase time limit reached" : "Loss rule breached"}</h3><p>${escape(attempt.breachReason || "Both phases met their objectives. This result is for practice only.")}</p><b>Final virtual equity · ${money(summary.equity)}</b></div><button class="propfirm-secondary" id="propFirmNewRound">Start another round</button></section>` : ""}
        <section class="propfirm-card"><div class="propfirm-section-head"><div><span class="propfirm-eyebrow">MODEL RULES</span><h3>Round objectives at a glance</h3><p>The selected model uses different drawdown and target thresholds.</p></div></div><div class="propfirm-model-grid">${Object.entries(MODELS).map(([code, model]) => `<article class="propfirm-model-card ${attempt?.model === code || (!attempt && this.model === code) ? "selected" : ""}"><div><b>${escape(model.name)}</b><span>${model.sizes.map(x => `$${x/1000}K`).join(" · ")}</span></div><div class="propfirm-model-metrics"><span>Daily loss <b>${model.dailyLossPct}%</b></span><span>Max loss <b>${model.maxLossPct}%</b></span><span>Phase 1 target <b>${model.targets[1]}%</b></span><span>Phase 2 target <b>${model.targets[2]}%</b></span><span>Min. active days <b>${model.minDays} / phase</b></span><span>Time limit <b>14 calendar days / phase</b></span></div></article>`).join("")}</div><p class="propfirm-rule-footnote">Daily loss is based on the higher day-opening balance or equity and resets at 00:00 platform time (UTC+3). Maximum loss is static from starting balance. Open-position floating loss counts toward both limits.</p></section>
        <section class="propfirm-card"><div class="propfirm-section-head"><div><span class="propfirm-eyebrow">YOUR ROUNDS</span><h3>Practice history <small>(${attempts.length})</small></h3><p>Attempts are saved in this browser and separated by your active TradeFXBook account.</p></div></div>${attempts.length ? `<div class="propfirm-history-list">${attempts.map(item => { const r=MODELS[item.model];const active=["active","phase-ready"].includes(item.status);return `<button class="propfirm-history-row ${item.id===attempt?.id?"selected":""}" data-prop-attempt="${escape(item.id)}"><span class="propfirm-history-icon ${item.model}">${item.model === "pro" ? "P" : "S"}</span><span class="propfirm-history-name"><b>${escape(r.name)} · ${money(item.startingBalance)}</b><small>Phase ${item.phase} · ${new Date(item.startedAt).toLocaleDateString()}</small></span><span class="propfirm-history-status" data-status="${item.status}">${escape(statusLabel(item.status))}</span><span>›</span></button>`;}).join("")}</div>` : `<div class="propfirm-empty"><span>◎</span><b>No practice rounds yet</b><p>Choose a model and account size to start your first simulated evaluation.</p></div>`}</section>
        <section class="propfirm-disclaimer"><b>How chart trades are scored</b><p>When a round is active, new simulated orders from Backtesting are included in that round. They are still recorded in the currently selected TradeFXBook demo account’s trade history. The round’s virtual starting balance and objectives are tracked separately and are not a provider account. FXN/session overlays are not used to determine prop-firm trading days; the round follows UTC+3 platform-day boundaries.</p></section>
      </section>`;
    },
    afterRender(container) {
      this.load();
      const model = container.querySelector("#propFirmModel");
      const size = container.querySelector("#propFirmSize");
      model?.addEventListener("change", () => {
        this.model = model.value;
        const allowed = MODELS[this.model].sizes;
        if (!allowed.includes(Number(this.size))) this.size = allowed[0];
        if (size) size.innerHTML = allowed.map(n => `<option value="${n}" ${n === Number(this.size) ? "selected" : ""}>${money(n)}</option>`).join("");
        const preview = container.querySelector("#propFirmRulePreview");
        if (preview) preview.textContent = this.model === "standard" ? "Phase 1 target 8% · Phase 2 target 5% · Daily loss 5% · Max loss 10% · 3 minimum trading days per phase · 14 calendar days per phase" : "Phase 1 and 2 target 6% · Daily loss 3% · Max loss 6% · 2 minimum trading days per phase · 14 calendar days per phase";
      });
      size?.addEventListener("change", () => { this.size = Number(size.value); });
      container.querySelector("#propFirmStart")?.addEventListener("click", () => {
        const result = this.create(model?.value || this.model, Number(size?.value || this.size));
        if (!result.ok) { window.UI?.showToast?.(result.message, "info"); return; }
        window.Router.go("prop-firm-session");
      });
      container.querySelector("#propFirmChart")?.addEventListener("click", () => window.Router.go("backtesting"));
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
