/* page_ai_coach.js - analytics-driven AI Coach view.
   Uses local trade analytics only; no external AI service or backend changes. */

const PageAICoach = {
  get store() { return this._store || Store; },
  render() {
    const snap = TradeAnalyticsEngine.snapshot(this.store.state);
    const m = snap.performance;
    const r = snap.risk;
    const weakSession = snap.sessions.at(-1);
    const bestSession = snap.sessions[0];
    const weakSymbol = snap.symbols.at(-1);
    const bestSymbol = snap.symbols[0];
    const weakStrategy = snap.strategies.at(-1);
    const emotionDrag = snap.emotions.find((e) => e.trades && e.profit < 0);
    const rules = this.rules(snap);

    return `
      <div class="section-title" style="font-size:19px;margin-bottom:2px">${this.svgCoach()} AI Coach</div>
      <div class="section-sub" style="margin-bottom:18px">Rule-based review of your trading history · calculated locally, no AI model connected</div>

      <div class="grid grid-4" style="margin-bottom:16px">
        ${this.scoreCard("Edge", this.edgeScore(m), `${m.profitFactor && isFinite(m.profitFactor) ? m.profitFactor.toFixed(2) : "0.00"} PF`)}
        ${this.scoreCard("Risk", Math.round(r.riskConsistency || 0), `${Fmt.money(r.averageRisk)} avg risk`)}
        ${this.scoreCard("Discipline", this.disciplineScore(snap), `${snap.trades.filter((t) => Object.keys(t.checklist || {}).length).length} checked trades`)}
        ${this.scoreCard("Review", this.reviewScore(snap), `${snap.trades.filter((t) => t.journalEntries?.length).length} journaled`)}
      </div>

      <div class="grid row-2-1" style="align-items:start;margin-bottom:16px">
        <div class="card">
          <div class="section-title" style="margin-bottom:12px">Coach Insights</div>
          ${snap.insights.map((i) => `<div class="coach-insight ${i.severity}"><b>${i.title}</b><span>${i.body}</span></div>`).join("") || emptyState("No insight yet", "Close more trades to build your coach profile.")}
        </div>
        <div class="card">
          <div class="section-title" style="margin-bottom:12px">Current Read</div>
          ${this.metricList([
            ["Net Profit", Fmt.money(m.netProfit)],
            ["Win Rate", `${m.winRate.toFixed(1)}%`],
            ["Expectancy", Fmt.money(m.expectancy)],
            ["Max Drawdown", Fmt.money(m.maxDrawdown)],
            ["Best Session", bestSession?.name || "--"],
            ["Weak Session", weakSession?.name || "--"],
          ])}
        </div>
      </div>

      <div class="grid grid-3" style="margin-bottom:16px">
        ${this.patternCard("Best Behavior", [
          ["Session", bestSession?.name || "--"],
          ["Symbol", bestSymbol?.name || "--"],
          ["Strategy", snap.strategies[0]?.name || "--"],
        ])}
        ${this.patternCard("Main Drag", [
          ["Session", weakSession?.name || "--"],
          ["Symbol", weakSymbol?.name || "--"],
          ["Strategy", weakStrategy?.name || "--"],
        ])}
        ${this.patternCard("Psychology", [
          ["Weak Emotion", emotionDrag?.name || "--"],
          ["Emotion P&L", emotionDrag ? Fmt.money(emotionDrag.profit) : "--"],
          ["Journal Coverage", `${this.reviewScore(snap)}%`],
        ])}
      </div>

      <div class="card">
        <div class="section-title" style="margin-bottom:12px">Next Trading Rules</div>
        <div class="coach-rules">
          ${rules.map((rule, i) => `<div><b>${i + 1}</b><span>${rule}</span></div>`).join("")}
        </div>
      </div>
    `;
  },

  scoreCard(label, score, sub) {
    const pct = Math.max(0, Math.min(100, Number(score) || 0));
    return `<div class="kpi-card coach-score-card">
      <div class="kpi-label">${label}</div>
      <div class="coach-score">${pct}<span>%</span></div>
      <div class="kpi-bar"><div class="kpi-bar-fill" style="width:${pct}%"></div></div>
      <div class="kpi-sub">${sub}</div>
    </div>`;
  },

  patternCard(title, rows) {
    return `<div class="card"><div class="section-title" style="margin-bottom:10px">${title}</div>${this.metricList(rows)}</div>`;
  },

  metricList(rows) {
    return `<div class="analytics-list">${rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join("")}</div>`;
  },

  edgeScore(m) {
    const pf = isFinite(m.profitFactor) ? m.profitFactor : 2;
    return Math.round(Math.max(0, Math.min(100, (pf / 2) * 45 + (m.winRate / 100) * 35 + (m.expectancy > 0 ? 20 : 0))));
  },

  disciplineScore(snap) {
    if (!snap.trades.length) return 0;
    const checked = snap.trades.filter((t) => Object.keys(t.checklist || {}).length).length / snap.trades.length;
    const journaled = snap.trades.filter((t) => t.journalEntries?.length).length / snap.trades.length;
    return Math.round((checked * 60 + journaled * 40) * 100);
  },

  reviewScore(snap) {
    if (!snap.trades.length) return 0;
    return Math.round((snap.trades.filter((t) => t.journalEntries?.length).length / snap.trades.length) * 100);
  },

  rules(snap) {
    const rules = [];
    const weakSession = snap.sessions.at(-1);
    const weakStrategy = snap.strategies.at(-1);
    if (snap.performance.profitFactor < 1) rules.push("Reduce risk until profit factor returns above 1.0.");
    if (snap.risk.riskConsistency < 65) rules.push("Use one fixed risk model for the next 20 trades.");
    if (weakSession?.profit < 0) rules.push(`Do not scale size during ${weakSession.name} until it has a positive 10-trade sample.`);
    if (weakStrategy?.profit < 0) rules.push(`Review every ${weakStrategy.name} trade screenshot before taking another setup.`);
    rules.push("Journal each closed trade with mistake, lesson, confidence, and checklist completion.");
    rules.push("Stop trading for the day after two consecutive rule violations.");
    return rules.slice(0, 6);
  },

  svgCoach() {
    return `<svg width="19" height="19" viewBox="0 0 24 24" fill="none"><path d="M12 3l8 4.5v6.8c0 3.2-3.4 5.5-8 6.7-4.6-1.2-8-3.5-8-6.7V7.5L12 3z" stroke="currentColor" stroke-width="1.7"/><path d="M8 12h8M10 15h4M9 9h.01M15 9h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
  },
};

window.PageAICoach = PageAICoach;
