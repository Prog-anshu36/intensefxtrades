/* page_trades.js — Trades page: open / closed in tabs */

const PageTrades = {
  tab: "open",
  search: '',
  page: 0,
  pageSize: 50,
  reviewId: null,
  editor: null,
  sideFilter: '',
  resultFilter: '',
  sortOrder: 'newest',

  renderEditor() {
    if (!this.editor) return '';
    const trade = this.editor.trade;
    const fields = ['symbol','type','opened_at','closed_at','entry','exit','lots','sl','tp','commission','swap'];
    return `<form id="tradeRecordForm" class="card" style="padding:16px;margin:16px 0"><h3>${this.editor.id == null ? 'Record a closed trade' : 'Edit trade #' + this.editor.id}</h3><p>Enter actual executed prices. Times must be ISO timestamps; unqualified times are UTC. Quantity is lots. Net P&amp;L is recalculated from prices, commission and swap.</p><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px">${fields.map(field => `<label>${field}<input name="${field}" value="${this.escape(trade[field])}" ${['entry','exit','lots','sl','tp','commission','swap'].includes(field) ? 'type="number" step="any"' : ''} ${['sl','tp','commission','swap'].includes(field) ? '' : 'required'}></label>`).join('')}</div><p id="tradeRecordError" role="alert"></p><button class="btn btn-primary" type="submit">Save trade</button><button class="btn btn-ghost" type="button" id="cancelTradeEditor">Cancel</button></form>`;
  },

  async archiveTrade(container, id, restore=false) {
    try {
      const response = await fetch('/api/trades/archive', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({account_id:Store.state.id,id,restore})});
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      this.reviewId = null; await Store.refresh(); this.rerender(container);
    } catch (error) { container.querySelector('#tradeActionStatus').textContent = error.message; }
  },
  importState: null,
  escape(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c])); },

  renderImporter() {
    const state = this.importState;
    if (!state) return '';
    const report = state.report;
    return `<section class="card trade-import-panel" aria-label="Trade CSV import" style="padding:16px;margin-bottom:16px">
      <h3>Import closed trades</h3><p>Quantity is in lots. Times without an offset are UTC. Commission is a positive cost; swap is signed. P&amp;L, when supplied, is net P&amp;L.</p>
      <input type="file" id="tradeImportFile" accept=".csv,text/csv" ${state.busy ? 'disabled' : ''}>
      ${state.headers ? `<div class="trade-import-mapping" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;margin:12px 0">${Object.keys(state.mapping).map(field => `<label>${this.escape(field)}<select data-import-field="${field}" style="display:block;width:100%"><option value="">Not mapped</option>${state.headers.map(header => `<option value="${this.escape(header)}" ${state.mapping[field] === header ? 'selected' : ''}>${this.escape(header)}</option>`).join('')}</select></label>`).join('')}</div><button class="btn btn-ghost" id="previewTradeImport" ${state.busy ? 'disabled' : ''}>Validate &amp; preview</button>` : ''}
      <p role="status">${this.escape(state.message || '')}</p>
      ${report ? `<p>${report.valid} valid · ${report.duplicates} duplicates skipped · ${report.errors.length} invalid · ${report.imported} imported</p>
      ${report.errors.length ? `<ul>${report.errors.slice(0,30).map(error => `<li>Row ${error.row}: ${this.escape(error.error)}</li>`).join('')}</ul>` : ''}
      <div style="overflow:auto;max-height:280px"><table class="data-table"><thead><tr><th>Symbol</th><th>Side</th><th>Entry time (UTC)</th><th>Lots</th><th>Net P&amp;L</th></tr></thead><tbody>${report.preview.map(trade => `<tr><td>${this.escape(trade.symbol)}</td><td>${trade.type}</td><td>${this.escape(trade.opened_at)}</td><td>${trade.lots}</td><td>${trade.pnl}</td></tr>`).join('')}</tbody></table></div>
      ${report.valid && !report.errors.length && !report.imported ? `<button class="btn btn-primary" id="commitTradeImport" ${state.busy ? 'disabled' : ''}>Import ${report.valid} trades into ${this.escape(state.accountName)}</button>` : ''}` : ''}
      <button class="btn btn-ghost" id="dismissTradeImport" ${state.busy ? 'disabled' : ''}>Close import</button>
    </section>`;
  },

  async importRequest(container, mode) {
    const state = this.importState;
    if (!state || state.busy) return;
    state.busy = true; state.message = 'Processing CSV…'; this.rerender(container);
    try {
      const response = await fetch('/api/trades/import', { method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({csv:state.csv, mapping:mode === 'inspect' ? {} : state.mapping, account_id:state.accountId, inspect:mode === 'inspect', commit:mode === 'commit'}) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Import failed.');
      if (mode === 'inspect') { state.headers = result.headers; state.mapping = result.columns; state.report = null; state.message = 'Review column mapping, then validate.'; }
      else { state.report = result; state.message = mode === 'commit' ? `${result.imported} trades saved. Duplicates were skipped.` : 'Preview only. No trades have been saved.'; }
      if (mode === 'commit') { await Store.refresh(); this.tab = 'closed'; }
    } catch (error) { state.message = error.message; }
    finally { state.busy = false; this.rerender(container); }
  },

  render() {
    const s = Store.state;
    return `
      <div class="trade-toolbar">
        <div>
          <div class="section-title">Trade History</div>
          <div class="section-sub">${s.name || "Active account"} · ${s.currency || "USD"}</div>
        </div>
        <div class="trade-toolbar-actions">
          <button class="btn btn-primary" id="newTradeRecord">Record trade</button>
          <button class="btn btn-primary" id="openTradeImport">Import CSV</button>
          <a class="btn btn-ghost" href="/api/export/trades.csv">CSV</a>
          <a class="btn btn-ghost" href="/api/export/trades.xlsx">Excel</a>
        </div>
      </div>
      ${this.renderImporter()}
      ${this.renderEditor()}
      <div class="trade-toolbar"><label>Search trades <input id="tradeSearch" type="search" value="${this.escape(this.search)}" placeholder="Symbol, side, strategy, notes or tag"></label></div>
      <div class="trade-toolbar"><label>Direction<select id="tradeSideFilter"><option value="">All</option ${this.sideFilter === 'BUY' ? 'selected' : ''}>BUY</option><option ${this.sideFilter === 'SELL' ? 'selected' : ''}>SELL</option></select></label><label>Result<select id="tradeResultFilter"><option value="">All</option>${['WIN','LOSS','BREAKEVEN'].map(r=>`<option ${this.resultFilter === r ? 'selected' : ''}>${r}</option>`).join('')}</select></label><label>Sort<select id="tradeSortOrder">${['newest','oldest','highest P&L','lowest P&L'].map(s=>`<option ${this.sortOrder === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label></div>
      <p id="tradeActionStatus" role="status"></p>
      ${this.renderReview()}
      <div class="bt-bottom-tabs" style="margin-bottom:0">
        <div class="bt-tabs-head">
          ${["open", "closed"].map((t) => `<button class="bt-tab-btn ${this.tab === t ? "active" : ""}" data-tab="${t}">${t === "open" ? `Open (${s.active_trades.length})` : `Closed (${s.history.length})`}</button>`).join("")}
        </div>
        <div class="bt-tabs-body" style="max-height:none;padding:16px">
          ${this.tab === "open" ? this.renderOpen() : this.renderClosed()}
        </div>
      </div>
      ${(s.deleted_trades || []).length ? `<details class="card" style="padding:12px;margin-top:16px"><summary>Deleted trades (${s.deleted_trades.length}) · Restore</summary>${s.deleted_trades.map(t=>`<div>Trade #${t.id} · ${this.escape(t.symbol)} · ${Fmt.money(t.pnl)} <button class="btn btn-ghost" data-restore-trade="${t.id}">Restore</button></div>`).join('')}</details>` : ''}
    `;
  },

  renderOpen() {
    const s = Store.state;
    if (s.active_trades.length === 0) return emptyState("No open positions", "Place a trade from the Backtesting screen.", null, { label: "Go to Backtesting", onClick: () => Router.go("backtesting") });
    return `
      <table class="data-table">
        <thead><tr><th>Symbol</th><th>Side</th><th>Entry</th><th>Lots</th><th>SL</th><th>TP</th><th>Floating P&amp;L</th><th></th></tr></thead>
        <tbody>
          ${s.active_trades.map((t) => {
            const decimals = MarketData.getMeta(t.symbol).decimals;
            return `
            <tr>
              <td><div class="symbol-chip"><span class="symbol-dot" style="background:${SymbolUI.colorFor(t.symbol)}"></span>${t.symbol}</div></td>
              <td><span class="dir-pill ${t.type === "BUY" ? "long" : "short"}">${t.type}</span></td>
              <td class="mono">${Fmt.price(t.entry, decimals)}</td>
              <td class="mono">${t.lots}</td>
              <td class="mono dim">${t.sl ? Fmt.price(t.sl, decimals) : "—"}</td>
              <td class="mono dim">${t.tp ? Fmt.price(t.tp, decimals) : "—"}</td>
              <td class="mono ${Fmt.cls(t.floating_pnl || 0)}">${Fmt.money(t.floating_pnl || 0)}</td>
              <td><button class="btn btn-ghost" data-close-id="${t.id}" style="color:var(--red)">Close</button></td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    `;
  },

  renderClosed() {
    const s = Store.state;
    if (s.history.length === 0) return emptyState("No closed trades yet", "Your trade history will appear here.");
    const query = this.search.toLowerCase().trim();
    const filtered = s.history.filter(trade => (!this.sideFilter || trade.type === this.sideFilter) && (!this.resultFilter || trade.result === this.resultFilter) && (!query || [trade.id,trade.symbol,trade.type,trade.strategy,trade.notes,...(trade.tags || [])].some(value => String(value || '').toLowerCase().includes(query))));
    filtered.sort((a,b) => this.sortOrder === 'highest P&L' ? b.pnl-a.pnl : this.sortOrder === 'lowest P&L' ? a.pnl-b.pnl : (this.sortOrder === 'oldest' ? 1 : -1) * ((Date.parse(a.closed_at)||0)-(Date.parse(b.closed_at)||0) || a.id-b.id));
    this.page = Math.min(this.page, Math.max(0, Math.ceil(filtered.length / this.pageSize) - 1));
    const rows = filtered.slice(this.page * this.pageSize, (this.page + 1) * this.pageSize);
    return `
      <table class="data-table">
        <thead><tr><th>#</th><th>Symbol</th><th>Side</th><th>Entry</th><th>Exit</th><th>Lots</th><th>P&amp;L</th><th>Result</th><th>Strategy / Tags</th><th></th></tr></thead>
        <tbody>
          ${rows.map((t) => {
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
              <td><span class="result-pill ${t.result === "WIN" ? "win" : "loss"}">${this.escape(t.result)}</span></td>
              <td>${this.escape(t.strategy)} ${this.escape((t.tags || []).join(', '))}</td>
              <td><button class="btn btn-ghost" data-review-trade="${t.id}">Review</button><button class="btn btn-ghost" data-edit-trade="${t.id}">Edit</button><button class="btn btn-ghost" data-delete-trade="${t.id}">Delete</button></td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
      <div class="trade-toolbar"><span>${filtered.length} matching trades · Page ${this.page + 1} of ${Math.max(1, Math.ceil(filtered.length / this.pageSize))}</span><div><button class="btn btn-ghost" id="tradePagePrev" ${this.page === 0 ? 'disabled' : ''}>Previous</button><button class="btn btn-ghost" id="tradePageNext" ${(this.page + 1) * this.pageSize >= filtered.length ? 'disabled' : ''}>Next</button></div></div>
    `;
  },

  renderReview() {
    const trade = Store.state.history.find(t => t.id === this.reviewId);
    if (!trade) return '';
    return `<section class="card" style="padding:16px;margin-bottom:16px" aria-label="Trade review">
      <h3>Trade #${trade.id} · ${this.escape(trade.symbol)} · ${trade.type}</h3>
      <p>${this.escape(trade.opened_at)} → ${this.escape(trade.closed_at)} · Net P&amp;L ${Fmt.money(trade.pnl)} · R ${trade.r_multiple == null ? 'Unavailable' : trade.r_multiple.toFixed(2)}</p>
      <label>Strategy<input id="reviewStrategy" maxlength="200" value="${this.escape(trade.strategy)}"></label>
      <label>Tags (separate with |)<input id="reviewTags" value="${this.escape((trade.tags || []).join(' | '))}"></label>
      <label style="display:block">Review notes<textarea id="reviewNotes" maxlength="50000" style="width:100%;min-height:100px">${this.escape(trade.notes)}</textarea></label>
      <p id="tradeReviewStatus" role="status"></p><button class="btn btn-primary" id="saveTradeReview">Save review</button><button class="btn btn-ghost" id="closeTradeReview">Close</button>
    </section>`;
  },

  afterRender(container) {
    container.querySelector('#newTradeRecord')?.addEventListener('click', () => { this.editor = {accountId:Store.state.id,trade:{symbol:'XAUUSD',type:'BUY',commission:0,swap:0}}; this.rerender(container); });
    container.querySelector('#cancelTradeEditor')?.addEventListener('click', () => { this.editor = null; this.rerender(container); });
    container.querySelectorAll('[data-restore-trade]').forEach(button => button.addEventListener('click',()=>this.archiveTrade(container,Number(button.dataset.restoreTrade),true)));
    [['#tradeSideFilter','sideFilter'],['#tradeResultFilter','resultFilter'],['#tradeSortOrder','sortOrder']].forEach(([selector,key]) => container.querySelector(selector)?.addEventListener('change',event=>{this[key]=event.target.value;this.page=0;this.rerender(container);}));
    container.querySelector('#tradeRecordForm')?.addEventListener('submit',async event=>{
      event.preventDefault(); const editor = this.editor;
      const trade = Object.fromEntries(new FormData(event.target));
      event.target.querySelector('[type="submit"]').disabled = true;
      try {
        const response = await fetch('/api/trades/record',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({account_id:editor.accountId,id:editor.id,trade})});
        const result = await response.json(); if (!response.ok) throw new Error(result.error);
        this.editor=null;this.tab='closed';await Store.refresh();this.rerender(container);
      } catch(error) { container.querySelector('#tradeRecordError').textContent=error.message;event.target.querySelector('[type="submit"]').disabled=false; }
    });
    container.querySelector('#tradeSearch')?.addEventListener('input', event => {
      this.search = event.target.value; this.page = 0;
      // Update only the table, preserving input focus and caret.
      if (this.tab === 'closed') { container.querySelector('.bt-tabs-body').innerHTML = this.renderClosed(); this.bindClosedControls(container); }
    });
    this.bindClosedControls(container);
    container.querySelector('#closeTradeReview')?.addEventListener('click', () => { this.reviewId = null; this.rerender(container); });
    container.querySelector('#saveTradeReview')?.addEventListener('click', async event => {
      const accountId = Store.state.id;
      event.target.disabled = true;
      try {
        const response = await fetch('/api/trades/review', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({account_id:accountId,id:this.reviewId,notes:container.querySelector('#reviewNotes').value,strategy:container.querySelector('#reviewStrategy').value,tags:container.querySelector('#reviewTags').value.split('|')}) });
        const result = await response.json(); if (!response.ok) throw new Error(result.error);
        await Store.refresh(); this.rerender(container);
        container.querySelector('#tradeReviewStatus').textContent = 'Review saved.';
      } catch (error) { container.querySelector('#tradeReviewStatus').textContent = error.message || 'Review could not be saved.'; event.target.disabled = false; }
    });
    container.querySelector('#openTradeImport')?.addEventListener('click', () => {
      if (this.importState?.busy) return;
      this.importState = {accountId:Store.state.id, accountName:Store.state.name, csv:'', busy:false};
      this.rerender(container);
    });
    container.querySelector('#dismissTradeImport')?.addEventListener('click', () => { this.importState = null; this.rerender(container); });
    container.querySelector('#tradeImportFile')?.addEventListener('change', async event => {
      const file = event.target.files[0]; if (!file) return;
      if (file.size > 10 * 1024 * 1024) { this.importState.message = 'CSV exceeds 10 MB. Split it into smaller files.'; this.rerender(container); return; }
      this.importState.csv = await file.text(); await this.importRequest(container, 'inspect');
    });
    container.querySelectorAll('[data-import-field]').forEach(select => select.addEventListener('change', () => {
      this.importState.mapping[select.dataset.importField] = select.value || null; this.importState.report = null;
      this.rerender(container);
    }));
    container.querySelector('#previewTradeImport')?.addEventListener('click', () => this.importRequest(container, 'preview'));
    container.querySelector('#commitTradeImport')?.addEventListener('click', () => this.importRequest(container, 'commit'));
    container.querySelectorAll("[data-tab]").forEach((btn) => {
      btn.addEventListener("click", () => { this.tab = btn.dataset.tab; this.rerender(container); });
    });
    container.querySelectorAll("[data-close-id]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = parseInt(btn.dataset.closeId, 10);
        const trade = Store.state.active_trades.find((t) => t.id === id);
        if (!trade) return;
        if (MarketData.isLocal(trade.symbol)) {
          const page = window.PageBacktesting;
          const candle = page?.symbol === trade.symbol && page.dataSource === "local-csv" ? page.candles[page.idx] : null;
          if (!candle) { toast("Open this symbol in Backtesting to close at its replay price.", "error"); return; }
          await API.closeTrade({ id, exit: candle[trade.type === "BUY" ? "bid" : "ask"]?.close ?? candle.close, reason: "MANUAL", closed_at: new Date(candle.time + page.candleDuration()).toISOString() });
          await Store.refresh();
          this.rerender(container);
          return;
        }
        const candles = MarketData.generate(trade.symbol, Store.state.settings.timeframe, 600);
        const last = candles[candles.length - 1];
        await API.closeTrade({ id, exit: last.close, reason: "MANUAL" });
        await Store.refresh();
        toast("Position closed", "success");
        this.rerender(container);
      });
    });
  },

  bindClosedControls(container) {
    container.querySelectorAll('[data-edit-trade]').forEach(button => button.addEventListener('click',()=>{const id=Number(button.dataset.editTrade);this.editor={accountId:Store.state.id,id,trade:{...Store.state.history.find(t=>t.id===id)}};this.rerender(container);}));
    container.querySelectorAll('[data-delete-trade]').forEach(button => button.addEventListener('click',()=>this.archiveTrade(container,Number(button.dataset.deleteTrade))));
    container.querySelectorAll('[data-review-trade]').forEach(button => button.addEventListener('click', () => { this.reviewId = Number(button.dataset.reviewTrade); this.rerender(container); }));
    container.querySelector('#tradePagePrev')?.addEventListener('click', () => { this.page--; this.rerender(container); });
    container.querySelector('#tradePageNext')?.addEventListener('click', () => { this.page++; this.rerender(container); });
  },

  rerender(container) {
    container.innerHTML = this.render();
    this.afterRender(container);
  },
};
