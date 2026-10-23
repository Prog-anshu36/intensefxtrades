/* page_dashboard.js — Dashboard page */

const PageDashboard = {
  range: "1W",

  render() {
    const s = Store.state;
    const equity = Store.equity();
    const floating = Store.floatingPnl();
    const realized = s.history.reduce((sum, t) => sum + t.pnl, 0);
    const totalPnl = equity - s.initial_balance;
    const m = Store.metrics();

    const perfSeries = this.buildPerfSeries();
    const perfChange = perfSeries.length > 1
      ? ((perfSeries[perfSeries.length - 1] - perfSeries[0]) / Math.abs(perfSeries[0] || 1)) * 100
      : 0;

    return `
      <div class="grid grid-4" style="margin-bottom:16px">
        ${this.kpiCard({
          icon: this.svgDollar(), iconClass: "blue", pill: "TOTAL",
          label: "Total P&L", value: Fmt.money(totalPnl), valueClass: Fmt.cls(totalPnl),
          sub: `→ ${s.history.length + s.active_trades.length} trades`,
        })}
        ${this.kpiCard({
          icon: this.svgClock(), iconClass: "amber", pill: "",
          label: "Unrealized", value: Fmt.money(floating), valueClass: Fmt.cls(floating),
          sub: `${s.active_trades.length} open position${s.active_trades.length === 1 ? "" : "s"}`,
        })}
        ${this.kpiCard({
          icon: this.svgCheck(), iconClass: "blue", pill: "",
          label: "Realized", value: Fmt.money(realized), valueClass: Fmt.cls(realized),
          sub: `${s.history.length} closed trade${s.history.length === 1 ? "" : "s"}`,
        })}
        ${this.kpiCard({
          icon: this.svgTarget(), iconClass: "blue", pill: "",
          label: "Win Rate", value: `${m.winRate.toFixed(0)}%`, valueClass: "",
          sub: "", bar: Math.min(100, m.winRate),
        })}
      </div>

      <div class="grid row-12-4" style="margin-bottom:16px;align-items:start">
        <div class="card">
          <div class="perf-card-head">
            <div>
              <div class="section-title">${this.svgTrend()} PERFORMANCE</div>
            </div>
            <div class="pill-row" id="rangeRow">
              ${["1D", "1W", "1M", "3M", "1Y", "ALL"].map((r) => `<button class="pill ${r === this.range ? "active" : ""}" data-range="${r}">${r}</button>`).join("")}
            </div>
          </div>
          <div class="perf-value-row">
            <span class="perf-value ${Fmt.cls(perfSeries.length ? perfSeries[perfSeries.length - 1] - perfSeries[0] : 0)}">${Fmt.money(perfSeries.length ? perfSeries[perfSeries.length - 1] - perfSeries[0] : 0)}</span>
            <span class="perf-badge">▲ ${Math.abs(perfChange).toFixed(1)}%</span>
          </div>
          <div class="chart-wrap" id="perfChartWrap">
            ${this.renderPerfChart(perfSeries)}
          </div>
        </div>

        <div class="card">
          <div class="section-title-row">
            <div class="section-title">Monthly P&amp;L</div>
            <span class="section-sub">${new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}</span>
          </div>
          ${this.renderCalendar()}
        </div>
      </div>

      <div class="grid row-12-4" style="align-items:start">
        <div class="card">
          <div class="section-title-row">
            <div class="section-title">Open Positions</div>
            <div style="display:flex;align-items:center;gap:10px">
              ${s.active_trades.length ? `<span class="live-pill"><span class="dot"></span> LIVE</span>` : ""}
              <span class="section-sub">Total: <b style="color:var(--text-primary)">${Fmt.money(floating)}</b></span>
            </div>
          </div>
          <div style="margin-top:12px">
            ${s.active_trades.length === 0
              ? emptyState("No open positions", "Head to Backtesting to place a simulated trade.", null, { label: "Go to Backtesting", onClick: () => Router.go("backtesting") })
              : s.active_trades.map((t) => this.positionRow(t)).join("")}
          </div>
        </div>

        <div class="card">
          <div class="section-title" style="margin-bottom:10px">Top Performers</div>
          ${this.renderTopPerformers()}
        </div>
      </div>

      <div class="grid grid-3" style="margin-top:16px">
        <div class="card">
          <div class="section-title" style="margin-bottom:2px">↑ Long vs Short</div>
          ${this.renderLongShort()}
        </div>
        <div class="card">
          <div class="section-title" style="margin-bottom:2px">📅 Day Performance</div>
          ${this.renderDayPerformance()}
        </div>
        <div class="card">
          <div class="section-title" style="margin-bottom:2px">◎ Top Symbols</div>
          ${this.renderTopSymbols()}
        </div>
      </div>
    `;
  },

  afterRender(container) {
    container.querySelectorAll("[data-range]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.range = btn.dataset.range;
        container.innerHTML = this.render();
        this.afterRender(container);
      });
    });
  },

  kpiCard({ icon, iconClass, pill, label, value, valueClass, sub, bar }) {
    return `
      <div class="kpi-card">
        <div class="kpi-top">
          <div class="kpi-icon ${iconClass}">${icon}</div>
          ${pill ? `<span class="kpi-pill">${pill}</span>` : ""}
        </div>
        <div class="kpi-label">${label}</div>
        <div class="kpi-value ${valueClass}">${value}</div>
        ${bar !== undefined ? `<div class="kpi-bar"><div class="kpi-bar-fill" style="width:${bar}%"></div></div>` : `<div class="kpi-sub">${sub}</div>`}
      </div>
    `;
  },

  positionRow(t) {
    const color = SymbolUI.colorFor(t.symbol);
    const pnlPct = ((t.floating_pnl || 0) / (Store.state.initial_balance)) * 100;
    return `
      <div class="position-row">
        ${SymbolUI.iconHtml(t.symbol)}
        <div class="pos-main">
          <div class="pos-symbol-row">
            <span class="pos-symbol">${t.symbol}</span>
            <span class="dir-pill ${t.type === "BUY" ? "long" : "short"}">${t.type === "BUY" ? "LONG" : "SHORT"}</span>
          </div>
          <div class="pos-sub">${t.lots} lots @ ${Fmt.price(t.entry, MarketData.getMeta(t.symbol).decimals)}</div>
        </div>
        <div class="pos-pnl">
          <div class="pos-pnl-value ${Fmt.cls(t.floating_pnl || 0)}">${Fmt.money(t.floating_pnl || 0)}</div>
          <div class="pos-pnl-pct">${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%</div>
        </div>
      </div>
    `;
  },

  renderTopPerformers() {
    const s = Store.state;
    const bySymbol = {};
    [...s.history].forEach((t) => {
      bySymbol[t.symbol] = (bySymbol[t.symbol] || 0) + t.pnl;
    });
    const rows = Object.entries(bySymbol).sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (rows.length === 0) return emptyState("No closed trades yet", "Performers will appear once you close trades.");
    return rows.map(([symbol, pnl], i) => `
      <div class="performer-row">
        <span class="performer-rank">${i + 1}</span>
        <div class="performer-icon" style="background:${SymbolUI.colorFor(symbol)}">${SymbolUI.iconLetter(symbol)}</div>
        <span class="performer-name">${symbol}</span>
        <span class="performer-value ${Fmt.cls(pnl)}">${Fmt.money(pnl)}</span>
      </div>
    `).join("");
  },

  renderLongShort() {
    const s = Store.state;
    const all = [...s.history, ...s.active_trades];
    const longs = all.filter((t) => t.type === "BUY").length;
    const shorts = all.filter((t) => t.type === "SELL").length;
    const total = Math.max(longs + shorts, 1);
    const longPct = (longs / total) * 100;
    const shortPct = 100 - longPct;
    return `
      <div class="lvs-row">
        <div class="lvs-stat"><div class="lvs-stat-label">Long</div><div class="lvs-stat-value" style="color:var(--blue-bright)">${longs}</div></div>
        <div class="lvs-stat" style="text-align:right"><div class="lvs-stat-label">Short</div><div class="lvs-stat-value" style="color:var(--amber)">${shorts}</div></div>
      </div>
      <div class="lvs-bar-track">
        <div class="lvs-bar-fill long" style="width:${longPct}%"></div>
        <div class="lvs-bar-fill short" style="width:${shortPct}%"></div>
      </div>
    `;
  },

  renderDayPerformance() {
    const s = Store.state;
    const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const byDay = new Array(7).fill(0);
    s.history.forEach((t) => {
      const d = new Date(t.closed_at || Date.now());
      const idx = (d.getDay() + 6) % 7; // Mon=0
      byDay[idx] += t.pnl;
    });
    const max = Math.max(...byDay.map(Math.abs), 1);
    return `
      <div class="mini-bars">
        ${byDay.map((v, i) => {
          const h = Math.max(4, (Math.abs(v) / max) * 80);
          const color = v >= 0 ? "var(--blue)" : "var(--red)";
          return `<div class="mini-bar-col"><div class="mini-bar" style="height:${h}px;background:${color}"></div><span class="mini-bar-label">${days[i]}</span></div>`;
        }).join("")}
      </div>
    `;
  },

  renderTopSymbols() {
    const s = Store.state;
    const counts = {};
    [...s.history, ...s.active_trades].forEach((t) => { counts[t.symbol] = (counts[t.symbol] || 0) + 1; });
    const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 4);
    if (rows.length === 0) return emptyState("No trades yet", "Symbols you trade will rank here.");
    const max = Math.max(...rows.map((r) => r[1]), 1);
    return rows.map(([symbol, count]) => `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:9px">
        <div class="performer-icon" style="background:${SymbolUI.colorFor(symbol)};width:24px;height:24px;font-size:9px">${SymbolUI.iconLetter(symbol)}</div>
        <span style="font-size:12px;font-weight:600;width:62px">${symbol}</span>
        <div style="flex:1;height:6px;border-radius:3px;background:var(--bg-elevated);overflow:hidden">
          <div style="height:100%;width:${(count / max) * 100}%;background:${SymbolUI.colorFor(symbol)};border-radius:3px"></div>
        </div>
        <span style="font-size:11px;color:var(--text-tertiary);font-family:var(--font-mono)">${count}</span>
      </div>
    `).join("");
  },

  renderCalendar() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const offset = (firstDay + 6) % 7; // Mon-first
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const pnlByDay = {};
    Store.state.history.forEach((t) => {
      const d = new Date(t.closed_at || Date.now());
      if (d.getFullYear() === year && d.getMonth() === month) {
        pnlByDay[d.getDate()] = (pnlByDay[d.getDate()] || 0) + t.pnl;
      }
    });

    let cells = "";
    for (let i = 0; i < offset; i++) cells += `<div class="cal-cell empty"></div>`;
    for (let d = 1; d <= daysInMonth; d++) {
      const pnl = pnlByDay[d];
      const cls = pnl === undefined ? "" : pnl >= 0 ? "profit" : "loss";
      cells += `<div class="cal-cell ${cls}">
        <span>${d}</span>
        ${pnl !== undefined ? `<span class="cal-pnl">${pnl >= 0 ? "+" : ""}${Math.round(pnl)}</span>` : ""}
      </div>`;
    }

    return `
      <div class="cal-grid">
        ${["M", "T", "W", "T", "F", "S", "S"].map((d) => `<div class="cal-dow">${d}</div>`).join("")}
        ${cells}
      </div>
      <div class="cal-legend">
        <span><span class="legend-dot profit"></span> Profit</span>
        <span><span class="legend-dot loss"></span> Loss</span>
      </div>
    `;
  },

  buildPerfSeries() {
    const s = Store.state;
    const sorted = [...s.history].sort((a, b) => new Date(a.closed_at || 0) - new Date(b.closed_at || 0));
    let running = s.initial_balance;
    const series = [running];
    sorted.forEach((t) => { running += t.pnl; series.push(running); });
    series.push(running + Store.floatingPnl());
    if (series.length < 2) return [s.initial_balance, s.initial_balance];
    return series;
  },

  renderPerfChart(series) {
    const color = series[series.length - 1] >= series[0] ? "#3d7fff" : "#f23645";
    const inner = buildLineChart(series, { width: 900, height: 230, color, fill: true, padding: 14 });
    return `<svg viewBox="0 0 900 230" preserveAspectRatio="none">${inner}</svg>`;
  },

  svgDollar() { return `<svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M12 2v20M17 6.5C17 4.6 14.8 3 12 3s-5 1.6-5 3.5S9.2 10 12 10s5 1.6 5 3.5-2.2 3.5-5 3.5-5-1.6-5-3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`; },
  svgClock() { return `<svg width="17" height="17" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><path d="M12 7v5l4 2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`; },
  svgCheck() { return `<svg width="17" height="17" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><path d="M8.5 12.5l2.3 2.3 4.7-5.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`; },
  svgTarget() { return `<svg width="17" height="17" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="4.5" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg>`; },
  svgTrend() { return `<svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M3 16l6-6 4 4 8-9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`; },
};
