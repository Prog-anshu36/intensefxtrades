/* page_performance.js - Analysis > Performance page */

const PagePerformance = {
  period: "All Time",
  filter: "All Trades",

  render() {
    const history = this.filteredHistory();
    const state = { ...Store.state, history };
    const snap = TradeAnalyticsEngine.snapshot(state);
    const m = snap.performance;
    const r = snap.risk;
    const series = this.buildEquitySeries(history);

    return `
      <div class="section-title" style="font-size:19px;margin-bottom:2px">${this.svgChart()} Performance Analytics</div>
      <div class="section-sub" style="margin-bottom:18px">Professional trading statistics, behavior analytics, and review intelligence</div>

      <div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap;margin-bottom:18px">
        <div>
          <div class="kpi-label" style="margin-bottom:6px">TIME PERIOD</div>
          <div class="pill-row" id="periodRow">
            ${["Today", "7 Days", "30 Days", "3 Months", "1 Year", "All Time"].map((p) => `<button class="pill ${p === this.period ? "active" : ""}" data-period="${p}">${p}</button>`).join("")}
          </div>
        </div>
        <div>
          <div class="kpi-label" style="margin-bottom:6px">FILTER BY</div>
          <div class="pill-row" id="filterRow">
            ${["All Trades", "Winners", "Losers"].map((f) => `<button class="pill ${f === this.filter ? "active" : ""}" data-filter="${f}">${f}</button>`).join("")}
          </div>
        </div>
      </div>

      <div class="grid grid-4" style="margin-bottom:16px">
        ${this.kpi("blue", this.svgDollar(), "Net Profit", Fmt.money(m.netProfit), Fmt.cls(m.netProfit), `${m.totalTrades} closed trades`)}
        ${this.kpi("blue", this.svgCheck(), "Win Rate", `${m.winRate.toFixed(1)}%`, "", `${m.winningTrades} wins / ${m.losingTrades} losses`, Math.min(100, m.winRate))}
        ${this.kpi("amber", this.svgBars(), "Profit Factor", isFinite(m.profitFactor) ? m.profitFactor.toFixed(2) : "Infinity", "", this.pfLabel(m.profitFactor))}
        ${this.kpi("blue", this.svgTarget(), "Expectancy", Fmt.money(m.expectancy), Fmt.cls(m.expectancy), "Average per trade")}
      </div>

      <div class="grid grid-4" style="margin-bottom:16px">
        ${this.kpi("blue", this.svgTarget(), "Average RR", m.avgRR ? m.avgRR.toFixed(2) : "--", "", "Reward/risk estimate")}
        ${this.kpi("amber", this.svgBars(), "Max Drawdown", Fmt.money(m.maxDrawdown), "down", "Equity peak to trough")}
        ${this.kpi("blue", this.svgCheck(), "Kelly %", `${m.kellyPercentage.toFixed(1)}%`, "", "Sizing reference")}
        ${this.kpi("amber", this.svgDollar(), "Recovery Factor", m.recoveryFactor.toFixed(2), "", "Net profit / drawdown")}
      </div>

      <div class="grid row-2-1" style="align-items:start;margin-bottom:16px">
        <div class="card">
          <div class="section-title" style="margin-bottom:14px">Quick Stats</div>
          <div class="grid grid-2" style="gap:12px">
            ${this.statBox("GROSS PROFIT", Fmt.money(m.grossProfit), "up")}
            ${this.statBox("GROSS LOSS", Fmt.money(-m.grossLoss), "down")}
            ${this.statBox("AVG WINNER", Fmt.money(m.avgWin), "up")}
            ${this.statBox("AVG LOSER", Fmt.money(m.avgLoss), "down")}
            ${this.statBox("BEST TRADE", Fmt.money(m.largestWin), "up")}
            ${this.statBox("WORST TRADE", Fmt.money(m.largestLoss), "down")}
            ${this.statBox("WIN STREAK", `${m.winStreak} trades`, "")}
            ${this.statBox("LOSS STREAK", `${m.lossStreak} trades`, "")}
          </div>
        </div>
        <div class="card">
          <div class="section-title" style="margin-bottom:4px">Equity Curve</div>
          <div class="section-sub" style="margin-bottom:10px">Cumulative P&L progression</div>
          <div class="chart-wrap" style="height:170px">
            <svg viewBox="0 0 380 170" preserveAspectRatio="none">
              ${buildLineChart(series, { width: 380, height: 170, color: series.length && series[series.length - 1] >= series[0] ? "#3d7fff" : "#f23645", padding: 8 })}
            </svg>
          </div>
        </div>
      </div>

      <div class="grid grid-3" style="margin-bottom:16px">
        <div class="card"><div class="section-title" style="margin-bottom:10px">Risk Analytics</div>${this.metricList([
          ["Average Risk", Fmt.money(r.averageRisk)],
          ["Largest Risk", Fmt.money(r.largestRisk)],
          ["Daily Drawdown", Fmt.money(r.dailyDrawdown)],
          ["Weekly Drawdown", Fmt.money(r.weeklyDrawdown)],
          ["Monthly Drawdown", Fmt.money(r.monthlyDrawdown)],
          ["Risk Consistency", `${r.riskConsistency.toFixed(0)}%`],
        ])}</div>
        <div class="card"><div class="section-title" style="margin-bottom:10px">Time Analytics</div>${this.metricList([
          ["Best Hour", snap.time.bestTradingHour],
          ["Worst Hour", snap.time.worstTradingHour],
          ["Best Weekday", snap.time.bestWeekday],
          ["Worst Weekday", snap.time.worstWeekday],
          ["Best Month", snap.time.bestMonth],
          ["Worst Month", snap.time.worstMonth],
        ])}</div>
        <div class="card"><div class="section-title" style="margin-bottom:10px">AI Insights</div>${snap.insights.map((i) => `<div class="insight-row ${i.severity}"><b>${i.title}</b><span>${i.body}</span></div>`).join("")}</div>
      </div>

      <div class="grid grid-2" style="margin-bottom:16px">
        <div class="card"><div class="section-title" style="margin-bottom:10px">Session Analytics</div>${this.groupTable(snap.sessions, ["Session", "Trades", "Win %", "Profit", "Avg RR"])}</div>
        <div class="card"><div class="section-title" style="margin-bottom:10px">Symbol Analytics</div>${this.groupTable(snap.symbols, ["Symbol", "Trades", "Win %", "Profit", "Best Session"])}</div>
      </div>

      <div class="grid grid-2">
        <div class="card"><div class="section-title" style="margin-bottom:10px">Strategy Analytics</div>${this.groupTable(snap.strategies, ["Strategy", "Trades", "Win %", "Profit", "Avg RR"])}</div>
        <div class="card"><div class="section-title" style="margin-bottom:10px">Psychology Analytics</div>${this.groupTable(snap.emotions, ["Emotion", "Trades", "Win %", "Profit", "Avg RR"])}</div>
      </div>
    `;
  },

  afterRender(container) {
    container.querySelectorAll("[data-period]").forEach((btn) => {
      btn.addEventListener("click", () => { this.period = btn.dataset.period; this.rerender(container); });
    });
    container.querySelectorAll("[data-filter]").forEach((btn) => {
      btn.addEventListener("click", () => { this.filter = btn.dataset.filter; this.rerender(container); });
    });
  },

  rerender(container) {
    container.innerHTML = this.render();
    this.afterRender(container);
  },

  filteredHistory() {
    let history = [...Store.state.history];
    const now = Date.now();
    const cutoffs = { "Today": 1, "7 Days": 7, "30 Days": 30, "3 Months": 90, "1 Year": 365, "All Time": null };
    const days = cutoffs[this.period];
    if (days) history = history.filter((t) => new Date(t.closed_at || 0).getTime() >= now - days * 86400000);
    if (this.filter === "Winners") history = history.filter((t) => t.pnl > 0);
    if (this.filter === "Losers") history = history.filter((t) => t.pnl <= 0);
    return history;
  },

  buildEquitySeries(history) {
    const sorted = [...history].sort((a, b) => new Date(a.closed_at || 0) - new Date(b.closed_at || 0));
    let running = 0;
    const series = [0];
    sorted.forEach((t) => { running += t.pnl; series.push(running); });
    return series.length < 2 ? [0, 0] : series;
  },

  kpi(iconClass, icon, label, value, valueClass, sub, bar) {
    return `<div class="kpi-card"><div class="kpi-top"><div class="kpi-icon ${iconClass}">${icon}</div></div><div class="kpi-label">${label}</div><div class="kpi-value ${valueClass}">${value}</div>${bar !== undefined ? `<div class="kpi-bar"><div class="kpi-bar-fill" style="width:${bar}%"></div></div>` : `<div class="kpi-sub">${sub}</div>`}</div>`;
  },

  statBox(label, value, cls) {
    return `<div style="background:var(--bg-card-alt);border:1px solid var(--border-soft);border-radius:10px;padding:12px"><div class="kpi-label" style="margin-bottom:6px">${label}</div><div style="font-family:var(--font-mono);font-weight:700;font-size:16px" class="${cls}">${value}</div></div>`;
  },

  metricList(rows) {
    return `<div class="analytics-list">${rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join("")}</div>`;
  },

  groupTable(rows, headers) {
    if (!rows.length) return emptyState("No data yet", "Close and journal trades to populate this section.");
    return `<div class="scroll-x"><table class="data-table"><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.slice(0, 8).map((r) => `<tr><td>${r.name}</td><td>${r.trades}</td><td>${r.winRate.toFixed(1)}%</td><td class="${Fmt.cls(r.profit)}">${Fmt.money(r.profit)}</td><td>${headers[4]?.includes("Session") ? r.bestSession : Number.isFinite(r.averageRR) ? r.averageRR.toFixed(2) : "--"}</td></tr>`).join("")}</tbody></table></div>`;
  },

  pfLabel(pf) {
    if (!isFinite(pf)) return "No losing trades";
    if (pf >= 2) return "Excellent";
    if (pf >= 1.5) return "Good";
    if (pf >= 1) return "Profitable";
    return "Needs work";
  },

  svgChart() { return `<svg width="19" height="19" viewBox="0 0 24 24" fill="none"><path d="M4 19V10M11 19V5M18 19v-7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`; },
  svgDollar() { return PageDashboard.svgDollar(); },
  svgCheck() { return PageDashboard.svgCheck(); },
  svgTarget() { return PageDashboard.svgTarget(); },
  svgBars() { return `<svg width="17" height="17" viewBox="0 0 24 24" fill="none"><rect x="4" y="11" width="4" height="9" stroke="currentColor" stroke-width="1.7"/><rect x="10" y="6" width="4" height="14" stroke="currentColor" stroke-width="1.7"/><rect x="16" y="3" width="4" height="17" stroke="currentColor" stroke-width="1.7"/></svg>`; },
};
