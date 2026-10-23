/* page_trade_analysis.js - Analysis > Trade Analysis page */

const PageTradeAnalysis = {
  sortKey: "closed_at",
  sortDir: "desc",
  symbolFilter: "All",
  query: "",

  render() {
    const s = Store.state;
    const baseRows = typeof TradeAnalyticsEngine !== "undefined" ? TradeAnalyticsEngine.normalizeTrades(s.history, s.journal || []) : [...s.history];
    const symbols = ["All", ...new Set(baseRows.map((t) => t.symbol))];
    let rows = [...baseRows];
    if (this.symbolFilter !== "All") rows = rows.filter((t) => t.symbol === this.symbolFilter);
    if (this.query.trim() && typeof TradeAnalyticsEngine !== "undefined") {
      const ids = new Set(TradeAnalyticsEngine.search(this.query, { ...s, history: rows }).map((t) => t.id));
      rows = rows.filter((t) => ids.has(t.id));
    }
    rows.sort((a, b) => {
      const av = a[this.sortKey], bv = b[this.sortKey];
      const cmp = (av > bv) - (av < bv);
      return this.sortDir === "asc" ? cmp : -cmp;
    });

    const m = Store.metrics(rows);

    return `
      <div class="section-title" style="font-size:19px;margin-bottom:2px">Trade Analysis</div>
      <div class="section-sub" style="margin-bottom:18px">Every closed trade, journal field, tag, and behavior marker</div>

      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:10px">
        <div class="pill-row" id="symbolFilterRow">
          ${symbols.map((sym) => `<button class="pill ${sym === this.symbolFilter ? "active" : ""}" data-symbol="${sym}">${sym}</button>`).join("")}
        </div>
        <div class="section-sub">${rows.length} trade${rows.length === 1 ? "" : "s"} - Net ${Fmt.money(m.totalPnl)}</div>
      </div>

      <div class="card" style="margin-bottom:14px">
        <input id="tradeSearchInput" type="search" value="${this.escape(this.query)}" placeholder="Search by trade, date, symbol, session, emotion, mistake, lesson, strategy, journal or tags" style="width:100%;background:var(--bg-card-alt);border:1px solid var(--border-soft);border-radius:10px;color:var(--text-primary);padding:11px 12px">
      </div>

      <div class="card" style="padding:0">
        <div class="scroll-x">
          <table class="data-table">
            <thead>
              <tr>
                <th data-sort="id">#</th>
                <th data-sort="symbol">Symbol</th>
                <th data-sort="type">Side</th>
                <th data-sort="entry">Entry</th>
                <th data-sort="exit">Exit</th>
                <th data-sort="lots">Lots</th>
                <th data-sort="pnl">P&L</th>
                <th data-sort="session">Session</th>
                <th data-sort="strategy">Strategy</th>
                <th data-sort="emotion">Emotion</th>
                <th data-sort="reason">Reason</th>
                <th data-sort="closed_at">Closed</th>
                <th data-sort="result">Result</th>
              </tr>
            </thead>
            <tbody>
              ${rows.length === 0 ? `<tr><td colspan="13" style="padding:0"><div style="padding:30px">${emptyState("No trades match this filter", "Close and journal trades to see analytics here.")}</div></td></tr>` : rows.map((t) => this.row(t)).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  row(t) {
    const decimals = MarketData.getMeta(t.symbol).decimals;
    return `
      <tr>
        <td class="dim">${t.id}</td>
        <td><div class="symbol-chip"><span class="symbol-dot" style="background:${SymbolUI.colorFor(t.symbol)}"></span>${t.symbol}</div></td>
        <td><span class="dir-pill ${t.type === "BUY" ? "long" : "short"}">${t.type}</span></td>
        <td class="mono">${Fmt.price(t.entry, decimals)}</td>
        <td class="mono">${Fmt.price(t.exit, decimals)}</td>
        <td class="mono">${t.lots}</td>
        <td class="mono ${Fmt.cls(t.pnl)}">${Fmt.money(t.pnl)}</td>
        <td class="dim">${this.escape(t.session || "--")}</td>
        <td class="dim">${this.escape(t.strategy || "--")}</td>
        <td class="dim">${this.escape(t.emotion || "--")}</td>
        <td class="dim">${this.escape(t.reason || "MANUAL")}</td>
        <td class="dim">${t.closed_at ? Fmt.dateTime(t.closed_at) : "--"}</td>
        <td><span class="result-pill ${t.result === "WIN" ? "win" : "loss"}">${t.result}</span></td>
      </tr>
    `;
  },

  afterRender(container) {
    container.querySelectorAll("[data-symbol]").forEach((btn) => {
      btn.addEventListener("click", () => { this.symbolFilter = btn.dataset.symbol; this.rerender(container); });
    });
    container.querySelector("#tradeSearchInput")?.addEventListener("input", (e) => {
      this.query = e.target.value;
      this.rerender(container);
    });
    container.querySelectorAll("[data-sort]").forEach((th) => {
      th.style.cursor = "pointer";
      th.addEventListener("click", () => {
        const key = th.dataset.sort;
        if (this.sortKey === key) this.sortDir = this.sortDir === "asc" ? "desc" : "asc";
        else { this.sortKey = key; this.sortDir = "desc"; }
        this.rerender(container);
      });
    });
  },

  rerender(container) {
    container.innerHTML = this.render();
    this.afterRender(container);
  },

  escape(str) {
    const div = document.createElement("div");
    div.textContent = str || "";
    return div.innerHTML;
  },
};
