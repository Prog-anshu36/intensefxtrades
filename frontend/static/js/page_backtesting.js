/* page_backtesting.js - TradingView-style chart, replay, watchlist, and order panel */

const PageBacktesting = {
  candles: [],
  visibleCount: 120,
  minVisibleCount: 20,
  maxVisibleCount: 900,
  historyTargets: {
    "1m": 1576800,
    "3m": 525600,
    "5m": 315360,
    "15m": 105120,
    "30m": 52560,
    "1h": 26280,
    "4h": 6570,
    "1d": 1095,
    "1w": 156,
    "1M": 36,
  },
  playing: false,
  playTimer: null,
  playLoopToken: 0,
  speed: 1.0,
  replayActive: false,
  replayCutIndex: null,
  replayClock: null,
  visibleCandles: [],
  hiddenCandles: [],
  revealAnim: null,
  replayUndoStack: [],
  replayRedoStack: [],
  replayBookmarks: [],
  replayEvents: [],
  yZoom: 1,
  yOffset: 0,
  minYZoom: 0.3,
  maxYZoom: 6,
  orderTab: "Market",
  pendingPrice: null,
  bottomTab: "open",
  chartType: "candles",
  indicator: "volume",
  tool: "crosshair",
  cursorMode: "crosshair", // crosshair | dot | arrow | demo | eraser
  valuesTooltipOnLongPress: true,
  crosshair: null,
  drawings: [],
  drawingEngine: null,
  drawingWorkspaceUX: null,
  drawingObjectSearch: "",
  drawingObjectFilter: "all",
  drawingManagerHidden: false,
  drawingHistory: [],
  drawingRedoStack: [],
  drawingClipboard: null,
  selectedDrawingIds: [],
  hoveredDrawingId: null,
  drawingDrag: null,
  sessionEngine: null,
  sessionSettingsOpen: false,
  sessionRangeOpen: false,
  sessionNavigator: {
    selectedSessionType: "new-york",
    date: "",
  },
  sessionPanelHidden: false,
  _sessionStatsCache: null,
  drawingDefaults: {
    color: "#d1d4dc",
    width: 1.5,
    opacity: 1,
    lineStyle: "solid",
    fillColor: "#3d7fff",
    fillOpacity: 0.16,
    textColor: "#d1d4dc",
    fontSize: 13,
    fontWeight: "400",
  },
  magnetMode: true,
  pendingDrawing: null,
  dataSource: "loading",
  tpEnabled: false,
  slEnabled: false,
  tpPips: 100,
  slPips: 50,
  lots: 0.01,
  // --- chart engine (view/pan) state — decoupled from replay's `idx` ---
  viewEnd: null,        // right-edge candle index of the current viewport (camera)
  autoFollow: true,      // when true, viewEnd tracks idx (replay position) automatically
  futureSlots: 6,        // empty candle-widths reserved to the right, TradingView-style
  zoomAnim: null,        // in-flight smooth-zoom animation state
  inertia: null,         // in-flight pan momentum animation state
  mouseEngine: null,     // authoritative chart interaction controller state
  replayTimestamp: null, // global replay anchor shared across timeframe changes
  _drawRaf: null,
  _canvasW: 0,
  _canvasH: 0,

  chartStorage() {
    return this._chartAccountStorage || localStorage;
  },

  init() {
    this._initialized = true;
    const settings = Store.state.settings;
    this.symbol = settings.symbol || "BTCUSD";
    this.timeframe = settings.timeframe || "1m";
    this.speed = settings.replay_speed || this.speed;
    this.replayActive = !!settings.replay_active;
    if (!window.SubscriptionSystem?.canAccessFeature("replay")) this.replayActive = false;
    this.replayTimestamp = this.replayActive ? (settings.replay_timestamp || null) : null;
    this.candles = MarketData.isLocal(this.symbol) ? [] : MarketData.generate(this.symbol, this.timeframe, this.historyCountForTimestamp(this.timeframe, this.replayTimestamp));
    this.idx = this.replayTimestamp ? this.snapIndexToTimestamp(this.replayTimestamp) : Math.min(settings.current_idx || this.candles.length - 1, this.candles.length - 1);
    this.replayCutIndex = this.replayActive ? (settings.replay_cut_index ?? this.idx) : null;
    this.viewEnd = settings.chart_view_end ?? this.idx;
    this.visibleCount = settings.chart_visible_count || this.visibleCount;
    this.yZoom = settings.chart_y_zoom || this.yZoom;
    this.yOffset = settings.chart_y_offset || 0;
    this.autoFollow = settings.chart_auto_follow ?? this.autoFollow;
    this.replayTimestamp = this.replayActive ? (this.candles[this.idx]?.date?.getTime() || this.replayTimestamp) : null;
    this.loadReplayStorage();
    this.initializeSessionEngine();
    this.initializeDrawingWorkspaceUX();
    this.loadDrawingManagerPanelState();
    this.loadDrawingStorage();
    this.initializeDrawingEngine();
    this.syncReplayBuffers();
    this.sanitizeChartCamera();
    this.loadRealHistory();
  },

  async loadRealHistory() {
    this.stopPlay();
    const requestId = this._historyRequest = (this._historyRequest || 0) + 1;
    const symbol = this.symbol;
    const timeframe = this.timeframe;
    this.dataSource = "loading";
    const anchorTs = this.replayActive ? (this.replayTimestamp ?? this.candles[this.idx]?.date?.getTime()) : null;
    const options = MarketData.isLocal(symbol) && anchorTs != null ? { anchor: anchorTs - this.candleDuration() } : {};
    const result = await MarketData.history(symbol, timeframe, this.historyCountForTimestamp(timeframe, anchorTs), options);
    if (symbol !== this.symbol || timeframe !== this.timeframe || requestId !== this._historyRequest) return;
    this.datasetInfo = result;
    this._olderExhausted = false;
    this._historyError = result.error || null;
    // Preserve the replay position (by timestamp) and camera offset across the data swap.
    const panOffset = (this.viewEnd ?? this.idx) - this.idx;
    this.candles = result.candles;
    this.dataSource = result.source;
    if (anchorTs != null) {
      this.idx = this.snapIndexToTimestamp(anchorTs);
    } else if (!this.replayActive) {
      this.idx = this.candles.length - 1;
    } else {
      this.idx = Math.min(Math.max(this.idx || this.candles.length - 1, 80), this.candles.length - 1);
    }
    this.replayTimestamp = this.replayActive ? (anchorTs || this.candles[this.idx]?.date?.getTime() || null) : null;
    if (this.replayActive) this.replayCutIndex = this.idx;
    this.syncReplayBuffers();
    this.viewEnd = this.clampViewEnd(this.idx + panOffset);
    this.sanitizeChartCamera();
    this.syncMouseEngineCamera();
    this.rerender();
  },

  initialHistoryCount(timeframe = this.timeframe) {
    const target = this.historyTargets[timeframe] || 12000;
    if (timeframe === "1m") return Math.min(target, 50000);
    if (timeframe === "3m" || timeframe === "5m") return Math.min(target, 30000);
    if (timeframe.endsWith("m")) return Math.min(target, 20000);
    return Math.min(target, 12000);
  },

  historyCountForTimestamp(timeframe = this.timeframe, timestamp = null) {
    if (MarketData.isLocal(this.symbol)) return 5000;
    const base = this.initialHistoryCount(timeframe);
    if (!timestamp) return base;
    const tfMin = MarketData.TF_MINUTES[timeframe] || 60;
    const ageMs = Math.max(0, Date.now() - timestamp);
    const needed = Math.ceil(ageMs / (tfMin * 60 * 1000)) + Math.max(500, Math.ceil(base * 0.08));
    return Math.min(this.historyTargetCount(timeframe), Math.max(base, needed));
  },

  historyTargetCount(timeframe = this.timeframe) {
    return this.historyTargets[timeframe] || 50000;
  },

  historyChunkCount(timeframe = this.timeframe) {
    if (timeframe === "1m") return 100000;
    if (timeframe === "3m" || timeframe === "5m") return 75000;
    if (timeframe.endsWith("m")) return 40000;
    return 5000;
  },

  historyIdleBatchCount(timeframe = this.timeframe) {
    if (timeframe === "1m") return 25000;
    if (timeframe === "3m" || timeframe === "5m") return 20000;
    if (timeframe.endsWith("m")) return 15000;
    return 5000;
  },

  synthesizeOlderCandles(addCount) {
    if (MarketData.isLocal(this.symbol)) return [];
    const first = this.candles[0];
    if (!first || !addCount) return [];
    const meta = MarketData.getMeta(this.symbol);
    const tfMin = MarketData.TF_MINUTES[this.timeframe] || 60;
    const ms = tfMin * 60 * 1000;
    const seed = Array.from(`${this.symbol}_${this.timeframe}_${first.time || first.date?.getTime() || 0}`).reduce((h, ch) => ((h << 5) - h + ch.charCodeAt(0)) | 0, 0);
    let s = seed || 1;
    const rand = () => {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const older = [];
    let close = first.open;
    for (let i = addCount; i > 0; i--) {
      const time = first.date.getTime() - i * ms;
      const shock = (rand() - 0.5) * 2 * meta.vol;
      const open = Math.max(meta.pip || 1e-9, close - shock);
      const nextClose = Math.max(meta.pip || 1e-9, close);
      const high = Math.max(open, nextClose) + rand() * meta.vol * 1.2;
      const low = Math.min(open, nextClose) - rand() * meta.vol * 1.2;
      older.push({
        time,
        date: new Date(time),
        open: this.roundPrice(open, meta.decimals),
        high: this.roundPrice(high, meta.decimals),
        low: this.roundPrice(low, meta.decimals),
        close: this.roundPrice(nextClose, meta.decimals),
        volume: Math.round(500 + rand() * 4500),
      });
      close = open;
    }
    return older;
  },

  roundPrice(value, decimals) {
    const factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
  },

  runPhaseOneChartStress() {
    const original = {
      symbol: this.symbol,
      timeframe: this.timeframe,
      candles: this.candles,
      idx: this.idx,
      replayActive: this.replayActive,
      replayCutIndex: this.replayCutIndex,
      replayTimestamp: this.replayTimestamp,
      viewEnd: this.viewEnd,
      visibleCount: this.visibleCount,
      yZoom: this.yZoom,
      yOffset: this.yOffset,
      autoFollow: this.autoFollow,
      visibleCandles: this.visibleCandles,
      hiddenCandles: this.hiddenCandles,
    };
    const rows = Object.keys(this.historyTargets).map((tf) => {
      const tfMin = MarketData.TF_MINUTES[tf] || 60;
      const oldReplayTs = Date.now() - Math.min(1000 * 60 * tfMin * (this.historyTargetCount(tf) - 10), 1000 * 60 * 60 * 24 * 365 * 3);
      const timestampAwareCount = this.historyCountForTimestamp(tf, oldReplayTs);
      this.timeframe = tf;
      this.candles = MarketData.isLocal(this.symbol) ? [] : MarketData.generate(this.symbol || original.symbol || "EURUSD", tf, timestampAwareCount);
      this.idx = this.candles.length - 1;
      this.replayActive = false;
      this.replayCutIndex = null;
      this.viewEnd = this.idx;
      const before = this.candles.length;
      const addCount = Math.min(this.historyChunkCount(tf), this.historyIdleBatchCount(tf), this.historyTargetCount(tf) - before);
      const older = this.synthesizeOlderCandles(addCount);
      const after = before + older.length;
      const mid = this.candles[Math.floor(this.candles.length * 0.55)]?.date?.getTime();
      this.replayActive = true;
      this.replayTimestamp = mid;
      this.idx = this.snapIndexToTimestamp(mid);
      this.replayCutIndex = this.idx;
      this.syncReplayBuffers();
      return {
        timeframe: tf,
        target: this.historyTargetCount(tf),
        timestampAwareCount,
        initial: before,
        idleBatch: this.historyIdleBatchCount(tf),
        nextChunk: older.length,
        afterNextChunk: after,
        replaySynced: this.candles[this.idx]?.date?.getTime() === mid,
        visibleReplayCandles: this.visibleCandles.length,
        hiddenReplayCandles: this.hiddenCandles.length,
      };
    });
    Object.assign(this, original);
    this.syncReplayBuffers();
    this.syncMouseEngineCamera();
    this.scheduleDraw();
    console.table(rows);
    return rows;
  },

  render() {
    if (!this._initialized) this.init();
    const s = Store.state;
    const current = this.candles[this.idx];
    const prev = this.candles[Math.max(0, this.idx - 1)] || current;
    const meta = MarketData.getMeta(this.symbol);
    const change = current && prev ? current.close - prev.close : 0;
    const changePct = prev ? (change / prev.close) * 100 : 0;
    const openTrades = s.active_trades.filter((t) => t.symbol === this.symbol);

    return `
      <div class="bt-engine-stack">
      <div class="tv-shell">
        <div class="tv-topbar tv-chart-commandbar">
          <div class="tv-command-group tv-symbol-command">
            <span class="tv-search-glyph" aria-hidden="true">⌕</span>
            <select id="symbolSelect" class="tv-symbol-select" title="Select symbol">
            ${Object.keys(MarketData.SYMBOLS).map((sym) => `<option value="${sym}" ${sym === this.symbol ? "selected" : ""}>${sym}</option>`).join("")}
            </select>
            <button class="tv-icon-action" id="addSymbolBtn" title="Choose another instrument" aria-label="Choose another instrument">+</button>
          </div>
          <div class="tv-divider"></div>
          <select id="timeframeSelect" class="tv-command-select" title="Chart timeframe">
            ${["1m", "3m", "5m", "15m", "30m", "1h", "4h", "1d"].map((tf) => `<option value="${tf}" ${tf === this.timeframe ? "selected" : ""}>${tf === "1h" ? "1H" : tf === "4h" ? "4H" : tf === "1d" ? "1D" : tf}</option>`).join("")}
          </select>
          <select id="chartTypeSelect" class="tv-command-select tv-chart-type-select" title="Chart type">
            <option value="candles" ${this.chartType === "candles" ? "selected" : ""}>Candles</option>
            <option value="line" ${this.chartType === "line" ? "selected" : ""}>Line</option>
            <option value="area" ${this.chartType === "area" ? "selected" : ""}>Area</option>
          </select>
          <div class="tv-divider"></div>
          <select id="indicatorSelect" class="tv-command-select tv-indicator-select" title="Indicators">
            <option value="none" ${this.indicator === "none" ? "selected" : ""}>ƒx Indicators</option>
            <option value="volume" ${this.indicator === "volume" ? "selected" : ""}>Volume</option>
            <option value="fxn">FXN - Asian Session Range · RobMinty</option>
            <option value="ema" ${this.indicator === "ema" ? "selected" : ""}>EMA 20 / 50 + Volume</option>
            <option value="sma" ${this.indicator === "sma" ? "selected" : ""}>SMA 20 / 50</option>
            <option value="vwap" ${this.indicator === "vwap" ? "selected" : ""}>Session VWAP</option>
            <option value="rsi" ${this.indicator === "rsi" ? "selected" : ""}>RSI 14</option>
          </select>
          <button class="tv-action" id="layoutBtn" title="Show or hide the analysis panel">Layout</button>
          <button type="button" class="tv-action" id="drawingHelpBtn" aria-expanded="${!!this.drawingHelpOpen}" aria-controls="drawingToolHelp">Tool help</button>
          <button type="button" class="tv-action" id="drawingObjectsBtn">Objects</button>
          <label class="tv-drawing-opacity-control" title="Set opacity for the selected drawing or the next drawing">
            <span>Opacity</span>
            <input type="range" id="chartDrawingOpacityInput" min="5" max="100" step="5" value="${Math.round((this.drawings.find(d => this.selectedDrawingIds.includes(d.id))?.style?.opacity ?? this.drawingDefaults.opacity ?? 1) * 100)}" aria-label="Drawing opacity">
            <output id="chartDrawingOpacityValue">${Math.round((this.drawings.find(d => this.selectedDrawingIds.includes(d.id))?.style?.opacity ?? this.drawingDefaults.opacity ?? 1) * 100)}%</output>
          </label>
          <input id="drawingToolSearchInput" class="tv-command-select" placeholder="Search tools" list="drawingToolOptions" aria-label="Search drawing tools">
          <datalist id="drawingToolOptions">${(this.drawingEngine?.toolRegistry?.getTools?.() || []).map(tool => `<option value="${this.escapeHtml(tool.name)}"></option>`).join('')}</datalist>
          <button class="tv-action tv-order-command" id="placeOrderBtn" title="Open the simulated order ticket">+ Place Order</button>
          <button class="tv-action" id="goToBtn" title="Open session and date navigation">Go To</button>
          <button type="button" class="tv-action tv-prop-firm-badge" id="propFirmChartBadge" hidden title="Open Prop Firm Session"></button>
          <button class="tv-icon-action" id="toolbarUndoBtn" title="Undo drawing" aria-label="Undo drawing">${this.toolSvg("undo")}</button>
          <button class="tv-icon-action" id="toolbarRedoBtn" title="Redo drawing" aria-label="Redo drawing">${this.toolSvg("redo")}</button>
          <div class="tv-command-market">
            <span class="tv-price ${Fmt.cls(change)}">${current ? Fmt.price(current.close, meta.decimals) : "--"}</span>
            <span class="tv-change ${Fmt.cls(change)}">${change >= 0 ? "+" : ""}${Fmt.price(change, meta.decimals)} (${changePct.toFixed(2)}%)</span>
          </div>
          <button type="button" class="tv-action tv-fullscreen-button" id="fullscreenBtn" title="Toggle fullscreen chart (F11)" aria-label="Toggle fullscreen chart" aria-pressed="false">⛶ Full screen</button>
          <div class="tv-toolbar-group tv-command-actions">
            <button class="tv-action" id="saveChartBtn" title="Save chart workspace">Save</button>
            <button class="tv-icon-action" id="chartSettingsBtn" title="Chart settings" aria-label="Chart settings">⚙</button>
            <button class="tv-icon-action" id="screenshotBtn" title="Screenshot chart">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M4 8h3l1.5-2h7L17 8h3v11H4V8z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="12" cy="13.5" r="3.2" stroke="currentColor" stroke-width="1.7"/></svg>
            </button>

          </div>
        </div>

        <div class="tv-indicator-strip">${this.renderSessionToolbar()}</div>
        <div class="tv-workspace">
          <aside class="tv-left-rail">
            ${this.renderLeftRail()}
          </aside>
          <main class="tv-chart-area">
            <div class="tv-chart-head">
              <div>
                <b>${this.symbolName()}</b>
                <span>${this.timeframe} · ${this.assetClass()} · intensefxTRADES</span>
                ${this._historyError ? `<span role="status">XAUUSD historical dataset could not be loaded.</span>` : ""}
              </div>
              ${current ? `<div class="tv-ohlc">
                O <b>${Fmt.price(current.open, meta.decimals)}</b>
                H <b class="up">${Fmt.price(current.high, meta.decimals)}</b>
                L <b class="down">${Fmt.price(current.low, meta.decimals)}</b>
                C <b class="${Fmt.cls(change)}">${Fmt.price(current.close, meta.decimals)}</b>
                Vol <b>${this.shortVolume(current.volume)}</b>
              </div>` : ""}
            </div>
            <div class="bt-chart-card tv-chart-card" id="chartCard">
              ${this.renderChartSurface()}
            </div>
            <div class="tv-range-row">
              ${["1D", "5D", "1M", "3M", "6M", "YTD", "1Y", "3Y", "All"].map((r) => `<button data-range-preset="${r}">${r}</button>`).join("")}
              <span class="tv-clock">${new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}</span>
            </div>
            <div class="bt-bottom-tabs">
              <div class="bt-tabs-head">
                ${["open", "closed"].map((t) => `<button class="bt-tab-btn ${this.bottomTab === t ? "active" : ""}" data-bottomtab="${t}">${t === "open" ? `Open (${openTrades.length})` : `Closed (${s.history.filter((h) => h.symbol === this.symbol).length})`}</button>`).join("")}
              </div>
              <div class="bt-tabs-body">
                ${this.bottomTab === "open" ? this.renderOpenTable(openTrades) : this.renderClosedTable(s.history.filter((h) => h.symbol === this.symbol))}
              </div>
            </div>
          </main>

          <div class="tv-resize-handle" data-side="right" title="Drag to resize"></div>
          <aside class="tv-right-panel">
            <button class="tv-panel-collapse-btn" title="Collapse panel">›</button>
            ${this.renderWatchlist()}
            ${this.renderReplayPanel()}
            ${this.renderSessionPanel()}
            ${this.renderOrderPanel(current, meta, openTrades)}
            ${this.renderInstrumentNews(current, meta)}
            ${this.renderSymbolDetails(current, change, changePct)}
          </aside>
        </div>
        ${this.renderStatusBar(current, meta)}
      </div>
      </div>
    `;
  },

  renderTradingViewPanel() {
    return `<section class="tv-external-chart-panel">
      <div class="tv-external-chart-head">
        <div>
          <b>TradingView Chart</b>
          <span>External market chart separate from intensefxTRADES engine</span>
        </div>
        <div class="tv-external-chart-tags">
          <span>${this.escapeHtml(this.tradingViewSymbol())}</span>
          <span>${this.escapeHtml(this.tradingViewInterval())}</span>
        </div>
      </div>
      <div class="tv-external-chart-frame">
        <div id="tradingViewExternalWidget" class="tradingview-widget-container"></div>
      </div>
    </section>`;
  },

  tradingViewSymbol(symbol = this.symbol) {
    const map = {
      EURUSD: "FX_IDC:EURUSD",
      GBPUSD: "FX_IDC:GBPUSD",
      USDJPY: "FX_IDC:USDJPY",
      XAUUSD: "FX_IDC:XAUUSD",
      GOLD: "FX_IDC:XAUUSD",
      SILVER: "FX_IDC:XAGUSD",
      BTCUSD: "BITSTAMP:BTCUSD",
      ETHUSD: "BITSTAMP:ETHUSD",
    };
    return map[symbol] || `FX_IDC:${symbol}`;
  },

  tradingViewInterval(timeframe = this.timeframe) {
    return ({
      "1m": "1",
      "3m": "3",
      "5m": "5",
      "15m": "15",
      "30m": "30",
      "1h": "60",
      "4h": "240",
      "1d": "D",
      "1w": "W",
      "1M": "M",
    })[timeframe] || "30";
  },

  mountTradingViewWidget(container = this.container) {
    const mount = container?.querySelector?.("#tradingViewExternalWidget");
    if (!mount) return;
    mount.innerHTML = "";
    const widget = document.createElement("div");
    widget.className = "tradingview-widget-container__widget";
    widget.style.height = "100%";
    widget.style.width = "100%";
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.type = "text/javascript";
    script.async = true;
    script.textContent = JSON.stringify({
      autosize: true,
      symbol: this.tradingViewSymbol(),
      interval: this.tradingViewInterval(),
      timezone: "Etc/UTC",
      theme: document.body.classList.contains("light-mode") ? "light" : "dark",
      style: "1",
      locale: "en",
      allow_symbol_change: true,
      calendar: false,
      support_host: "https://www.tradingview.com",
      hide_side_toolbar: false,
      withdateranges: true,
      details: false,
      hotlist: false,
      studies: [],
    });
    mount.appendChild(widget);
    mount.appendChild(script);
  },

  renderStatusBar(current, meta) {
    const conn = this.dataSource !== "unavailable";
    const session = this.currentSessionStats();
    return `<div class="tv-status-bar">
      <div class="tv-status-item"><span>Symbol</span><b>${this.symbol}</b></div>
      <div class="tv-status-sep"></div>
      <div class="tv-status-item"><span>TF</span><b>${this.timeframe}</b></div>
      <div class="tv-status-sep"></div>
      <div class="tv-status-item"><span>Price</span><b id="statusMousePrice">${current ? Fmt.price(current.close, meta.decimals) : "--"}</b></div>
      <div class="tv-status-sep"></div>
      <div class="tv-status-item"><span>Time</span><b id="statusMouseTime">${current ? Fmt.dateTime(current.date) : "--"}</b></div>
      <div class="tv-status-sep"></div>
      <div class="tv-status-item"><span>Replay</span><b>${this.playing ? `Running · ${this.speed.toFixed(1)}x` : "Paused"}</b></div>
      <div class="tv-status-sep"></div>
      <div class="tv-status-item"><span>Session</span><b id="statusSession">${session ? session.shortName : "Off session"}</b></div>
      <div class="tv-status-sep"></div>
      <div class="tv-status-item"><span>Market</span><b>${this.dataLabel()}</b></div>
      <div class="tv-status-item right">
        <span class="tv-status-dot ${conn ? "" : "off"}"></span>
        <span>${conn ? "Connected" : "Offline"}</span>
      </div>
      <div class="tv-status-sep"></div>
      <div class="tv-status-item"><span>Theme</span><b>${document.body.classList.contains("light-mode") ? "Light" : "Dark"}</b></div>
    </div>`;
  },

  dataLabel() {
    if (MarketData.isLocal(this.symbol)) {
      if (this._historyError || this.dataSource === "unavailable") return "XAUUSD historical dataset could not be loaded.";
      if (this.dataSource === "loading") return "Loading local CSV dataset…";
      return "Local CSV";
    }
    if (this.dataSource === "loading") return "Loading real data...";
    if (this.dataSource === "yahoo-cache") return "Real data - Yahoo cached";
    if (this.dataSource === "yahoo-stale-cache") return "Real data - Yahoo stale";
    if (this.dataSource === "cache") return "Real data · cached";
    if (this.dataSource === "stale-cache") return "Real data · stale cache";
    if (this.dataSource === "yahoo") return "Real data · Yahoo 3Y";
    return "Simulated fallback";
  },

  symbolName() {
    const names = {
      BTCUSD: "Bitcoin / U.S. Dollar", ETHUSD: "Ethereum / U.S. Dollar",
      EURUSD: "Euro / U.S. Dollar", GBPUSD: "British Pound / U.S. Dollar",
      USDJPY: "U.S. Dollar / Japanese Yen", XAUUSD: "Gold / U.S. Dollar", GOLD: "Gold",
      SILVER: "Silver",
    };
    return names[this.symbol] || this.symbol;
  },

  renderInstrumentNews(current, meta) {
    const items = this.instrumentNewsItems(current, meta).slice(0, 5);
    return `<div class="tv-panel tv-news-panel">
      <div class="tv-panel-head"><b>Top Instrument News</b><span>${this.escapeHtml(this.symbol)}</span></div>
      <div class="tv-news-list">
        ${items.map((item) => `<div class="tv-news-item">
          <div class="tv-news-kicker"><span>${this.escapeHtml(item.source)}</span><b>${this.escapeHtml(item.time)}</b></div>
          <div class="tv-news-title">${this.escapeHtml(item.title)}</div>
          <div class="tv-news-meta">${this.escapeHtml(item.impact)} impact · ${this.escapeHtml(item.scope)}</div>
        </div>`).join("")}
      </div>
    </div>`;
  },

  instrumentNewsItems(current, meta = MarketData.getMeta(this.symbol)) {
    const symbol = this.symbol;
    const name = this.symbolName();
    const kind = meta.kind || "fx";
    const priceText = current ? Fmt.price(current.close, meta.decimals) : "--";
    const tradedSymbols = [...new Set([
      symbol,
      ...Store.state.active_trades.map((t) => t.symbol),
      ...Store.state.history.slice(-12).map((t) => t.symbol),
    ])].filter(Boolean);
    const scope = tradedSymbols.slice(0, 4).join(", ");
    const templates = {
      fx: [
        ["FX Desk", `${name} traders watch dollar momentum around ${priceText}`],
        ["Rates", "Treasury yield repricing keeps major currency pairs active"],
        ["Macro", "Upcoming inflation and jobs data remain key drivers for FX risk"],
        ["Liquidity", "London and New York overlap expected to carry the strongest volume"],
        ["Risk", `${symbol} setups remain sensitive to central-bank commentary`],
      ],
      metal: [
        ["Metals Desk", `${name} holds focus as spot price trades near ${priceText}`],
        ["Macro", "Gold and silver remain sensitive to dollar and real-yield shifts"],
        ["Risk", "Safe-haven flows stay important around high-impact data releases"],
        ["Liquidity", "New York metals session expected to drive intraday volatility"],
        ["Commodities", `${symbol} traders monitor support and resistance around recent ranges`],
      ],
      crypto: [
        ["Crypto Desk", `${name} volatility stays elevated near ${priceText}`],
        ["Flows", "ETF and exchange-flow headlines remain key for crypto direction"],
        ["Risk", "Broad risk sentiment continues to affect major digital assets"],
        ["Liquidity", "US session volume expected to set the next directional impulse"],
        ["Derivatives", `${symbol} traders watch liquidation zones around recent highs and lows`],
      ],
    };
    const rows = templates[kind] || templates.fx;
    return rows.map(([source, title], index) => ({
      source,
      title,
      time: index === 0 ? "Now" : `${index + 1}h`,
      impact: index < 2 ? "High" : index < 4 ? "Medium" : "Low",
      scope: scope || symbol,
    }));
  },

  assetClass() {
    const kind = MarketData.getMeta(this.symbol).kind;
    return kind === "fx" ? "FOREX" : kind === "metal" ? "METALS" : "CRYPTO";
  },

  TOOL_META: {
    testLine: { name: "Test Line", group: "development" },
    crosshair: { label: "+", name: "Crosshair", shortcut: "Alt+C", group: "nav" },
    zoom: { label: "⌕", name: "Zoom", shortcut: "Alt+Z", group: "nav" },
    scissors: { label: "Cut", name: "Scissors Replay Cut", shortcut: "Alt+S", group: "nav" },
    trend: { label: "/", name: "Trend Line", shortcut: "Alt+T", group: "draw" },
    ray: { label: ">", name: "Ray", shortcut: "Alt+R", group: "draw" },
    extended: { label: "<>", name: "Extended Line", shortcut: "Alt+E", group: "draw" },
    arrow: { label: "->", name: "Arrow", shortcut: "Alt+A", group: "draw" },
    hline: { label: "-", name: "Horizontal Line", shortcut: "Alt+H", group: "draw" },
    vline: { label: "|", name: "Vertical Line", shortcut: "Alt+V", group: "draw" },
    hray: { label: "-\u203a", name: "Horizontal Ray", shortcut: "Alt+Y", group: "draw" },
    vray: { label: "|\u02c5", name: "Vertical Ray", shortcut: "Alt+J", group: "draw" },
    rect: { label: "[]", name: "Rectangle", shortcut: "Alt+Q", group: "draw" },
    ellipse: { label: "()", name: "Ellipse", shortcut: "Alt+O", group: "draw" },
    triangle: { label: "△", name: "Triangle", shortcut: "Alt+G", group: "draw" },
    polygon: { label: "⬠", name: "Polygon", shortcut: "Alt+P", group: "draw" },
    channel: { label: "//", name: "Parallel Channel", shortcut: "Alt+N", group: "draw" },
    fib: { label: "F", name: "Fibonacci", shortcut: "Alt+F", group: "draw" },
    brush: { label: "~", name: "Brush", shortcut: "Alt+B", group: "draw" },
    text: { label: "T", name: "Text", shortcut: "Alt+X", group: "draw" },
    measure: { label: "M", name: "Measure", shortcut: "Alt+M", group: "draw" },
    priceRange: { label: "$", name: "Price Range", shortcut: "Alt+I", group: "draw" },
    dateRange: { label: "D", name: "Date Range", shortcut: "Alt+D", group: "draw" },
    longPosition: { label: "LP", name: "Long Position", shortcut: "Alt+L", group: "position" },
    shortPosition: { label: "SP", name: "Short Position", shortcut: "Alt+K", group: "position" },
    magnet: { label: "U", name: "Magnet mode", shortcut: "Alt+U", group: "util" },
    lock: { label: "L", name: "Lock drawings", shortcut: "", group: "util" },
    eye: { label: "E", name: "Toggle visibility", shortcut: "Alt+V", group: "util" },
    trash: { label: "X", name: "Delete object", shortcut: "Del", group: "util" },
  },

  DRAWING_UI_TOOLS: ["trend", "hline", "vline", "ray", "rect", "ellipse", "triangle", "channel", "fib", "text", "brush", "priceRange", "dateRange", "measure", "longPosition", "shortPosition"],

  DRAWING_RAIL_GROUPS: {
    patterns: { name: 'Patterns / Paths', primary: 'pattern-path', tools: ['abcd','xabcd','elliott-wave','pattern-path','path','polygon','triangle'] },
    symbols: { name: 'Symbols / Markers', primary: 'symbol-smile', tools: ['symbol-smile','symbol-check','symbol-warning','annotation-buy','annotation-sell','annotation-entry','annotation-exit'] },
    fib: { name: 'Fibonacci', primary: 'fib', tools: ['fib','fib-extension','fib-projection','fib-channel'] },
    annotations: { name: 'Annotations / Price Action', primary: 'text', tools: ['text','annotation-note','annotation-callout','annotation-entry','annotation-exit','annotation-buy','annotation-sell','annotation-bos','annotation-choch','zone-order-block','zone-fair-value-gap','zone-supply','zone-demand'] },
    advanced: { name: 'Advanced strokes', primary: 'brush', tools: ['brush','highlighter','path'] },
    lines: { name: "Lines", primary: "trend", tools: ["trend", "crossline", "hline", "vline", "ray", "extended", "arrow", "hray", "vray"] },
    shapes: { name: "Shapes", primary: "rect", tools: ["rect", "ellipse", "triangle", "polygon", "arc"] },
    measurement: { name: "Measurements", primary: "measure", tools: ["priceRange", "dateRange", "measure"] },
    position: { name: "Position / Risk-Reward", primary: "longPosition", tools: ["longPosition", "shortPosition"] },
  },

  RAIL_LABELS: {
    crosshair: "+",
    trend: "╱",
    hline: "─",
    vline: "│",
    ray: "↗",
    rect: "□",
    ellipse: "◇",
    triangle: "△",
    channel: "═",
    fib: "F",
    text: "T",
    brush: "✎",
    priceRange: "↕",
    dateRange: "↔",
    measure: "📏",
    magnet: "🧲",
    undo: "↶",
    redo: "↷",
    eye: "👁",
    lock: "🔒",
    trash: "🗑",
  },

  CURSOR_MODES: {
    crosshair: { icon: "+", name: "Cross", hint: "Full price and time crosshair" },
    dot: { icon: "•", name: "Dot", hint: "Small tracking point" },
    arrow: { icon: "↖", name: "Arrow", hint: "Pointer mode" },
    demo: { icon: "▷", name: "Demonstration", hint: "Presentation pointer" },
    eraser: { icon: "⌫", name: "Eraser", hint: "Click drawing to remove" },
  },

  renderRailBtn(tool) {
    const t = this.TOOL_META[tool];
    const favs = (typeof UI !== "undefined" ? UI.getFavoriteTools() : []) || [];
    const recent = (typeof UI !== "undefined" ? UI.getRecentTools() : []) || [];
    const isFav = favs.includes(tool);
    const isRecent = recent.slice(0, 3).includes(tool) && !isFav;
    if (tool === "crosshair") {
      const mode = this.CURSOR_MODES[this.cursorMode] || this.CURSOR_MODES.crosshair;
      return `<div class="tv-cursor-picker">
        <button class="tv-rail-btn tv-cursor-picker-btn ${this.tool === "crosshair" ? "active" : ""} ${isRecent ? "recent-used" : ""}" id="cursorModeBtn" title="Cursor mode" data-shortcut="${t.shortcut}">
          ${mode.icon}<span class="tv-cursor-caret">▾</span>
        </button>
        <div class="tv-cursor-menu" id="cursorModeMenu">
          ${Object.entries(this.CURSOR_MODES).map(([key, item]) => `
            <button class="tv-cursor-option ${this.cursorMode === key ? "active" : ""}" data-cursor-mode="${key}" title="${item.hint}">
              <span class="tv-cursor-icon">${item.icon}</span><span>${item.name}</span>
            </button>
          `).join("")}
          <div class="tv-cursor-menu-sep"></div>
          <button class="tv-cursor-toggle ${this.valuesTooltipOnLongPress ? "active" : ""}" id="valuesTooltipToggle" type="button">
            <span>Values tooltip on long press</span><i></i>
          </button>
        </div>
      </div>`;
    }
    return `<button class="tv-rail-btn ${this.tool === tool ? "active" : ""} ${isRecent ? "recent-used" : ""}" data-tool="${tool}" data-rail-label="${this.escapeHtml(this.RAIL_LABELS[tool] || t.label)}" title="${t.name}" data-shortcut="${t.shortcut}">
      ${t.label}
      <span class="tv-rail-fav-btn ${isFav ? "on" : ""}" data-fav-tool="${tool}" title="${isFav ? "Remove from favorites" : "Add to favorites"}">★</span>
    </button>`;
  },

  toolSvg(tool) {
    const common = `width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"`;
    const icons = {
      crosshair: `<svg ${common}><path d="M12 4v16M4 12h16"/></svg>`,
      trend: `<svg ${common}><path d="M5 18L19 6"/><circle cx="5" cy="18" r="1.8"/><circle cx="19" cy="6" r="1.8"/></svg>`,
      hline: `<svg ${common}><path d="M4 12h16"/><path d="M7 9h3M14 15h3"/></svg>`,
      vline: `<svg ${common}><path d="M12 4v16"/><path d="M9 7v3M15 14v3"/></svg>`,
      ray: `<svg ${common}><path d="M5 18L18 5"/><path d="M13 5h5v5"/></svg>`,
      rect: `<svg ${common}><rect x="5" y="5" width="14" height="14" rx="1"/></svg>`,
      ellipse: `<svg ${common}><ellipse cx="12" cy="12" rx="7" ry="5"/></svg>`,
      triangle: `<svg ${common}><path d="M12 5l8 14H4L12 5z"/></svg>`,
      channel: `<svg ${common}><path d="M6 17L16 7M9 20L19 10"/></svg>`,
      fib: `<svg ${common}><path d="M5 6h14M5 10h14M5 14h14M5 18h14"/><path d="M8 4v16"/></svg>`,
      text: `<svg ${common}><path d="M5 6h14M12 6v12M9 18h6"/></svg>`,
      brush: `<svg ${common}><path d="M4 17c4-7 7 3 11-5 1.7-3.2 3.2-4.6 5-4"/><path d="M4 20c2 0 3-.8 3-3"/></svg>`,
      priceRange: `<svg ${common}><path d="M12 5v14M8 8l4-4 4 4M8 16l4 4 4-4"/></svg>`,
      dateRange: `<svg ${common}><path d="M5 12h14M8 8l-4 4 4 4M16 8l4 4-4 4"/></svg>`,
      measure: `<svg ${common}><path d="M5 19L19 5"/><path d="M7 17l-2-2M10 14l-2-2M13 11l-2-2M16 8l-2-2"/></svg>`,
      longPosition: `<svg ${common}><path d="M6 17h12"/><path d="M6 12h12"/><path d="M6 7h12"/><path d="M8 12l3-5 3 5"/><path d="M8 12l3 5 3-5"/><path d="M18 7v5h-5"/></svg>`,
      shortPosition: `<svg ${common}><path d="M6 17h12"/><path d="M6 12h12"/><path d="M6 7h12"/><path d="M8 12l3-5 3 5"/><path d="M8 12l3 5 3-5"/><path d="M18 17v-5h-5"/></svg>`,
      magnet: `<svg ${common}><path d="M7 4v7a5 5 0 0010 0V4"/><path d="M7 4h4M13 4h4"/></svg>`,
      undo: `<svg ${common}><path d="M9 7H5v4"/><path d="M5 11a7 7 0 117 7"/></svg>`,
      redo: `<svg ${common}><path d="M15 7h4v4"/><path d="M19 11a7 7 0 10-7 7"/></svg>`,
      eye: `<svg ${common}><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"/><circle cx="12" cy="12" r="2.5"/></svg>`,
      lock: `<svg ${common}><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 018 0v3"/></svg>`,
      trash: `<svg ${common}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>`,
      zoom: `<svg ${common}><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5M7 10h6M10 7v6"/></svg>`,
      stayDrawing: `<svg ${common}><path d="m4 16 11-11 4 4L8 20H4v-4M14 17v-3h6v6h-6v-3"/></svg>`,
      'pattern-path': `<svg ${common}><path d="m4 17 5-11 5 13 6-14"/><circle cx="4" cy="17" r="2"/><circle cx="9" cy="6" r="2"/><circle cx="14" cy="19" r="2"/><circle cx="20" cy="5" r="2"/></svg>`,
      'symbol-smile': `<svg ${common}><circle cx="12" cy="12" r="9"/><path d="M8 14q4 5 8 0M8 8h.1M16 8h.1"/></svg>`,
    };
    return icons[tool] || icons.crosshair;
  },

  renderRailGroupBtn(groupId) {
    const group = this.DRAWING_RAIL_GROUPS[groupId];
    const active = group.tools.includes(this.tool);
    return `<div class="tv-rail-group-popover">
      <button class="tv-rail-btn svg-tool-btn ${active ? "active" : ""}" data-tool-group="${groupId}" title="${group.name}" aria-label="${this.escapeHtml(group.name)}">
        ${this.toolSvg(group.primary)}
      </button>
      ${this.openDrawingToolGroup === groupId ? `<div class="tv-tool-flyout">
        <b>${this.escapeHtml(group.name)}</b>
        ${group.tools.map((tool) => `<button class="${this.tool === tool ? "active" : ""}" data-tool="${tool}">
          ${this.toolSvg(tool)}<span>${this.escapeHtml(this.TOOL_META[tool]?.name || tool)}</span><kbd>${this.shortcutLabelForTool(tool)}</kbd>
        </button>`).join("")}
      </div>` : ""}
    </div>`;
  },

  shortcutLabelForTool(tool) {
    const direct = Object.entries(this.drawingWorkspaceUX?.getState?.().shortcuts || {}).find(([, mapped]) => mapped === tool)?.[0];
    return direct ? direct.toUpperCase() : (this.TOOL_META[tool]?.shortcut || "").replace("Alt+", "");
  },

  renderLeftRail() {
    const favs = (typeof UI !== "undefined" ? UI.getFavoriteTools() : []) || [];
    const recent = ((typeof UI !== "undefined" ? UI.getRecentTools() : []) || []).filter((t) => !favs.includes(t)).slice(0, 3);
    const groups = {
      nav: ["crosshair"],
      draw: ["lines", "shapes", "channel", "fib", "text", "brush", "measurement"],
      util: ["magnet", "undo", "redo", "eye", "lock", "trash"],
    };
    let html = "";
    if (favs.length) {
      html += `<div class="tv-rail-group">${favs.map((t) => this.renderRailBtn(t)).join("")}</div><div class="tv-rail-divider"></div>`;
    }
    if (recent.length) {
      html += `<div class="tv-rail-group">${recent.map((t) => this.renderRailBtn(t)).join("")}</div><div class="tv-rail-divider"></div>`;
    }
    Object.values(groups).forEach((tools, i) => {
      html += `<div class="tv-rail-group">${tools.map((t) => this.DRAWING_RAIL_GROUPS[t] ? this.renderRailGroupBtn(t) : this.renderRailBtn(t)).join("")}</div>`;
      if (i < Object.values(groups).length - 1) html += `<div class="tv-rail-divider"></div>`;
    });
    return html;
  },

  renderDrawingSettingsDialog() {
    const drawing = this.drawings.find(d=>d.id===this.selectedDrawingIds[0]);
    if (!this.drawingSettingsOpen || !drawing) return '';
    const wasHidden=this.drawingManagerHidden;
    this.drawingManagerHidden=false;
    let html;
    try { html=this.renderDrawingManager(); } finally { this.drawingManagerHidden=wasHidden; }
    const from=html.indexOf('<div class="tv-drawing-style">');
    const end=html.indexOf('<div class="tv-drawing-list"',from);
    const appearance = html.slice(from, end);
    return `<div class="tv-object-settings-backdrop"><section class="tv-object-settings" role="dialog" aria-modal="true" aria-label="Drawing settings"><header><b>${this.escapeHtml(this.drawingDisplayName(drawing))}</b><button id="closeDrawingSettingsBtn" aria-label="Close drawing settings">×</button></header>${appearance}</section></div>`;
  },

  renderDrawingHelp() {
    if (!this.drawingHelpOpen) return '';
    const tools = (this.drawingEngine?.toolRegistry?.getAllTools?.() || [])
      .filter((tool) => Number(tool.requiredAnchors) > 0 && !String(tool.id).startsWith("test-"))
      .sort((a, b) => String(a.category).localeCompare(String(b.category)) || String(a.name).localeCompare(String(b.name)));
    const instructionsFor = (tool) => {
      if (tool.creationMode === "freehand") return "Press and hold the left mouse button, move across the chart, then release to finish.";
      if (tool.creationMode === "polygon") return "Click each chart point, then double-click or press Enter to finish.";
      if (Number(tool.requiredAnchors) === 1) return "Click the chart once to place this tool.";
      return `Click ${tool.requiredAnchors} chart points. Move between clicks to preview; double-click or press Enter to finish multi-point tools.`;
    };
    return `<aside class="tv-tool-help" id="drawingToolHelp" aria-label="Drawing tool help">
      <header><b>TradeFXBook drawing tools</b><button type="button" id="closeDrawingHelpBtn" aria-label="Close tool help">×</button></header>
      <input id="drawingHelpSearch" placeholder="Search tools or categories" aria-label="Search tool help">
      <div class="tv-tool-help-list">${tools.map((tool) => {
        const name = tool.name || tool.id;
        const category = tool.category || "Drawing";
        const searchText = `${name} ${category} ${tool.description || ""}`.toLowerCase();
        return `<details data-help-search="${this.escapeHtml(searchText)}">
          <summary><span>${this.escapeHtml(name)}</span><small>${this.escapeHtml(category)}</small></summary>
          <p>${this.escapeHtml(tool.description || `${category} chart tool.`)}</p>
          <p>${this.escapeHtml(instructionsFor(tool))}</p>
          <p>To edit later, click the drawing to select it, drag its body to move it, or drag a handle to edit an anchor. Double-click it for appearance and timestamp/price settings. Use Delete to remove it, Esc to cancel, Ctrl+Z to undo, and Ctrl+Y to redo.</p>
          <p>Opacity is available in the chart toolbar and object settings. Drawings stay anchored to chart time and price while zooming or panning.</p>
          <button type="button" data-help-activate="${this.escapeHtml(tool.id)}">Use ${this.escapeHtml(name)}</button>
        </details>`;
      }).join("") || `<p class="tv-tool-help-empty">No drawing tools are available yet.</p>`}</div>
    </aside>`;
  },

  renderRailBtn(tool) {
    const fallbackMeta = {
      zoom: { name: 'Zoom area — drag to focus', shortcut: 'Alt+Z' },
      stayDrawing: { name: 'Stay in drawing mode', shortcut: '' },
      undo: { name: "Undo drawing", shortcut: "Ctrl+Z" },
      redo: { name: "Redo drawing", shortcut: "Ctrl+Shift+Z" },
    };
    const t = this.TOOL_META[tool] || fallbackMeta[tool];
    if (!t) return "";
    const isActive = tool === "magnet" ? this.magnetMode : this.tool === tool;
    const isDisabled =
      (tool === "undo" && !this.drawingEngine?.canUndo?.()) ||
      (tool === "redo" && !this.drawingEngine?.canRedo?.());
    const shortcut = this.shortcutLabelForTool(tool);
    const title = `${t.name}${shortcut ? ` (${shortcut})` : ""}`;
    return `<button class="tv-rail-btn svg-tool-btn ${isActive ? "active" : ""}" data-tool="${tool}" title="${this.escapeHtml(title)}" aria-label="${this.escapeHtml(t.name)}" ${isDisabled ? "disabled" : ""}>
      ${this.toolSvg(tool)}
    </button>`;
  },

  renderFullscreenSessionNavigation() {
    const sessionType = this.selectedSessionType();
    const definition = this.sessionEngine?.getConfig?.().definitions?.[sessionType];
    const short = this.sessionShortLabel(definition);
    const name = definition?.name || "Session";
    return `<div class="tv-fullscreen-session-nav" aria-label="${this.escapeHtml(name)} navigation">
      <button type="button" class="replay-btn" data-fullscreen-session-nav="previous" title="Go to the previous ${this.escapeHtml(name)}">Previous ${this.escapeHtml(short)}</button>
      <button type="button" class="replay-btn active" data-fullscreen-session-nav="go" title="Go to the selected ${this.escapeHtml(name)} date">GO TO ${this.escapeHtml(short)}</button>
      <button type="button" class="replay-btn" data-fullscreen-session-nav="next" title="Go to the next ${this.escapeHtml(name)}">Next ${this.escapeHtml(short)}</button>
    </div>`;
  },

  renderProfessionalDrawingToolbar() {
    return "";
  },

  renderLeftRail() {
    const groups = [
      ["crosshair"],
      ["lines", "fib", "patterns", "position", "shapes", "advanced", "annotations", "symbols", "measurement", "zoom"],
      ["magnet", "stayDrawing", "lock", "eye", "undo", "redo", "trash"],
    ];
    return groups.map((tools) => `<div class="tv-rail-group">${tools.map((tool) => (
      this.DRAWING_RAIL_GROUPS[tool] ? this.renderRailGroupBtn(tool) : this.renderRailBtn(tool)
    )).join("")}</div>`).join(`<div class="tv-rail-divider"></div>`);
  },

  renderWatchlist() {
    const groups = [
      ["METALS", ["GOLD", "SILVER", "XAUUSD"]],
      ["FOREX", ["EURUSD", "GBPUSD", "USDJPY"]],
      ["CRYPTO", ["BTCUSD", "ETHUSD"]],
    ];
    return `<div class="tv-panel">
      <div class="tv-panel-head"><b>Watchlist</b><span>Last Chg%</span></div>
      ${groups.map(([label, symbols]) => `
        <div class="tv-watch-group">${label}</div>
        ${symbols.map((sym) => {
          const meta = MarketData.getMeta(sym);
          if (MarketData.isLocal(sym)) {
            const candle = MarketData.isLocal(this.symbol) && this.dataSource === "local-csv" ? this.candles[this.idx] : null;
            return `<button class="tv-watch-row ${sym === this.symbol ? "active" : ""}" data-watch-symbol="${sym}"><span><i style="background:${meta.color}"></i>${sym}</span><b>${candle ? Fmt.price(candle.close, meta.decimals) : "—"}</b><em>CSV</em></button>`;
          }
          const base = meta.base || 1;
          const pseudo = ((sym.charCodeAt(0) + sym.length * 7) % 240 - 120) / 100;
          return `<button class="tv-watch-row ${sym === this.symbol ? "active" : ""}" data-watch-symbol="${sym}">
            <span><i style="background:${meta.color}"></i>${sym}</span>
            <b>${Fmt.price(base, meta.decimals)}</b>
            <em class="${pseudo >= 0 ? "up" : "down"}">${pseudo.toFixed(2)}%</em>
          </button>`;
        }).join("")}
      `).join("")}
    </div>`;
  },

  renderReplayPanel() {
    const hiddenCount = this.replayActive ? this.hiddenCandles.length : Math.max(0, this.candles.length - this.idx - 1);
    const current = this.candles[this.idx];
    const replayDate = current ? new Date(current.date.getTime() - current.date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";
    const speeds = [0.25, 0.5, 1, 2, 5, 10, 20, 50, 100];
    const progressMax = Math.max(0, this.candles.length - 1);
    const progressPct = progressMax > 0 ? Math.round((this.idx / progressMax) * 100) : 0;
    return `<div class="tv-panel tv-replay-panel">
      <div class="tv-panel-head"><b>Replay</b><span id="replayStateLabel">${this.replayStateText()}</span></div>
      <div class="replay-grid">
        <button class="replay-btn" id="btnPrev" title="Step one candle backward">Step −</button>
        <button class="replay-btn" id="btnNext" title="Step one candle forward">Step +</button>
        <button class="replay-btn ${this.playing ? "playing" : ""}" id="btnPlay" title="Play or pause one historical candle at a time">${this.playing ? "Pause" : "Play"}</button>
        <button class="replay-btn" id="btnBack10" title="Move back ten candles">−10</button>
        <button class="replay-btn" id="btnF10" title="Move forward ten candles">+10</button>
        <button class="replay-btn" id="btnReplayStart" title="Return to the replay start candle">Start</button>
        <button class="replay-btn" id="btnEnd" title="Process candles through the dataset end">End</button>
        <button class="replay-btn" id="btnReplayLive" title="Exit replay and show the latest candle">Live</button>
      </div>
      <div class="speed-row">
        <span>Speed</span>
        <input type="range" id="speedSlider" min="2.5" max="1000" step="2.5" value="${this.speed * 10}">
        <span class="mono" id="replaySpeedLabel">${this.speed.toFixed(1)}x</span>
      </div>
      <div class="replay-speed-presets">
        ${speeds.map((speed) => `<button class="${Math.abs(this.speed - speed) < 0.01 ? "active" : ""}" data-replay-speed="${speed}">${speed}x</button>`).join("")}
      </div>
      <div class="replay-date-row">
        <input type="datetime-local" id="replayDateInput" value="${replayDate}">
        <button class="replay-btn" id="btnReplayDate">Go</button>
      </div>
      <div class="replay-progress-row">
        <input type="range" id="replayProgress" min="0" max="${progressMax}" value="${this.idx}">
        <span id="replayProgressLabel">${progressPct}%</span>
      </div>
      <div class="replay-grid">
        <button class="replay-btn" id="btnBookmarkAdd">Bookmark</button>
        <button class="replay-btn" id="btnBookmarkPrev">Prev Mark</button>
        <button class="replay-btn" id="btnBookmarkNext">Next Mark</button>
        <button class="replay-btn" id="btnBookmarkClear">Clear</button>
      </div>
      <div class="order-info-row"><span>Hidden candles</span><b id="replayHiddenCount">${hiddenCount.toLocaleString()}</b></div>
      <div class="order-info-row"><span>Bookmarks</span><b id="replayBookmarkCount">${this.replayBookmarks.length}</b></div>
    </div>`;
  },

  replayStateText() {
    if (this.playing) return "Running";
    if (this.replayActive) return "Ready";
    if (this.tool === "scissors") return "Select candle";
    return "Live";
  },

  renderOrderPanel(current, meta, openTrades) {
    const riskPlan = this.selectedRiskPlan();
    return `<div class="order-card tv-order-card">
      <div class="tv-panel-head"><b>${this.symbol}</b><span>${current ? Fmt.dateTime(current.date) : ""}</span></div>
      ${this.renderOrderDraft(meta)}
      <div class="tv-trade-guide" role="note">
        <b>Quick start</b>
        <span>1. Press Replay to reveal candles one at a time.</span>
        <span>2. Set lots and optional SL / TP.</span>
        <span>3. Buy or Sell at the current candle.</span>
      </div>
      ${riskPlan ? `<button type="button" class="tv-plan-btn" id="useRiskPlanBtn">
        Use ${riskPlan.direction === "long" ? "Long" : "Short"} chart plan
        <span>SL ${Fmt.price(riskPlan.stopLoss.price, meta.decimals)} · TP ${Fmt.price(riskPlan.takeProfit.price, meta.decimals)}</span>
      </button>` : ""}
      ${riskPlan ? `<button type="button" class="tv-plan-btn" id="createPlanTradeBtn">Create Backtest Trade from chart plan</button>` : ''}
      <div class="order-tabs">
        ${["Market", "Limit", "Stop"].map((t) => `<button class="order-tab-btn ${t === this.orderTab ? "active" : ""}" data-ordertab="${t}">${t}</button>`).join("")}
      </div>
      ${this.orderTab !== "Market" ? `<div class="field-row"><label class="field-label">Entry price</label><input type="number" step="any" id="pendingPriceInput" value="${this.pendingPrice ?? (current ? current.close : "")}" placeholder="Price to trigger"></div><div class="order-helper">${this.orderTab} orders trigger when a replay candle reaches this price.</div>` : ""}
      <div class="field-row"><span class="field-label">Units (Lots)</span></div>
      <div class="stepper" style="width:100%;margin-bottom:12px">
        <button data-lot-step="-1">-</button>
        <input type="text" id="lotsInput" value="${this.lots.toFixed(2)}" style="flex:1">
        <button data-lot-step="1">+</button>
      </div>
      <div class="field-row">
        <label class="field-label"><input type="checkbox" id="tpCheck" ${this.tpEnabled ? "checked" : ""}> Take Profit</label>
        <input type="number" class="pip-input" id="tpInput" value="${this.tpPips}" ${this.tpEnabled ? "" : "disabled"}>
      </div>
      <div class="field-row">
        <label class="field-label"><input type="checkbox" id="slCheck" ${this.slEnabled ? "checked" : ""}> Stop Loss</label>
        <input type="number" class="pip-input" id="slInput" value="${this.slPips}" ${this.slEnabled ? "" : "disabled"}>
      </div>
      <div class="order-info-row"><span>Pip Value</span><b>${Fmt.moneyPlain(this.pipValueFor(meta))}</b></div>
      ${this.renderRiskSummary(current, meta)}
      <div class="bt-trade-buttons">
        <button class="bt-sell-btn" id="btnSell"><div class="bt-px-label">${this.orderTab === "Market" ? "Sell" : `Place ${this.orderTab} Sell`}</div><div class="bt-px-value">${current ? Fmt.price(this.orderTab === "Market" ? current.close : (this.pendingPrice ?? current.close), meta.decimals) : "--"}</div></button>
        <button class="bt-buy-btn" id="btnBuy"><div class="bt-px-label">${this.orderTab === "Market" ? "Buy" : `Place ${this.orderTab} Buy`}</div><div class="bt-px-value">${current ? Fmt.price(this.orderTab === "Market" ? current.close : (this.pendingPrice ?? current.close), meta.decimals) : "--"}</div></button>
      </div>
      ${openTrades.length ? `<button class="bt-close-btn" id="btnCloseActive">Close Active Position</button>
      <button class="bt-close-btn bt-close-all-btn" id="btnCloseAllPositions">Close All Positions</button>` : ""}
    </div>`;
  },

  // Read-only risk estimate block: derived from existing lots/TP/SL inputs only.
  // Does not alter order placement, sizing, or execution — display purposes only.
  renderRiskSummary(current, meta) {
    if (!current) return "";
    const pipVal = this.pipValueFor(meta);
    const estLoss = this.slEnabled ? this.slPips * pipVal : 0;
    const estProfit = this.tpEnabled ? this.tpPips * pipVal : 0;
    const rr = this.slEnabled && this.slPips > 0 && this.tpEnabled ? (this.tpPips / this.slPips) : null;
    const riskPct = Store.state.balance > 0 ? (estLoss / Store.state.balance) * 100 : 0;
    const local = MarketData.isLocal(this.symbol);
    const paired = current.bid && current.ask;
    const spreadPips = local ? (paired ? (current.ask.close - current.bid.close) / meta.pip : 0) : +(meta.pip * 1.4).toPrecision(2);
    const bid = local ? current.bid?.close : current.close - (spreadPips * meta.pip) / 2;
    const ask = local ? current.ask?.close : current.close + (spreadPips * meta.pip) / 2;
    return `<div class="tv-key-stats" id="orderRiskSummary" style="margin:10px 0;">
      <span>Bid / Ask</span><b>${bid == null ? "Unavailable" : Fmt.price(bid, meta.decimals)} / ${ask == null ? "Unavailable" : Fmt.price(ask, meta.decimals)}</b>
      <span>Spread</span><b>${local && !paired ? "OHLC execution (no spread data)" : spreadPips.toFixed(1) + " pips"}</b>
      <span>Position size</span><b>${(this.lots * (meta.kind === "fx" ? 100000 : meta.kind === "crypto" ? 1 : 100)).toLocaleString()}</b>
      <span>Risk %</span><b class="${riskPct > 2 ? "down" : ""}">${this.slEnabled ? riskPct.toFixed(2) + "%" : "—"}</b>
      <span>Risk / Reward</span><b>${rr ? `1 : ${rr.toFixed(2)}` : "—"}</b>
      <span>Est. loss</span><b class="down">${this.slEnabled ? Fmt.moneyPlain(-estLoss) : "—"}</b>
      <span>Est. profit</span><b class="up">${this.tpEnabled ? Fmt.moneyPlain(estProfit) : "—"}</b>
    </div>`;
  },

  renderSymbolDetails(current, change, changePct) {
    return `<div class="tv-panel">
      <div class="tv-detail-title">${SymbolUI.iconHtml(this.symbol, 30)}<div><b>${this.symbol}</b><span>${this.symbolName()}</span></div></div>
      <div class="tv-detail-price ${Fmt.cls(change)}">${current ? Fmt.price(current.close, MarketData.getMeta(this.symbol).decimals) : "--"}</div>
      <div class="${Fmt.cls(change)}">${change >= 0 ? "+" : ""}${change.toFixed(2)} ${changePct.toFixed(2)}%</div>
      <div class="tv-key-stats">
        <span>Source</span><b>${this.dataLabel()}</b>
        <span>Volume</span><b>${this.shortVolume(current?.volume || 0)}</b>
        <span>Open positions</span><b>${Store.state.active_trades.filter((t) => t.symbol === this.symbol).length}</b>
        <span>Loaded candles</span><b>${this.candles.length}</b>
      </div>
    </div>`;
  },

  renderOpenTable(trades) {
    if (!trades.length) return emptyState("No open position on this symbol", "Use Buy/Sell to simulate an order.");
    const decimals = MarketData.getMeta(this.symbol).decimals;
    return `<table class="data-table"><thead><tr><th>Side</th><th>Entry</th><th>Lots</th><th>SL</th><th>TP</th><th>Floating P&amp;L</th></tr></thead><tbody>
      ${trades.map((t) => `<tr><td><span class="dir-pill ${t.type === "BUY" ? "long" : "short"}">${t.type}</span></td><td class="mono">${Fmt.price(t.entry, decimals)}</td><td class="mono">${t.lots}</td><td class="mono dim">${t.sl ? Fmt.price(t.sl, decimals) : "-"}</td><td class="mono dim">${t.tp ? Fmt.price(t.tp, decimals) : "-"}</td><td class="mono ${Fmt.cls(t.floating_pnl || 0)}">${this.formatTradePnl(t, true)}</td></tr>`).join("")}
    </tbody></table>`;
  },

  renderClosedTable(history) {
    if (!history.length) return emptyState("No closed trades on this symbol yet", "Closed trades will show up here.");
    const decimals = MarketData.getMeta(this.symbol).decimals;
    return `<table class="data-table"><thead><tr><th>#</th><th>Side</th><th>Entry</th><th>Exit</th><th>Lots</th><th>P&amp;L</th><th>Result</th></tr></thead><tbody>
      ${[...history].reverse().map((t) => `<tr><td class="dim">${t.id}</td><td><span class="dir-pill ${t.type === "BUY" ? "long" : "short"}">${t.type}</span></td><td class="mono">${Fmt.price(t.entry, decimals)}</td><td class="mono">${Fmt.price(t.exit, decimals)}</td><td class="mono">${t.lots}</td><td class="mono ${Fmt.cls(t.pnl)}">${this.formatTradePnl(t)}</td><td><span class="result-pill ${t.result === "WIN" ? "win" : "loss"}">${t.result}</span></td></tr>`).join("")}
    </tbody></table>`;
  },

  formatTradePnl(trade, floating = false) {
    if (typeof UI === "undefined" || !UI.getSetting?.("showPips")) return Fmt.money(floating ? trade.floating_pnl || 0 : trade.pnl || 0);
    const pip = MarketData.getMeta(trade.symbol).pip || 1;
    let pips;
    if (floating) {
      const contract = ({ EURUSD: 100000, GBPUSD: 100000, USDJPY: 100000, XAUUSD: 100, GOLD: 100, SILVER: 5000, BTCUSD: 1, ETHUSD: 1 })[trade.symbol] || 100000;
      pips = (Number(trade.floating_pnl) || 0) / (Math.max(Number(trade.lots) || 0, 1e-12) * contract * pip);
    } else {
      const direction = trade.type === "SELL" ? -1 : 1;
      pips = ((Number(trade.exit) - Number(trade.entry)) * direction) / pip;
    }
    return `${pips >= 0 ? "+" : ""}${pips.toFixed(1)} pips`;
  },

  renderChartSurface() {
    const current = this.candles[this.idx];
    const replayAllowed = Boolean(window.SubscriptionSystem?.canAccessFeature("replay"));
    return `
      <canvas id="tvBgCanvas" class="tv-bg-canvas"></canvas>
      <canvas id="tvCanvas" class="tv-canvas"></canvas>
      <canvas id="tvDrawingCanvas" class="tv-drawing-canvas" aria-hidden="true"></canvas>
      <canvas id="tvInteractionCanvas" class="tv-interaction-canvas" aria-hidden="true"></canvas>
      ${this.renderFullscreenSessionNavigation()}
      ${this.renderProfessionalDrawingToolbar()}
      <div class="tv-chart-controls">
        <div class="tv-control-group">
          <span class="tv-control-label">X</span>
          <button class="tv-control-btn" data-zoom-x="in" title="Zoom in horizontally" data-shortcut="+">+</button>
          <button class="tv-control-btn" data-zoom-x="out" title="Zoom out horizontally" data-shortcut="-">-</button>
        </div>
        <div class="tv-control-group">
          <span class="tv-control-label">Y</span>
          <button class="tv-control-btn" data-zoom-y="in" title="Zoom in vertically">+</button>
          <button class="tv-control-btn" data-zoom-y="out" title="Zoom out vertically">-</button>
        </div>
        <div class="tv-control-group">
          ${replayAllowed ? `<button class="tv-control-btn tv-control-btn-wide ${this.tool === "scissors" ? "active" : ""}" id="scissorsToolBtn" title="Choose the candle where replay should begin">Set start</button>` : `<button class="tv-control-btn tv-control-btn-wide" data-plan-feature="replay">Replay · Pro</button>`}
          <button class="tv-control-btn tv-control-btn-wide ${!this.replayActive && this.tool !== "scissors" ? "active" : ""}" id="liveChartBtn" title="Exit replay and show latest live chart">Live</button>
          <button class="tv-control-btn" id="fitAllBtn" title="Fit all loaded candles">Fit</button>
          <button class="tv-control-btn" id="resetViewBtn" title="Reset zoom & price scale">1:1</button>
          <button class="tv-control-btn ${this.autoFollow ? "active" : ""}" id="goLatestBtn" title="Go to latest candle (Home)" data-shortcut="Home">⏭</button>
        </div>
        <div class="tv-control-group">
          ${replayAllowed ? `<button class="tv-control-btn tv-control-btn-wide ${this.playing ? "active" : ""}" id="chartReplayBtn" title="Play historical candles from the current view" data-shortcut="Space">${this.playing ? "Pause" : "Replay"}</button><button class="tv-control-btn tv-control-btn-wide" id="chartReplayResetBtn" title="Restart replay from the loaded history">Reset</button>` : `<button class="tv-control-btn tv-control-btn-wide" data-plan-feature="replay">Replay · Pro</button>`}
        </div>
      </div>
      ${this.renderFullscreenReplayDock()}
      <div class="tv-datetime-chip">${current ? this.axisDateTimeLabel(current.date) : "--"}</div>
      <div class="tv-crosshair-tip" id="crosshairTip"></div>
      <div class="tv-chart-watermark">intensefxTRADES</div>
    `;
  },

  renderDrawingManager() {
    if (this.drawingManagerHidden) {
      return `<button class="tv-drawing-manager-restore" id="drawingManagerRestoreBtn" title="Show drawings panel">
        ${this.toolSvg("eye")} <span>Drawings</span>
      </button>`;
    }
    const selected = this.drawings.find((d) => this.selectedDrawingIds.includes(d.id));
    const style = { ...this.drawingDefaults, ...(selected?.style || {}) };
    const properties = selected?.properties || {};
    const isFillDrawing = ["rectangle", "circle", "ellipse", "triangle", "polygon", "parallelChannel"].includes(selected?.type);
    const isTextDrawing = selected?.type === "text";
    const objects = this.filteredObjectTreeDrawings();
    const groups = this.drawingWorkspaceUX?.getState?.().groups || {};
    const groupOrder = this.drawingWorkspaceUX?.getState?.().groupOrder || [];
    const labelFor = (d) => ({
      trendLine: "Trend",
      ray: "Ray",
      extendedLine: "Extended",
      arrow: "Arrow",
      horizontalRay: "H-Ray",
      verticalRay: "V-Ray",
      horizontalLine: "Horizontal",
      verticalLine: "Vertical",
      rectangle: "Rectangle",
      ellipse: "Ellipse",
      triangle: "Triangle",
      polygon: "Polygon",
      parallelChannel: "Channel",
      fibRetracement: "Fibonacci",
      polyline: "Brush",
      text: "Text",
      riskReward: "Measure",
      priceRange: "Price Range",
      dateRange: "Date Range",
    }[d.type] || d.type);
    const rowFor = (d) => `<button class="tv-drawing-row ${this.selectedDrawingIds.includes(d.id) ? "active" : ""}" data-drawing-id="${d.id}" draggable="true">
      <span>${this.escapeHtml(this.drawingDisplayName(d))}</span>
      <small>${d.locked ? "Lock" : d.visible === false ? "Hide" : `L${d.layer || 0}`}</small>
    </button>`;
    const rootDrawings = objects.filter((d) => !this.groupForDrawing(d.id));
    const groupHtml = groupOrder.map((groupId) => groups[groupId]).filter(Boolean).map((group) => {
      const children = objects.filter((d) => (group.children || []).includes(d.id));
      return `<div class="tv-object-group ${group.collapsed ? "collapsed" : ""}" data-group-id="${group.id}">
        <div class="tv-object-group-head">
          <button data-group-action="toggle" data-group-id="${group.id}">${group.collapsed ? "+" : "-"}</button>
          <b>${this.escapeHtml(group.name)}</b>
          <span>${children.length}</span>
          <button data-group-action="visibility" data-group-id="${group.id}">${group.visible === false ? "Show" : "Hide"}</button>
          <button data-group-action="lock" data-group-id="${group.id}">${group.locked ? "Unlock" : "Lock"}</button>
        </div>
        ${group.collapsed ? "" : `<div class="tv-object-group-children">${children.length ? children.map(rowFor).join("") : `<div class="tv-drawing-empty">No drawings in group</div>`}</div>`}
      </div>`;
    }).join("");
    return `<div class="tv-drawing-manager" id="drawingManager">
      <div class="tv-drawing-manager-head"><b>DRAWINGS</b><span>⌕  ⚱  ⋯</span></div>
      <button class="tv-drawing-panel-hide" id="drawingManagerHideBtn" title="Hide drawings panel" aria-label="Hide drawings panel" type="button">×</button>
      <button class="tv-drawing-hide-selected" id="drawingHideBtn" title="${selected?.visible === false ? "Show selected drawing" : "Hide selected drawing"}" ${selected ? "" : "disabled"}>
        ${this.toolSvg("eye")} <span>${selected?.visible === false ? "Show Selected Drawing" : "Hide Selected Drawing"}</span>
      </button>
      <div class="tv-object-tree-tools">
        <select id="drawingObjectSymbol" disabled><option>${this.symbol}</option></select>
        <select id="drawingObjectFilter">
          ${["all", "lines", "shapes", "fibonacci", "measurements", "annotations", "hidden", "locked", "groups"].map((value) => `<option value="${value}" ${this.drawingObjectFilter === value ? "selected" : ""}>${value}</option>`).join("")}
        </select>
      </div>
      <input class="tv-drawing-text-input" id="drawingObjectSearch" value="${this.escapeHtml(this.drawingObjectSearch)}" placeholder="Search drawings">
      <div class="tv-drawing-style">
        <label>Color <input type="color" id="drawingColorInput" value="${style.color || "#d1d4dc"}" ${selected ? "" : "disabled"}></label>
        <label>Width <input type="range" id="drawingWidthInput" min="1" max="6" step="0.5" value="${style.width || 1.5}" ${selected ? "" : "disabled"}></label>
        <label>Opacity <span class="tv-opacity-field"><input type="range" id="drawingOpacityInput" min="0.05" max="1" step="0.05" value="${style.opacity ?? 1}"><output id="drawingOpacityValue">${Math.round((style.opacity ?? 1) * 100)}%</output></span></label>
        <label>Line <select id="drawingLineStyleInput" ${selected ? "" : "disabled"}>
          ${["solid", "dashed", "dotted"].map((value) => `<option value="${value}" ${style.lineStyle === value ? "selected" : ""}>${value}</option>`).join("")}
        </select></label>
        ${isFillDrawing ? `<label>Fill <input type="color" id="drawingFillColorInput" value="${style.fillColor || "#3d7fff"}"></label>
        <label>Fill Opacity <input type="range" id="drawingFillOpacityInput" min="0" max="1" step="0.05" value="${style.fillOpacity ?? 0.16}"></label>` : ""}
        ${selected && ["trendLine", "ray", "extendedLine", "rectangle"].includes(selected.type) ? `<label><input type="checkbox" id="drawingExtendLeftInput" ${properties.extendLeft ? "checked" : ""}> Extend L</label>
        <label><input type="checkbox" id="drawingExtendRightInput" ${properties.extendRight ? "checked" : ""}> Extend R</label>` : ""}
      </div>
      ${selected?.type === "fibRetracement" ? `<label>Fibonacci levels <input id="drawingFibLevelsInput" value="${this.escapeHtml((properties.levels || [0,0.236,0.382,0.5,0.618,0.786,1,1.272,1.618]).join(', '))}"></label><label><input type="checkbox" id="drawingFibReverseInput" ${properties.reverse ? "checked" : ""}> Reverse Fibonacci</label><label><input type="checkbox" id="drawingFibExtendInput" ${properties.extendRight ? "checked" : ""}> Extend levels right</label>` : ""}
      ${isTextDrawing ? `<input class="tv-drawing-text-input" id="drawingTextInput" value="${this.escapeHtml(selected.metadata?.text || "Text")}" placeholder="Text label">
        <div class="tv-drawing-style">
          <label>Text <input type="color" id="drawingTextColorInput" value="${style.textColor || style.color || "#d1d4dc"}"></label>
          <label>Size <input type="range" id="drawingFontSizeInput" min="8" max="40" step="1" value="${style.fontSize || 13}"></label>
          <label>Weight <select id="drawingFontWeightInput">
            ${["400", "500", "600", "700"].map((value) => `<option value="${value}" ${String(style.fontWeight || "400") === value ? "selected" : ""}>${value}</option>`).join("")}
          </select></label>
        </div>` : ""}
      ${selected ? `<details><summary>Coordinates</summary>${selected.anchors.map((anchor,index)=> `<label>Anchor ${index+1} UTC <input type="datetime-local" step="1" data-anchor-time="${index}" value="${new Date(anchor.time ?? anchor.timestamp).toISOString().slice(0,19)}" ${selected.locked?'disabled':''}></label><label>Price <input type="number" step="any" data-anchor-price="${index}" value="${anchor.price}" ${selected.locked?'disabled':''}></label>`).join('')}</details>` : ''}
      <div class="tv-drawing-actions">
        <button data-drawing-action="rename" ${selected ? "" : "disabled"}>Rename</button>
        <button data-drawing-action="group" ${this.selectedDrawingIds.length ? "" : "disabled"}>Group</button>
        <button data-drawing-action="front" ${selected ? "" : "disabled"}>Front</button>
        <button data-drawing-action="back" ${selected ? "" : "disabled"}>Back</button>
        <button data-drawing-action="lock" ${selected ? "" : "disabled"}>${selected?.locked ? "Unlock" : "Lock"}</button>
        <button data-drawing-action="visibility" ${selected ? "" : "disabled"}>${selected?.visible === false ? "Show" : "Hide"}</button>
        <button data-drawing-action="template" ${selected ? "" : "disabled"}>Template</button>
        <button data-drawing-action="delete" ${selected ? "" : "disabled"}>Delete</button>
      </div>
      ${selected ? this.renderQuickDrawingTemplates(selected) : ""}
      <div class="tv-drawing-list">
        <div class="tv-object-symbol-head">${this.symbol} <span>Drawings (${objects.length})</span></div>
        ${groupHtml}
        ${rootDrawings.length ? rootDrawings.map(rowFor).join("") : (groupHtml ? "" : `<div class="tv-drawing-empty">No drawings yet. Create your first drawing using the toolbar.</div>`)}
      </div>
      <button class="tv-delete-all-drawings" id="deleteAllDrawingsBtn" ${this.drawings.length ? "" : "disabled"}>${this.toolSvg("trash")} Delete All Drawings</button>
    </div>`;
  },

  renderSessionToolbar() {
    const fxn = this.getFxnIndicator();
    if (!window.SubscriptionSystem?.canAccessFeature("technicalIndicators")) {
      return `<div class="tv-session-menu-wrap"><button class="tv-action" data-plan-feature="technicalIndicators">Indicators · Purple</button><button class="tv-action" data-plan-feature="technicalIndicators">Volume · Purple</button></div>`;
    }
    return `<div class="tv-session-menu-wrap">
      <button class="tv-action ${fxn?.config.enabled ? 'active' : ''}" id="fxnToggleBtn" aria-pressed="${!!fxn?.config.enabled}" title="FXN - Asian Session Range by RobMinty">FXN - Asian Session Range: ${fxn?.config.enabled ? 'ON' : 'OFF'}</button>
      <button class="tv-action" id="fxnSettingsBtn" title="FXN indicator settings">FXN ⚙</button>
      ${this.fxnSettingsOpen ? this.renderFxnSettings() : ''}
      <button class="tv-action ${this.isVolumeVisible() ? 'active' : ''}" id="volumeToggleBtn" aria-pressed="${this.isVolumeVisible()}">Vol: ${this.isVolumeVisible() ? 'ON' : 'OFF'}</button>
    </div>`;
  },

  renderSessionMenu(config = this.sessionEngine?.getConfig?.()) {
    if (!config) return "";
    const checkbox = (id, checked, label) => `<label class="tv-session-check"><input type="checkbox" data-session-toggle="${id}" ${checked ? "checked" : ""}><span>${label}</span></label>`;
    return `<div class="tv-session-menu">
      <b>Sessions</b>
      ${checkbox("enabled", config.enabled, "Show Sessions")}
      ${Object.values(config.definitions).map((def) => checkbox(`def:${def.id}`, def.enabled, def.name)).join("")}
      <div class="tv-session-menu-sep"></div>
      ${checkbox("showLabels", config.showLabels, "Session Labels")}
      ${checkbox("showHighLow", config.showHighLow, "High / Low")}
      ${checkbox("showOpen", config.showOpen, "Session Open")}
      <button class="tv-session-menu-link" id="sessionSettingsExpandBtn">${this.sessionRangeOpen ? "Hide" : "Session Settings"}</button>
    </div>`;
  },

  getFxnIndicator() {
    if(!this.fxnIndicator && window.FXNAsianSessionRange){
      let config={};try{config=JSON.parse(this.chartStorage().getItem('tfb_fxn_asian_range_v1') || '{}');}catch{}
      // Apply the requested visibility change to existing saved workspaces once.
      try{
        if(this.chartStorage().getItem('tfb_fxn_hide_yellow_levels_v2')!=='true'){
          config.showPreviousDayHiLo=false;
          config.showLastWeeklyHiLo=false;
          config.showAsianMidpoint=false;
          config.showRangeBreaks=false;
          this.chartStorage().setItem('tfb_fxn_asian_range_v1',JSON.stringify(config));
          this.chartStorage().setItem('tfb_fxn_hide_yellow_levels_v2','true');
        }
      }catch{Object.assign(config,{showPreviousDayHiLo:false,showLastWeeklyHiLo:false,showAsianMidpoint:false,showRangeBreaks:false});}
      try {
        if (this.chartStorage().getItem('tfb_fxn_ist_boundary_v1') !== 'true') {
          config.dailyUtcOffset = 5.5;
          this.chartStorage().setItem('tfb_fxn_asian_range_v1', JSON.stringify(config));
          this.chartStorage().setItem('tfb_fxn_ist_boundary_v1','true');
        }
      } catch { config.dailyUtcOffset = 5.5; }
      this.fxnIndicator=new window.FXNAsianSessionRange(config);
    }
    return this.fxnIndicator;
  },

  updateFxnSettings(patch) {
    const indicator=this.getFxnIndicator();if(!indicator)return;
    indicator.setConfig(patch);
    this.syncNewYorkSession();
    try{this.chartStorage().setItem('tfb_fxn_asian_range_v1',JSON.stringify(indicator.config));}catch{}
    this.rerender();
  },

  syncNewYorkSession(){
    const fxn=this.getFxnIndicator(),engine=this.sessionEngine;
    if(!fxn || !engine)return;
    const c=fxn.config,old=engine.getConfig();
    const def=(id,name,shortName,startHour,startMinute,endHour,endMinute)=>({
      ...old.definitions[id],enabled:true,timezone:c.sessionTimezone,name,shortName,
      startTime:`${c[startHour]}:${c[startMinute]}`,endTime:`${c[endHour]}:${c[endMinute]}`,
    });
    engine.setConfig({enabled:true,displayTimezone:'Asia/Kolkata',definitions:{
      asia:def('asia','Asian Session','ASIA','user_ssth','user_sstm','user_esth','user_estm'),
      london:def('london','London Session','LONDON','london_ssth','london_sstm','london_esth','london_estm'),
      'new-york':def('new-york','New York Session','NEW YORK','ny_ssth','ny_sstm','ny_esth','ny_estm'),
    }});
    this.saveSessionSettings();
  },

  updateFxnIstTime(key,value){
    const indicator=this.getFxnIndicator(),time=this.candles[this.idx]?.time ?? this.candles[this.idx]?.date?.getTime() ?? Date.now();
    const {values,shift}=indicator.clockSettings(time);
    const h=key.slice(0,-1)+'h',m=key.slice(0,-1)+'m';
    values[key]=value;
    const minutes=(Number(values[h])*60+Number(values[m])-shift+2880)%1440;
    this.updateFxnSettings({[h]:String(Math.floor(minutes/60)).padStart(2,'0'),[m]:String(minutes%60).padStart(2,'0')});
  },

  renderFxnSettings() {
    const indicator=this.getFxnIndicator();if(!indicator)return '';
    const c=indicator.clockSettings(this.candles[this.idx]?.time ?? this.candles[this.idx]?.date?.getTime() ?? Date.now()).values,defaults=window.FXNAsianSessionRange.defaults;
    const labels={displayTimezone:'Display timezone (UTC+05:30)',sessionTimezone:'Session timezone (DST automatic)',enabled:'Enable indicator',user_ssth:'Asia start hour (New York time)',user_sstm:'Asia start minute',user_esth:'Asia end hour (New York time)',user_estm:'Asia end minute',user_elth:'Extend Asia levels until hour (New York time)',user_eltm:'Extension minute',show_london_session:'Show London box',show_london_session_rng:'Show London range',london_ssth:'London start hour (New York time)',london_sstm:'London start minute',london_esth:'London end hour (New York time)',london_estm:'London end minute',show_ny_session:'Show New York box',show_ny_session_rng:'Show New York range',ny_ssth:'New York start hour (New York time)',ny_sstm:'New York start minute',ny_esth:'New York end hour (New York time)',ny_estm:'New York end minute',showADR:'Show Average Daily Range',is_forex_pips:'ADR in forex pips (10 ticks)',daily_adr_user:'Show ADR for recent N days',daily_adr_length:'ADR length (completed days)',showPreviousDayHiLo:'Previous day high / low',previousDayHiLoColor:'Previous day line color',supportLineWidth:'Previous day line width',previousDayHiLoLineStyle:'Previous day line style',showHiLoPriceRange:'Show previous day range',showHiLoPriceLabel:'Show YH / YL labels',showLastWeeklyHiLo:'Previous week high / low',lastWeeklyHiLoColor:'Previous week color',supportLastWeekLineWidth:'Previous week width',lastWeeklyHiLoStyle:'Previous week style',lastWeeklyHiLoShowLabel:'Show PWH / PWL labels',showWeeklyHiLo:'Developing current week high / low',weeklyHiLoColor:'Current week color',supportWeekLineWidth:'Current week width',weeklyHiLoStyle:'Current week style',weeklyHiLoShowLabel:'Show WH / WL labels',showHiLoTime:'Show high / low time (New York time)',fillOpacity:'Box fill opacity',dailyUtcOffset:'Daily candle UTC offset (hours)',dailyStartHour:'Daily candle boundary hour'};
    const styleLabels={user_box_line_color:'border color',boxLineWidth:'border width',user_box_line_style:'border style',sessionLineWidth:'high / low / mid width',user_upperlower_line_style:'high / low style',user_midline_color:'midpoint color',user_middle_line_style:'midpoint style',user_text_color:'text color',user_label_size:'text size'};
    Object.assign(labels,{showAsianMidpoint:'Show Asian midpoint line',showRangeBreaks:'Show Asian Range Break labels'});
    for(const prefix of ['', 'l','n'])for(const [key,label] of Object.entries(styleLabels))labels[prefix+key]=`${prefix==='l'?'London':prefix==='n'?'New York':'Asia'} ${label}`;
    const fields=Object.keys(defaults).map(key=>{
      const value=c[key],type=typeof defaults[key];
      let options=key==='displayTimezone'?['Asia/Kolkata']:key==='sessionTimezone'?['America/New_York','Etc/GMT+5']:key.toLowerCase().includes('color')?Object.keys(window.FXNAsianSessionRange.colors):key.toLowerCase().includes('style')?['solid','dashed','dotted']:key.includes('label_size')?['tiny','small','normal','large']:null;
      if(/(ssth|esth|elth)$/.test(key))options=Array.from({length:24},(_,i)=>String(i).padStart(2,'0'));
      if(/(sstm|estm|eltm)$/.test(key))options=['00','15','30','45'];
      const input=type==='boolean'?`<input type="checkbox" data-fxn-setting="${key}" ${value?'checked':''}>`:options?`<select data-fxn-setting="${key}">${options.map(v=>`<option ${v===value?'selected':''}>${v}</option>`).join('')}</select>`:`<input type="number" style="width:75px" data-fxn-setting="${key}" value="${value}" step="${key==='fillOpacity'?'.05':key==='dailyUtcOffset'?'.5':'1'}">`;
      return `<label style="display:flex;justify-content:space-between;align-items:center;gap:12px;padding:5px 0">${labels[key].replaceAll('(New York time)','(IST)').replace('Session timezone (DST automatic)','Market session reference timezone')} ${input}</label>`;
    }).join('');
    return `<div class="tv-session-menu" style="width:min(440px,85vw);max-height:65vh;overflow-y:auto;z-index:150"><b>FXN - Asian Session Range · IST</b><p>All session times are shown and edited in IST (UTC+05:30) for the selected replay date. New York daylight saving is converted automatically.</p><p>Daily/weekly levels use the daily boundary below. Missing lookback data is omitted. Range breaks are chart markers; no popups.</p>${fields}<button class="tv-action" id="fxnResetBtn">Reset defaults</button><button class="tv-action" id="fxnSettingsCloseBtn">Close</button></div>`;
  },

  renderSessionPanel() {
    const config = this.sessionEngine?.getConfig?.();
    if (!config) return "";
    if (this.sessionPanelHidden) {
      return `<button class="replay-btn tv-session-panel-restore" id="sessionPanelRestoreBtn" title="Show Session Navigator">Show Session Navigator</button>`;
    }
    const current = this.currentSessionStats();
    const currentText = current ? `${current.shortName} SESSION` : "OFF SESSION";
    const currentMeta = current ? `${this.sessionEngine.formatTime(current.start)} - ${this.sessionEngine.formatTime(current.end)}` : "No active configured session";
    const selectedType = this.selectedSessionType();
    const selectedDef = config.definitions[selectedType] || config.definitions[config.navigatorSession] || Object.values(config.definitions)[0];
    const selectedShort = this.sessionShortLabel(selectedDef);
    const selectedName = selectedDef?.name || "Session";
    const dateValue = this.sessionNavigator.date || this.sessionDateValue(null, selectedType);
    const defs = Object.values(config.definitions);
    return `<div class="replay-card tv-session-panel">
      <div class="tv-panel-head"><b>Session Navigator</b><button class="tv-mini-panel-btn" id="sessionPanelHideBtn" title="Hide Session Navigator">Hide</button></div>
      <div class="tv-session-status"><b>${this.escapeHtml(currentText)}</b><span>${this.escapeHtml(currentMeta)}</span></div>
      <div class="tv-session-quick">
        ${defs.map((def) => `<button class="replay-btn ${def.id === selectedType ? "active" : ""}" data-session-quick="${def.id}" title="Jump to next ${this.escapeHtml(def.name)}">${this.escapeHtml(def.shortName)}</button>`).join("")}
      </div>
      <div class="tv-session-selected"><span>Selected</span><b>${this.escapeHtml(selectedName)}</b></div>
      <div class="tv-session-form">
        <label>Date<input type="date" id="sessionDateInput" value="${this.escapeHtml(dateValue)}"></label>
        <label>Session<select id="sessionSelectInput">${defs.map((def) => `<option value="${def.id}" ${def.id === selectedType ? "selected" : ""}>${this.escapeHtml(def.name)}</option>`).join("")}</select></label>
      </div>
      <div class="replay-grid tv-session-nav-grid">
        <button class="replay-btn" id="btnPrevSession" title="Previous ${this.escapeHtml(selectedName)}">Previous ${this.escapeHtml(selectedShort)}</button>
        <button class="replay-btn active" id="btnGoSession" title="Go to selected ${this.escapeHtml(selectedName)} on date">GO TO ${this.escapeHtml(selectedShort)}</button>
        <button class="replay-btn" id="btnNextSession" title="Next ${this.escapeHtml(selectedName)}">Next ${this.escapeHtml(selectedShort)}</button>
      </div>
      ${this.renderSessionRangeTable()}
    </div>`;
  },

  renderSessionSettings(config) {
    const zones = ["Asia/Tokyo", "Europe/London", "America/New_York", "UTC", "Asia/Kolkata"];
    const ist=this.getFxnIndicator()?.clockSettings(this.candles[this.idx]?.time ?? this.candles[this.idx]?.date?.getTime() ?? Date.now()).values;
    return `<div class="tv-session-settings">
      ${Object.values(config.definitions).map((def) => `<div class="tv-session-setting-row">
        <label><input type="checkbox" data-session-def-enabled="${def.id}" ${def.enabled ? "checked" : ""}> ${this.escapeHtml(def.name)}</label>
        <input type="time" data-session-start="${def.id}" title="${def.id==='new-york'?'IST':''}" value="${def.id==='new-york' && ist?`${ist.ny_ssth}:${ist.ny_sstm}`:this.escapeHtml(def.startTime)}">
        <input type="time" data-session-end="${def.id}" title="${def.id==='new-york'?'IST':''}" value="${def.id==='new-york' && ist?`${ist.ny_esth}:${ist.ny_estm}`:this.escapeHtml(def.endTime)}">
        ${def.id==='new-york'?'<span>IST · linked to FXN</span>':`<select data-session-zone="${def.id}">${zones.map((zone) => `<option value="${zone}" ${zone === def.timezone ? "selected" : ""}>${zone}</option>`).join("")}</select>`}
      </div>`).join("")}
    </div>`;
  },

  renderSessionRangeTable() {
    const rows = this.visibleSessionStats().filter((session) => session.candleCount).slice(-6);
    const meta = MarketData.getMeta(this.symbol);
    return `<details class="tv-session-range-table"><summary>Session ranges</summary>
      <table><thead><tr><th>Session</th><th>Open</th><th>High</th><th>Low</th><th>Range</th></tr></thead><tbody>
        ${rows.length ? rows.map((row) => `<tr><td>${this.escapeHtml(row.shortName)}</td><td>${row.open == null ? "--" : Fmt.price(row.open, meta.decimals)}</td><td>${row.high == null ? "--" : Fmt.price(row.high, meta.decimals)}</td><td>${row.low == null ? "--" : Fmt.price(row.low, meta.decimals)}</td><td>${row.range == null ? "--" : Fmt.price(row.range, meta.decimals)}</td></tr>`).join("") : `<tr><td colspan="5">No visible session data</td></tr>`}
      </tbody></table>
    </details>`;
  },

  renderFullscreenReplayDock() {
    if (!window.SubscriptionSystem?.canAccessFeature("replay")) return "";
    const hiddenCount = this.replayActive ? this.hiddenCandles.length : Math.max(0, this.candles.length - this.idx - 1);
    const progressMax = Math.max(0, this.candles.length - 1);
    const progressPct = progressMax > 0 ? Math.round((this.idx / progressMax) * 100) : 0;
    const session = this.currentSessionStats();
    const openCount = Store.state.active_trades.filter((t) => t.symbol === this.symbol).length;
    return `<div class="tv-fullscreen-replay" id="fullscreenReplayDock">
      <button class="replay-btn" id="fsExitFullscreen" title="Exit fullscreen">Exit fullscreen</button>
      <span class="tv-fullscreen-replay-state">${this.playing ? "Replay running" : this.replayActive ? "Replay ready" : "Live mode"}${session ? ` · ${this.escapeHtml(session.shortName)}` : ""}</span>
      <button class="replay-btn" id="fsBtnPrev" title="Previous candle">Prev</button>
      <button class="replay-btn ${this.playing ? "playing active" : ""}" id="fsBtnPlay" title="Start or pause replay">${this.playing ? "Pause" : "Play"}</button>
      <button class="replay-btn" id="fsBtnNext" title="Next candle">Next</button>
      <button class="replay-btn" id="fsBtnBack10" title="Back 10 candles">-10</button>
      <button class="replay-btn" id="fsBtnF10" title="Forward 10 candles">+10</button>
      <select id="fsReplaySpeed" title="Replay speed">
        ${[0.25, 0.5, 1, 2, 5, 10, 20, 50, 100].map((speed) => `<option value="${speed}" ${Math.abs(this.speed - speed) < 0.01 ? "selected" : ""}>${speed}x</option>`).join("")}
      </select>
      <button class="replay-btn" id="fsReplayReset" title="Restart replay">Reset</button>
      <button class="replay-btn" id="fsReplayLive" title="Exit replay and go live">Live</button>
      ${openCount ? `<button class="replay-btn fs-close-all-btn" id="fsCloseAllPositions" title="Close all open positions on ${this.symbol}">Close All (${openCount})</button>` : ""}
      <span class="tv-fullscreen-replay-meta">${progressPct}% · Hidden ${hiddenCount.toLocaleString()}</span>
    </div>`;
  },

  renderProfessionalDrawingToolbar() {
    return "";
    const ux = this.drawingWorkspaceUX?.getState?.() || {};
    const registryTools = this.drawingEngine?.toolRegistry?.getAllTools?.() || [];
    const byEngineId = new Map(registryTools.map((tool) => [tool.id, tool]));
    const allowed = new Set(this.DRAWING_UI_TOOLS);
    const uiEntries = Object.entries(this.TOOL_META)
      .filter(([tool]) => allowed.has(tool))
      .map(([tool, meta]) => ({ tool, meta, engine: byEngineId.get(this.engineToolForUiTool(tool)) || null }));
    const query = ux.toolSearch || "";
    const matched = query
      ? uiEntries.filter((item) => [item.meta.name, item.tool, item.engine?.category, item.engine?.description].some((v) => String(v || "").toLowerCase().includes(query.toLowerCase())))
      : [];
    const favoriteSet = new Set(ux.favorites || []);
    const favorites = (ux.favorites || []).map((tool) => uiEntries.find((item) => item.tool === tool)).filter(Boolean);
    const categories = [...new Set(uiEntries.map((item) => item.engine?.category || item.meta.group || "TOOLS"))];
    const shortcutFor = (tool) => Object.entries(ux.shortcuts || {}).find(([, mapped]) => mapped === tool)?.[0]?.toUpperCase() || "";
    const buttonFor = (item) => {
      const shortcut = shortcutFor(item.tool);
      const title = `${item.meta.name}${shortcut ? `\nShortcut: ${shortcut}` : ""}`;
      const label = ux.toolbarMode === "expanded" ? item.meta.name : item.meta.label;
      return `<button class="tv-drawing-tool-btn ${this.tool === item.tool ? "active" : ""}" data-tool="${item.tool}" title="${this.escapeHtml(title)}">
        <span>${label}</span><i data-drawing-favorite="${item.tool}" class="${favoriteSet.has(item.tool) ? "on" : ""}">★</i>
      </button>`;
    };
    return `<div class="tv-drawing-toolbar ${ux.toolbarMode === "expanded" ? "expanded" : "compact"}" id="professionalDrawingToolbar">
      <div class="tv-drawing-toolbar-title">Favorites</div>
      <div class="tv-drawing-toolbar-favorites">${favorites.length ? favorites.map(buttonFor).join("") : uiEntries.slice(0, 4).map(buttonFor).join("")}</div>
      <input class="tv-drawing-tool-search" id="drawingToolSearch" value="${this.escapeHtml(query)}" placeholder="Search tools">
      <button class="tv-drawing-tool-btn ${this.magnetMode ? "active" : ""}" data-tool="magnet" title="Magnet ${this.magnetMode ? "ON" : "OFF"}">Magnet ${this.magnetMode ? "ON" : "OFF"}</button>
      <button class="tv-drawing-tool-btn ${this.tool === "crosshair" ? "active" : ""}" data-tool="crosshair" title="Select\nShortcut: S">Select</button>
      <button class="tv-drawing-tool-btn" id="drawingToolbarModeBtn" title="Compact / expanded toolbar">${ux.toolbarMode === "expanded" ? "Compact" : "Expand"}</button>
      <div class="tv-drawing-tool-results ${query ? "open" : ""}">
        ${matched.map(buttonFor).join("") || (query ? `<div class="tv-drawing-empty">No matching tools</div>` : "")}
      </div>
      <div class="tv-drawing-tool-categories">
        ${categories.map((category) => `<div class="tv-drawing-tool-category">
          <b>${this.escapeHtml(String(category).replaceAll("_", " "))}</b>
          <div>${uiEntries.filter((item) => (item.engine?.category || item.meta.group || "TOOLS") === category).map(buttonFor).join("")}</div>
        </div>`).join("")}
      </div>
    </div>`;
  },

  renderQuickDrawingTemplates(selected) {
    const templates = this.drawingWorkspaceUX?.getState?.().templates || [];
    if (!templates.length) return "";
    return `<div class="tv-template-row">
      <select id="drawingTemplateSelect">
        <option value="">Apply template</option>
        ${templates.map((template) => `<option value="${template.id}">${this.escapeHtml(template.name)}</option>`).join("")}
      </select>
      <button data-drawing-action="save-template" ${selected ? "" : "disabled"}>Save</button>
      <button data-drawing-action="default-template" ${selected ? "" : "disabled"}>Default</button>
    </div>`;
  },

  // --- chart engine helpers ---------------------------------------------

  getReplayLimit() {
    return this.replayActive ? Math.max(-1, Math.min(this.idx, this.candles.length - 1)) : this.candles.length - 1;
  },

  syncReplayBuffers() {
    const limit = this.getReplayLimit();
    this.visibleCandles = { length: limit + 1 };
    this.hiddenCandles = { length: this.replayActive ? Math.max(0, this.candles.length - limit - 1) : 0 };
    this.replayClock = this.createReplayClock();
  },

  sanitizeChartCamera() {
    this.visibleCount = Math.max(this.minVisibleCount, Math.min(this.maxVisibleCount, Number(this.visibleCount) || 120));
    this.yZoom = Math.max(this.minYZoom, Math.min(this.maxYZoom, Number(this.yZoom) || 1));
    this.yOffset = Number.isFinite(this.yOffset) ? this.yOffset : 0;
    if (!this.candles.length) {
      this.idx = 0;
      this.viewEnd = 0;
      return;
    }
    this.idx = Math.max(MarketData.isLocal(this.symbol) && this.replayActive ? -1 : 0, Math.min(this.candles.length - 1, Math.round(Number(this.idx) || 0)));
    this.viewEnd = this.clampViewEnd(Number.isFinite(this.viewEnd) ? this.viewEnd : this.idx);
    if (this.mouseEngine && !this.mouseEngine.raf) {
      this.mouseEngine.targetCount = this.visibleCount;
      this.mouseEngine.targetEnd = this.viewEnd;
    }
  },

  createReplayClock(direction = 1) {
    const current = this.candles[this.idx] || null;
    return {
      timestamp: current?.date?.getTime() || this.replayTimestamp || null,
      index: this.idx,
      speed: this.speed,
      direction,
      frame: this.replayClock?.frame ? this.replayClock.frame + 1 : 1,
      status: this.playing ? "playing" : this.replayActive ? "paused" : "live",
      current,
      mode: this.replayActive ? "replay" : "live-history",
      visible: this.visibleCandles.length,
      hidden: this.hiddenCandles.length,
    };
  },

  emitReplayEvent(type, detail = {}) {
    const event = { type, at: Date.now(), clock: this.replayClock || this.createReplayClock(), detail };
    this.replayEvents.push(event);
    if (this.replayEvents.length > 200) this.replayEvents.shift();
    window.dispatchEvent(new CustomEvent(`tfb:${type}`, { detail: event }));
  },

  saveReplayStorage() {
    const payload = {
      symbol: this.symbol,
      timeframe: this.timeframe,
      replayActive: this.replayActive,
      playing: this.playing,
      timestamp: this.replayTimestamp || this.candles[this.idx]?.date?.getTime() || null,
      speed: this.speed,
      index: this.idx,
      cutIndex: this.replayCutIndex,
      viewEnd: this.viewEnd,
      panOffset: (this.viewEnd ?? this.idx) - this.idx,
      visibleCount: this.visibleCount,
      yZoom: this.yZoom,
      yOffset: this.yOffset,
      autoFollow: this.autoFollow,
      bookmarks: this.replayBookmarks,
    };
    this.chartStorage().setItem("tfb_replay_engine_v1", JSON.stringify(payload));
  },

  persistReplayState(options = {}) {
    if (window.ChartAccountState && !ChartAccountState.isCurrent(this)) return;
    const delay = options.immediate ? 0 : (options.delay ?? 180);
    if (this._persistReplayTimer) clearTimeout(this._persistReplayTimer);
    const run = () => {
      this._persistReplayTimer = null;
      this.saveReplayStorage();
      API.updateSettings(this.replaySettingsPayload()).catch(() => {});
    };
    if (delay <= 0) run();
    else this._persistReplayTimer = setTimeout(run, delay);
  },

  loadReplayStorage() {
    try {
      const saved = JSON.parse(this.chartStorage().getItem("tfb_replay_engine_v1") || "null");
      if (!saved || saved.symbol !== this.symbol) return;
      this.speed = saved.speed || this.speed;
      this.replayBookmarks = Array.isArray(saved.bookmarks) ? saved.bookmarks : [];
      if (saved.replayActive && saved.timestamp) {
        this.replayActive = true;
        this.idx = this.snapIndexToTimestamp(saved.timestamp);
        this.replayCutIndex = this.idx;
        this.replayTimestamp = saved.timestamp;
        const savedPanOffset = Number.isFinite(saved.panOffset) ? saved.panOffset : (saved.viewEnd ?? this.followViewEnd()) - (saved.index ?? this.idx);
        this.viewEnd = this.clampViewEnd(this.idx + savedPanOffset);
        this.visibleCount = saved.visibleCount || this.visibleCount;
        this.yZoom = saved.yZoom || this.yZoom;
        this.yOffset = saved.yOffset || 0;
        this.autoFollow = saved.autoFollow ?? this.autoFollow;
        this.sanitizeChartCamera();
      }
    } catch { /* ignore malformed replay storage */ }
  },

  replaySettingsPayload() {
    return {
      current_idx: this.idx,
      replay_active: this.replayActive,
      replay_timestamp: this.replayActive ? this.replayTimestamp : null,
      replay_cut_index: this.replayActive ? this.replayCutIndex : null,
      replay_speed: this.speed,
      chart_view_end: this.viewEnd,
      chart_visible_count: this.visibleCount,
      chart_y_zoom: this.yZoom,
      chart_y_offset: this.yOffset,
      chart_auto_follow: this.autoFollow,
    };
  },

  replaySnapshot() {
    return {
      idx: this.idx,
      replayActive: this.replayActive,
      replayCutIndex: this.replayCutIndex,
      replayTimestamp: this.replayTimestamp,
      viewEnd: this.viewEnd,
      visibleCount: this.visibleCount,
      yZoom: this.yZoom,
      yOffset: this.yOffset,
      autoFollow: this.autoFollow,
      tool: this.tool,
    };
  },

  pushReplayUndo() {
    this.replayUndoStack.push(this.replaySnapshot());
    if (this.replayUndoStack.length > 80) this.replayUndoStack.shift();
    this.replayRedoStack = [];
  },

  restoreReplaySnapshot(snapshot) {
    if (!snapshot) return;
    this.stopPlay();
    this.idx = Math.max(0, Math.min(this.candles.length - 1, snapshot.idx ?? this.idx));
    this.replayActive = !!snapshot.replayActive;
    this.replayCutIndex = snapshot.replayCutIndex;
    this.replayTimestamp = snapshot.replayTimestamp;
    this.viewEnd = snapshot.viewEnd;
    this.visibleCount = snapshot.visibleCount || this.visibleCount;
    this.yZoom = snapshot.yZoom || this.yZoom;
    this.yOffset = snapshot.yOffset || 0;
    this.autoFollow = snapshot.autoFollow ?? this.autoFollow;
    this.tool = snapshot.tool || "crosshair";
    this.revealAnim = null;
    this.syncReplayBuffers();
    this.sanitizeChartCamera();
    this.syncMouseEngineCamera();
    API.updateSettings(this.replaySettingsPayload()).catch(() => {});
    this.rerender();
  },

  undoReplayAction() {
    const snapshot = this.replayUndoStack.pop();
    if (!snapshot) return;
    this.replayRedoStack.push(this.replaySnapshot());
    this.restoreReplaySnapshot(snapshot);
    toast("Replay action undone.", "info");
  },

  redoReplayAction() {
    const snapshot = this.replayRedoStack.pop();
    if (!snapshot) return;
    this.replayUndoStack.push(this.replaySnapshot());
    this.restoreReplaySnapshot(snapshot);
    toast("Replay action redone.", "info");
  },

  renderCandles() {
    if (!this.replayActive) return this.candles;
    if (!this.visibleCandles.length) this.syncReplayBuffers();
    return this.candles.slice(0, this.getReplayLimit() + 1);
  },

  clampViewEnd(v) {
    const dataEnd = this.getReplayLimit();
    const minEnd = Math.min(this.visibleCount - 1, dataEnd);
    // The viewport may travel into empty time; replay/data limits remain independent.
    return Math.max(minEnd, Number.isFinite(v) ? v : dataEnd);
  },

  followViewEnd() {
    return this.clampViewEnd((this.idx ?? 0) + this.futureSlots);
  },

  stopZoomAnimation() {
    if (this.zoomAnim?.raf) cancelAnimationFrame(this.zoomAnim.raf);
    this.zoomAnim = null;
  },

  panChartByCandles(deltaCandles, options = {}) {
    if (!Number.isFinite(deltaCandles) || deltaCandles === 0) return;
    this.stopZoomAnimation();
    this.viewEnd = this.clampViewEnd((this.viewEnd ?? this.idx) + deltaCandles);
    this.ensureOlderCandles();
    this.autoFollow = options.keepFollow ? this.autoFollow : false;
    this.syncMouseEngineCamera();
    this.scheduleDraw();
  },

  startRevealAnimation(index) {
    if (!this.replayActive || index == null) return;
    this.revealAnim = {
      index,
      from: performance.now(),
      duration: Math.max(90, Math.min(260, 220 / Math.max(1, this.speed))),
    };
    this.scheduleDraw();
  },

  syncReplayTimestamp() {
    if (!this.replayActive) {
      this.replayTimestamp = null;
      return;
    }
    this.replayTimestamp = this.candles[this.idx] ? this.candles[this.idx].time + (MarketData.isLocal(this.symbol) ? this.candleDuration() : 0) : this.replayTimestamp;
  },

  candleDuration() { return (MarketData.TF_MINUTES[this.timeframe] || 1) * 60000; },

  async loadLocalPage(direction) {
    if (this._localPageLoading || !this.candles.length || this.dataSource !== "local-csv") return;
    const symbol = this.symbol, timeframe = this.timeframe, generation = this._historyRequest;
    const edge = direction < 0 ? this.candles[0].time : this.candles.at(-1).time;
    if (direction < 0 && this._olderExhausted) return;
    if (direction > 0 && edge >= this.datasetInfo.last_timestamp) return;
    this._localPageLoading = true;
    try {
      const result = await MarketData.history(symbol, timeframe, 2500, direction < 0 ? { end: edge - 1 } : { start: edge + 1 });
      if (symbol !== this.symbol || timeframe !== this.timeframe || generation !== this._historyRequest) return;
      if (result.error) { this._historyError = result.error; this.stopPlay(); this.rerender(); return; }
      const rows = result.candles;
      if (!rows.length) { if (direction < 0) this._olderExhausted = true; return; }
      if (direction < 0) {
        this.candles = rows.concat(this.candles);
        this.idx += rows.length;
        this.viewEnd += rows.length;
        if (this.replayCutIndex != null) this.replayCutIndex += rows.length;
        // Keep replay near the middle of a bounded window when loading farther back.
        const trimStart = Math.min(Math.max(0, this.idx - 5000), Math.max(0, this.candles.length - 10000));
        if (trimStart) {
          this.candles = this.candles.slice(trimStart);
          this.idx -= trimStart;
          this.viewEnd -= trimStart;
          if (this.replayCutIndex != null) this.replayCutIndex -= trimStart;
        }
      } else {
        this.candles.push(...rows);
        const trim = Math.max(0, Math.min(this.candles.length - 10000, this.idx - 1000));
        if (trim) {
          this.candles.splice(0, trim);
          this.idx -= trim;
          this.viewEnd -= trim;
          if (this.replayCutIndex != null) this.replayCutIndex = Math.max(0, this.replayCutIndex - trim);
        }
      }
      this.crosshair = null;
      this.syncReplayBuffers();
      this.syncMouseEngineCamera();
      this.scheduleDraw();
    } finally { this._localPageLoading = false; }
  },

  scheduleDraw() {
    if (this._drawRaf) return;
    this._drawRaf = requestAnimationFrame(() => {
      this._drawRaf = null;
      this.drawChart();
    });
  },

  ensureOlderCandles() {
    if (!this.candles.length) return;
    if (MarketData.isLocal(this.symbol)) {
      if ((this.viewEnd ?? this.idx) - this.visibleCount < 100 && this.candles.length < 10000) this.loadLocalPage(-1);
      return;
    }
    const end = this.viewEnd ?? this.idx;
    const start = Math.floor(end - this.visibleCount + 1);
    const targetCount = this.historyTargetCount();
    if (start > Math.max(80, this.visibleCount * 0.5) || this._loadingOlder || this.candles.length >= targetCount) return;
    this._loadingOlder = true;
    const symbol = this.symbol;
    const timeframe = this.timeframe;
    const currentLength = this.candles.length;
    const addCount = Math.min(this.historyChunkCount(timeframe), this.historyIdleBatchCount(timeframe), targetCount - currentLength);
    const run = () => {
      try {
        if (symbol !== this.symbol || timeframe !== this.timeframe || !this.candles.length) return;
        const older = this.synthesizeOlderCandles(addCount);
        if (!older.length) return;
        const replayTs = this.replayActive ? (this.replayTimestamp ?? this.candles[this.idx]?.date?.getTime()) : null;
        this.candles = older.concat(this.candles);
        this.idx += older.length;
        if (this.replayCutIndex != null) this.replayCutIndex += older.length;
        this.viewEnd = (this.viewEnd ?? this.idx) + older.length;
        if (this.mouseEngine) {
          this.mouseEngine.targetEnd = (this.mouseEngine.targetEnd ?? this.viewEnd) + older.length;
          this.mouseEngine.anchorAbs = Number.isFinite(this.mouseEngine.anchorAbs) ? this.mouseEngine.anchorAbs + older.length : this.mouseEngine.anchorAbs;
        }
        if (replayTs != null) {
          this.idx = this.snapIndexToTimestamp(replayTs);
          this.replayTimestamp = replayTs;
          if (this.replayActive && this.replayCutIndex != null) this.replayCutIndex = this.idx;
        }
        this.crosshair = null;
        this.syncReplayBuffers();
        this.syncMouseEngineCamera();
        this.updateReplayChrome();
        this.persistReplayState();
        this.scheduleDraw();
      } finally {
        this._loadingOlder = false;
        const shouldContinue = symbol === this.symbol
          && timeframe === this.timeframe
          && this.candles.length < this.historyTargetCount();
        if (shouldContinue) setTimeout(() => this.ensureOlderCandles(), 0);
      }
    };
    if (window.requestIdleCallback) window.requestIdleCallback(run, { timeout: 120 });
    else setTimeout(run, 0);
  },

  // Find the candle index whose timestamp is closest to `ts` (ms). Used to keep
  // the replay position synchronized to the same historical moment when the
  // timeframe (and therefore the whole candle array) changes.
  snapIndexToTimestamp(ts) {
    if (!this.candles.length) return 0;
    if (ts == null) return this.candles.length - 1;
    if (MarketData.isLocal(this.symbol)) {
      let lo = 0, hi = this.candles.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (this.candles[mid].time + this.candleDuration() <= ts) lo = mid + 1; else hi = mid;
      }
      return lo - 1;
    }
    let lo = 0, hi = this.candles.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.candles[mid].date.getTime() < ts) lo = mid + 1; else hi = mid;
    }
    if (lo > 0) {
      const prevDiff = Math.abs(this.candles[lo - 1].date.getTime() - ts);
      const curDiff = Math.abs(this.candles[lo].date.getTime() - ts);
      if (prevDiff < curDiff) lo -= 1;
    }
    return Math.max(0, Math.min(this.candles.length - 1, lo));
  },

  chartWindow() {
    const data = this.candles;
    this.sanitizeChartCamera();
    const end = Math.floor(this.viewEnd);
    const logicalStart = Math.max(0, this.viewEnd - this.visibleCount + 1);
    const start = Math.max(0, Math.floor(logicalStart));
    const dataEnd = Math.min(end, data.length - 1, this.getReplayLimit());
    const visible = dataEnd >= start ? data.slice(start, dataEnd + 1) : [];
    const meta = MarketData.getMeta(this.symbol);
    const fallback = this.candles[this.idx] || this.candles[this.candles.length - 1] || { high: 1, low: 0, close: 1 };
    const max = visible.length ? Math.max(...visible.map((c) => c.high), fallback.high || fallback.close || 1) : (fallback.high || fallback.close || 1);
    const min = visible.length ? Math.min(...visible.map((c) => c.low), fallback.low || fallback.close || 0) : (fallback.low || fallback.close || 0);
    const basePad = (max - min) * 0.08 || Math.max(Math.abs(max), 1) * 0.001;
    const rawHi = max + basePad;
    const rawLo = min - basePad;
    const center = (rawHi + rawLo) / 2 + (this.yOffset || 0);
    const scaledSpan = ((rawHi - rawLo) || 1) / this.yZoom;
    return { start, end, logicalStart, visible, meta, hi: center + scaledSpan / 2, lo: center - scaledSpan / 2 };
  },

  chartMetrics(rect) {
    const rightAxis = 78;
    const bottomAxis = 24;
    const topPad = 8;
    const chartWidth = Math.max(1, rect.width - rightAxis);
    const priceHeight = Math.max(1, rect.height - bottomAxis - topPad);
    const totalSlots = Math.max(1, this.visibleCount + this.futureSlots);
    const candleW = chartWidth / totalSlots;
    return { rightAxis, bottomAxis, topPad, chartWidth, priceHeight, totalSlots, candleW };
  },

  prepareCanvas(canvas, rect, dpr) {
    const nextW = Math.max(1, Math.floor(rect.width * dpr));
    const nextH = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== nextW || canvas.height !== nextH) {
      canvas.width = nextW;
      canvas.height = nextH;
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  },

  drawBackgroundGraph(rect, dpr, frame) {
    const canvas = this.container?.querySelector("#tvBgCanvas");
    if (!canvas) return;
    const ctx = this.prepareCanvas(canvas, rect, dpr);
    const { bottomAxis, topPad, chartWidth } = frame.metrics;
    const { visible, meta, hi, lo } = frame.window;
    const width = rect.width;
    const height = rect.height;
    const priceHeight = height - bottomAxis - topPad;
    const range = hi - lo || 1;
    const px = (v) => Math.round(v) + 0.5;
    const xFor = (i) => (frame.window.start + i - frame.window.logicalStart) * frame.metrics.candleW + frame.metrics.candleW * 0.5;
    const gridOpacity = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--user-grid-opacity")) || 1;
    const showGridLines = !document.body.classList.contains("settings-chart-grid-off");
    const lightTheme = document.body.classList.contains("light-mode");

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = lightTheme ? "#f9fbfe" : "#0b0d10";
    ctx.fillRect(0, 0, width, height);
    ctx.lineWidth = 1;
    ctx.font = "11px JetBrains Mono, monospace";
    ctx.textBaseline = "middle";

    if (showGridLines) {
      ctx.save();
      ctx.globalAlpha = 0.4 * gridOpacity;
      ctx.strokeStyle = lightTheme ? "#e9eef5" : "#141619";
      for (let g = 0; g <= 32; g++) {
        if (g % 4 === 0) continue;
        const y = px(topPad + ((priceHeight - topPad) / 32) * g);
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(chartWidth, y); ctx.stroke();
      }
      ctx.restore();
    }

    ctx.save();
    ctx.globalAlpha = gridOpacity;
    ctx.strokeStyle = lightTheme ? "#dce3ed" : "#1d1f24";
    for (let g = 0; g <= 8; g++) {
      const y = px(topPad + ((priceHeight - topPad) / 8) * g);
      const p = hi - (g / 8) * range;
      if (showGridLines) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(chartWidth, y);
        ctx.stroke();
      }
      ctx.fillStyle = lightTheme ? "#65738a" : "#787B86";
      ctx.fillText(Fmt.price(p, meta.decimals), chartWidth + 8, y);
    }
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = gridOpacity;
    ctx.strokeStyle = lightTheme ? "#e4eaf2" : "#15181f";
    const labelStep = Math.max(4, Math.round(frame.metrics.totalSlots / 8));
    for (let i = 0; i < frame.metrics.totalSlots; i += labelStep) {
      const logicalIndex = Math.floor(frame.window.logicalStart) + i;
      const x = px((logicalIndex - frame.window.logicalStart + 0.5) * frame.metrics.candleW);
      const lastIndex = Math.max(0, this.getReplayLimit());
      const last = this.candles[lastIndex];
      const date = this.candles[Math.min(logicalIndex, lastIndex)]?.date;
      const axisDate = logicalIndex <= lastIndex ? date : new Date(last.date.getTime() + (logicalIndex - lastIndex) * (MarketData.TF_MINUTES[this.timeframe] || 1) * 60000);
      if (showGridLines) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height - bottomAxis);
        ctx.stroke();
      }
      ctx.fillStyle = lightTheme ? "#65738a" : "#787B86";
      ctx.textAlign = "center";
      ctx.fillText(this.timeAxisLabel(axisDate), x, height - 10);
      ctx.textAlign = "left";
    }
    ctx.restore();
  },

  drawChart() {
    const canvas = this.container?.querySelector("#tvCanvas");
    if (!canvas || !this.candles.length) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const ctx = this.prepareCanvas(canvas, rect, dpr);
    this._canvasW = rect.width;
    this._canvasH = rect.height;

    const width = rect.width;
    const height = rect.height;
    const metrics = this.chartMetrics(rect);
    const { rightAxis, bottomAxis, topPad, chartWidth, candleW, totalSlots } = metrics;
    const indicatorsAllowed = Boolean(window.SubscriptionSystem?.canAccessFeature("technicalIndicators"));
    const volumeHeight = indicatorsAllowed && (this.isVolumeVisible() || this.indicator === 'rsi') ? 88 : 0;
    const priceHeight = height - bottomAxis - topPad;
    const windowState = this.chartWindow();
    this._chartFrame = { rect, dpr, windowState, metrics };
    const { start, logicalStart, visible, meta, hi, lo } = windowState;
    this.drawBackgroundGraph(rect, dpr, { metrics, window: windowState });
    const range = hi - lo || 1;
    const maxVol = Math.max(...visible.map((c) => c.volume || 0), 1);
    // Reserve empty space to the right (TradingView-style "future" margin) so the
    // latest candle isn't pinned to the hard edge of the viewport.
    const bodyW = Math.max(2, Math.min(15, candleW * 0.64));
    const px = (v) => Math.round(v) + 0.5; // pixel-snap for crisp 1px strokes
    const xForIndex = (absIndex) => (absIndex - logicalStart) * candleW + candleW * 0.5;
    const xFor = (i) => xForIndex(start + i);
    const coords = this.chartCoordinates();
    const coordinateContext = { metrics, windowState };
    const yFor = (price) => coords.priceToY(price, coordinateContext);
    const priceForY = (y) => coords.yToPrice(y, coordinateContext);
    ctx.clearRect(0, 0, width, height);
    this.drawSessionOverlays(ctx, windowState, metrics, xForIndex, yFor, chartWidth, height, bottomAxis);
    const fxn=this.getFxnIndicator();
    if(fxn?.config.enabled && window.SubscriptionSystem?.canAccessFeature("technicalIndicators")){
      const coords=this.chartCoordinates(),context={metrics,windowState};
      ctx.save();ctx.beginPath();ctx.rect(0,topPad,chartWidth,height-bottomAxis-topPad);ctx.clip();
      fxn.render(ctx,{candles:this.candles,limit:this.getReplayLimit(),timeframeMs:(MarketData.TF_MINUTES[this.timeframe]||1)*60000,from:coords.xToTime(0,context),to:coords.xToTime(chartWidth,context),x:time=>this.xForTimestamp(time,windowState,metrics),y:yFor,width:chartWidth,tickSize:Math.pow(10,-meta.decimals)});
      ctx.restore();
    }
    if (indicatorsAllowed) this.drawIndicators(ctx, visible, xFor, yFor, candleW, chartWidth, height, bottomAxis, volumeHeight, maxVol);
    this.drawPriceSeries(ctx, visible, start, xFor, yFor, candleW, bodyW, height, bottomAxis);
    this.drawTradeLevels(ctx, yFor, chartWidth, meta);
    this.drawOrderDraft(ctx, yFor, chartWidth, height, bottomAxis, meta);
    const drawingCanvas = this.container?.querySelector("#tvDrawingCanvas");
    const drawingCtx = drawingCanvas ? this.prepareCanvas(drawingCanvas, rect, dpr) : ctx;
    if (drawingCanvas) drawingCtx.clearRect(0, 0, width, height);
    this.drawUserDrawings(drawingCtx, start, xFor, yFor, candleW);
    this.drawReplayCutMarker(ctx, start, xFor, chartWidth, height, bottomAxis);

    // Live price line — tracks the actual replay position (this.idx), not the
    // camera, so it stays correct even while the user has panned elsewhere.
    const replayCandle = this.candles[this.idx] || visible[visible.length - 1];
    if (replayCandle) {
      const priceChanged = this._lastLivePrice != null && this._lastLivePrice !== replayCandle.close;
      if (priceChanged) this._priceFlashAt = performance.now();
      this._lastLivePrice = replayCandle.close;
      const flashElapsed = this._priceFlashAt ? performance.now() - this._priceFlashAt : Infinity;
      const flashActive = flashElapsed < 380;
      const up = !this._prevLivePrice || replayCandle.close >= this._prevLivePrice;
      this._prevLivePrice = replayCandle.close;
      const lineColor = up ? "#00b894" : "#ff3b4f";
      const lastY = yFor(replayCandle.close);
      this.dashedLine(ctx, 0, lastY, chartWidth, lastY, lineColor, [2, 4], flashActive ? 0.9 : 0.6);
      if (this.idx >= start && this.idx < start + visible.length) {
        const nowX = px(xFor(this.idx - start));
        this.dashedLine(ctx, nowX, 0, nowX, height - bottomAxis, "#787B86", [5, 5], 0.35);
      }
      this.priceBadge(ctx, chartWidth, lastY, Fmt.price(replayCandle.close, meta.decimals), lineColor, flashActive ? 84 : 76);
      if (flashActive) { clearTimeout(this._flashTimer); this._flashTimer = setTimeout(() => this.drawChart(), 55); }
    }

    this._chartFrame = { rect, dpr, windowState, metrics };
    this.drawInteractionLayer();

    if (this._loadingOlder) this.drawHistoryLoadingBadge(ctx, chartWidth);
    if (!this.autoFollow) this.drawAutoFollowBadge(ctx, chartWidth);
    if (!this.replayActive && this.tool !== "scissors") this.drawLiveBadge(ctx, chartWidth);
  },

  initializeSessionEngine() {
    if (!window.IntenseSessions?.createSessionEngine) return null;
    const saved = this.loadSessionSettings();
    this.sessionEngine = window.IntenseSessions.createSessionEngine({ config: saved });
    this.syncNewYorkSession();
    const current = this.candles[this.idx];
    this.sessionPanelHidden = saved?.navigatorHidden ?? this.sessionPanelHidden;
    this.sessionNavigator.selectedSessionType = saved?.navigatorSession || this.sessionNavigator.selectedSessionType || "new-york";
    this.sessionNavigator.date = this.sessionNavigator.date || this.sessionDateValue(current?.date?.getTime(), this.sessionNavigator.selectedSessionType);
    return this.sessionEngine;
  },

  loadSessionSettings() {
    try {
      return JSON.parse(this.chartStorage().getItem("tfb_session_settings_v1") || "null") || {};
    } catch {
      return {};
    }
  },

  saveSessionSettings() {
    try {
      const config = this.sessionEngine?.getConfig?.();
      if (config) this.chartStorage().setItem("tfb_session_settings_v1", JSON.stringify({ ...config, navigatorHidden: this.sessionPanelHidden }));
    } catch { /* localStorage can be disabled */ }
  },

  visibleSessionStats() {
    if (!this.sessionEngine || !this.candles.length) return [];
    // A four-hour/daily bar cannot resolve intraday session OHLC. Avoid
    // constructing hundreds of invisible sessions across months of bars.
    if ((MarketData.TF_MINUTES[this.timeframe] || 0) >= 240) return [];
    const win = this.chartWindow();
    const first = this.candles[Math.max(0, win.start)]?.date?.getTime?.() || this.candles[0].date.getTime();
    const lastIndex = Math.min(this.candles.length - 1, Math.ceil(win.logicalStart + win.visible.length + this.futureSlots + 8));
    const last = this.candles[lastIndex]?.date?.getTime?.() || this.candles[this.candles.length - 1].date.getTime();
    const key = [
      "visible",
      this.symbol,
      this.timeframe,
      this.candles.length,
      first,
      last,
      this.replayActive ? this.getReplayLimit() : "live",
      this.sessionEngine.cacheVersion || 0,
    ].join(":");
    if (this._sessionStatsCache?.key === key) return this._sessionStatsCache.value;
    const value = this.sessionEngine.getSessionsInRange(first - 86400000, last + 86400000)
      .map((session) => this.sessionEngine.calculateSessionStats(session, this.candles, { replayActive: this.replayActive, replayLimit: this.getReplayLimit() }))
      // Planned sessions without candle OHLC should not become full-height boxes in the future margin.
      .filter((session) => session?.candleCount > 0 && Number.isFinite(session.high) && Number.isFinite(session.low));
    this._sessionStatsCache = { key, value };
    return value;
  },

  currentSessionStats() {
    if (!this.sessionEngine || !this.candles.length) return null;
    const ts = this.candles[this.idx]?.date?.getTime() || this.replayTimestamp || Date.now();
    const key = ["current", this.symbol, this.timeframe, this.candles.length, ts, this.replayActive ? this.getReplayLimit() : "live", this.sessionEngine.cacheVersion || 0].join(":");
    if (this._currentSessionStatsCache?.key === key) return this._currentSessionStatsCache.value;
    const session = this.sessionEngine.getSessionAt(ts);
    const value = session ? this.sessionEngine.calculateSessionStats(session, this.candles, { replayActive: this.replayActive, replayLimit: this.getReplayLimit() }) : null;
    this._currentSessionStatsCache = { key, value };
    return value;
  },

  selectedSessionType() {
    const config = this.sessionEngine?.getConfig?.();
    return this.sessionNavigator.selectedSessionType || config?.navigatorSession || "new-york";
  },

  sessionShortLabel(defOrType = null) {
    const config = this.sessionEngine?.getConfig?.();
    const def = typeof defOrType === "string" ? config?.definitions?.[defOrType] : defOrType;
    if (!def) return "Session";
    return def.id === "new-york" ? "NY" : def.shortName || def.name || def.id;
  },

  setSelectedSessionType(sessionType, options = {}) {
    const config = this.sessionEngine?.getConfig?.();
    if (!config?.definitions?.[sessionType]) return false;
    this.sessionNavigator.selectedSessionType = sessionType;
    this.sessionNavigator.date = options.date || this.sessionNavigator.date || this.sessionDateValue(null, sessionType);
    this.updateSessionConfig({ navigatorSession: sessionType }, { rerender: options.rerender ?? false });
    return true;
  },

  setSessionPanelHidden(hidden) {
    this.sessionPanelHidden = !!hidden;
    this.saveSessionSettings();
    this.rerender();
  },

  sessionDateValue(timestamp = null, sessionType = this.selectedSessionType()) {
    const ts = timestamp || this.candles[this.idx]?.date?.getTime() || Date.now();
    try {
      const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(new Date(ts)).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
      return `${parts.year}-${parts.month}-${parts.day}`;
    } catch {
      return new Date(ts).toISOString().slice(0, 10);
    }
  },

  xForTimestamp(timestamp, windowState, metrics) {
    const candles = this.candles || [];
    if (!candles.length || !Number.isFinite(timestamp)) return null;
    const firstTs = candles[0].date.getTime();
    const lastTs = candles[candles.length - 1].date.getTime();
    const tfMs = (MarketData.TF_MINUTES[this.timeframe] || 1) * 60000;
    if (timestamp <= firstTs) return ((timestamp - firstTs) / tfMs - windowState.logicalStart) * metrics.candleW + metrics.candleW * 0.5;
    if (timestamp >= lastTs) return ((candles.length - 1 + (timestamp - lastTs) / tfMs) - windowState.logicalStart) * metrics.candleW + metrics.candleW * 0.5;
    let lo = 0;
    let hi = candles.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (candles[mid].date.getTime() < timestamp) lo = mid + 1;
      else hi = mid;
    }
    const right = lo;
    const left = Math.max(0, right - 1);
    const leftTs = candles[left].date.getTime();
    const rightTs = candles[right].date.getTime();
    const span = rightTs - leftTs || tfMs;
    const index = left + (timestamp - leftTs) / span;
    return (index - windowState.logicalStart) * metrics.candleW + metrics.candleW * 0.5;
  },

  rgbaFromHex(hex, alpha) {
    const text = String(hex || "#ffffff").replace("#", "");
    const n = parseInt(text.length === 3 ? text.split("").map((c) => c + c).join("") : text, 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, alpha))})`;
  },

  drawSessionOverlays(ctx, windowState, metrics, xForIndex, yFor, chartWidth, height, bottomAxis) {
    const config = this.sessionEngine?.getConfig?.();
    if (!config?.enabled) return;
    const meta = MarketData.getMeta(this.symbol);
    const sessions = this.visibleSessionStats();
    const current = this.currentSessionStats();
    sessions.forEach((session, order) => {
      if (!(session?.candleCount > 0) || !Number.isFinite(session.high) || !Number.isFinite(session.low)) return;
      const style = session.style || {};
      const x1 = this.xForTimestamp(session.start, windowState, metrics);
      const x2 = this.xForTimestamp(session.end, windowState, metrics);
      if (!Number.isFinite(x1) || !Number.isFinite(x2)) return;
      const left = Math.max(0, Math.min(x1, x2));
      const right = Math.min(chartWidth, Math.max(x1, x2));
      const asianRange = config.asianRange && session.type === 'asia';
      const projectionX = asianRange ? this.xForTimestamp(session.end + 15 * 3600000, windowState, metrics) : x2;
      if (Math.max(x2, projectionX) < 0 || x1 > chartWidth) return;
      const topPrice = Number.isFinite(session.high) ? session.high : windowState.hi;
      const bottomPrice = Number.isFinite(session.low) ? session.low : windowState.lo;
      const top = Math.max(metrics.topPad, Math.min(height - bottomAxis, yFor(topPrice)));
      const bottom = Math.max(metrics.topPad, Math.min(height - bottomAxis, yFor(bottomPrice)));
      const y = Math.min(top, bottom);
      const h = Math.max(12, Math.abs(bottom - top));
      const active = current?.id === session.id;
      ctx.save();
      if (config.showBoxes && right > left) {
        ctx.fillStyle = this.rgbaFromHex(style.backgroundColor, style.backgroundOpacity ?? 0.06);
        ctx.fillRect(left, y, Math.max(1, right - left), h);
        ctx.strokeStyle = this.rgbaFromHex(style.borderColor, active ? Math.min(0.82, (style.borderOpacity ?? 0.42) + 0.22) : (style.borderOpacity ?? 0.42));
        ctx.lineWidth = active ? Math.max(1.5, style.borderWidth || 1) : (style.borderWidth || 1);
        ctx.strokeRect(left, y, Math.max(1, right - left), h);
      }
      if (config.showHighLow && Number.isFinite(session.high) && Number.isFinite(session.low)) {
        ctx.strokeStyle = this.rgbaFromHex(style.lineColor, 0.58);
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        const hiY = yFor(session.high);
        const loY = yFor(session.low);
        ctx.beginPath();
        const lineEnd = Math.min(chartWidth, Math.max(right, projectionX));
        ctx.moveTo(left, hiY); ctx.lineTo(lineEnd, hiY);
        ctx.moveTo(left, loY); ctx.lineTo(lineEnd, loY);
        if(asianRange){const midY=yFor((session.high+session.low)/2);ctx.moveTo(left,midY);ctx.lineTo(lineEnd,midY);}
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (config.showOpen && Number.isFinite(session.open)) {
        ctx.strokeStyle = this.rgbaFromHex(style.lineColor, 0.46);
        ctx.lineWidth = 1;
        const openY = yFor(session.open);
        ctx.beginPath(); ctx.moveTo(left, openY); ctx.lineTo(right, openY); ctx.stroke();
      }
      if (config.showLabels) {
        const label = `${session.shortName} ${session.range == null ? "" : Fmt.price(session.range, meta.decimals)}`;
        ctx.font = "600 10px Inter, sans-serif";
        const labelW = ctx.measureText(label).width + 12;
        const labelX = Math.max(4, Math.min(left + 6, chartWidth - labelW - 4));
        const labelY = Math.max(metrics.topPad + 6 + order * 2, y - 20);
        ctx.fillStyle = "rgba(10,12,15,.82)";
        ctx.beginPath(); ctx.roundRect(labelX, labelY, labelW, 18, 5); ctx.fill();
        ctx.fillStyle = style.labelColor || "#d1d4dc";
        ctx.fillText(label, labelX + 6, labelY + 12);
      }
      ctx.restore();
    });
  },

  drawHistoryLoadingBadge(ctx, chartWidth) {
    ctx.save();
    ctx.font = "10.5px Inter, sans-serif";
    const target = this.historyTargetCount();
    const pct = target ? Math.min(100, Math.round((this.candles.length / target) * 100)) : 0;
    const label = `Loading history ${pct}%`;
    const w = ctx.measureText(label).width + 20;
    ctx.fillStyle = "rgba(20,22,28,.86)";
    ctx.strokeStyle = "rgba(61,127,255,.45)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(12, 10, w, 24, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#8fb2ff";
    ctx.textBaseline = "middle";
    ctx.fillText(label, 22, 22);
    ctx.restore();
  },

  drawAutoFollowBadge(ctx, chartWidth) {
    ctx.save();
    ctx.font = "10.5px Inter, sans-serif";
    const label = "Panning · press Home to follow replay";
    const w = ctx.measureText(label).width + 20;
    ctx.fillStyle = "rgba(20,22,28,.85)";
    ctx.fillRect(chartWidth - w - 10, 10, w, 24);
    ctx.fillStyle = "#d9a441";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, chartWidth - w / 2 - 10, 22);
    ctx.textAlign = "left";
    ctx.restore();
  },

  drawLiveBadge(ctx, chartWidth) {
    ctx.save();
    ctx.font = "10.5px Inter, sans-serif";
    const label = "Live";
    const w = ctx.measureText(label).width + 20;
    ctx.fillStyle = "rgba(0, 184, 148, .14)";
    ctx.strokeStyle = "rgba(0, 184, 148, .55)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(chartWidth - w - 10, 40, w, 24, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#00b894";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, chartWidth - w / 2 - 10, 52);
    ctx.restore();
  },

  drawPriceSeries(ctx, visible, start, xFor, yFor, candleW, bodyW, height, bottomAxis) {
    if (this.chartType !== "candles") {
      ctx.beginPath();
      visible.forEach((c, i) => {
        const x = xFor(i), y = yFor(c.close);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      if (this.chartType === "area") {
        const lastX = xFor(visible.length - 1);
        ctx.lineTo(lastX, height - bottomAxis);
        ctx.lineTo(xFor(0), height - bottomAxis);
        ctx.closePath();
        const grad = ctx.createLinearGradient(0, 0, 0, height - bottomAxis);
        grad.addColorStop(0, "rgba(41,98,255,.30)");
        grad.addColorStop(1, "rgba(41,98,255,0)");
        ctx.fillStyle = grad;
        ctx.fill();
      }
      ctx.beginPath();
      visible.forEach((c, i) => {
        const x = xFor(i), y = yFor(c.close);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = "#2962ff";
      ctx.lineWidth = 2;
      ctx.stroke();
      return;
    }

    const reveal = this.revealAnim;
    let revealProgress = 1;
    if (reveal) {
      revealProgress = Math.min(1, (performance.now() - reveal.from) / reveal.duration);
      revealProgress = 1 - Math.pow(1 - revealProgress, 3);
    }

    visible.forEach((raw, i) => {
      let c = raw;
      const absIndex = start + i;
      if (reveal && absIndex === reveal.index && revealProgress < 1) {
        const prev = this.candles[Math.max(0, absIndex - 1)] || raw;
        const base = prev.close;
        c = {
          ...raw,
          open: base + (raw.open - base) * revealProgress,
          high: base + (raw.high - base) * revealProgress,
          low: base + (raw.low - base) * revealProgress,
          close: base + (raw.close - base) * revealProgress,
        };
      }
      const x = xFor(i);
      const color = c.close >= c.open ? "#00b894" : "#ff3b4f";
      const yHigh = yFor(c.high), yLow = yFor(c.low), yOpen = yFor(c.open), yClose = yFor(c.close);
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = Math.max(1, Math.min(2, candleW * 0.12));
      ctx.beginPath();
      ctx.moveTo(x, yHigh);
      ctx.lineTo(x, yLow);
      ctx.stroke();
      const top = Math.min(yOpen, yClose);
      const h = Math.max(1.5, Math.abs(yClose - yOpen));
      ctx.fillRect(x - bodyW / 2, top, bodyW, h);
    });
    if (reveal && revealProgress < 1) {
      this.scheduleDraw();
    } else if (reveal) {
      this.revealAnim = null;
    }
  },

  isVolumeVisible() {
    if(this.volumeVisible == null){
      try { const saved=this.chartStorage().getItem('tfb_volume_visible_v1');if(saved!==null)return saved==='true'; } catch {}
      return this.indicator === 'volume' || this.indicator === 'ema';
    }
    return this.volumeVisible;
  },

  toggleAsianRange() {
    const config=this.sessionEngine?.getConfig?.();
    if(!config)return;
    if(config.asianRange && config.enabled){this.updateSessionConfig({asianRange:false,enabled:false});return;}
    this.updateSessionConfig({asianRange:true,enabled:true,showBoxes:true,showHighLow:true,showOpen:false,definitions:{
      asia:{...config.definitions.asia,enabled:true,timezone:'Etc/GMT+5',startTime:'20:00',endTime:'02:00',style:{...config.definitions.asia.style,backgroundColor:'#0097a7',borderColor:'#00bcd4',lineColor:'#00bcd4',labelColor:'#00bcd4'}},
      london:{...config.definitions.london,enabled:false},
      'new-york':{...config.definitions['new-york'],enabled:false},
    }});
  },

  drawIndicators(ctx, visible, xFor, yFor, candleW, chartWidth, height, bottomAxis, volumeHeight, maxVol) {
    if (this.isVolumeVisible()) {
      visible.forEach((c, i) => {
        if(!Number.isFinite(c.volume) || c.volume <= 0)return;
        const color = c.close >= c.open ? "rgba(0,184,148,.32)" : "rgba(255,59,79,.32)";
        const volH = Math.max(1, ((c.volume || 0) / maxVol) * volumeHeight);
        ctx.fillStyle = color;
        ctx.fillRect(xFor(i) - Math.max(1, candleW * 0.32), height - bottomAxis - volH, Math.max(2, candleW * 0.64), volH);
      });
      ctx.fillStyle = "#787B86";
      ctx.font = "11px Inter, sans-serif";
      ctx.fillText("Volume", 12, height - bottomAxis - volumeHeight - 8);
    }
    if (this.indicator === "ema") {
      this.drawEma(ctx, visible, xFor, yFor, 20, "#f3c969");
      this.drawEma(ctx, visible, xFor, yFor, 50, "#7aa2ff");
    }
    if (this.indicator === "sma") {
      this.drawSma(ctx, visible, xFor, yFor, 20, "#f3c969");
      this.drawSma(ctx, visible, xFor, yFor, 50, "#7aa2ff");
    }
    if (this.indicator === "vwap") this.drawVwap(ctx, visible, xFor, yFor);
    if (this.indicator === "rsi") this.drawRsi(ctx, visible, xFor, height, bottomAxis, volumeHeight);
  },

  drawEma(ctx, visible, xFor, yFor, period, color) {
    const k = 2 / (period + 1);
    let ema = visible[0]?.close || 0;
    ctx.beginPath();
    visible.forEach((c, i) => {
      ema = c.close * k + ema * (1 - k);
      const x = xFor(i), y = yFor(ema);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  },

  drawSma(ctx, visible, xFor, yFor, period, color) {
    if (!visible.length) return;
    ctx.beginPath();
    let sum = 0;
    visible.forEach((c, i) => {
      sum += Number(c.close) || 0;
      if (i >= period) sum -= Number(visible[i - period].close) || 0;
      const n = Math.min(i + 1, period);
      const x = xFor(i), y = yFor(sum / n);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  },

  drawVwap(ctx, visible, xFor, yFor) {
    let pv = 0, vol = 0;
    ctx.beginPath();
    visible.forEach((c, i) => {
      const volume = Math.max(1, Number(c.volume) || 0);
      pv += ((Number(c.high) + Number(c.low) + Number(c.close)) / 3) * volume;
      vol += volume;
      const x = xFor(i), y = yFor(pv / vol);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = "#d58cff";
    ctx.lineWidth = 1.7;
    ctx.stroke();
  },

  drawRsi(ctx, visible, xFor, height, bottomAxis, paneHeight) {
    const period = 14;
    const values = visible.map((c, i) => {
      if (i === 0) return 50;
      let gains = 0, losses = 0;
      const from = Math.max(1, i - period + 1);
      for (let j = from; j <= i; j++) {
        const diff = (Number(visible[j].close) || 0) - (Number(visible[j - 1].close) || 0);
        if (diff >= 0) gains += diff; else losses -= diff;
      }
      const rs = losses ? gains / losses : 100;
      return 100 - (100 / (1 + rs));
    });
    const top = height - bottomAxis - paneHeight + 8;
    const bottom = height - bottomAxis - 8;
    const y = (value) => bottom - (Math.max(0, Math.min(100, value)) / 100) * (bottom - top);
    ctx.save();
    ctx.fillStyle = "rgba(120,123,134,.06)";
    ctx.fillRect(0, top, xFor(visible.length - 1), bottom - top);
    ctx.strokeStyle = "rgba(120,123,134,.35)";
    ctx.setLineDash([3, 3]);
    [30, 50, 70].forEach((level) => { ctx.beginPath(); ctx.moveTo(0, y(level)); ctx.lineTo(xFor(visible.length - 1), y(level)); ctx.stroke(); });
    ctx.setLineDash([]);
    ctx.beginPath();
    values.forEach((value, i) => { const x = xFor(i), yy = y(value); if (i === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy); });
    ctx.strokeStyle = "#f3c969";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = "#787B86";
    ctx.font = "11px Inter, sans-serif";
    ctx.fillText("RSI 14", 12, top + 12);
    ctx.restore();
  },

  drawTradeLevels(ctx, yFor, chartWidth, meta) {
    this._tradeLevelHits = [];
    Store.state.active_trades.filter((t) => t.symbol === this.symbol).forEach((t) => {
      const draft = this.tradeProtectionDraft?.id === t.id ? this.tradeProtectionDraft : null;
      const levels = draft || t;
      const x = Math.max(8, chartWidth - 270);
      for (const [key,color] of [['entry','#2962ff'],['sl','#ff3b4f'],['tp','#00b894']]) {
        const price = key === 'entry' ? t.entry : levels[key];
        const fallback = t.entry * (1 + (t.type === 'BUY' ? 1 : -1) * (key === 'sl' ? -.002 : .004));
        const y = yFor(price ?? fallback);
        const label = key === 'entry' ? `${t.type} ${t.lots} · Entered ${Fmt.price(price,meta.decimals)}` : `${key.toUpperCase()} ${price == null ? '+ Add' : Fmt.price(price,meta.decimals)} · drag`;
        this.dashedLine(ctx,0,y,chartWidth,y,color,[4,4]);
        ctx.save();ctx.fillStyle='#101820';ctx.fillRect(x,y-11,265,22);
        ctx.strokeStyle=color;ctx.strokeRect(x,y-11,265,22);ctx.fillStyle=color;ctx.font='11px Inter, sans-serif';ctx.textAlign='left';ctx.fillText(label,x+6,y+4);ctx.restore();
        if(key !== 'entry') this._tradeLevelHits.push({id:t.id,key,x,y,width:265});
      }
      if(draft) {
        const y=yFor(t.entry)+28;
        [['discard','Discard','#414956'],['confirm',draft.saving?'Saving…':'Confirm','#2962ff']].forEach(([action,label,color],i)=>{
          const bx=x+i*100;
          ctx.save();ctx.fillStyle=color;ctx.fillRect(bx,y,94,23);ctx.fillStyle='#fff';ctx.font='11px Inter, sans-serif';ctx.textAlign='left';ctx.fillText(label,bx+9,y+16);ctx.restore();
          this._tradeLevelHits.push({id:t.id,action,x:bx,y:y+11,width:94});
        });
        if(draft.error){ctx.save();ctx.fillStyle='#ff6b78';ctx.font='11px Inter, sans-serif';ctx.fillText(draft.error,8,y+44);ctx.restore();}
      }
    });
  },

  drawOrderDraft(ctx, yFor, chartWidth, height, bottomAxis, meta) {
    const draft = this.orderDraft;
    this._orderDraftHits = [];
    if (!draft || draft.symbol !== this.symbol || !Number.isFinite(Number(draft.entry))) return;
    const direction = draft.type === "BUY" ? 1 : -1;
    const entry = Number(draft.entry);
    const stop = Number(draft.sl);
    const target = Number(draft.tp);
    if (!Number.isFinite(stop) || !Number.isFinite(target)) return;
    const entryY = yFor(entry), stopY = yFor(stop), targetY = yFor(target);
    const left = Math.max(8, Math.min(chartWidth - 300, chartWidth * 0.43));
    const right = chartWidth - 6;
    const contract = meta.kind === "fx" ? 100000 : meta.kind === "crypto" ? 1 : (this.symbol === "SILVER" ? 5000 : 100);
    const moneyFor = (priceDelta) => Fmt.moneyPlain(priceDelta * contract * Number(draft.lots || this.lots));
    const drawLevel = (key, price, y, color, text, fill) => {
      ctx.save();
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = fill;
      ctx.fillRect(left, Math.min(entryY, y), Math.max(0, right - left), Math.abs(y - entryY));
      ctx.globalAlpha = 1;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.4;
      ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(chartWidth, y + 0.5); ctx.stroke();
      ctx.setLineDash([]);
      const labelWidth = Math.min(244, Math.max(136, ctx.measureText(text).width + 20));
      const labelX = Math.max(4, right - labelWidth);
      const labelY = Math.max(4, Math.min(height - bottomAxis - 25, y - 12));
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.roundRect(labelX, labelY, labelWidth, 22, 5); ctx.fill();
      ctx.fillStyle = "#f7f9fc";
      ctx.font = "600 11px Inter, sans-serif";
      ctx.textAlign = "left"; ctx.textBaseline = "middle";
      ctx.fillText(text, labelX + 8, labelY + 11, labelWidth - 14);
      ctx.restore();
      this._orderDraftHits.push({ key, x: 0, width: chartWidth, y, kind: "level" });
    };
    drawLevel("tp", target, targetY, "#00b894", `TP  ${moneyFor(Math.abs(target - entry))}  ·  ${Fmt.price(target, meta.decimals)}`, "#00b894");
    drawLevel("sl", stop, stopY, "#ff5364", `SL  ${moneyFor(-Math.abs(entry - stop))}  ·  ${Fmt.price(stop, meta.decimals)}`, "#ff5364");

    ctx.save();
    ctx.strokeStyle = "#4388ff"; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(0, entryY + 0.5); ctx.lineTo(chartWidth, entryY + 0.5); ctx.stroke(); ctx.setLineDash([]);
    const entryText = `${draft.type}  ${Number(draft.lots || this.lots).toFixed(2)} lots  ·  ${Fmt.price(entry, meta.decimals)}`;
    ctx.font = "700 10px Inter, sans-serif"; ctx.textBaseline = "middle"; ctx.textAlign = "left";
    const entryW = Math.max(112, ctx.measureText(entryText).width + 16);
    const labelX = Math.max(4, Math.min(chartWidth - entryW - 151, chartWidth * 0.3));
    const labelY = Math.max(5, Math.min(height - bottomAxis - 29, entryY - 14));
    ctx.fillStyle = "#10203b"; ctx.strokeStyle = "#4388ff"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(labelX, labelY, entryW, 24, 5); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#dce8ff"; ctx.fillText(entryText, labelX + 8, labelY + 12, entryW - 14);
    let buttonX = labelX + entryW + 7;
    const buttons = [
      { key: "discard", text: "Discard", width: 64, color: "#343b48" },
      { key: "confirm", text: draft.saving ? "Saving…" : "Confirm", width: 70, color: "#2962ff" },
    ];
    buttons.forEach((button) => {
      ctx.fillStyle = button.color;
      ctx.beginPath(); ctx.roundRect(buttonX, labelY, button.width, 24, 5); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.textAlign = "center";
      ctx.fillText(button.text, buttonX + button.width / 2, labelY + 12);
      this._orderDraftHits.push({ key: button.key, x: buttonX, width: button.width, y: labelY + 12, kind: "action" });
      buttonX += button.width + 5;
    });
    ctx.fillStyle = "#4388ff";
    ctx.beginPath(); ctx.arc(Math.min(chartWidth - 5, Math.max(5, left)), entryY, 4, 0, Math.PI * 2); ctx.fill();
    if (draft.error) {
      ctx.fillStyle = "#ff7884"; ctx.textAlign = "left";
      ctx.fillText(draft.error, 8, Math.min(height - bottomAxis - 10, labelY + 38), chartWidth - 16);
    }
    ctx.restore();
    this._orderDraftHits.push({ key: "entry", x: 0, width: chartWidth, y: entryY, kind: "level" });
  },

  orderDraftHit(point) {
    if (!this.orderDraft || !point) return null;
    const hits = [...(this._orderDraftHits || [])].reverse();
    return hits.find((hit) => hit.kind === "action" && point.x >= hit.x && point.x <= hit.x + hit.width && Math.abs(point.y - hit.y) <= 13) || hits.find((hit) => (
      point.x >= hit.x && point.x <= hit.x + hit.width && Math.abs(point.y - hit.y) <= (hit.kind === "action" ? 13 : 9)
    )) || null;
  },

  tradeLevelHit(point) {
    return [...(this._tradeLevelHits || [])].reverse().find(h=>point.x>=h.x && point.x<=h.x+h.width && Math.abs(point.y-h.y)<=12);
  },

  async confirmTradeProtection() {
    const draft=this.tradeProtectionDraft;
    const trade=Store.state.active_trades.find(t=>t.id===draft?.id);
    const candle=this.candles[this.idx];
    if(!draft || draft.saving || !trade || !candle)return;
    draft.saving=true;draft.error=null;this.scheduleDraw();
    try {
      const response=await fetch('/api/trades/protection',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({account_id:Store.state.id,id:trade.id,sl:draft.sl,tp:draft.tp,mark:candle[trade.type==='BUY'?'bid':'ask']?.close ?? candle.close})});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error || 'Could not save SL/TP.');
      await Store.refresh({fresh:true});this.tradeProtectionDraft=null;this.syncOrderPrices();
    } catch(error){draft.error=error.message;} finally{draft.saving=false;this.scheduleDraw();}
  },

  drawingToolType(tool = this.tool) {
    if (['crosshair','select','zoom','scissors','eraser'].includes(tool)) return null;
    return {
      trend: "trendLine",
      ray: "ray",
      hline: "horizontalLine",
      vline: "verticalLine",
      rect: "rectangle",
      ellipse: "ellipse",
      triangle: "triangle",
      polygon: "polygon",
      channel: "parallelChannel",
      fib: "fibRetracement",
      brush: "polyline",
      text: "text",
      measure: "riskReward",
      priceRange: "priceRange",
      dateRange: "dateRange",
      longPosition: "longPosition",
      shortPosition: "shortPosition",
      extended: "extendedLine",
      arrow: "arrow",
      hray: "horizontalRay",
      vray: "verticalRay",
    }[tool] || (this.drawingEngine?.toolRegistry?.hasTool?.(tool) ? tool : null);
  },

  makeDrawing(type, anchors, extra = {}) {
    const now = Date.now();
    return {
      id: extra.id || `draw_${now}_${Math.random().toString(36).slice(2, 8)}`,
      type,
      version: extra.version || 1,
      symbol: this.symbol,
      timeframeScope: extra.timeframeScope || "all",
      anchors: anchors.map((a) => this.normalizeDrawingAnchor(a)),
      style: { ...this.drawingDefaults, ...(extra.style || {}) },
      visible: extra.visible ?? true,
      locked: extra.locked ?? false,
      selected: false,
      layer: extra.layer ?? this.nextDrawingLayer(),
      metadata: extra.metadata || {},
      createdAt: extra.createdAt || now,
      updatedAt: now,
    };
  },

  nextDrawingLayer() {
    return (this.drawings.reduce((max, d) => Math.max(max, d.layer || 0), 0) || 0) + 1;
  },

  normalizeDrawingAnchor(anchor = {}) {
    const rawIndex = Number.isFinite(anchor.index) ? Math.round(anchor.index) : 0;
    const sourceTimestamp = anchor.time ?? anchor.timestamp ?? this.candles[rawIndex]?.date?.getTime() ?? null;
    const normalized = this.drawingEngine?.coordinateManager?.normalizeAnchor?.({ ...anchor, time: sourceTimestamp, timestamp: sourceTimestamp }, { allowIncomplete: true });
    const timestamp = normalized?.time ?? sourceTimestamp;
    const index = timestamp != null ? this.snapIndexToTimestamp(timestamp) : Math.max(0, Math.min(this.candles.length - 1, rawIndex));
    return {
      ...anchor,
      type: "time-price",
      index,
      time: timestamp ?? this.candles[index]?.date?.getTime() ?? null,
      price: normalized?.price ?? (Number.isFinite(anchor.price) ? anchor.price : this.candles[index]?.close || 0),
      timestamp: timestamp ?? this.candles[index]?.date?.getTime() ?? null,
      metadata: {
        ...(anchor.metadata || {}),
        candleIndex: index,
      },
    };
  },

  normalizeDrawing(d) {
    const drawing = d.anchors
      ? d
      : this.makeDrawing("trendLine", [d.a, d.b], { id: d.id, style: { color: d.color || this.drawingDefaults.color } });
    return {
      ...drawing,
      anchors: (drawing.anchors || []).map((anchor) => this.normalizeDrawingAnchor(anchor)),
    };
  },

  visibleDrawingObjects() {
    return this.drawings
      .map((d) => this.normalizeDrawing(d))
      .filter((d) => d.symbol === this.symbol && d.visible !== false && (d.timeframeScope === "all" || d.timeframeScope === this.timeframe))
      .sort((a, b) => (a.layer || 0) - (b.layer || 0));
  },

  drawUserDrawings(ctx, start, xFor, yFor, candleW) {
    const projector = this.drawingProjector();
    const project = projector?.project || ((a) => ({ x: xFor(a.index - start), y: yFor(a.price) }));
    this.visibleDrawingObjects().forEach((drawing) => this.drawDrawingObject(ctx, drawing, project));
    if (this.pendingDrawing && this.crosshair) {
      const anchors = this.pendingDrawing.anchors?.length
        ? this.pendingDrawing.anchors
        : [this.pendingDrawing.anchor, this.snapDrawingPoint(this.crosshair)];
      const preview = this.makeDrawing(this.pendingDrawing.type, anchors, {
        style: { color: "#f3c969", width: 1.5, opacity: 0.95 },
        layer: 999999,
      });
      this.drawDrawingObject(ctx, preview, project, true);
    }
    const temporary = this.drawingEngine?.state?.temporaryDrawing;
    if (temporary?.anchors?.length) {
      this.drawDrawingObject(ctx, {
        ...temporary,
        type: this.legacyTypeForEngineType(temporary.type),
        style: { ...this.drawingDefaults, ...(temporary.style || {}), color: temporary.style?.color || "#f3c969" },
      }, project, true);
    }
    this.drawSnapIndicator(ctx);
    this.drawSelectionBox(ctx);
  },

  drawSnapIndicator(ctx) {
    const result = this.drawingEngine?.state?.snapResult;
    if (!result?.snapped || !result.logical) return;
    const point = this.drawingEngine?.coordinateManager?.logicalToContainer?.(result.logical);
    if (!point || point.offscreen) return;
    ctx.save();
    ctx.strokeStyle = "#f3c969";
    ctx.fillStyle = "rgba(243, 201, 105, 0.16)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(point.x - 11, point.y);
    ctx.lineTo(point.x + 11, point.y);
    ctx.moveTo(point.x, point.y - 11);
    ctx.lineTo(point.x, point.y + 11);
    ctx.stroke();
    if (result.label) {
      ctx.font = "11px Inter, sans-serif";
      ctx.fillStyle = "#f3c969";
      ctx.fillText(result.label, point.x + 10, point.y - 10);
    }
    ctx.restore();
  },

  drawSelectionBox(ctx) {
    const box = this.drawingEngine?.selectionManager?.boxSelection;
    if (!box) return;
    const rect = this.container?.querySelector("#tvCanvas")?.getBoundingClientRect?.();
    if (!rect) return;
    const x = Math.min(box.x1, box.x2) - rect.left;
    const y = Math.min(box.y1, box.y2) - rect.top;
    const w = Math.abs(box.x2 - box.x1);
    const h = Math.abs(box.y2 - box.y1);
    ctx.save();
    ctx.fillStyle = "rgba(61, 127, 255, 0.10)";
    ctx.strokeStyle = "rgba(61, 127, 255, 0.86)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
  },

  drawingProjector(rect = null) {
    const canvas = this.container?.querySelector("#tvCanvas");
    const bounds = rect || canvas?.getBoundingClientRect?.();
    if (!bounds) return null;
    this.drawingEngine?.setCoordinateAdapter?.(this.drawingCoordinateAdapter());
    const coordinateManager = this.drawingEngine?.coordinateManager;
    const win = this._chartFrame?.windowState || this.chartWindow();
    const metrics = this.chartMetrics(bounds);
    const range = win.hi - win.lo || 1;
    const plotBottom = bounds.height - metrics.bottomAxis;
    const ySpan = Math.max(1, metrics.priceHeight - metrics.topPad);
    return {
      win,
      metrics,
      plotBottom,
      project: (anchor) => ({
        x: coordinateManager?.timeToX(anchor.time ?? anchor.timestamp) ?? ((anchor.index - win.logicalStart) * metrics.candleW + metrics.candleW * 0.5),
        y: coordinateManager?.priceToY(anchor.price) ?? (metrics.topPad + ((win.hi - anchor.price) / range) * ySpan),
      }),
    };
  },

  drawDrawingObject(ctx, drawing, project, preview = false) {
    if (!drawing.anchors?.length) return;
    const selected = this.selectedDrawingIds.includes(drawing.id);
    const hovered = this.hoveredDrawingId === drawing.id;
    const style = { ...this.drawingDefaults, ...(drawing.style || {}) };
    const properties = drawing.properties || {};
    const pts = drawing.anchors.map(project);
    ctx.save();
    ctx.globalAlpha = preview ? 0.78 : style.opacity ?? 1;
    ctx.strokeStyle = selected ? "#3d7fff" : hovered ? "#f3c969" : style.color || "#d1d4dc";
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = selected || hovered ? Math.max(2, style.width || 1.5) : style.width || 1.5;
    if (style.lineStyle === "dashed") ctx.setLineDash([8, 5]);
    if (style.lineStyle === "dotted") ctx.setLineDash([2, 4]);
    if (properties.crossline && pts[0]) {
      const p=pts[0],w=this._chartFrame?.metrics.chartWidth || this._canvasW,h=this._canvasH;
      ctx.beginPath();ctx.moveTo(0,p.y);ctx.lineTo(w,p.y);ctx.moveTo(p.x,0);ctx.lineTo(p.x,h-24);ctx.stroke();
      if(properties.priceLabelVisible){ctx.fillStyle=style.color;ctx.fillRect(w,p.y-10,78,20);ctx.fillStyle='#10141b';ctx.font='11px monospace';ctx.fillText(drawing.anchors[0].price.toFixed(MarketData.getMeta(this.symbol).decimals),w+4,p.y+4);}
      ctx.fillStyle=style.color;ctx.font='11px monospace';ctx.fillText(this.axisDateTimeLabel(new Date(drawing.anchors[0].time)),p.x+4,h-8);
      if(selected)this.drawSelectionHandles(ctx,pts,drawing);ctx.restore();return;
    }
    if (properties.arc && pts.length >= 3) {
      const [a,b,c]=pts;
      ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.quadraticCurveTo(c.x,c.y,b.x,b.y);ctx.stroke();
      if(selected)this.drawSelectionHandles(ctx,pts,drawing);ctx.restore();return;
    }
    if (properties.patternLabels) {
      ctx.beginPath();pts.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.stroke();
      ctx.font='12px monospace';ctx.fillStyle=style.textColor || style.color;
      pts.forEach((p,i)=>{ctx.fillText(properties.patternLabels[i] || '',p.x+5,p.y-8);if(i>0){const distance=drawing.anchors[i].price-drawing.anchors[i-1].price;const previous=i>1?Math.abs(drawing.anchors[i-1].price-drawing.anchors[i-2].price):0;ctx.fillText(`${distance.toFixed(2)}${previous?' / '+(Math.abs(distance)/previous).toFixed(3):''}`,(pts[i-1].x+p.x)/2,(pts[i-1].y+p.y)/2-8);}});
      if(selected)this.drawSelectionHandles(ctx,pts,drawing);ctx.restore();return;
    }
    if (drawing.locked && style.lineStyle === "solid") ctx.setLineDash([6, 4]);
    if (["longPosition", "shortPosition"].includes(drawing.type)) {
      this.drawPositionObject(ctx, drawing, project, style, preview);
    } else if (["trendLine", "ray", "extendedLine", "arrow", "fibRetracement", "riskReward", "priceRange", "dateRange"].includes(drawing.type)) {
      const [a, b] = pts;
      if (!a || !b) return ctx.restore();
      if (drawing.type !== 'fibRetracement') this.strokeObjectLine(ctx, a, b, drawing.type, properties);
      if (drawing.type === "arrow") this.drawArrowHead(ctx, a, b, properties);
      if (drawing.type === "fibRetracement") this.drawFibLevels(ctx, pts, drawing);
      if (["riskReward", "priceRange", "dateRange"].includes(drawing.type)) this.drawMeasurement(ctx, pts, drawing);
    } else if (drawing.type === "horizontalLine") {
      const y = pts[0].y;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(this._canvasW || 400, y); ctx.stroke();
      if (properties.priceLabelVisible !== false) this.priceBadge(ctx, this._canvasW - 78, y, Fmt.price(drawing.anchors[0].price, MarketData.getMeta(this.symbol).decimals), style.color);
    } else if (drawing.type === "verticalLine") {
      const x = pts[0].x;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, this._canvasH || 300); ctx.stroke();
      ctx.fillText(this.axisDateTimeLabel(new Date(drawing.anchors[0].time ?? drawing.anchors[0].timestamp)), Math.max(0, x - 80), this._canvasH - 8);
    } else if (drawing.type === "horizontalRay") {
      const p = pts[0];
      const endX = properties.direction === "left" ? 0 : (this._canvasW || 400);
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(endX, p.y); ctx.stroke();
    } else if (drawing.type === "verticalRay") {
      const p = pts[0];
      const endY = properties.direction === "up" ? 0 : (this._canvasH || 300);
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x, endY); ctx.stroke();
    } else if (drawing.type === "rectangle") {
      const [a, b] = pts;
      const x = properties.extendLeft ? 0 : Math.min(a.x, b.x), y = Math.min(a.y, b.y);
      const right = properties.extendRight ? (this._chartFrame?.metrics.chartWidth || this._canvasW || 1000) : Math.max(a.x,b.x);
      const w = right-x, h = Math.abs(a.y-b.y);
      ctx.fillStyle = style.fillColor || style.color || "#3d7fff";
      ctx.globalAlpha = preview ? 0.2 : Math.max(0, Math.min(1, (style.fillOpacity ?? 0.16) * (style.opacity ?? 1)));
      ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = preview ? 0.78 : style.opacity ?? 1;
      ctx.strokeRect(x, y, w, h);
      if (properties.labelVisible && drawing.metadata?.text) { ctx.fillStyle = style.textColor || '#d1d4dc'; ctx.font = '12px Inter, sans-serif'; ctx.fillText(drawing.metadata.text, x + 6, y + 16); }
    } else if (drawing.type === "ellipse") {
      const [a, b] = pts;
      if (properties.arc) { ctx.beginPath(); ctx.ellipse((a.x+b.x)/2,(a.y+b.y)/2,Math.max(1,Math.abs(b.x-a.x)/2),Math.max(1,Math.abs(b.y-a.y)/2),0,Math.PI,2*Math.PI);ctx.stroke(); }
      else this.drawEllipseObject(ctx, a, b, style, preview);
    } else if (["triangle", "polygon"].includes(drawing.type)) {
      this.drawPolygonObject(ctx, pts, style, preview, true);
    } else if (drawing.type === "parallelChannel") {
      this.drawParallelChannel(ctx, pts);
    } else if (drawing.type === "text") {
      const p = pts[0];
      ctx.fillStyle = style.textColor || style.color || "#d1d4dc";
      ctx.font = `${style.fontWeight || "400"} ${style.fontSize || drawing.metadata?.fontSize || 13}px Inter, sans-serif`;
      if (['note','callout'].includes(properties.annotationKind)) {
        const width = ctx.measureText(drawing.metadata?.text || 'Text').width + 14;
        ctx.fillStyle = style.fillColor || '#253146'; ctx.fillRect(p.x, p.y-24,width,24);
        if(properties.annotationKind==='callout'){ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(p.x+10,p.y);ctx.lineTo(p.x,p.y+10);ctx.fill();}
        ctx.fillStyle = style.textColor || '#d1d4dc';
      }
      ctx.fillText(drawing.metadata?.text || "Text", p.x + 4, p.y - 4);
    } else if (drawing.type === "polyline") {
      ctx.beginPath();
      pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
      ctx.stroke();
    }
    if (selected) this.drawSelectionHandles(ctx, pts, drawing);
    ctx.restore();
  },

  strokeObjectLine(ctx, a, b, type, properties = {}) {
    const width = this._canvasW || 1600;
    let x1 = a.x, y1 = a.y, x2 = b.x, y2 = b.y;
    if (type === "ray" || type === "extendedLine" || properties.extendLeft || properties.extendRight) {
      const dx = b.x - a.x || 1;
      const dy = b.y - a.y;
      if (type === "extendedLine" || (properties.extendLeft && properties.extendRight)) {
        const t1 = (0 - a.x) / dx, t2 = (width - a.x) / dx;
        x1 = 0; y1 = a.y + dy * t1; x2 = width; y2 = a.y + dy * t2;
      } else if (type === "ray" || properties.extendRight) {
        const t2 = (width - a.x) / dx;
        x2 = width; y2 = a.y + dy * t2;
      } else if (properties.extendLeft) {
        const t1 = (0 - a.x) / dx;
        x1 = 0; y1 = a.y + dy * t1;
      }
    }
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  },

  drawArrowHead(ctx, a, b, properties = {}) {
    const size = Math.max(6, Math.min(28, Number(properties.arrowSize) || 12));
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const drawHead = (point, direction) => {
      const theta = angle + (direction === "start" ? Math.PI : 0);
      ctx.beginPath();
      ctx.moveTo(point.x, point.y);
      ctx.lineTo(point.x - size * Math.cos(theta - Math.PI / 6), point.y - size * Math.sin(theta - Math.PI / 6));
      ctx.moveTo(point.x, point.y);
      ctx.lineTo(point.x - size * Math.cos(theta + Math.PI / 6), point.y - size * Math.sin(theta + Math.PI / 6));
      ctx.stroke();
    };
    if (properties.arrowStart) drawHead(a, "start");
    if (properties.arrowEnd !== false) drawHead(b, "end");
  },

  drawEllipseObject(ctx, a, b, style, preview = false) {
    if (!a || !b) return;
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(a.x - b.x), h = Math.abs(a.y - b.y);
    ctx.fillStyle = style.fillColor || style.color || "#3d7fff";
    ctx.globalAlpha = preview ? 0.2 : Math.max(0, Math.min(1, (style.fillOpacity ?? 0.12) * (style.opacity ?? 1)));
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h / 2, Math.max(1, w / 2), Math.max(1, h / 2), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = preview ? 0.78 : style.opacity ?? 1;
    ctx.stroke();
  },

  drawPolygonObject(ctx, pts, style, preview = false, close = true) {
    const points = pts.filter(Boolean);
    if (points.length < 2) return;
    ctx.beginPath();
    points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
    if (close && points.length > 2) ctx.closePath();
    if (close && points.length > 2) {
      ctx.fillStyle = style.fillColor || style.color || "#3d7fff";
      ctx.globalAlpha = preview ? 0.18 : Math.max(0, Math.min(1, (style.fillOpacity ?? 0.12) * (style.opacity ?? 1)));
      ctx.fill();
      ctx.globalAlpha = preview ? 0.78 : style.opacity ?? 1;
    }
    ctx.stroke();
  },

  drawParallelChannel(ctx, pts) {
    const [a, b, c] = pts;
    if (!a || !b || !c) return;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const px = c.x - a.x;
    const py = c.y - a.y;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    ctx.moveTo(c.x, c.y); ctx.lineTo(c.x + dx, c.y + dy);
    ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y);
    ctx.moveTo(b.x, b.y); ctx.lineTo(b.x + px, b.y + py);
    ctx.stroke();
  },

  drawMeasurement(ctx, pts, drawing) {
    const [a, b] = pts;
    if (!a || !b) return;
    const anchors = drawing.anchors || [];
    const priceA = Number(anchors[0]?.price);
    const priceB = Number(anchors[1]?.price);
    const timeA = Number(anchors[0]?.time ?? anchors[0]?.timestamp);
    const timeB = Number(anchors[1]?.time ?? anchors[1]?.timestamp);
    const priceDiff = Number.isFinite(priceA) && Number.isFinite(priceB) ? priceB - priceA : 0;
    const pct = priceA ? (priceDiff / priceA) * 100 : 0;
    const minutes = Number.isFinite(timeA) && Number.isFinite(timeB) ? Math.abs(timeB - timeA) / 60000 : 0;
    ctx.save();
    ctx.globalAlpha *= 0.92;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(a.x, b.y); ctx.lineTo(b.x, b.y); ctx.moveTo(a.x, a.y); ctx.lineTo(a.x, b.y); ctx.stroke();
    ctx.setLineDash([]);
    const label = drawing.type === "dateRange"
      ? `${Math.round(minutes)}m`
      : drawing.type === "priceRange"
        ? `${priceDiff >= 0 ? "+" : ""}${priceDiff.toFixed(2)} (${pct.toFixed(2)}%)`
        : `${priceDiff >= 0 ? "+" : ""}${priceDiff.toFixed(2)} (${pct.toFixed(2)}%) / ${Math.round(minutes)}m`;
    const indices = anchors.map(anchor => this.chartCoordinates().timeToIndex(anchor.time ?? anchor.timestamp));
    const bars = Math.abs(Math.round(indices[1]) - Math.round(indices[0]));
    const rows = this.candles.slice(Math.max(0, Math.floor(Math.min(...indices))), Math.min(this.getReplayLimit() + 1, Math.ceil(Math.max(...indices)) + 1));
    const high = rows.length ? Math.max(...rows.map(c => c.high)) : null;
    const low = rows.length ? Math.min(...rows.map(c => c.low)) : null;
    ctx.font = "11px Inter, sans-serif";
    ctx.fillText(label, Math.min(a.x, b.x) + 6, Math.min(a.y, b.y) - 6);
    ctx.fillText(`${bars} bars${high == null ? '' : ` · H ${high.toFixed(2)} L ${low.toFixed(2)} Range ${(high - low).toFixed(2)}`}`, Math.min(a.x, b.x) + 6, Math.min(a.y, b.y) - 22);
    ctx.restore();
  },

  positionGeometry(drawing) {
    const anchors = drawing.anchors || [];
    const entry = drawing.geometry?.entry || anchors.find((a) => a.metadata?.role === "entry") || anchors[0];
    const stop = drawing.geometry?.stopLoss || anchors.find((a) => a.metadata?.role === "stop") || anchors[1];
    const target = drawing.geometry?.takeProfit || anchors.find((a) => a.metadata?.role === "target") || anchors[2];
    const start = drawing.geometry?.timeRange?.start ?? anchors.find((a) => a.metadata?.role === "start")?.time ?? anchors[3]?.time ?? entry?.time;
    const end = drawing.geometry?.timeRange?.end ?? anchors.find((a) => a.metadata?.role === "end")?.time ?? anchors[4]?.time ?? entry?.time;
    if (!entry || !stop || !target) return null;
    return {
      direction: ["shortPosition", "short-position"].includes(drawing.type) ? "short" : "long",
      entry: { time: Number(entry.time ?? entry.timestamp), price: Number(entry.price) },
      stopLoss: { price: Number(stop.price) },
      takeProfit: { price: Number(target.price) },
      timeRange: { start: Number(start), end: Number(end) },
    };
  },

  positionMetrics(drawing) {
    const geometry = this.positionGeometry(drawing);
    if (!geometry) return null;
    const entry = geometry.entry.price;
    const stop = geometry.stopLoss.price;
    const target = geometry.takeProfit.price;
    const risk = geometry.direction === "short" ? stop - entry : entry - stop;
    const reward = geometry.direction === "short" ? entry - target : target - entry;
    const rr = risk > 0 && reward > 0 ? reward / risk : null;
    return {
      geometry,
      risk,
      reward,
      rr,
      riskPct: entry ? Math.abs(risk / entry) * 100 : 0,
      rewardPct: entry ? Math.abs(reward / entry) * 100 : 0,
      valid: risk > 0 && reward > 0,
    };
  },

  drawPositionObject(ctx, drawing, project, style, preview = false) {
    const showDetails = this.selectedDrawingIds.includes(drawing.id) || this.hoveredDrawingId === drawing.id || preview;
    const metrics = this.positionMetrics(drawing);
    if (!metrics) return;
    const { geometry, risk, reward, rr } = metrics;
    const leftPoint = project({ time: geometry.timeRange.start, price: geometry.entry.price });
    const rightPoint = project({ time: geometry.timeRange.end, price: geometry.entry.price });
    const entry = project({ time: geometry.entry.time, price: geometry.entry.price });
    const stop = project({ time: geometry.entry.time, price: geometry.stopLoss.price });
    const target = project({ time: geometry.entry.time, price: geometry.takeProfit.price });
    if (!leftPoint || !rightPoint || !entry || !stop || !target) return;
    const left = Math.min(leftPoint.x, rightPoint.x);
    const right = Math.max(leftPoint.x, rightPoint.x);
    const width = Math.max(1, right - left);
    const riskTop = Math.min(entry.y, stop.y);
    const riskHeight = Math.max(1, Math.abs(stop.y - entry.y));
    const profitTop = Math.min(entry.y, target.y);
    const profitHeight = Math.max(1, Math.abs(target.y - entry.y));
    const alpha = preview ? 0.22 : Math.max(0, Math.min(1, (style.fillOpacity ?? 0.35) * (style.opacity ?? 1)));
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = style.riskColor || "#ff3b4f";
    ctx.fillRect(left, riskTop, width, riskHeight);
    ctx.fillStyle = style.profitColor || "#00b894";
    ctx.fillRect(left, profitTop, width, profitHeight);
    ctx.globalAlpha = preview ? 0.84 : (style.opacity ?? 1);
    const drawLevel = (y, color, dash = []) => {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = style.width || 1.4;
      ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
      ctx.restore();
    };
    drawLevel(entry.y, showDetails ? (style.entryColor || "#d1d4dc") : "rgba(209,212,220,.3)");
    if (showDetails) {
      drawLevel(target.y, style.targetColor || "#00b894");
      drawLevel(stop.y, style.stopColor || "#ff3b4f");
      const decimals = this.priceDecimals ? this.priceDecimals() : 3;
      const fmt = value => Number(value).toFixed(decimals);
      const meta = MarketData.getMeta(this.symbol);
      const contract = meta.kind === 'fx' ? 100000 : meta.kind === 'crypto' ? 1 : 100;
      const lots = Number(drawing.properties?.lots ?? this.lots ?? 0.01);
      const quantity = lots * contract;
      const current = this.candles[this.idx];
      const mark = current?.[geometry.direction === 'short' ? 'ask' : 'bid']?.close ?? current?.close;
      const pnl = Number.isFinite(mark) ? (mark - geometry.entry.price) * quantity * (geometry.direction === 'short' ? -1 : 1) : null;
      const tag = (lines, y, color) => {
        ctx.save();ctx.font='600 11px Inter, sans-serif';
        const textWidth = Math.max(...lines.map(line => ctx.measureText(line).width));
        const w = textWidth + 12, h = lines.length * 14 + 8;
        const x = Math.max(2, Math.min((left+right-w)/2, (this._canvasW || right+w)-w-2));
        ctx.fillStyle=color;ctx.strokeStyle='#ffffff';ctx.lineWidth=0.75;ctx.setLineDash([]);
        ctx.beginPath();ctx.roundRect(x,y,w,h,3);ctx.fill();ctx.stroke();
        ctx.fillStyle='#ffffff';ctx.textAlign='center';ctx.textBaseline='middle';
        lines.forEach((line,i)=>ctx.fillText(line,x+w/2,y+11+i*14));ctx.restore();
      };
      const stopText = `Stop: ${fmt(risk)} (${metrics.riskPct.toFixed(3)}%) · Risk: ${fmt(risk*quantity)}`;
      const targetText = `Target: ${fmt(reward)} (${metrics.rewardPct.toFixed(3)}%) · Reward: ${fmt(reward*quantity)}`;
      if (drawing.properties?.showStop !== false) tag([stopText], stop.y < entry.y ? stop.y-30 : stop.y+8, style.stopColor || '#ff3b4f');
      if (drawing.properties?.showTarget !== false) tag([targetText], target.y < entry.y ? target.y-30 : target.y+8, style.targetColor || '#00b894');
      if (drawing.properties?.showRR !== false) tag([
        `Open P&L: ${pnl == null ? '—' : fmt(pnl)} · Qty: ${quantity.toFixed(2)}`,
        `Risk/Reward ratio: ${rr == null ? 'Invalid' : rr.toFixed(2)}`,
      ], entry.y + (target.y > entry.y ? 10 : -46), pnl < 0 ? (style.riskColor || '#ff3b4f') : (style.profitColor || '#00b894'));
    }
    ctx.restore();
  },

  drawFibLevels(ctx, pts, drawing) {
    const [a, b] = pts;
    if (!a || !b) return;
    const properties = drawing.properties || {};
    const levels = properties.fibMode ? (properties.levels || [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.272, 1.618]) : window.IntenseDrawing.fibRetracementLevels(properties.levels);
    const first = properties.reverse ? b : a;
    const second = properties.reverse ? a : b;
    const anchors = properties.reverse ? [drawing.anchors[1], drawing.anchors[0]] : drawing.anchors;
    const basePoint = pts[2] || second;
    const baseAnchor = drawing.anchors[2] || anchors[1];
    ctx.save();
    ctx.font = '11px Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    // A transparent overlay: only the anchor guide, level lines and labels are painted.
    ctx.strokeStyle = '#808080';
    ctx.lineWidth = 1;
    ctx.setLineDash([8, 8]);
    ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
    ctx.setLineDash([]);
    levels.forEach((level) => {
      const ratio = Number(level);
      if (!Number.isFinite(ratio)) return;
      const channel = properties.fibMode === 'channel';
      const y = window.IntenseDrawing.fibLevelValue(a.y, b.y, ratio, properties, basePoint.y);
      const price = window.IntenseDrawing.fibLevelValue(drawing.anchors[0].price, drawing.anchors[1].price, ratio, properties, baseAnchor.price);
      const left = properties.extendLeft ? 0 : Math.min(a.x, b.x);
      const right = properties.extendRight ? this._canvasW - 78 : Math.max(a.x, b.x);
      const colors = {'0.382':'#ff9800', '0.5':'#4caf50', '0.618':'#009688', '0.66':'#00bcd4'};
      ctx.strokeStyle = colors[String(ratio)] || drawing.style?.color || '#808080';
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = drawing.style?.width || 1;
      if(channel){ const baselineAtThird=first.y+(second.y-first.y)*(basePoint.x-first.x)/(second.x-first.x||1); const offset=(basePoint.y-baselineAtThird)*ratio;ctx.beginPath();ctx.moveTo(first.x,first.y+offset);ctx.lineTo(second.x,second.y+offset);ctx.stroke(); }
      else { ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke(); }
      const labelPrice = Number(price).toLocaleString('en-US', {minimumFractionDigits:3,maximumFractionDigits:3});
      ctx.fillText(`${ratio} (${labelPrice})`, left - 7, y);
    });
    ctx.restore();
  },

  drawRiskReward(ctx, pts) {
    const [a, b] = pts;
    const x = Math.min(a.x, b.x), w = Math.abs(a.x - b.x);
    const midY = (a.y + b.y) / 2;
    ctx.save();
    ctx.fillStyle = "rgba(0,184,148,.16)"; ctx.fillRect(x, Math.min(a.y, midY), w, Math.abs(a.y - midY));
    ctx.fillStyle = "rgba(255,59,79,.14)"; ctx.fillRect(x, Math.min(midY, b.y), w, Math.abs(b.y - midY));
    ctx.restore();
  },

  drawSelectionHandles(ctx, pts, drawing = null) {
    if (drawing && ["longPosition", "shortPosition"].includes(drawing.type)) {
      this.drawPositionSelectionHandles(ctx, drawing);
      return;
    }
    ctx.save();
    ctx.fillStyle = "#0b0e14";
    ctx.strokeStyle = "#3d7fff";
    ctx.lineWidth = 1.5;
    const rect = this.container?.querySelector("#tvCanvas")?.getBoundingClientRect?.();
    const handles = drawing && rect
      ? (this.drawingEngine?.transformEngine?.getHandles?.({
        ...drawing,
        type: window.IntenseDrawing?.LegacyDrawingTypeMap?.[drawing.type] || this.engineToolForUiTool(drawing.type) || drawing.type,
      }) || []).map((handle) => ({ x: handle.screen.x - rect.left, y: handle.screen.y - rect.top, kind: handle.kind }))
      : [];
    const points = handles.length ? handles : pts;
    points.forEach((p) => {
      ctx.beginPath();
      ctx.roundRect(p.x - 5, p.y - 5, 10, 10, 3);
      ctx.fill();
      ctx.stroke();
    });
    ctx.restore();
  },

  drawPositionSelectionHandles(ctx, drawing) {
    const rect = this.container?.querySelector("#tvCanvas")?.getBoundingClientRect?.();
    if (!rect) return;
    const handles = this.drawingEngine?.transformEngine?.getHandles?.({
      ...drawing,
      type: window.IntenseDrawing?.LegacyDrawingTypeMap?.[drawing.type] || drawing.type,
    }) || [];
    const roleName = { target: "TP", entry: "ENTRY", stop: "SL", start: "START", end: "END" };
    ctx.save();
    ctx.font = "9px Inter, sans-serif";
    handles.forEach((handle) => {
      const x = handle.screen.x - rect.left;
      const y = handle.screen.y - rect.top;
      const isTime = handle.id === "start" || handle.id === "end";
      ctx.fillStyle = "#0b0e14";
      ctx.strokeStyle = isTime ? "#f3c969" : "#3d7fff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (isTime) ctx.roundRect(x - 5, y - 9, 10, 18, 3);
      else ctx.arc(x, y, 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      const label = roleName[handle.id] || handle.id;
      const labelW = ctx.measureText(label).width + 8;
      ctx.fillStyle = "rgba(12,14,18,.82)";
      ctx.beginPath();
      ctx.roundRect(x - labelW / 2, y + 8, labelW, 14, 4);
      ctx.fill();
      ctx.fillStyle = "#d1d4dc";
      ctx.fillText(label, x - labelW / 2 + 4, y + 18);
    });
    ctx.restore();
  },

  initializeDrawingWorkspaceUX() {
    if (!this.drawingWorkspaceUX && window.IntenseDrawing?.DrawingWorkspaceUX) {
      this.drawingWorkspaceUX = new window.IntenseDrawing.DrawingWorkspaceUX({ key: "tfb_drawing_workspace_ux_v1", storage: this.chartStorage() });
    }
    const state = this.drawingWorkspaceUX?.getState?.();
    if (state) {
      this.drawingObjectSearch = state.objectTree?.search || "";
      this.drawingObjectFilter = state.objectTree?.filter || "all";
      this.magnetMode = state.magnetEnabled ?? this.magnetMode;
    }
  },

  drawingStorageKey() {
    return `tfb_drawings_v1_${this.symbol}`;
  },

  saveDrawingStorage() {
    this.updateDrawingHistoryControls();
    try {
      this.syncDrawingEngineFromLegacy();
      this.ensureDrawingNames();
      this.chartStorage().setItem(this.drawingStorageKey(), JSON.stringify(this.drawings.map((d) => this.normalizeDrawing(d))));
      this.drawingWorkspaceUX?.save?.();
    } catch { /* localStorage can be disabled */ }
  },

  loadDrawingStorage() {
    try {
      const saved = JSON.parse(this.chartStorage().getItem(this.drawingStorageKey()) || "[]");
      this.drawings = Array.isArray(saved) ? saved.map((d) => this.normalizeDrawing(d)) : [];
      this.selectedDrawingIds = [];
    } catch {
      this.drawings = [];
    }
    this.syncDrawingEngineFromLegacy();
  },

  drawingDisplayName(drawing) {
    return drawing?.metadata?.name || drawing?.metadata?.label || this.defaultDrawingName(drawing);
  },

  defaultDrawingName(drawing) {
    const names = {
      trendLine: "Trend Line",
      ray: "Ray",
      extendedLine: "Extended Line",
      arrow: "Arrow",
      horizontalRay: "Horizontal Ray",
      verticalRay: "Vertical Ray",
      horizontalLine: "Horizontal Line",
      verticalLine: "Vertical Line",
      rectangle: "Rectangle",
      ellipse: "Ellipse",
      triangle: "Triangle",
      polygon: "Polygon",
      parallelChannel: "Parallel Channel",
      fibRetracement: "Fibonacci Retracement",
      riskReward: "Price + Date Range",
      priceRange: "Price Range",
      dateRange: "Date Range",
      longPosition: "Long Position",
      shortPosition: "Short Position",
      polyline: "Brush",
      text: "Text",
    };
    const base = names[drawing?.type] || drawing?.type || "Drawing";
    const same = this.drawings.filter((item) => item.type === drawing?.type && item.id !== drawing?.id);
    return same.length ? `${base} ${same.length + 1}` : base;
  },

  groupForDrawing(id) {
    return this.drawingWorkspaceUX?.groupForDrawing?.(id) || null;
  },

  filteredObjectTreeDrawings() {
    const query = String(this.drawingObjectSearch || "").trim().toLowerCase();
    const filter = this.drawingObjectFilter || "all";
    const groupMatch = (drawing) => String(this.groupForDrawing(drawing.id)?.name || "").toLowerCase().includes(query);
    return this.drawings
      .map((d) => this.normalizeDrawing(d))
      .filter((d) => d.symbol === this.symbol && (d.timeframeScope === "all" || d.timeframeScope === this.timeframe))
      .filter((d) => {
        if (!query) return true;
        return this.drawingDisplayName(d).toLowerCase().includes(query) || String(d.type || "").toLowerCase().includes(query) || groupMatch(d);
      })
      .filter((d) => {
        if (filter === "hidden") return d.visible === false;
        if (filter === "locked") return !!d.locked;
        if (filter === "groups") return !!this.groupForDrawing(d.id);
        if (filter === "lines") return ["trendLine", "ray", "extendedLine", "arrow", "horizontalLine", "verticalLine", "horizontalRay", "verticalRay"].includes(d.type);
        if (filter === "shapes") return ["rectangle", "ellipse", "triangle", "polygon"].includes(d.type);
      if (filter === "fibonacci") return d.type === "fibRetracement";
      if (filter === "measurements") return ["riskReward", "priceRange", "dateRange"].includes(d.type);
      if (filter === "position") return ["longPosition", "shortPosition"].includes(d.type);
      if (filter === "annotations") return ["text", "polyline"].includes(d.type);
        return true;
      })
      .sort((a, b) => (a.layer || 0) - (b.layer || 0));
  },

  initializeDrawingEngine() {
    if (!window.IntenseDrawing?.createDrawingEngine) return null;
    if (this.stayInDrawingMode == null) {
      try { this.stayInDrawingMode = this.chartStorage().getItem('tfb_stay_drawing_v1') === 'true'; } catch { this.stayInDrawingMode = false; }
    }
    if (!this.drawingEngine) {
      this.drawingEngine = window.IntenseDrawing.createDrawingEngine({
        eventTarget: window,
        coordinateAdapter: this.drawingCoordinateAdapter(),
        getSymbol: () => this.symbol,
        getReplayLimit: () => this.getReplayLimit(),
        rendererOptions: {
          adapter: {
            render: (drawings) => { this.scheduleDrawingDraw(); return { drawingsRendered: drawings.length }; },
            requestRender: () => this.scheduleDrawingDraw(),
          },
        },
      });
      this.drawingEngine.initialize({ existingDrawings: this.drawings });
      this.drawingEngine.toolRegistry.getTools().forEach(tool => {
        if (!this.TOOL_META[tool.id]) this.TOOL_META[tool.id] = { name: tool.name, label: tool.name.slice(0,2), group: tool.category };
      });
      this.drawingEngine.setMagnetEnabled?.(this.magnetMode);
    } else {
      this.drawingEngine.setCoordinateAdapter(this.drawingCoordinateAdapter());
      this.drawingEngine.setMagnetEnabled?.(this.magnetMode);
      this.syncDrawingEngineFromLegacy();
    }
    return this.drawingEngine;
  },

  drawingCoordinateAdapter() {
    return {
      continuousTime: true,
      getContainerRect: () => this.container?.querySelector("#tvCanvas")?.getBoundingClientRect?.() || null,
      getMetrics: (rect) => rect ? this.chartMetrics(rect) : null,
      getWindowState: () => this._chartFrame?.windowState || this.chartWindow(),
      getCandles: () => this.candles,
      getTimeframeMs: () => this.candleDuration(),
      getDevicePixelRatio: () => window.devicePixelRatio || 1,
    };
  },

  chartCoordinates() {
    if (!this._chartCoordinates && window.IntenseDrawing?.CoordinateManager) {
      this._chartCoordinates = new window.IntenseDrawing.CoordinateManager({ ...this.drawingCoordinateAdapter(), continuousTime: true });
    }
    return this._chartCoordinates;
  },

  scheduleDrawingDraw() {
    if (this._drawingRaf) return;
    this._drawingRaf = requestAnimationFrame(() => {
      this._drawingRaf = null;
      const frame = this._chartFrame;
      const canvas = this.container?.querySelector("#tvDrawingCanvas");
      if (!frame || !canvas) return;
      const { windowState: win, metrics } = frame;
      const ctx = this.prepareCanvas(canvas, frame.rect, frame.dpr);
      ctx.clearRect(0, 0, frame.rect.width, frame.rect.height);
      this.drawUserDrawings(ctx, win.start,
        i => (win.start + i - win.logicalStart + 0.5) * metrics.candleW,
        price => this.chartCoordinates().priceToY(price, { metrics, windowState: win }), metrics.candleW);
    });
  },

  scheduleInteractionDraw() {
    if (this._interactionRaf) return;
    this._interactionRaf = requestAnimationFrame(() => {
      this._interactionRaf = null;
      this.drawInteractionLayer();
    });
  },

  drawInteractionLayer() {
    const canvas = this.container?.querySelector("#tvInteractionCanvas");
    const frame = this._chartFrame;
    if (!canvas || !frame) return;
    const ctx = this.prepareCanvas(canvas, frame.rect, frame.dpr);
    ctx.clearRect(0, 0, frame.rect.width, frame.rect.height);
    if (!this.crosshair) {
      const tip = this.container?.querySelector("#crosshairTip");
      if (tip) tip.style.display = "none";
      return;
    }
    const { windowState: win, metrics } = frame;
    const coords = this.chartCoordinates();
    if (!coords) return;
    const context = { metrics, windowState: win };
    const point = this.crosshair;
    const index = Math.max(win.start, Math.min(win.start + win.visible.length - 1,
      Math.round(coords.xToIndex(point.x, context))));
    point.index = index;
    point.localIndex = index - win.start;
    point.price = coords.yToPrice(point.y, context);
    this.drawCrosshair(ctx, point, win.visible,
      i => (win.start + i - win.logicalStart + 0.5) * metrics.candleW,
      price => coords.priceToY(price, context), y => coords.yToPrice(y, context),
      metrics.candleW, metrics.chartWidth, frame.rect.height, metrics.bottomAxis, win.meta);
  },

  syncDrawingEngineFromLegacy() {
    if (!this.drawingEngine) return;
    this.drawingEngine.setCoordinateAdapter(this.drawingCoordinateAdapter());
    this.drawingEngine.manager.importDrawings(this.drawings, { legacy: true, clear: true });
  },

  syncLegacyDrawingsFromEngine() {
    if (!this.drawingEngine) return;
    const byId = new Map(this.drawings.map((drawing) => [drawing.id, drawing]));
    this.drawings = this.drawingEngine.getDrawings().map((drawing) => ({
      ...(byId.get(drawing.id) || drawing),
      id: drawing.id,
      type: drawing.properties?.legacyType || this.legacyTypeForEngineType(drawing.type),
      version: drawing.version || drawing.properties?.version || 1,
      anchors: drawing.anchors,
      style: drawing.style,
      visible: drawing.visible,
      locked: drawing.locked,
      layer: drawing.layer,
      symbol: drawing.symbol || this.symbol,
      timeframeScope: drawing.timeframeVisibility || "all",
      properties: drawing.properties || {},
      geometry: drawing.geometry || null,
      metadata: drawing.metadata || {},
      createdAt: drawing.createdAt,
      updatedAt: drawing.updatedAt,
    }));
  },

  engineToolForUiTool(tool = this.tool) {
    return {
      testLine: "test-line",
      hline: window.IntenseDrawing?.DrawingTypes?.HORIZONTAL_LINE,
      vline: window.IntenseDrawing?.DrawingTypes?.VERTICAL_LINE,
      trend: window.IntenseDrawing?.DrawingTypes?.TREND_LINE,
      ray: window.IntenseDrawing?.DrawingTypes?.RAY,
      extended: window.IntenseDrawing?.DrawingTypes?.EXTENDED_LINE,
      arrow: window.IntenseDrawing?.DrawingTypes?.ARROW,
      hray: window.IntenseDrawing?.DrawingTypes?.HORIZONTAL_RAY,
      vray: window.IntenseDrawing?.DrawingTypes?.VERTICAL_RAY,
      rect: window.IntenseDrawing?.DrawingTypes?.RECTANGLE,
      ellipse: window.IntenseDrawing?.DrawingTypes?.ELLIPSE,
      triangle: window.IntenseDrawing?.DrawingTypes?.TRIANGLE,
      polygon: window.IntenseDrawing?.DrawingTypes?.POLYGON,
      channel: window.IntenseDrawing?.DrawingTypes?.PARALLEL_CHANNEL,
      fib: window.IntenseDrawing?.DrawingTypes?.FIB_RETRACEMENT,
      measure: window.IntenseDrawing?.DrawingTypes?.PRICE_DATE_RANGE,
      priceRange: window.IntenseDrawing?.DrawingTypes?.PRICE_RANGE,
      dateRange: window.IntenseDrawing?.DrawingTypes?.DATE_RANGE,
      text: window.IntenseDrawing?.DrawingTypes?.TEXT,
      brush: window.IntenseDrawing?.DrawingTypes?.BRUSH,
      longPosition: window.IntenseDrawing?.DrawingTypes?.LONG_POSITION,
      shortPosition: window.IntenseDrawing?.DrawingTypes?.SHORT_POSITION,
    }[tool] || (this.drawingEngine?.toolRegistry?.hasTool?.(tool) ? tool : null);
  },

  legacyTypeForEngineType(type) {
    return {
      "horizontal-line": "horizontalLine",
      "vertical-line": "verticalLine",
      "trend-line": "trendLine",
      "ray": "ray",
      "extended-line": "extendedLine",
      "arrow": "arrow",
      "horizontal-ray": "horizontalRay",
      "vertical-ray": "verticalRay",
      "rectangle": "rectangle",
      "ellipse": "ellipse",
      "circle": "ellipse",
      "triangle": "triangle",
      "polygon": "polygon",
      "parallel-channel": "parallelChannel",
      "fib-retracement": "fibRetracement",
      "price-range": "priceRange",
      "date-range": "dateRange",
      "price-date-range": "riskReward",
      "long-position": "longPosition",
      "short-position": "shortPosition",
      "brush": "polyline",
      "text": "text",
    }[type] || type;
  },

  syncToolControllerResult() {
    if (!this.drawingEngine) return;
    this.syncLegacyDrawingsFromEngine();
    const last = this.drawingEngine.state.lastCreatedDrawingId;
    if (last) {
      this.selectedDrawingIds = [last];
      this.ensureDrawingNames([last]);
      this.applyDefaultTemplateToDrawing(last);
    }
    if (this.drawingEngine.getActiveTool?.() === window.IntenseDrawing?.DrawingTypes?.SELECT || this.drawingEngine.state.activeTool === window.IntenseDrawing?.DrawingTypes?.SELECT) {
      this.tool = "crosshair";
      this.cursorMode = "crosshair";
    }
    this.updateToolChrome();
    this.saveDrawingStorage();
  },

  ensureDrawingNames(ids = null) {
    const targetIds = ids ? new Set(ids) : null;
    this.drawings = this.drawings.map((drawing) => {
      if (targetIds && !targetIds.has(drawing.id)) return drawing;
      if (drawing.metadata?.name) return drawing;
      return { ...drawing, metadata: { ...(drawing.metadata || {}), name: this.defaultDrawingName(drawing) } };
    });
  },

  renameSelectedDrawing() {
    const selected = this.drawings.find((d) => this.selectedDrawingIds.includes(d.id));
    if (!selected) return;
    const name = prompt("Rename drawing", this.drawingDisplayName(selected));
    if (!name) return;
    this.applyDrawingPropertyPatch({ metadata: { name: name.trim() } });
    toast("Drawing renamed.", "success");
  },

  groupSelectedDrawings() {
    if (!this.selectedDrawingIds.length || !this.drawingWorkspaceUX) return;
    const group = this.drawingWorkspaceUX.createGroup(`Group ${Object.keys(this.drawingWorkspaceUX.getState().groups || {}).length + 1}`, this.selectedDrawingIds);
    this.applyDrawingPropertyPatch({ metadata: { groupId: group.id } });
    this.saveDrawingStorage();
    this.rerender();
    toast("Drawing group created.", "success");
  },

  groupAction(groupId, action) {
    const group = this.drawingWorkspaceUX?.getState?.().groups?.[groupId];
    if (!group) return;
    const children = group.children || [];
    if (action === "toggle") this.drawingWorkspaceUX.updateGroup(groupId, { collapsed: !group.collapsed });
    if (action === "rename") {
      const name = prompt("Rename group", group.name);
      if (name) this.drawingWorkspaceUX.updateGroup(groupId, { name: name.trim() });
    }
    if (action === "visibility") {
      const nextVisible = group.visible === false;
      this.drawingWorkspaceUX.updateGroup(groupId, { visible: nextVisible });
      this.syncDrawingEngineFromLegacy();
      this.drawingEngine?.updateDrawingProperties?.(children, { visible: nextVisible }, { label: nextVisible ? "Show Group" : "Hide Group" });
      this.syncLegacyDrawingsFromEngine();
    }
    if (action === "lock") {
      const nextLocked = !group.locked;
      this.drawingWorkspaceUX.updateGroup(groupId, { locked: nextLocked });
      this.syncDrawingEngineFromLegacy();
      this.drawingEngine?.updateDrawingProperties?.(children, { locked: nextLocked }, { label: nextLocked ? "Lock Group" : "Unlock Group" });
      this.syncLegacyDrawingsFromEngine();
    }
    if (action === "delete") {
      this.selectedDrawingIds = [...children];
      this.drawingEngine?.selectionManager?.selectMultiple?.(children, { reason: "group-delete" });
      this.deleteSelectedDrawings();
      this.drawingWorkspaceUX.deleteGroup(groupId);
    }
    this.saveDrawingStorage();
    this.rerender();
  },

  applyTemplate(templateId) {
    const template = this.drawingWorkspaceUX?.getTemplate?.(templateId);
    if (!template || !this.selectedDrawingIds.length) return;
    this.applyDrawingPropertyPatch({ style: template.style || {}, properties: template.properties || {} });
    toast("Template applied.", "success");
  },

  saveSelectedAsTemplate() {
    const selected = this.drawings.find((d) => this.selectedDrawingIds.includes(d.id));
    if (!selected) return;
    const name = prompt("Template name", `${this.drawingDisplayName(selected)} Template`);
    if (!name) return;
    this.drawingWorkspaceUX?.saveTemplate?.(name.trim(), selected);
    this.rerender();
    toast("Template saved.", "success");
  },

  setSelectedDefaultTemplate() {
    const selected = this.drawings.find((d) => this.selectedDrawingIds.includes(d.id));
    const templateId = this.container?.querySelector("#drawingTemplateSelect")?.value;
    if (!selected || !templateId) return;
    const engineType = window.IntenseDrawing?.LegacyDrawingTypeMap?.[selected.type] || selected.type;
    this.drawingWorkspaceUX?.setDefaultTemplate?.(engineType, templateId);
    toast("Default template saved.", "success");
  },

  applyDefaultTemplateToDrawing(id) {
    const drawing = this.drawingEngine?.getDrawing?.(id);
    if (!drawing) return;
    const templateId = this.drawingWorkspaceUX?.getState?.().defaultTemplates?.[drawing.type];
    if (!templateId) return;
    const template = this.drawingWorkspaceUX.getTemplate(templateId);
    if (!template) return;
    this.drawingEngine?.updateDrawingProperties?.([id], { style: template.style || {}, properties: template.properties || {} }, { label: "Apply Default Template" });
    this.syncLegacyDrawingsFromEngine();
  },

  updateToolChrome() {
    this.updateDrawingHistoryControls();
    this.container?.querySelectorAll("[data-tool]").forEach((btn) => btn.classList.toggle("active", btn.dataset.tool === this.tool));
    this.container?.querySelector('[data-tool="stayDrawing"]')?.classList.toggle('active', !!this.stayInDrawingMode);
    this.container?.querySelectorAll('[data-tool="magnet"]').forEach((btn) => {
      btn.classList.toggle("active", !!this.magnetMode);
      btn.setAttribute("aria-pressed", this.magnetMode ? "true" : "false");
    });
    const cursorBtn = this.container?.querySelector("#cursorModeBtn");
    cursorBtn?.classList.toggle("active", this.tool === "crosshair");
  },

  updateDrawingHistoryControls() {
    for (const [action, available] of [["undo", !!this.drawingEngine?.canUndo?.()], ["redo", !!this.drawingEngine?.canRedo?.()]]) {
      this.container?.querySelectorAll?.(`[data-tool="${action}"], #toolbar${action === "undo" ? "Undo" : "Redo"}Btn`)?.forEach(button => { button.disabled = !available; });
    }
  },

  commitDrawingCommand(command) {
    if (!command?.redo || !command?.undo) return;
    command.redo();
    this.drawingHistory = [];
    this.drawingRedoStack = [];
    this.saveDrawingStorage();
    this.scheduleDraw();
  },

  addDrawingObject(drawing) {
    this.syncDrawingEngineFromLegacy();
    this.drawingEngine?.registerDrawingsWithHistory?.([this.drawingEngine.factory.fromLegacy(drawing)], this.selectedDrawingIds);
    this.syncLegacyDrawingsFromEngine();
    this.selectedDrawingIds = [...(this.drawingEngine?.state?.selectedDrawingIds || this.selectedDrawingIds)];
    this.saveDrawingStorage();
    this.scheduleDraw();
  },

  updateDrawingObjects(ids, updater) {
    if (!ids.length) return;
    this.syncDrawingEngineFromLegacy();
    const before = ids.map((id) => this.drawingEngine?.getDrawing?.(id)).filter(Boolean);
    const afterLegacy = this.drawings.filter((d) => ids.includes(d.id)).map((d) => ({ ...updater(structuredClone(d)), updatedAt: Date.now() }));
    const after = afterLegacy.map((d) => this.drawingEngine.factory.fromLegacy(d));
    this.drawingEngine?.updateDrawingsWithHistory?.(before, after, "Update Drawings");
    this.syncLegacyDrawingsFromEngine();
    this.selectedDrawingIds = [...(this.drawingEngine?.state?.selectedDrawingIds || this.selectedDrawingIds)];
    this.saveDrawingStorage();
    this.scheduleDraw();
  },

  deleteSelectedDrawings() {
    const ids = this.selectedDrawingIds;
    if (!ids.length) return;
    this.syncDrawingEngineFromLegacy();
    this.drawingEngine?.deleteDrawings?.(ids);
    this.syncLegacyDrawingsFromEngine();
    this.selectedDrawingIds = [];
    this.saveDrawingStorage();
    this.scheduleDraw();
    toast("Drawing deleted.", "success");
  },

  duplicateSelectedDrawings() {
    this.syncDrawingEngineFromLegacy();
    this.drawingEngine?.selectionManager?.selectMultiple?.(this.selectedDrawingIds, { reason: "legacy-duplicate" });
    this.drawingEngine?.duplicateSelectedDrawings?.({ offsetCandles: 4 });
    this.syncLegacyDrawingsFromEngine();
    this.selectedDrawingIds = [...(this.drawingEngine?.state?.selectedDrawingIds || [])];
    this.saveDrawingStorage();
    this.scheduleDraw();
    toast("Drawing duplicated.", "success");
  },

  cloneDrawingWithOffset(drawing, indexOffset = 2, priceOffset = 0) {
    const copy = structuredClone(this.normalizeDrawing(drawing));
    copy.id = `draw_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    copy.layer = this.nextDrawingLayer();
    copy.createdAt = Date.now();
    copy.updatedAt = Date.now();
    copy.locked = false;
    copy.anchors = copy.anchors.map((a) => this.normalizeDrawingAnchor({ ...a, index: a.index + indexOffset, timestamp: null, price: a.price + priceOffset }));
    if (copy.geometry) {
      const shiftTime = (time) => {
        const idx = this.drawingEngine?.coordinateManager?.timeToIndex?.(time);
        const shifted = Number.isFinite(idx) ? this.drawingEngine?.coordinateManager?.indexToTime?.(idx + indexOffset) : null;
        return shifted ?? time;
      };
      copy.geometry = {
        ...copy.geometry,
        entry: copy.geometry.entry ? { ...copy.geometry.entry, time: shiftTime(copy.geometry.entry.time), price: Number(copy.geometry.entry.price) + priceOffset } : copy.geometry.entry,
        stopLoss: copy.geometry.stopLoss ? { ...copy.geometry.stopLoss, price: Number(copy.geometry.stopLoss.price) + priceOffset } : copy.geometry.stopLoss,
        takeProfit: copy.geometry.takeProfit ? { ...copy.geometry.takeProfit, price: Number(copy.geometry.takeProfit.price) + priceOffset } : copy.geometry.takeProfit,
        timeRange: copy.geometry.timeRange ? { start: shiftTime(copy.geometry.timeRange.start), end: shiftTime(copy.geometry.timeRange.end) } : copy.geometry.timeRange,
      };
    }
    return copy;
  },

  undoDrawingAction() {
    if (!this.drawingEngine?.undo?.()) return false;
    this.syncLegacyDrawingsFromEngine();
    this.selectedDrawingIds = [...(this.drawingEngine?.state?.selectedDrawingIds || [])];
    this.saveDrawingStorage();
    this.scheduleDraw();
    return true;
  },

  redoDrawingAction() {
    if (!this.drawingEngine?.redo?.()) return false;
    this.syncLegacyDrawingsFromEngine();
    this.selectedDrawingIds = [...(this.drawingEngine?.state?.selectedDrawingIds || [])];
    this.saveDrawingStorage();
    this.scheduleDraw();
    return true;
  },

  snapDrawingPoint(point) {
    if (!point) return point;
    const withTimestamp = (anchor) => ({ ...anchor, timestamp: this.candles[Math.round(anchor.index)]?.date?.getTime() || null });
    if (!this.magnetMode) return withTimestamp({ index: Math.round(point.index), price: point.price });
    const candle = this.candles[Math.round(point.index)];
    if (!candle || this.tool === "brush") return withTimestamp({ index: point.index, price: point.price });
    const levels = [candle.open, candle.high, candle.low, candle.close];
    const nearest = levels.reduce((best, price) => Math.abs(price - point.price) < Math.abs(best - point.price) ? price : best, levels[0]);
    const range = Math.max(1e-9, candle.high - candle.low);
    return Math.abs(nearest - point.price) / range < 0.18
      ? withTimestamp({ index: Math.round(point.index), price: nearest })
      : withTimestamp({ index: Math.round(point.index), price: point.price });
  },

  createDrawingFromPoint(point) {
    const type = this.drawingToolType();
    if (!type) return false;
    const snapped = this.snapDrawingPoint(point);
    if (["horizontalLine", "verticalLine", "text"].includes(type)) {
      this.addDrawingObject(this.makeDrawing(type, [snapped], { metadata: type === "text" ? { text: "Text" } : {} }));
      return true;
    }
    if (!this.pendingDrawing) {
      this.pendingDrawing = { type, anchor: snapped };
      this.scheduleDraw();
      return true;
    }
    const anchors = [this.pendingDrawing.anchor, snapped];
    const drawing = this.makeDrawing(type, anchors);
    this.pendingDrawing = null;
    this.addDrawingObject(drawing);
    return true;
  },

  hitTestDrawing(point) {
    this.syncDrawingEngineFromLegacy();
    const engineHit = this.drawingEngine?.hitTest?.(this.screenPointForDrawingHit(point), { drawings: this.visibleDrawingObjects() });
    if (engineHit?.drawing) return engineHit.drawing;
    const drawings = [...this.visibleDrawingObjects()].reverse();
    let best = null;
    drawings.forEach((drawing) => {
      if (drawing.locked) return;
      const score = this.drawingHitScore(drawing, point);
      if (score != null && (!best || score < best.score)) best = { drawing, score };
    });
    return best?.score <= 8 ? best.drawing : null;
  },

  hitTestDrawingHandle(point) {
    this.syncDrawingEngineFromLegacy();
    const engineHit = this.drawingEngine?.hitTest?.(this.screenPointForDrawingHit(point), { drawings: this.visibleDrawingObjects() });
    if (engineHit?.hitType === "anchor" || engineHit?.hitType === "handle") return { drawing: engineHit.drawing, anchorIndex: engineHit.anchorIndex, hit: engineHit };
    const projector = this.drawingProjector();
    if (!projector || !this.selectedDrawingIds.length) return null;
    const selected = [...this.visibleDrawingObjects()].reverse().filter((d) => this.selectedDrawingIds.includes(d.id) && !d.locked);
    for (const drawing of selected) {
      const pts = (drawing.anchors || []).map(projector.project);
      for (let i = 0; i < pts.length; i++) {
        if (Math.hypot(point.x - pts[i].x, point.y - pts[i].y) <= 10) {
          return { drawing, anchorIndex: i };
        }
      }
    }
    return null;
  },

  screenPointForDrawingHit(point) {
    if (!point) return null;
    if (Number.isFinite(point.clientX) && Number.isFinite(point.clientY)) return point;
    const rect = this.container?.querySelector("#tvCanvas")?.getBoundingClientRect?.();
    if (!rect) return point;
    return { ...point, x: rect.left + point.x, y: rect.top + point.y };
  },

  applyDrawingStylePatch(patch) {
    if (this.selectedDrawingIds.length) {
      this.syncDrawingEngineFromLegacy();
      const result = this.drawingEngine?.updateDrawingProperties?.(this.selectedDrawingIds, { style: patch }, { label: "Update Drawing Style" });
      if (result) {
        this.syncLegacyDrawingsFromEngine();
        this.saveDrawingStorage();
        this.scheduleDraw();
        this.updateDrawingManagerSelection();
      }
    } else {
      const normalized = this.drawingEngine?.propertyEngine?.normalizeStyle?.("trend-line", { ...this.drawingDefaults, ...patch }) || { ...this.drawingDefaults, ...patch };
      this.drawingDefaults = normalized;
      if (Object.hasOwn(patch, "opacity")) {
        this.drawingOpacityOverride = normalized.opacity;
        const activeTool = this.drawingEngine?.toolRegistry?.getActiveTool?.();
        if (activeTool) activeTool.defaultStyle = { ...(activeTool.defaultStyle || {}), opacity: normalized.opacity };
      }
      this.scheduleDraw();
    }
  },

  applyDrawingPropertyPatch(patch) {
    if (!this.selectedDrawingIds.length) return;
    this.syncDrawingEngineFromLegacy();
    const result = this.drawingEngine?.updateDrawingProperties?.(this.selectedDrawingIds, patch, { label: "Update Drawing Properties" });
    if (result) {
      this.syncLegacyDrawingsFromEngine();
      this.saveDrawingStorage();
      this.scheduleDraw();
      this.updateDrawingManagerSelection();
    }
  },

  toggleSelectedDrawingVisibility() {
    const selected = this.drawings.find((d) => this.selectedDrawingIds.includes(d.id));
    if (!selected) return;
    const shouldShow = selected.visible === false;
    this.applyDrawingPropertyPatch({ visible: shouldShow });
    this.rerender();
    toast(shouldShow ? "Drawing shown." : "Drawing hidden.", "info");
  },

  loadDrawingManagerPanelState() {
    try {
      this.drawingManagerHidden = this.chartStorage().getItem("tfb_drawing_manager_hidden_v1") === "true";
    } catch {
      this.drawingManagerHidden = false;
    }
  },

  setDrawingManagerHidden(hidden) {
    this.drawingManagerHidden = !!hidden;
    try {
      this.chartStorage().setItem("tfb_drawing_manager_hidden_v1", String(this.drawingManagerHidden));
    } catch { /* localStorage can be disabled */ }
    this.rerender();
  },

  bringSelectedDrawingToFront() {
    if (!this.selectedDrawingIds.length) return;
    const top = this.nextDrawingLayer();
    this.updateDrawingObjects(this.selectedDrawingIds, (d) => ({ ...d, layer: top }));
  },

  sendSelectedDrawingToBack() {
    if (!this.selectedDrawingIds.length) return;
    const low = Math.min(0, ...this.drawings.map((d) => d.layer || 0)) - 1;
    this.updateDrawingObjects(this.selectedDrawingIds, (d) => ({ ...d, layer: low }));
  },

  escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  },

  drawingHitScore(drawing, point) {
    const anchors = drawing.anchors || [];
    if (!anchors.length) return null;
    const projector = this.drawingProjector();
    if (projector) {
      const pts = anchors.map(projector.project);
      const pxPoint = { x: point.x, y: point.y };
      if (drawing.type === "horizontalLine") return Math.abs(pxPoint.y - pts[0].y);
      if (drawing.type === "verticalLine") return Math.abs(pxPoint.x - pts[0].x);
      if (drawing.type === "rectangle" && pts.length > 1) {
        const minX = Math.min(pts[0].x, pts[1].x), maxX = Math.max(pts[0].x, pts[1].x);
        const minY = Math.min(pts[0].y, pts[1].y), maxY = Math.max(pts[0].y, pts[1].y);
        if (pxPoint.x >= minX - 4 && pxPoint.x <= maxX + 4 && pxPoint.y >= minY - 4 && pxPoint.y <= maxY + 4) {
          return Math.min(
            Math.abs(pxPoint.x - minX),
            Math.abs(pxPoint.x - maxX),
            Math.abs(pxPoint.y - minY),
            Math.abs(pxPoint.y - maxY),
            6,
          );
        }
        return null;
      }
      if (drawing.type === "polyline") {
        let best = Infinity;
        for (let i = 1; i < pts.length; i++) best = Math.min(best, this.distanceToSegment(pxPoint, pts[i - 1], pts[i]));
        return best;
      }
      if (pts.length === 1) return Math.hypot(pxPoint.x - pts[0].x, pxPoint.y - pts[0].y);
      return this.distanceToSegment(pxPoint, pts[0], pts[1]);
    }
    if (drawing.type === "horizontalLine") return Math.abs(point.price - anchors[0].price) / Math.max(1e-9, this.chartWindow().hi - this.chartWindow().lo) * 100;
    if (drawing.type === "verticalLine") return Math.abs(point.index - anchors[0].index);
    if (drawing.type === "rectangle" && anchors.length > 1) {
      const minI = Math.min(anchors[0].index, anchors[1].index), maxI = Math.max(anchors[0].index, anchors[1].index);
      const minP = Math.min(anchors[0].price, anchors[1].price), maxP = Math.max(anchors[0].price, anchors[1].price);
      if (point.index >= minI && point.index <= maxI && point.price >= minP && point.price <= maxP) return 2;
    }
    if (anchors.length === 1) return Math.abs(point.index - anchors[0].index) + Math.abs(point.price - anchors[0].price) / Math.max(1e-9, this.chartWindow().hi - this.chartWindow().lo) * 100;
    const [a, b] = anchors;
    const dx = b.index - a.index, dy = b.price - a.price;
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((point.index - a.index) * dx + (point.price - a.price) * dy) / len2));
    const px = a.index + dx * t, py = a.price + dy * t;
    return Math.abs(point.index - px) + Math.abs(point.price - py) / Math.max(1e-9, this.chartWindow().hi - this.chartWindow().lo) * 100;
  },

  distanceToSegment(point, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2));
    const x = a.x + dx * t;
    const y = a.y + dy * t;
    return Math.hypot(point.x - x, point.y - y);
  },

  selectDrawing(drawing, append = false) {
    if (!drawing) {
      this.selectedDrawingIds = [];
      this.drawingEngine?.clearSelection?.({ reason: "chart-empty" });
    } else if (append) {
      this.selectedDrawingIds = this.selectedDrawingIds.includes(drawing.id)
        ? this.selectedDrawingIds.filter((id) => id !== drawing.id)
        : [...this.selectedDrawingIds, drawing.id];
      this.drawingEngine?.selectDrawing?.(drawing.id, { toggle: true, reason: "chart-toggle" });
    } else {
      this.selectedDrawingIds = [drawing.id];
      this.drawingEngine?.selectDrawing?.(drawing.id, { reason: "chart-select" });
    }
    this.scheduleDraw();
    this.updateDrawingManagerSelection();
  },

  updateDrawingManagerSelection() {
    const root = this.container?.querySelector("#drawingManager");
    if (!root) return;
    root.querySelectorAll("[data-drawing-id]").forEach((btn) => btn.classList.toggle("active", this.selectedDrawingIds.includes(btn.dataset.drawingId)));
    const selected = this.drawings.find((d) => this.selectedDrawingIds.includes(d.id));
    const style = { ...this.drawingDefaults, ...(selected?.style || {}) };
    const color = root.querySelector("#drawingColorInput");
    const width = root.querySelector("#drawingWidthInput");
    const opacity = root.querySelector("#drawingOpacityInput");
    const opacityValue = root.querySelector("#drawingOpacityValue");
    const lineStyle = root.querySelector("#drawingLineStyleInput");
    const fillColor = root.querySelector("#drawingFillColorInput");
    const fillOpacity = root.querySelector("#drawingFillOpacityInput");
    const extendLeft = root.querySelector("#drawingExtendLeftInput");
    const extendRight = root.querySelector("#drawingExtendRightInput");
    const textColor = root.querySelector("#drawingTextColorInput");
    const fontSize = root.querySelector("#drawingFontSizeInput");
    const fontWeight = root.querySelector("#drawingFontWeightInput");
    [color, width, lineStyle, fillColor, fillOpacity, extendLeft, extendRight, textColor, fontSize, fontWeight].forEach((input) => { if (input) input.disabled = !selected; });
    if (opacity) opacity.disabled = false;
    if (color) color.value = style.color || "#d1d4dc";
    if (width) width.value = String(style.width || 1.5);
    if (opacity) opacity.value = String(style.opacity ?? 1);
    if (opacityValue) opacityValue.value = `${Math.round((style.opacity ?? 1) * 100)}%`;
    const chartOpacity = this.container?.querySelector("#chartDrawingOpacityInput");
    const chartOpacityValue = this.container?.querySelector("#chartDrawingOpacityValue");
    if (chartOpacity) chartOpacity.value = String(Math.round((style.opacity ?? 1) * 100));
    if (chartOpacityValue) chartOpacityValue.value = `${Math.round((style.opacity ?? 1) * 100)}%`;
    if (lineStyle) lineStyle.value = style.lineStyle || "solid";
    if (fillColor) fillColor.value = style.fillColor || "#3d7fff";
    if (fillOpacity) fillOpacity.value = String(style.fillOpacity ?? 0.16);
    if (extendLeft) extendLeft.checked = !!selected?.properties?.extendLeft;
    if (extendRight) extendRight.checked = !!selected?.properties?.extendRight;
    if (textColor) textColor.value = style.textColor || style.color || "#d1d4dc";
    if (fontSize) fontSize.value = String(style.fontSize || 13);
    if (fontWeight) fontWeight.value = String(style.fontWeight || "400");
  },

  drawReplayCutMarker(ctx, start, xFor, chartWidth, height, bottomAxis) {
    if (!this.replayActive || this.replayCutIndex == null) return;
    const data = this.renderCandles();
    const local = this.replayCutIndex - start;
    if (local < 0 || local >= data.length) return;
    const x = xFor(local);
    this.dashedLine(ctx, x, 0, x, height - bottomAxis, "#f3c969", [6, 4], 0.9);
    ctx.save();
    ctx.font = "11px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const label = "Replay Cut";
    const w = ctx.measureText(label).width + 18;
    const bx = Math.max(w / 2 + 4, Math.min(chartWidth - w / 2 - 4, x));
    ctx.fillStyle = "rgba(243, 201, 105, .18)";
    ctx.strokeStyle = "rgba(243, 201, 105, .75)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(bx - w / 2, 8, w, 24, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#f3c969";
    ctx.fillText(label, bx, 20);
    ctx.restore();
  },

  drawCrosshair(ctx, point, visible, xFor, yFor, priceForY, candleW, chartWidth, height, bottomAxis, meta) {
    const lightTheme = document.body.classList.contains("light-mode");
    const localIndex = Math.max(0, Math.min(visible.length - 1, Math.round(point.localIndex)));
    const candle = point.emptyTime ? null : visible[localIndex];
    const x = point.emptyTime ? point.x : xFor(localIndex);
    const y = point.y;
    const cursorPrice = priceForY(y);
    if (this.cursorMode === "crosshair" || this.cursorMode === "dot") {
      const label = this.axisDateTimeLabel(point.emptyTime ? new Date(point.timestamp) : candle.date);
      ctx.save();
      ctx.font = "11px JetBrains Mono, monospace";
      const labelWidth = Math.min(chartWidth, ctx.measureText(label).width + 16);
      const left = Math.max(0, Math.min(chartWidth - labelWidth, x - labelWidth / 2));
      ctx.fillStyle = lightTheme ? "#e4eaf2" : "#363a45";
      ctx.fillRect(left, height - bottomAxis, labelWidth, bottomAxis);
      ctx.fillStyle = lightTheme ? "#334155" : "#fff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, left + labelWidth / 2, height - bottomAxis / 2);
      ctx.restore();
    }
    if (this.cursorMode === "crosshair") {
      this.dashedLine(ctx, x, 0, x, height - bottomAxis, lightTheme ? "#64748b" : "#d1d4dc", [4, 4], 0.65);
      this.dashedLine(ctx, 0, y, chartWidth, y, lightTheme ? "#64748b" : "#d1d4dc", [4, 4], 0.65);
      this.priceBadge(ctx, chartWidth, y, Fmt.price(cursorPrice, meta.decimals), "#787B86");
    } else if (this.cursorMode === "dot") {
      ctx.save();
      ctx.fillStyle = lightTheme ? "#334155" : "#d1d4dc";
      ctx.strokeStyle = "rgba(0,0,0,.75)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      this.priceBadge(ctx, chartWidth, y, Fmt.price(cursorPrice, meta.decimals), "#787B86");
    } else if (this.cursorMode === "demo") {
      ctx.save();
      ctx.strokeStyle = "#f3c969";
      ctx.fillStyle = "rgba(243, 201, 105, .16)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(point.x, y, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(point.x, y, 3, 0, Math.PI * 2);
      ctx.fillStyle = "#f3c969";
      ctx.fill();
      ctx.restore();
    }

    const tip = this.container.querySelector("#crosshairTip");
    if (tip && candle && this.cursorMode !== "arrow" && this.cursorMode !== "eraser") {
      tip.style.display = "block";
      const tipW = 232;
      const tipH = 126;
      const left = point.x > chartWidth - tipW - 20 ? point.x - tipW - 12 : point.x + 12;
      const top = y > height - bottomAxis - tipH - 20 ? y - tipH - 12 : y + 12;
      const tx = Math.min(chartWidth - tipW - 8, Math.max(8, left));
      const ty = Math.min(height - bottomAxis - tipH - 8, Math.max(8, top));
      tip.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
      if (!tip.dataset.ready) {
        tip.innerHTML = `
          <b data-tip-symbol></b> <span data-tip-time-main></span><br>
          O <span data-tip-open></span>
          H <span data-tip-high></span>
          L <span data-tip-low></span>
          C <span data-tip-close></span><br>
          Vol <span data-tip-volume></span>
          Price <span data-tip-price></span><br>
          Time <span data-tip-time></span>
        `;
        tip._tipRefs = {};
        ["symbol", "time-main", "open", "high", "low", "close", "volume", "price", "time"].forEach((name) => {
          tip._tipRefs[name] = tip.querySelector(`[data-tip-${name}]`);
        });
        tip.dataset.ready = "1";
      }
      const setTip = (name, value) => {
        const node = tip._tipRefs?.[name];
        if (node && node.textContent !== value) node.textContent = value;
      };
      const time = this.axisDateTimeLabel(candle.date);
      setTip("symbol", this.symbol);
      setTip("time-main", time);
      setTip("open", Fmt.price(candle.open, meta.decimals));
      setTip("high", Fmt.price(candle.high, meta.decimals));
      setTip("low", Fmt.price(candle.low, meta.decimals));
      setTip("close", Fmt.price(candle.close, meta.decimals));
      setTip("volume", this.shortVolume(candle.volume));
      setTip("price", Fmt.price(cursorPrice, meta.decimals));
      setTip("time", time);
    } else if (tip) {
      tip.style.display = "none";
    }
  },

  resetChartZoomOnly() {
    this.stopZoomAnimation();
    this.yZoom = 1;
    this.yOffset = 0;
    this.visibleCount = 120;
    this.viewEnd = this.clampViewEnd(this.viewEnd ?? this.followViewEnd());
    this.syncMouseEngineCamera();
    this.scheduleDraw();
    toast("Chart zoom reset.", "info");
  },

  resetTimeZoomOnly() {
    this.stopZoomAnimation();
    this.visibleCount = 120;
    this.viewEnd = this.clampViewEnd(this.viewEnd ?? this.followViewEnd());
    this.syncMouseEngineCamera();
    this.scheduleDraw();
    toast("Time scale reset.", "info");
  },

  copyCrosshairPrice() {
    const meta = MarketData.getMeta(this.symbol);
    const price = this.crosshair?.price ?? this.candles[this.idx]?.close;
    if (price == null) return;
    const text = Fmt.price(price, meta.decimals);
    navigator.clipboard?.writeText(text).then(
      () => toast(`Copied price ${text}.`, "success"),
      () => toast(`Price ${text}.`, "info"),
    );
  },

  copyCrosshairTime() {
    const candle = this.crosshair ? this.candles[this.crosshair.index] : this.candles[this.idx];
    if (!candle) return;
    const text = this.axisDateTimeLabel(candle.date);
    navigator.clipboard?.writeText(text).then(
      () => toast("Copied candle time.", "success"),
      () => toast(text, "info"),
    );
  },

  eraseNearestDrawing(point) {
    const drawing = this.hitTestDrawing(point);
    if (!drawing) {
      toast("No drawing near cursor.", "info");
      return;
    }
    this.selectedDrawingIds = [drawing.id];
    this.deleteSelectedDrawings();
    toast("Drawing erased.", "success");
  },

  levelLine(ctx, y, chartWidth, color, label) {
    this.dashedLine(ctx, 0, y, chartWidth, y, color, [4, 4]);
    this.priceBadge(ctx, chartWidth, y, label, color, 104);
  },

  dashedLine(ctx, x1, y1, x2, y2, color, dash, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  },

  priceBadge(ctx, chartWidth, y, label, color, width = 76) {
    ctx.fillStyle = color;
    ctx.fillRect(chartWidth, y - 11, width, 22);
    ctx.fillStyle = "#fff";
    ctx.font = "11px JetBrains Mono, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, chartWidth + width / 2, y);
    ctx.textAlign = "left";
  },

  timeAxisLabel(date) {
    return this.timeframe.endsWith("m") || this.timeframe.endsWith("h")
      ? date.toLocaleTimeString("en-US", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" })
      : date.toLocaleDateString("en-US", { timeZone: "Asia/Kolkata", month: "short", day: "2-digit" });
  },

  axisDateTimeLabel(date) {
    return date.toLocaleString("en-US", {
      timeZone: "Asia/Kolkata",
      month: "short",
      day: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  },

  shortVolume(v) {
    if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
    if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
    return `${v || 0}`;
  },

  pipValueFor(meta) {
    const CONTRACT_SIZE = { EURUSD: 100000, GBPUSD: 100000, USDJPY: 100000, XAUUSD: 100, GOLD: 100, SILVER: 5000, BTCUSD: 1, ETHUSD: 1 };
    const size = CONTRACT_SIZE[this.symbol] || 100000;
    return meta.pip * size * this.lots;
  },

  afterRender(container) {
    this.container = container;
    container.insertAdjacentHTML('beforeend', this.renderDrawingSettingsDialog());
    container.insertAdjacentHTML('beforeend', this.renderDrawingHelp());
    if(this.drawingObjectsOpen && !this.drawingSettingsOpen){ this.drawingManagerHidden=false;container.querySelector('#chartCard')?.insertAdjacentHTML('beforeend',this.renderDrawingManager()); }
    container.querySelector('#drawingObjectsBtn')?.addEventListener('click',()=>{this.drawingObjectsOpen=!this.drawingObjectsOpen;this.rerender();});
    container.querySelector('#drawingHelpBtn')?.addEventListener('click',()=>{this.drawingHelpOpen=!this.drawingHelpOpen;this.rerender();});
    container.querySelector('#closeDrawingHelpBtn')?.addEventListener('click',()=>{this.drawingHelpOpen=false;this.rerender();});
    container.querySelector('#drawingHelpSearch')?.addEventListener('input',event=>{const query=event.target.value.toLowerCase().trim();container.querySelectorAll('[data-help-search]').forEach(row=>row.hidden=!row.dataset.helpSearch.includes(query));});
    container.querySelectorAll('[data-help-activate]').forEach((button) => button.addEventListener("click", () => {
      const tool = this.drawingEngine?.toolRegistry?.getTool?.(button.dataset.helpActivate);
      if (!tool) return;
      this.TOOL_META[tool.id] ||= { name: tool.name || tool.id, group: tool.category || "draw" };
      this.drawingHelpOpen = false;
      this.selectTool(tool.id);
    }));
    container.querySelector('#closeDrawingSettingsBtn')?.addEventListener('click',()=>{this.drawingSettingsOpen=false;this.rerender();});
    this.syncOrderPrices();
    this.drawChart();
    this.bindChartInteractions(container);
    if (this._drawingPanelClickHandler && this._drawingPanelClickContainer) this._drawingPanelClickContainer.removeEventListener('click', this._drawingPanelClickHandler);
    this._drawingPanelClickContainer = container;
    this._drawingPanelClickHandler = (event) => {
      const hideDrawings = event.target.closest?.("#drawingManagerHideBtn");
      const showDrawings = event.target.closest?.("#drawingManagerRestoreBtn");
      if (!hideDrawings && !showDrawings) return;
      event.preventDefault();
      event.stopPropagation();
      this.setDrawingManagerHidden(!!hideDrawings);
      if(hideDrawings){this.drawingObjectsOpen=false;this.rerender();}
    };
    container.addEventListener('click', this._drawingPanelClickHandler);
    container.querySelectorAll("[data-tf]").forEach(btn => btn.addEventListener("click", () => this.changeTimeframeFromToolbar(btn.dataset.tf)));
    container.querySelector("#symbolSelect")?.addEventListener("change", async (e) => this.switchSymbol(e.target.value));
    container.querySelector("#addSymbolBtn")?.addEventListener("click", () => container.querySelector("#symbolSelect")?.focus());
    container.querySelector("#timeframeSelect")?.addEventListener("change", (e) => {
      const target = container.querySelector(`[data-tf="${e.target.value}"]`);
      if (target) target.click();
      else this.changeTimeframeFromToolbar(e.target.value);
    });
    container.querySelector("#chartTypeSelect")?.addEventListener("change", (e) => {
      this.chartType = e.target.value;
      this.scheduleDraw();
    });
    container.querySelector("#indicatorSelect")?.addEventListener("change", (e) => {
      if (e.target.value !== 'none' && !window.SubscriptionSystem?.canAccessFeature("technicalIndicators")) {
        e.target.value = this.indicator || "volume";
        window.SubscriptionSystem?.requestUpgrade("technicalIndicators");
        return;
      }
      if(e.target.value==='fxn'){
        if(this.sessionEngine?.getConfig?.().asianRange)this.updateSessionConfig({asianRange:false,enabled:false},{rerender:false});
        this.updateFxnSettings({enabled:true});return;
      }
      this.indicator = e.target.value;
      this.scheduleDraw();
    });
    container.querySelector('#fxnToggleBtn')?.addEventListener('click',()=>{
      if(!window.SubscriptionSystem?.canAccessFeature("technicalIndicators")){window.SubscriptionSystem?.requestUpgrade("technicalIndicators");return;}
      const enabled=!this.getFxnIndicator().config.enabled;
      if(enabled && this.sessionEngine?.getConfig?.().asianRange)this.updateSessionConfig({asianRange:false,enabled:false},{rerender:false});
      this.updateFxnSettings({enabled});
    });
    container.querySelector('#fxnSettingsBtn')?.addEventListener('click',()=>{if(!window.SubscriptionSystem?.canAccessFeature("technicalIndicators")){window.SubscriptionSystem?.requestUpgrade("technicalIndicators");return;}this.fxnSettingsOpen=!this.fxnSettingsOpen;this.rerender();});
    container.querySelectorAll('[data-plan-feature]').forEach(button=>button.addEventListener('click',()=>window.SubscriptionSystem?.requestUpgrade(button.dataset.planFeature)));
    container.querySelector('#fxnSettingsCloseBtn')?.addEventListener('click',()=>{this.fxnSettingsOpen=false;this.rerender();});
    container.querySelector('#fxnResetBtn')?.addEventListener('click',()=>this.updateFxnSettings({...window.FXNAsianSessionRange.defaults,enabled:this.getFxnIndicator().config.enabled}));
    container.querySelectorAll('[data-fxn-setting]').forEach(input=>input.addEventListener('change',()=>{
      const key=input.dataset.fxnSetting;
      if(/(ssth|sstm|esth|estm|elth|eltm)$/.test(key)){this.updateFxnIstTime(key,input.value);return;}
      this.updateFxnSettings({[key]:input.type==='checkbox'?input.checked:input.type==='number'?Number(input.value):input.value});
    }));
    container.querySelector('#volumeToggleBtn')?.addEventListener('click',()=>{
      if(!window.SubscriptionSystem?.canAccessFeature("technicalIndicators")){window.SubscriptionSystem?.requestUpgrade("technicalIndicators");return;}
      this.volumeVisible=!this.isVolumeVisible();
      try{this.chartStorage().setItem('tfb_volume_visible_v1',String(this.volumeVisible));}catch{}
      this.rerender();
    });
    container.querySelector("#layoutBtn")?.addEventListener("click", () => container.querySelector(".tv-panel-collapse-btn")?.click());
    container.querySelector("#phase2TestLineBtn")?.addEventListener("click", () => this.selectTool("testLine"));
    const searchInput = container.querySelector('#drawingToolSearchInput');
    const options = container.querySelector('#drawingToolOptions');
    if (options) options.innerHTML = (this.drawingEngine?.toolRegistry.getTools() || []).map(tool => `<option value="${this.escapeHtml(tool.name)}"></option>`).join('');
    const activateSearchTool = event => {
      if (!this.drawingEngine) this.initializeDrawingEngine();
      const tools = this.drawingEngine.toolRegistry.getTools();
      const tool = tools.find(item => item.name.toLowerCase() === event.target.value.trim().toLowerCase());
      if (!tool) return;
      this.TOOL_META[tool.id] = { name: tool.name, group: tool.category || 'draw' };
      this.selectTool(tool.id);
      event.target.value = '';
    };
    searchInput?.addEventListener('change', activateSearchTool);
    searchInput?.addEventListener('keydown', event => { if(event.key === 'Enter') { event.preventDefault(); activateSearchTool(event); } });
    container.querySelectorAll('[data-anchor-time],[data-anchor-price]').forEach(input => input.addEventListener('change',()=>{
      const id = this.selectedDrawingIds[0]; if(!id) return;
      const index=Number(input.dataset.anchorTime ?? input.dataset.anchorPrice);
      const timeInput=container.querySelector(`[data-anchor-time="${index}"]`);
      const priceInput=container.querySelector(`[data-anchor-price="${index}"]`);
      const timestamp=Date.parse(timeInput.value+'Z'), price=Number(priceInput.value);
      if(!Number.isFinite(timestamp)||!Number.isFinite(price)) return;
      this.drawingEngine.manager.moveAnchor(id,index,timestamp,price);
      this.syncLegacyDrawingsFromEngine(); this.saveDrawingStorage(); this.scheduleDrawingDraw();
    }));
    const updateFib = () => {
      const selected = this.selectedDrawingIds[0];
      const input = container.querySelector('#drawingFibLevelsInput');
      if (!selected || !input) return;
      const levels = input.value.split(',').map(v => Number(v.trim())).filter(Number.isFinite);
      if (!levels.length || levels.length > 50) { input.setCustomValidity('Enter 1 to 50 comma-separated numeric levels.'); input.reportValidity(); return; }
      input.setCustomValidity('');
      const drawing = this.drawingEngine.getDrawing(selected);
      this.drawingEngine.manager.updateDrawing(selected, { properties: { ...drawing.properties, levels,
        reverse: !!container.querySelector('#drawingFibReverseInput')?.checked,
        extendRight: !!container.querySelector('#drawingFibExtendInput')?.checked } });
      this.syncLegacyDrawingsFromEngine(); this.saveDrawingStorage(); this.scheduleDrawingDraw();
    };
    ['#drawingFibLevelsInput','#drawingFibReverseInput','#drawingFibExtendInput'].forEach(selector => container.querySelector(selector)?.addEventListener('change', updateFib));
    container.querySelector("#placeOrderBtn")?.addEventListener("click", () => {
      container.querySelector(".tv-order-card")?.scrollIntoView?.({ behavior: "smooth", block: "center" });
      container.querySelector(".tv-order-card button, .tv-order-card input")?.focus?.();
    });
    container.querySelector("#propFirmChartBadge")?.addEventListener("click", () => Router.go("prop-firm-session"));
    window.PropFirmSession?.syncChartBadge?.();
    container.querySelector("#goToBtn")?.addEventListener("click", () => {
      if (this.sessionPanelHidden) this.setSessionPanelHidden(false);
      requestAnimationFrame(() => container.querySelector(".tv-session-panel")?.scrollIntoView?.({ behavior: "smooth", block: "center" }));
    });
    container.querySelector("#toolbarUndoBtn")?.addEventListener("click", () => this.undoDrawingAction());
    container.querySelector("#toolbarRedoBtn")?.addEventListener("click", () => this.redoDrawingAction());
    container.querySelector("#saveChartBtn")?.addEventListener("click", async () => {
      this.saveDrawingStorage();
      this.persistReplayState({ immediate: true });
      await API.updateSettings({ symbol: this.symbol, timeframe: this.timeframe, chart_visible_count: this.visibleCount, chart_view_end: this.viewEnd, chart_y_zoom: this.yZoom, chart_y_offset: this.yOffset, chart_auto_follow: this.autoFollow });
      toast("Chart workspace saved.", "success");
    });
    container.querySelector("#chartSettingsBtn")?.addEventListener("click", () => UI?.openModal?.("settingsModal"));
    container.querySelectorAll("[data-watch-symbol]").forEach((btn) => btn.addEventListener("click", () => this.switchSymbol(btn.dataset.watchSymbol)));
    container.querySelector("#screenshotBtn")?.addEventListener("click", () => UI?.takeChartScreenshot());
    container.querySelector("#fullscreenBtn")?.addEventListener("click", () => UI?.toggleFullscreenChart());
    container.querySelector('#fsExitFullscreen')?.addEventListener('click',()=>UI?.toggleFullscreenChart());
    container.querySelector("#replayJumpBtn")?.addEventListener("click", () => this.togglePlay());
    container.querySelectorAll("[data-zoom-x]").forEach((btn) => btn.addEventListener("click", () => this.zoomX(btn.dataset.zoomX)));
    container.querySelectorAll("[data-zoom-y]").forEach((btn) => btn.addEventListener("click", () => this.zoomY(btn.dataset.zoomY)));
    container.querySelector("#fitAllBtn")?.addEventListener("click", () => this.fitAllCandles());
    container.querySelector("#resetViewBtn")?.addEventListener("click", () => this.resetChartView());
    container.querySelector("#goLatestBtn")?.addEventListener("click", () => this.goToLatest());
    container.querySelector("#scissorsToolBtn")?.addEventListener("click", () => this.toggleScissorsTool());
    container.querySelector("#liveChartBtn")?.addEventListener("click", () => this.exitReplayToLive());
    container.querySelector("#chartReplayBtn")?.addEventListener("click", () => this.togglePlay());
    container.querySelector("#chartReplayResetBtn")?.addEventListener("click", () => this.resetReplay());
    container.querySelector("#fsBtnPlay")?.addEventListener("click", () => this.togglePlay());
    container.querySelector("#fsBtnPrev")?.addEventListener("click", () => this.step(-1));
    container.querySelector("#fsBtnNext")?.addEventListener("click", () => this.step(1));
    container.querySelector("#fsBtnBack10")?.addEventListener("click", () => this.step(-10));
    container.querySelector("#fsBtnF10")?.addEventListener("click", () => this.step(10));
    container.querySelector("#fsReplayReset")?.addEventListener("click", () => this.resetReplay());
    container.querySelector("#fsReplayLive")?.addEventListener("click", () => this.exitReplayToLive());
    container.querySelector("#fsCloseAllPositions")?.addEventListener("click", () => this.closeAllPositions());
    container.querySelector("#fsReplaySpeed")?.addEventListener("change", (e) => this.setReplaySpeed(parseFloat(e.target.value)));
    container.querySelectorAll("[data-range-preset]").forEach((btn) => btn.addEventListener("click", () => {
      const counts = { "1D": 90, "5D": 180, "1M": 240, "3M": 360, "6M": 520, YTD: 700, "1Y": 900, "3Y": 1500, All: 2200 };
      this.visibleCount = counts[btn.dataset.rangePreset] || 120;
      this.viewEnd = this.clampViewEnd(this.viewEnd ?? this.idx);
      this.syncMouseEngineCamera();
      this.rerender();
    }));
    container.querySelectorAll("[data-bottomtab]").forEach((btn) => btn.addEventListener("click", () => { this.bottomTab = btn.dataset.bottomtab; this.rerender(); }));
    container.querySelectorAll("[data-ordertab]").forEach((btn) => btn.addEventListener("click", () => { this.orderTab = btn.dataset.ordertab; this.rerender(); }));
    container.querySelector("#pendingPriceInput")?.addEventListener("input", (e) => { this.pendingPrice = Number(e.target.value) || null; this.syncOrderPrices(); });
    container.querySelector("#btnPrev")?.addEventListener("click", () => this.step(-1));
    container.querySelector("#btnNext")?.addEventListener("click", () => this.step(1));
    container.querySelector("#btnBack10")?.addEventListener("click", () => this.step(-10));
    container.querySelector("#btnF10")?.addEventListener("click", () => this.step(10));
    container.querySelector("#btnReplayStart")?.addEventListener("click", () => this.goToReplayStart());
    container.querySelector("#btnEnd")?.addEventListener("click", () => this.goToReplayEnd());
    container.querySelector("#btnReplayLive")?.addEventListener("click", () => this.exitReplayToLive());
    container.querySelector("#btnBookmarkAdd")?.addEventListener("click", () => this.addReplayBookmark());
    container.querySelector("#btnBookmarkPrev")?.addEventListener("click", () => this.jumpReplayBookmark(-1));
    container.querySelector("#btnBookmarkNext")?.addEventListener("click", () => this.jumpReplayBookmark(1));
    container.querySelector("#btnBookmarkClear")?.addEventListener("click", () => this.clearReplayBookmarks());
    container.querySelector("#btnPlay")?.addEventListener("click", () => this.togglePlay());
    container.querySelector("#speedSlider")?.addEventListener("input", (e) => this.setReplaySpeed(parseInt(e.target.value, 10) / 10, { keepDom: true }));
    container.querySelectorAll("[data-replay-speed]").forEach((btn) => btn.addEventListener("click", () => this.setReplaySpeed(parseFloat(btn.dataset.replaySpeed))));
    container.querySelector("#btnReplayDate")?.addEventListener("click", () => this.jumpReplayToDate(container.querySelector("#replayDateInput")?.value));
    container.querySelector("#replayProgress")?.addEventListener("input", (e) => this.seekReplayToIndex(parseInt(e.target.value, 10)));
    container.querySelector("#sessionDateInput")?.addEventListener("change", (e) => { this.sessionNavigator.date = e.target.value; });
    container.querySelector("#sessionSelectInput")?.addEventListener("change", (e) => {
      this.setSelectedSessionType(e.target.value, { rerender: true });
    });
    container.querySelector("#sessionPanelHideBtn")?.addEventListener("click", () => this.setSessionPanelHidden(true));
    container.querySelector("#sessionPanelRestoreBtn")?.addEventListener("click", () => this.setSessionPanelHidden(false));
    container.querySelector("#btnGoSession")?.addEventListener("click", () => this.jumpToSelectedSession());
    container.querySelector("#btnNextSession")?.addEventListener("click", () => this.jumpRelativeSession(1));
    container.querySelector("#btnPrevSession")?.addEventListener("click", () => this.jumpRelativeSession(-1));
    container.querySelectorAll("[data-fullscreen-session-nav]").forEach((button) => button.addEventListener("click", () => {
      const action = button.dataset.fullscreenSessionNav;
      if (action === "previous") this.jumpRelativeSession(-1);
      else if (action === "next") this.jumpRelativeSession(1);
      else this.jumpToSelectedSession();
    }));
    container.querySelectorAll("[data-session-quick]").forEach((btn) => btn.addEventListener("click", () => this.jumpQuickSession(btn.dataset.sessionQuick)));
    const lotsInput = container.querySelector("#lotsInput");
    const refreshRisk = () => {
      const summary = container.querySelector('#orderRiskSummary');
      if (summary) summary.outerHTML = this.renderRiskSummary(this.candles[this.idx], MarketData.getMeta(this.symbol));
    };
    lotsInput?.addEventListener("change", (e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v) && v > 0) this.lots = v; refreshRisk(); });
    container.querySelectorAll("[data-lot-step]").forEach((btn) => btn.addEventListener("click", () => { this.lots = Math.max(0.01, Math.round((this.lots + parseFloat(btn.dataset.lotStep) * 0.01) * 100) / 100); if (lotsInput) lotsInput.value = this.lots.toFixed(2); }));
    container.querySelector("#tpCheck")?.addEventListener("change", (e) => { this.tpEnabled = e.target.checked; this.rerender(); });
    container.querySelector("#slCheck")?.addEventListener("change", (e) => { this.slEnabled = e.target.checked; this.rerender(); });
    container.querySelector("#tpInput")?.addEventListener("input", (e) => { this.tpPips = Math.max(0, parseFloat(e.target.value) || 0); refreshRisk(); });
    container.querySelector("#slInput")?.addEventListener("input", (e) => { this.slPips = Math.max(0, parseFloat(e.target.value) || 0); refreshRisk(); });
    container.querySelectorAll('[data-lot-step]').forEach(button => button.addEventListener('click', refreshRisk));
    container.querySelector("#btnBuy")?.addEventListener("click", () => this.previewOrder("BUY"));
    container.querySelector("#btnSell")?.addEventListener("click", () => this.previewOrder("SELL"));
    container.querySelector('#confirmOrderDraft')?.addEventListener('click', () => this.confirmOrderDraft());
    container.querySelector('#cancelOrderDraft')?.addEventListener('click', () => { this.orderDraft = null; this.rerender(); });
    container.querySelectorAll('[data-draft-price]').forEach(input => input.addEventListener('input', () => {
      if (!this.orderDraft) return;
      this.orderDraft[input.dataset.draftPrice] = input.value === '' ? null : Number(input.value);
      this.orderDraft.error = '';
      const risk = this.orderDraft.sl == null ? null : Math.abs(this.orderDraft.entry - this.orderDraft.sl);
      const reward = this.orderDraft.tp == null ? null : Math.abs(this.orderDraft.tp - this.orderDraft.entry);
      const ratio = container.querySelector('#draftRiskReward');
      if (ratio) ratio.textContent = risk > 0 && reward != null ? `1 : ${(reward / risk).toFixed(2)}` : '—';
      this.scheduleDraw();
    }));
    container.querySelector("#useRiskPlanBtn")?.addEventListener("click", () => this.applyRiskPlanToOrder());
    container.querySelector('#createPlanTradeBtn')?.addEventListener('click', async () => {
      const plan = this.selectedRiskPlan(); if(!plan) return;
      this.applyRiskPlanToOrder();
      await this.placeTrade(plan.direction === 'long' ? 'BUY' : 'SELL');
    });
    container.querySelector("#btnCloseActive")?.addEventListener("click", () => this.closeActive());
    container.querySelector("#btnCloseAllPositions")?.addEventListener("click", () => this.closeAllPositions());
    container.querySelectorAll("[data-tool]").forEach((btn) => btn.addEventListener("click", () => this.selectTool(btn.dataset.tool)));
    container.querySelectorAll("[data-tool-group]").forEach((btn) => btn.addEventListener("click", (event) => {
      event.stopPropagation();
      this.openDrawingToolGroup = this.openDrawingToolGroup === btn.dataset.toolGroup ? null : btn.dataset.toolGroup;
      this.rerender();
    }));
    if (this._railOutsideHandler) document.removeEventListener("click", this._railOutsideHandler);
    this._railOutsideHandler = (event) => {
      if (!this.openDrawingToolGroup) return;
      if (event.target.closest?.(".tv-left-rail")) return;
      this.openDrawingToolGroup = null;
      this.rerender();
    };
    document.addEventListener("click", this._railOutsideHandler);
    this.bindDrawingManager(container);
    this.bindCursorModeMenu(container);
  },

  bindDrawingManager(container) {
    container.querySelector("#drawingObjectSearch")?.addEventListener("input", (e) => {
      this.drawingObjectSearch = e.target.value || "";
      this.drawingWorkspaceUX?.setObjectTreePatch?.({ search: this.drawingObjectSearch });
      this.rerender();
    });
    container.querySelector("#drawingObjectFilter")?.addEventListener("change", (e) => {
      this.drawingObjectFilter = e.target.value || "all";
      this.drawingWorkspaceUX?.setObjectTreePatch?.({ filter: this.drawingObjectFilter });
      this.rerender();
    });
    container.querySelectorAll("[data-drawing-id]").forEach((btn) => {
      btn.addEventListener("click", (event) => this.selectDrawing(this.drawings.find((d) => d.id === btn.dataset.drawingId), event.ctrlKey || event.metaKey || event.shiftKey));
      btn.addEventListener("dragstart", (event) => event.dataTransfer?.setData?.("text/plain", btn.dataset.drawingId));
    });
    container.querySelectorAll("[data-group-id]").forEach((el) => {
      el.addEventListener("dragover", (event) => event.preventDefault());
      el.addEventListener("drop", (event) => {
        event.preventDefault();
        const drawingId = event.dataTransfer?.getData?.("text/plain");
        if (drawingId && el.dataset.groupId) {
          this.drawingWorkspaceUX?.assignToGroup?.([drawingId], el.dataset.groupId);
          this.updateDrawingObjects([drawingId], (d) => ({ ...d, metadata: { ...(d.metadata || {}), groupId: el.dataset.groupId } }));
          this.rerender();
        }
      });
    });
    container.querySelectorAll("[data-group-action]").forEach((btn) => btn.addEventListener("click", () => this.groupAction(btn.dataset.groupId, btn.dataset.groupAction)));
    container.querySelector("#drawingColorInput")?.addEventListener("input", (e) => this.applyDrawingStylePatch({ color: e.target.value }));
    container.querySelector("#drawingWidthInput")?.addEventListener("input", (e) => this.applyDrawingStylePatch({ width: parseFloat(e.target.value) || 1.5 }));
    container.querySelector("#drawingOpacityInput")?.addEventListener("input", (e) => {
      const opacity = Math.max(0.05, Math.min(1, parseFloat(e.target.value) || 0.05));
      const value = container.querySelector("#drawingOpacityValue");
      if (value) value.value = `${Math.round(opacity * 100)}%`;
      this.applyDrawingStylePatch({ opacity });
    });
    container.querySelector("#chartDrawingOpacityInput")?.addEventListener("input", (e) => {
      const opacity = Math.max(0.05, Math.min(1, (Number(e.target.value) || 5) / 100));
      const value = container.querySelector("#chartDrawingOpacityValue");
      if (value) value.value = `${Math.round(opacity * 100)}%`;
      this.applyDrawingStylePatch({ opacity });
    });
    container.querySelector("#drawingLineStyleInput")?.addEventListener("change", (e) => this.applyDrawingStylePatch({ lineStyle: e.target.value }));
    container.querySelector("#drawingFillColorInput")?.addEventListener("input", (e) => this.applyDrawingStylePatch({ fillColor: e.target.value }));
    container.querySelector("#drawingFillOpacityInput")?.addEventListener("input", (e) => this.applyDrawingStylePatch({ fillOpacity: parseFloat(e.target.value) || 0 }));
    container.querySelector("#drawingExtendLeftInput")?.addEventListener("change", (e) => this.applyDrawingPropertyPatch({ properties: { extendLeft: e.target.checked } }));
    container.querySelector("#drawingExtendRightInput")?.addEventListener("change", (e) => this.applyDrawingPropertyPatch({ properties: { extendRight: e.target.checked } }));
    container.querySelector("#drawingTextColorInput")?.addEventListener("input", (e) => this.applyDrawingStylePatch({ textColor: e.target.value }));
    container.querySelector("#drawingFontSizeInput")?.addEventListener("input", (e) => this.applyDrawingStylePatch({ fontSize: parseFloat(e.target.value) || 13 }));
    container.querySelector("#drawingFontWeightInput")?.addEventListener("change", (e) => this.applyDrawingStylePatch({ fontWeight: e.target.value }));
    container.querySelector("#drawingTextInput")?.addEventListener("change", (e) => {
      this.applyDrawingPropertyPatch({ metadata: { text: e.target.value || "Text" } });
    });
    container.querySelector("#drawingTemplateSelect")?.addEventListener("change", (e) => this.applyTemplate(e.target.value));
    container.querySelector("#drawingHideBtn")?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.toggleSelectedDrawingVisibility();
    });
    container.querySelector("#deleteAllDrawingsBtn")?.addEventListener("click", () => this.confirmDeleteAllDrawings());
    container.querySelectorAll("[data-drawing-action]").forEach((btn) => btn.addEventListener("click", () => {
      const action = btn.dataset.drawingAction;
      if (action === "rename") this.renameSelectedDrawing();
      if (action === "group") this.groupSelectedDrawings();
      if (action === "front") this.bringSelectedDrawingToFront();
      if (action === "back") this.sendSelectedDrawingToBack();
      if (action === "lock") {
        const selected = this.drawings.find((d) => this.selectedDrawingIds.includes(d.id));
        this.applyDrawingPropertyPatch({ locked: !selected?.locked });
      }
      if (action === "visibility") {
        this.toggleSelectedDrawingVisibility();
      }
      if (action === "save-template" || action === "template") this.saveSelectedAsTemplate();
      if (action === "default-template") this.setSelectedDefaultTemplate();
      if (action === "delete") this.deleteSelectedDrawings();
      this.rerender();
    }));
    this.bindProfessionalDrawingToolbar(container);
  },

  bindProfessionalDrawingToolbar(container) {
    container.querySelector("#drawingToolSearch")?.addEventListener("input", (e) => {
      const state = this.drawingWorkspaceUX?.getState?.();
      if (state) {
        state.toolSearch = e.target.value || "";
        this.drawingWorkspaceUX.save();
      }
      this.rerender();
    });
    container.querySelector("#drawingToolbarModeBtn")?.addEventListener("click", () => {
      const mode = this.drawingWorkspaceUX?.getState?.().toolbarMode === "expanded" ? "compact" : "expanded";
      this.drawingWorkspaceUX?.setToolbarMode?.(mode);
      this.rerender();
    });
    container.querySelectorAll("[data-drawing-favorite]").forEach((fav) => {
      fav.addEventListener("click", (event) => {
        event.stopPropagation();
        this.drawingWorkspaceUX?.toggleFavorite?.(fav.dataset.drawingFavorite);
        this.rerender();
      });
    });
  },

  selectTool(tool) {
    if (tool === 'stayDrawing') {
      this.stayInDrawingMode = !this.stayInDrawingMode;
      try { this.chartStorage().setItem('tfb_stay_drawing_v1',String(this.stayInDrawingMode)); } catch { /* optional persistence */ }
      if (this.drawingEngine?.state) this.drawingEngine.state.toolMode = this.stayInDrawingMode ? 'PERSISTENT' : 'SINGLE_USE';
      this.updateToolChrome();
      return;
    }
    if (!this.TOOL_META[tool] && !["undo", "redo"].includes(tool)) return;
    this.openDrawingToolGroup = null;
    if (tool === "trash") {
      this.confirmDeleteAllDrawings();
      return;
    }
    if (tool === "undo") {
      this.undoDrawingAction();
      return;
    }
    if (tool === "redo") {
      this.redoDrawingAction();
      return;
    }
    if (tool === "lock") {
      const selected = this.drawings.find((d) => this.selectedDrawingIds.includes(d.id));
      this.applyDrawingPropertyPatch({ locked: !selected?.locked });
      toast("Drawing lock toggled.", "info");
      return;
    }
    if (tool === "eye") {
      const selected = this.drawings.find((d) => this.selectedDrawingIds.includes(d.id));
      this.applyDrawingPropertyPatch({ visible: selected?.visible === false });
      toast("Drawing visibility toggled.", "info");
      return;
    }
    if (tool === "magnet") {
      this.magnetMode = !this.magnetMode;
      this.drawingEngine?.setMagnetEnabled?.(this.magnetMode);
      this.drawingWorkspaceUX?.setMagnetEnabled?.(this.magnetMode);
      this.updateToolChrome();
      this.scheduleDraw();
      toast(this.magnetMode ? "Magnet snapping enabled." : "Magnet snapping disabled.", "info");
      return;
    }
    // Tool selection is separate from object selection. Clear the old
    // handles, but keep the drawing so it can be selected and edited later.
    this.selectDrawing(null);
    const engineTool = this.engineToolForUiTool(tool);
    if (engineTool && this.drawingEngine?.activateTool) {
      // Keep the selected drawing tool active like TradingView. The engine
      // still supports single-use tools for its standalone consumers/tests;
      // the chart workspace opts into the persistent interaction mode.
      this.drawingEngine.activateTool(engineTool, {
        toolMode: this.stayInDrawingMode ? 'PERSISTENT' : 'SINGLE_USE',
      });
    } else if (this.drawingEngine?.toolController) {
      this.drawingEngine.toolController.clearActiveTool();
    }
    if (engineTool && this.drawingOpacityOverride != null) {
      const activeTool = this.drawingEngine?.toolRegistry?.getTool?.(engineTool);
      if (activeTool) activeTool.defaultStyle = { ...(activeTool.defaultStyle || {}), opacity: this.drawingOpacityOverride };
    }
    this.tool = tool;
    this.drawingWorkspaceUX?.setActiveTool?.(tool);
    this.pendingDrawing = null;
    if (tool === "crosshair") this.cursorMode = "crosshair";
    if (this.drawingToolType(tool)) this.cursorMode = "arrow";
    UI?.trackToolUse?.(tool);
    this.rerender();
  },

  bindCursorModeMenu(container) {
    const btn = container.querySelector("#cursorModeBtn");
    const menu = container.querySelector("#cursorModeMenu");
    if (!btn || !menu) return;
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      this.tool = "crosshair";
      menu.classList.toggle("open");
      btn.classList.toggle("open", menu.classList.contains("open"));
      UI?.trackToolUse?.("crosshair");
      if (menu.classList.contains("open")) {
        setTimeout(() => {
          document.addEventListener("click", () => menu.classList.remove("open"), { once: true });
        }, 0);
      }
    });
    menu.querySelectorAll("[data-cursor-mode]").forEach((option) => {
      option.addEventListener("click", (event) => {
        event.stopPropagation();
        this.setCursorMode(option.dataset.cursorMode);
      });
    });
    menu.querySelector("#valuesTooltipToggle")?.addEventListener("click", (event) => {
      event.stopPropagation();
      this.valuesTooltipOnLongPress = !this.valuesTooltipOnLongPress;
      this.rerender();
      toast(this.valuesTooltipOnLongPress ? "Values tooltip enabled." : "Values tooltip disabled.", "info");
    });
  },

  setCursorMode(mode) {
    if (!this.CURSOR_MODES[mode]) return;
    this.cursorMode = mode;
    this.tool = "crosshair";
    if (mode === "eraser") this.tool = "eraser";
    this.crosshair = null;
    this.rerender();
    toast(`${this.CURSOR_MODES[mode].name} cursor selected.`, "info");
  },

  chartCursor() {
    if (this.tool === "scissors") return "cell";
    const activeEngineTool = this.drawingEngine?.toolRegistry?.getActiveTool?.();
    if (activeEngineTool && activeEngineTool.id !== window.IntenseDrawing?.DrawingTypes?.SELECT) return activeEngineTool.cursor || "crosshair";
    if (this.drawingToolType()) return "crosshair";
    if (this.drawingDrag) return "move";
    if (this.hoveredDrawingId) return "pointer";
    if (this.cursorMode === "arrow") return "default";
    if (this.cursorMode === "demo") return "none";
    if (this.cursorMode === "eraser") return "not-allowed";
    return "crosshair";
  },

  bindChartInteractions(container) {
    const canvas = container.querySelector("#tvCanvas");
    const surface = container.querySelector("#chartCard") || canvas;
    const tip = container.querySelector("#crosshairTip");
    if (!canvas) return;
    let pointer = null;
    let drawingDragBefore = null;
    this._spacePan = false;
    this._spacePanUsed = false;
    const engine = this.mouseEngine = {
      raf: null,
      targetCount: this.visibleCount,
      targetEnd: this.viewEnd ?? this.idx,
      anchorAbs: null,
      anchorFraction: 0.5,
    };
    const stopMotion = () => {
      if (this.inertia?.raf) cancelAnimationFrame(this.inertia.raf);
      this.inertia = null;
      if (engine.raf) cancelAnimationFrame(engine.raf);
      engine.raf = null;
      engine.targetCount = this.visibleCount;
      engine.targetEnd = this.viewEnd ?? this.idx;
      this.stopZoomAnimation();
    };
    const normalizeWheel = (event) => {
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? Math.max(300, canvas.clientHeight) : 1;
      const dx = Math.max(-240, Math.min(240, event.deltaX * unit));
      const dy = Math.max(-240, Math.min(240, event.deltaY * unit));
      return { dx, dy };
    };
    const axisAt = (event, rect = canvas.getBoundingClientRect()) => {
      const { chartWidth, bottomAxis } = this.chartMetrics(rect);
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      if (x > chartWidth) return "price";
      if (y > rect.height - bottomAxis) return "time";
      return "chart";
    };
    const panPixels = (pixelDelta, rect = canvas.getBoundingClientRect()) => {
      const { candleW } = this.chartMetrics(rect);
      const current = this.viewEnd ?? this.idx;
      const next = this.clampViewEnd(current + pixelDelta / Math.max(2, candleW));
      if (Math.abs(next - current) < 0.001) return false;
      this.viewEnd = next;
      engine.targetEnd = next;
      engine.targetCount = this.visibleCount;
      this.autoFollow = false;
      this.ensureOlderCandles();
      this.scheduleDraw();
      return true;
    };
    const panPricePixels = (pixelDeltaY, rect = canvas.getBoundingClientRect()) => {
      if (!Number.isFinite(pixelDeltaY) || Math.abs(pixelDeltaY) < 0.01) return false;
      const win = this.chartWindow();
      const { topPad, priceHeight } = this.chartMetrics(rect);
      const pricePerPixel = (win.hi - win.lo || 1) / Math.max(1, priceHeight - topPad);
      this.yOffset = (this.yOffset || 0) + pixelDeltaY * pricePerPixel;
      this.scheduleDraw();
      return true;
    };
    const startPanInertia = (velocityPxPerMs) => {
      if (!Number.isFinite(velocityPxPerMs) || Math.abs(velocityPxPerMs) < 0.08) return;
      if (this.inertia?.raf) cancelAnimationFrame(this.inertia.raf);
      const state = this.inertia = {
        velocity: Math.max(-2.2, Math.min(2.2, velocityPxPerMs)),
        last: performance.now(),
        raf: null,
      };
      const tick = (now) => {
        if (this.inertia !== state) return;
        const dt = Math.min(32, Math.max(8, now - state.last));
        state.last = now;
        const moved = panPixels(state.velocity * dt);
        state.velocity *= Math.pow(0.91, dt / 16.67);
        if (!moved || Math.abs(state.velocity) < 0.035) {
          this.inertia = null;
          this.syncMouseEngineCamera();
          return;
        }
        state.raf = requestAnimationFrame(tick);
      };
      state.raf = requestAnimationFrame(tick);
    };
    const zoomPriceByPixels = (dy) => {
      if (engine.raf) cancelAnimationFrame(engine.raf);
      engine.raf = null;
      engine.targetCount = this.visibleCount;
      engine.targetEnd = this.viewEnd ?? this.idx;
      this.yZoom = Math.max(this.minYZoom, Math.min(this.maxYZoom, this.yZoom * Math.exp(dy / 180)));
      this.scheduleDraw();
    };
    const anchorFromEvent = (event, rect = canvas.getBoundingClientRect()) => {
      const { chartWidth, totalSlots } = this.chartMetrics(rect);
      const win = this.chartWindow();
      const x = Math.max(0, Math.min(chartWidth, event.clientX - rect.left));
      const anchorAbs = win.logicalStart + (x / Math.max(1, chartWidth)) * totalSlots - 0.5;
      const currentEnd = this.viewEnd ?? this.idx;
      const currentStart = currentEnd - this.visibleCount + 1;
      const anchorFraction = Math.max(0, Math.min(1, (anchorAbs - currentStart) / Math.max(1, this.visibleCount)));
      return { anchorAbs, anchorFraction };
    };
    const startWheelLoop = () => {
      if (engine.raf) return;
      const tick = () => {
        engine.raf = null;
        const countDiff = engine.targetCount - this.visibleCount;
        const endDiff = engine.targetEnd - (this.viewEnd ?? this.idx);
        if (Math.abs(countDiff) < 0.35 && Math.abs(endDiff) < 0.02) {
          this.visibleCount = engine.targetCount;
          this.viewEnd = this.clampViewEnd(engine.targetEnd);
          this.scheduleDraw();
          return;
        }
        this.visibleCount = Math.max(this.minVisibleCount, Math.min(this.maxVisibleCount, this.visibleCount + countDiff * 0.34));
        this.viewEnd = this.clampViewEnd((this.viewEnd ?? this.idx) + endDiff * 0.34);
        this.autoFollow = this.viewEnd >= this.getReplayLimit() ? this.autoFollow : false;
        this.scheduleDraw();
        engine.raf = requestAnimationFrame(tick);
      };
      engine.raf = requestAnimationFrame(tick);
    };
    const zoomTargetAround = (directionAmount, anchorAbs, anchorFraction) => {
      if (!Number.isFinite(directionAmount) || !Number.isFinite(anchorAbs)) return;
      const base = Math.max(this.minVisibleCount, Math.min(this.maxVisibleCount, engine.targetCount || this.visibleCount));
      const factor = Math.exp(directionAmount * 0.0018);
      engine.targetCount = Math.max(this.minVisibleCount, Math.min(this.maxVisibleCount, base * factor));
      engine.anchorAbs = anchorAbs;
      engine.anchorFraction = anchorFraction;
      engine.targetEnd = this.clampViewEnd(anchorAbs + (1 - anchorFraction) * engine.targetCount - 1);
      this.ensureOlderCandles();
      startWheelLoop();
    };
    const updateCrosshair = (event) => {
      const rect = canvas.getBoundingClientRect();
      const win = this._chartFrame?.windowState || this.chartWindow();
      const { visible, hi, lo } = win;
      const { chartWidth, topPad, bottomAxis, priceHeight, totalSlots } = this.chartMetrics(rect);
      const x = Math.max(0, Math.min(chartWidth, event.clientX - rect.left));
      const y = Math.max(topPad, Math.min(rect.height - bottomAxis, event.clientY - rect.top));
      const coords = this.chartCoordinates();
      const context = { metrics: this.chartMetrics(rect), windowState: win };
      const absIndex = Math.max(0, Math.min(this.getReplayLimit(), Math.round(coords.xToIndex(x, context))));
      const localIndex = Math.max(0, Math.min(visible.length - 1, absIndex - win.start));
      const price = coords.yToPrice(y, context);
      const rawIndex = Math.round(coords.xToIndex(x, context));
      const lastIndex = this.getReplayLimit();
      const emptyTime = rawIndex > lastIndex;
      const timestamp = emptyTime ? this.candles[lastIndex]?.date.getTime() + (rawIndex - lastIndex) * (MarketData.TF_MINUTES[this.timeframe] || 1) * 60000 : this.candles[absIndex]?.date.getTime();
      this.crosshair = { x, y, localIndex, index: absIndex, price, emptyTime, timestamp };
      this.drawingEngine?.setCoordinateAdapter?.(this.drawingCoordinateAdapter());
      this.scheduleInteractionDraw();
      const hoverCandle = this.candles[this.crosshair.index];
      UI?.updateStatusBar({
        statusMousePrice: Fmt.price(price, MarketData.getMeta(this.symbol).decimals),
        statusMouseTime: hoverCandle ? Fmt.dateTime(hoverCandle.date) : "--",
  });
      return this.crosshair;
    };

    canvas.addEventListener("pointermove", (event) => {
      const rect = canvas.getBoundingClientRect();
      const zone = pointer?.mode || axisAt(event, rect);
      canvas.style.cursor = zone === "price" ? "ns-resize" : zone === "time" ? "ew-resize" : pointer?.mode === "pan" ? "grabbing" : this._spacePan ? "grab" : this.chartCursor();
      if (!pointer) {
        const point = updateCrosshair(event);
        const orderHit = this.orderDraftHit(point);
        if (orderHit) canvas.style.cursor = orderHit.kind === "action" ? "pointer" : orderHit.key === "entry" ? "move" : "ns-resize";
        if(this.tradeLevelHit(point)) canvas.style.cursor='ns-resize';
        if (this.drawingToolType() && this.engineToolForUiTool(this.tool) && this.drawingEngine?.handlePointerMove?.(event)) return;
        const hover = !this.drawingToolType() || this.tool === "eraser" ? this.hitTestDrawing(point) : null;
        const hoverChanged = this.hoveredDrawingId !== (hover?.id || null);
        this.hoveredDrawingId = hover?.id || null;
        this.drawingEngine?.hoverDrawing?.(this.hoveredDrawingId);
        if (hoverChanged) this.scheduleDrawingDraw();
        return;
      }
      const dx = event.clientX - pointer.x;
      const dy = event.clientY - pointer.y;
      const now = performance.now();
      pointer.moved = pointer.moved || Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY) > 3;
      if (pointer.mode === "order-draft") {
        const point = updateCrosshair(event);
        const draft = this.orderDraft;
        if (draft && !draft.saving) {
          const pip = Number(MarketData.getMeta(this.symbol).pip) || 0.01;
          const direction = draft.type === "BUY" ? 1 : -1;
          const minGap = Math.max(pip, Math.abs(Number(draft.entry)) * 1e-7);
          const draggedPrice = Number(point.price);
          if (Number.isFinite(draggedPrice)) {
            if (pointer.key === "entry") {
              const delta = draggedPrice - Number(draft.entry);
              draft.entry = Number((Number(draft.entry) + delta).toFixed(MarketData.getMeta(this.symbol).decimals));
              if (draft.sl != null) draft.sl = Number((Number(draft.sl) + delta).toFixed(MarketData.getMeta(this.symbol).decimals));
              if (draft.tp != null) draft.tp = Number((Number(draft.tp) + delta).toFixed(MarketData.getMeta(this.symbol).decimals));
              if (this.orderTab !== "Market") {
                this.pendingPrice = draft.entry;
                const pendingInput = this.container?.querySelector("#pendingPriceInput");
                if (pendingInput) pendingInput.value = String(draft.entry);
              }
            } else if (pointer.key === "sl") {
              draft.sl = Number((direction > 0 ? Math.min(draggedPrice, draft.entry - minGap) : Math.max(draggedPrice, draft.entry + minGap)).toFixed(MarketData.getMeta(this.symbol).decimals));
            } else if (pointer.key === "tp") {
              draft.tp = Number((direction > 0 ? Math.max(draggedPrice, draft.entry + minGap) : Math.min(draggedPrice, draft.entry - minGap)).toFixed(MarketData.getMeta(this.symbol).decimals));
            }
            draft.error = "";
            this.slPips = Math.max(1, Math.round(Math.abs(draft.entry - draft.sl) / pip));
            this.tpPips = Math.max(1, Math.round(Math.abs(draft.tp - draft.entry) / pip));
            const slInput = this.container?.querySelector('[data-draft-price="sl"]');
            const tpInput = this.container?.querySelector('[data-draft-price="tp"]');
            if (slInput) slInput.value = String(draft.sl);
            if (tpInput) tpInput.value = String(draft.tp);
            const risk = Math.abs(draft.entry - draft.sl), reward = Math.abs(draft.tp - draft.entry);
            const ratio = this.container?.querySelector("#draftRiskReward");
            if (ratio) ratio.textContent = risk > 0 ? `1 : ${(reward / risk).toFixed(2)}` : "—";
            this.scheduleDraw();
          }
        }
        return;
      }
      if(pointer.mode === 'trade-protection') {
        const point=updateCrosshair(event);
        if(this.tradeProtectionDraft && !this.tradeProtectionDraft.saving){
          this.tradeProtectionDraft[pointer.key]=Number(point.price.toFixed(MarketData.getMeta(this.symbol).decimals));
          this.tradeProtectionDraft.error=null;
          this.scheduleDraw();
        }
        return;
      }
      if (pointer.mode === "tool") {
        updateCrosshair(event);
        this.drawingEngine?.handlePointerMove?.(event);
        this.scheduleDrawingDraw();
        return;
      }
      if (pointer.mode === "drawing") {
        updateCrosshair(event);
        const logical = this.drawingEngine?.screenToLogical?.(event.clientX, event.clientY);
        if (logical && this.drawingEngine?.updateSelectionDrag?.(logical)) {
          this.syncLegacyDrawingsFromEngine();
        }
        this.scheduleDrawingDraw();
        return;
      }
      if (pointer.mode === "box-select") {
        updateCrosshair(event);
        this.drawingEngine?.selectionManager?.updateBoxSelection?.({ x: event.clientX, y: event.clientY });
        this.scheduleDraw();
        return;
      }
      if (pointer.mode === "brush") {
        updateCrosshair(event);
        const point = this.snapDrawingPoint(this.crosshair);
        const anchors = this.pendingDrawing?.anchors || [];
        const last = anchors[anchors.length - 1];
        if (!last || Math.abs(point.index - last.index) >= 0.35 || Math.abs(point.price - last.price) > Math.max(1e-9, Math.abs(point.price) * 0.00008)) {
          this.pendingDrawing = { type: "polyline", anchors: [...anchors, point] };
          this.scheduleDraw();
        }
        pointer.lastX = event.clientX;
        pointer.lastY = event.clientY;
        return;
      }
      if (pointer.mode === "pan") {
        const pixelDelta = pointer.lastX - event.clientX;
        const pixelDeltaY = event.clientY - pointer.lastY;
        const dt = Math.max(1, now - (pointer.lastT || now));
        pointer.velocity = pixelDelta / dt;
        panPixels(pixelDelta, rect);
        panPricePixels(pixelDeltaY, rect);
        pointer.lastX = event.clientX;
        pointer.lastY = event.clientY;
        pointer.lastT = now;
        updateCrosshair(event);
        return;
      }
      if (pointer.mode === "time") {
        panPixels(pointer.lastX - event.clientX, rect);
        pointer.lastX = event.clientX;
        pointer.x = event.clientX;
        updateCrosshair(event);
        return;
      }
      if (pointer.mode === "price") {
        zoomPriceByPixels(dy);
        pointer.y = event.clientY;
        updateCrosshair(event);
      }
    });

    canvas.addEventListener("pointerleave", () => {
      if (!pointer) {
        this.hoveredDrawingId = null;
        this.drawingEngine?.hoverDrawing?.(null);
        this.crosshair = null;
        if (tip) tip.style.display = "none";
        this.scheduleDraw();
      }
    });

    canvas.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 && event.button !== 1) return;
      event.preventDefault();
      canvas.setPointerCapture?.(event.pointerId);
      stopMotion();
      const rect = canvas.getBoundingClientRect();
      const zone = axisAt(event, rect);
      const anchor = anchorFromEvent(event, rect);
      updateCrosshair(event);
      const orderHit = zone === "chart" && event.button === 0 ? this.orderDraftHit(this.crosshair) : null;
      if (orderHit) {
        if (orderHit.key === "discard") { this.orderDraft = null; this.rerender(); return; }
        if (orderHit.key === "confirm") { this.confirmOrderDraft(); return; }
        if (this.orderDraft?.saving) return;
        if (orderHit.key === "entry" && this.orderTab === "Market") return;
        pointer = { id: event.pointerId, mode: "order-draft", key: orderHit.key, startX: event.clientX, startY: event.clientY, moved: false };
        return;
      }
      const tradeHit=zone==='chart' && event.button===0 && !this.drawingToolType() && this.tradeLevelHit(this.crosshair);
      if(tradeHit) {
        if(this.tradeProtectionDraft?.saving)return;
        if(tradeHit.action==='discard'){this.tradeProtectionDraft=null;this.scheduleDraw();return;}
        if(tradeHit.action==='confirm'){this.confirmTradeProtection();return;}
        const trade=Store.state.active_trades.find(t=>t.id===tradeHit.id);
        if(trade){
          if(this.playing)this.stopPlay();
          if(this.tradeProtectionDraft?.id!==trade.id)this.tradeProtectionDraft={id:trade.id,sl:trade.sl ?? null,tp:trade.tp ?? null};
          this.tradeProtectionDraft[tradeHit.key]=this.crosshair.price;
          pointer={id:event.pointerId,mode:'trade-protection',key:tradeHit.key,startX:event.clientX,startY:event.clientY,moved:false};
          this.scheduleDraw();return;
        }
      }
      const lastCreatedBeforePointerDown = this.drawingEngine?.state?.lastCreatedDrawingId;
      if (zone === "chart" && event.button === 0 && !this._spacePan && this.drawingToolType() && this.engineToolForUiTool(this.tool) && this.drawingEngine?.handlePointerDown?.(event)) {
        pointer = { id: event.pointerId, mode: "tool", startX: event.clientX, startY: event.clientY, moved: false };
        this.syncToolControllerResult();
        // Starting a new drawing releases old selection handles without
        // deleting the previously-created object. Preserve selection if this
        // pointer-down itself completed a one-anchor drawing.
        if (this.drawingEngine?.state?.lastCreatedDrawingId === lastCreatedBeforePointerDown) this.selectDrawing(null);
        this.scheduleDrawingDraw();
        return;
      }
      pointer = {
        id: event.pointerId,
        mode: zone === "price" ? "price" : zone === "time" ? "time" : event.button === 1 || this._spacePan || !this.drawingToolType() ? "pan" : "inspect",
        anchorAbs: anchor.anchorAbs,
        anchorFraction: anchor.anchorFraction,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        lastT: performance.now(),
        velocity: 0,
        x: event.clientX,
        y: event.clientY,
        moved: false,
      };
      if (this._spacePan && pointer.mode === "pan") this._spacePanUsed = true;
      if (zone === "chart" && this.tool === "brush" && this.crosshair) {
        pointer.mode = "brush";
        this.pendingDrawing = { type: "polyline", anchors: [this.snapDrawingPoint(this.crosshair)] };
        this.scheduleDraw();
      }
      if (zone === "chart" && event.button === 0 && !this._spacePan && this.crosshair && !this.drawingToolType()) {
        const pointerLogical = this.drawingEngine?.screenToLogical?.(event.clientX, event.clientY);
        const handle = this.hitTestDrawingHandle(this.crosshair);
        if (handle) {
          this.selectDrawing(handle.drawing, event.ctrlKey || event.metaKey || event.shiftKey);
          const hit = handle.hit || { drawing: handle.drawing, hitType: "anchor", anchorIndex: handle.anchorIndex };
          this.drawingEngine?.startSelectionDrag?.(hit, pointerLogical);
          this.drawingDrag = { ids: [handle.drawing.id], anchorIndex: handle.anchorIndex, startPoint: this.crosshair, mode: "resize" };
          drawingDragBefore = this.drawingDrag.ids.map((id) => this.drawingEngine?.getDrawing?.(id)).filter(Boolean);
          pointer.mode = "drawing";
          return;
        }
        const engineHit = this.drawingEngine?.hitTest?.(this.screenPointForDrawingHit(this.crosshair), { drawings: this.visibleDrawingObjects() });
        const hit = engineHit?.drawing || this.hitTestDrawing(this.crosshair);
        if (hit) {
          this.selectDrawing(hit, event.ctrlKey || event.metaKey || event.shiftKey);
          this.drawingEngine?.startSelectionDrag?.(engineHit || { drawing: hit, hitType: "body" }, pointerLogical);
          this.drawingDrag = { ids: [...this.selectedDrawingIds], startPoint: this.crosshair, mode: "move" };
          drawingDragBefore = this.drawingDrag.ids.map((id) => this.drawingEngine?.getDrawing?.(id)).filter(Boolean);
          pointer.mode = "drawing";
        } else if (this.cursorMode === "arrow" && event.shiftKey) {
          this.drawingEngine?.selectionManager?.startBoxSelection?.({ x: event.clientX, y: event.clientY });
          pointer.mode = "box-select";
        }
      }
      if (pointer.mode === "pan" || pointer.mode === "time") canvas.classList.add("dragging");
    });

    canvas.addEventListener("pointerup", (event) => {
      if (!pointer || pointer.id !== event.pointerId) return;
      canvas.releasePointerCapture?.(event.pointerId);
      canvas.classList.remove("dragging");
      updateCrosshair(event);
      const wasMoved = pointer.moved;
      const mode = pointer.mode;
      if (mode === "order-draft") { pointer = null; this.scheduleDraw(); return; }
      if(mode==='trade-protection'){pointer=null;this.scheduleDraw();return;}
      if (mode === "tool") {
        this.drawingEngine?.handlePointerUp?.(event);
        this.syncToolControllerResult();
        this.scheduleDrawingDraw();
        pointer = null;
        return;
      }
      if (mode === "drawing" && this.drawingDrag) {
        const ids = [...this.drawingDrag.ids];
        const before = drawingDragBefore || [];
        this.drawingEngine?.endSelectionDrag?.();
        this.syncLegacyDrawingsFromEngine();
        const after = ids.map((id) => this.drawingEngine?.getDrawing?.(id)).filter(Boolean);
        if (wasMoved) {
          this.drawingEngine?.updateDrawingsWithHistory?.(before, after, this.drawingDrag.mode === "resize" ? "Move Anchor" : "Move Drawing");
          this.syncLegacyDrawingsFromEngine();
          this.saveDrawingStorage();
        }
        this.drawingDrag = null;
        drawingDragBefore = null;
        this.scheduleDrawingDraw();
        pointer = null;
        return;
      }
      if (mode === "box-select") {
        const ids = this.drawingEngine?.selectionManager?.completeBoxSelection?.({ append: event.ctrlKey || event.metaKey || event.shiftKey }) || [];
        this.selectedDrawingIds = ids.length || !(event.ctrlKey || event.metaKey || event.shiftKey) ? this.drawingEngine.selectionManager.getSelectedIds() : this.selectedDrawingIds;
        this.updateDrawingManagerSelection();
        this.scheduleDraw();
        pointer = null;
        return;
      }
      if (mode === "pan" && wasMoved) {
        startPanInertia(pointer.velocity || 0);
        pointer = null;
        return;
      }
      if (mode === "brush") {
        const anchors = this.pendingDrawing?.anchors || [];
        this.pendingDrawing = null;
        pointer = null;
        if (anchors.length > 1) {
          this.addDrawingObject(this.makeDrawing("polyline", anchors));
        } else {
          this.scheduleDraw();
        }
        return;
      }
      if (this.drawingToolType() && this.engineToolForUiTool(this.tool) && this.drawingEngine?.handlePointerUp?.(event)) {
        this.syncToolControllerResult();
        pointer = null;
        return;
      }
      pointer = null;
      if (wasMoved) return;
      // In crosshair mode the chart uses pan as its pointer mode, so an empty
      // stationary click used to bypass the selection-clearing path below.
      // Keep the drawing stored and only clear its selected state.
      if (
        event.button === 0 &&
        !this._spacePan &&
        axisAt(event) === "chart" &&
        !this.drawingToolType() &&
        this.tool !== "scissors" &&
        this.cursorMode !== "eraser"
      ) {
        const hit = this.crosshair ? this.hitTestDrawing(this.crosshair) : null;
        if (!hit) {
          this.selectDrawing(null);
          return;
        }
      }
      if (this.drawingToolType() && this.crosshair) {
        this.createDrawingFromPoint(this.crosshair);
        return;
      }
      if (this.cursorMode === "eraser" && this.crosshair) {
        this.eraseNearestDrawing(this.crosshair);
        return;
      }
      if (this.tool === "scissors" && this.crosshair) {
        this.cutReplayAt(this.crosshair.index);
        return;
      }
      if (this.cursorMode === "arrow" && this.crosshair) {
        this.selectDrawing(this.hitTestDrawing(this.crosshair), event.ctrlKey || event.metaKey || event.shiftKey);
        return;
      }
    });

    canvas.addEventListener("pointercancel", () => {
      if (pointer?.mode === "tool") this.drawingEngine?.toolController?.cancel?.({ silent: true });
      canvas.classList.remove("dragging");
      this.drawingEngine?.cancelSelectionDrag?.();
      this.drawingEngine?.selectionManager?.cancelBoxSelection?.();
      this.syncLegacyDrawingsFromEngine();
      this.drawingDrag = null;
      drawingDragBefore = null;
      pointer = null;
      this.scheduleDraw();
    });

    canvas.addEventListener("contextmenu", (event) => {
      updateCrosshair(event);
      const logicalPoint = this.crosshair;
      const hit = logicalPoint ? (this.drawingEngine?.hitTest?.(this.screenPointForDrawingHit(logicalPoint), { drawings: this.visibleDrawingObjects() })?.drawing || this.hitTestDrawing(logicalPoint)) : null;
      if (hit && !this.selectedDrawingIds.includes(hit.id)) this.selectDrawing(hit, event.ctrlKey || event.metaKey || event.shiftKey);
    });

    canvas.addEventListener("dblclick", (event) => {
      if (!this.drawingEngine?.state?.temporaryDrawing) {
        const hit = this.drawingEngine?.hitTest({ x: event.clientX, y: event.clientY });
        if (hit?.drawing) {
          this.selectDrawing(this.drawings.find(drawing => drawing.id === hit.drawing.id));
          this.drawingSettingsOpen = true;
          this.rerender();
          return;
        }
      }
      if (this.engineToolForUiTool(this.tool) && this.drawingEngine?.handleDoubleClick?.(event)) {
        this.syncToolControllerResult();
        return;
      }
      const zone = axisAt(event);
      if (zone === "price") {
        this.yZoom = 1;
        this.yOffset = 0;
        this.scheduleDraw();
        toast("Price scale reset.", "info");
      } else if (zone === "time") {
        this.resetTimeZoomOnly();
      } else if (this.tool === "scissors") {
        updateCrosshair(event);
        if (this.crosshair) this.cutReplayAt(this.crosshair.index);
      } else {
        this.resetChartZoomOnly();
      }
    });

    if (this._chartContextActionHandler) window.removeEventListener("ui:context-action", this._chartContextActionHandler);
    this._chartContextActionHandler = (event) => {
      const action = event.detail?.action;
      if (!action || !String(action).startsWith("chart-")) return;
      if (action === "chart-reset-zoom") this.resetChartZoomOnly();
      else if (action === "chart-fit-content") this.fitAllCandles();
      else if (action === "chart-reset-price") {
        this.yZoom = 1;
        this.yOffset = 0;
        this.scheduleDraw();
        toast("Price scale reset.", "info");
      } else if (action === "chart-reset-time") this.resetTimeZoomOnly();
      else if (action === "chart-settings") UI?.openModal?.("settingsModal");
      else if (action === "chart-go-live") this.goToLatest();
      else if (action === "chart-copy-price") this.copyCrosshairPrice();
      else if (action === "chart-copy-time") this.copyCrosshairTime();
      else if (action === "chart-replay-from-here" && this.crosshair) this.cutReplayAt(this.crosshair.index);
      else if (action === "chart-add-bookmark") this.addReplayBookmark();
      else if (action === "chart-add-horizontal-line" && this.crosshair) {
        const line = this.makeDrawing("horizontalLine", [this.snapDrawingPoint(this.crosshair)]);
        this.addDrawingObject(line);
        toast("Horizontal line added.", "success");
      }
      else if (action === "chart-toggle-scissors") this.toggleScissorsTool();
      else if (action === "chart-drawing-copy") {
        this.syncDrawingEngineFromLegacy();
        this.drawingEngine?.selectionManager?.selectMultiple?.(this.selectedDrawingIds, { reason: "context-copy" });
        const count = this.drawingEngine?.copySelectedDrawings?.() || 0;
        this.drawingClipboard = this.drawingEngine?.clipboard?.items || null;
        if (count) toast("Drawing copied.", "success");
      } else if (action === "chart-drawing-paste" && (this.drawingEngine?.clipboard?.hasItems?.() || this.drawingClipboard?.length)) {
        this.syncDrawingEngineFromLegacy();
        if (!this.drawingEngine?.clipboard?.hasItems?.() && this.drawingClipboard?.length) this.drawingEngine.clipboard.copy(this.drawingClipboard.map((d) => this.drawingEngine.factory.fromLegacy(d)));
        this.drawingEngine?.pasteDrawings?.({ offsetCandles: 3 });
        this.syncLegacyDrawingsFromEngine();
        this.selectedDrawingIds = [...(this.drawingEngine?.state?.selectedDrawingIds || [])];
        this.saveDrawingStorage();
        this.scheduleDraw();
      } else if (action === "chart-drawing-duplicate") this.duplicateSelectedDrawings();
      else if (action === "chart-drawing-delete") this.deleteSelectedDrawings();
      else if (action === "chart-drawing-lock") this.updateDrawingObjects(this.selectedDrawingIds, (d) => ({ ...d, locked: !d.locked }));
      else if (action === "chart-drawing-hide") this.updateDrawingObjects(this.selectedDrawingIds, (d) => ({ ...d, visible: !d.visible }));
      else if (action === "chart-drawing-rename") this.renameSelectedDrawing();
      else if (action === "chart-drawing-group") this.groupSelectedDrawings();
      else if (action === "chart-drawing-save-template") this.saveSelectedAsTemplate();
      else if (action === "chart-drawing-front") this.bringSelectedDrawingToFront();
      else if (action === "chart-drawing-back") this.sendSelectedDrawingToBack();
      else if (action === "chart-drawing-delete-all") this.confirmDeleteAllDrawings();
    };
    window.addEventListener("ui:context-action", this._chartContextActionHandler);

    surface.addEventListener("wheel", (event) => {
      event.preventDefault();
      if (this.inertia?.raf) cancelAnimationFrame(this.inertia.raf);
      this.inertia = null;
      const { dx, dy } = normalizeWheel(event);
      const rect = canvas.getBoundingClientRect();
      const zone = axisAt(event, rect);
      engine.lastWheelEvent = event;
      if (zone === "price" || event.ctrlKey) {
        this.zoomY(dy > 0 ? "out" : "in");
        updateCrosshair(event);
        return;
      }
      if (event.shiftKey || zone === "time" || Math.abs(dx) > Math.abs(dy) * 0.65) {
        panPixels(Math.abs(dx) > Math.abs(dy) ? dx : dy, rect);
        updateCrosshair(event);
        return;
      }
      const anchor = anchorFromEvent(event, rect);
      zoomTargetAround(dy, anchor.anchorAbs, anchor.anchorFraction);
      updateCrosshair(event);
    }, { passive: false });

    if (window.GestureEvent) {
      canvas.addEventListener("gesturestart", (event) => {
        event.preventDefault();
        this._lastGestureScale = 1;
      });
      canvas.addEventListener("gesturechange", (event) => {
        event.preventDefault();
        const prev = this._lastGestureScale || 1;
        this._lastGestureScale = event.scale || 1;
        const anchor = anchorFromEvent(event);
        zoomTargetAround((event.scale || 1) > prev ? -80 : 80, anchor.anchorAbs, anchor.anchorFraction);
      });
      canvas.addEventListener("gestureend", () => { this._lastGestureScale = 1; });
    }

    if (this._keyHandler) document.removeEventListener("keydown", this._keyHandler);
    if (this._keyUpHandler) document.removeEventListener("keyup", this._keyUpHandler);
    this._keyHandler = (e) => {
      if (!document.querySelector(".tv-shell")) return;
      if (typeof UI !== "undefined" && UI.getSetting?.("keyboardShortcuts") === false) return;
      const tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (e.code === "Space") {
        e.preventDefault();
        if (!e.repeat) {
          this._spacePan = true;
          this._spacePanUsed = false;
        }
        return;
      }
      if (e.ctrlKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        const handled = e.shiftKey ? this.redoDrawingAction() : this.undoDrawingAction();
        if (!handled) {
          if (e.shiftKey) this.redoReplayAction(); else this.undoReplayAction();
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        this.redoDrawingAction();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
        if (this.selectedDrawingIds.length) {
          e.preventDefault();
          this.syncDrawingEngineFromLegacy();
          this.drawingEngine?.selectionManager?.selectMultiple?.(this.selectedDrawingIds, { reason: "keyboard-copy" });
          this.drawingEngine?.copySelectedDrawings?.();
          this.drawingClipboard = this.drawingEngine?.clipboard?.items || null;
          toast("Drawing copied.", "success");
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
        if (this.drawingEngine?.clipboard?.hasItems?.() || this.drawingClipboard?.length) {
          e.preventDefault();
          this.syncDrawingEngineFromLegacy();
          if (!this.drawingEngine?.clipboard?.hasItems?.() && this.drawingClipboard?.length) this.drawingEngine.clipboard.copy(this.drawingClipboard.map((d) => this.drawingEngine.factory.fromLegacy(d)));
          this.drawingEngine?.pasteDrawings?.({ offsetCandles: 3 });
          this.syncLegacyDrawingsFromEngine();
          this.selectedDrawingIds = [...(this.drawingEngine?.state?.selectedDrawingIds || [])];
          this.saveDrawingStorage();
          this.scheduleDraw();
          toast("Drawing pasted.", "success");
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
        if (this.selectedDrawingIds.length) {
          e.preventDefault();
          this.duplicateSelectedDrawings();
        }
        return;
      }
      if (e.altKey) {
        const key = e.key.toLowerCase();
        const tool = Object.entries(this.TOOL_META).find(([, meta]) => meta.shortcut?.toLowerCase() === `alt+${key}`)?.[0];
        if (tool) {
          e.preventDefault();
          this.selectTool(tool);
          return;
        }
      }
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const shortcutTool = this.drawingWorkspaceUX?.resolveShortcut?.(e.key);
        if (shortcutTool && this.TOOL_META[shortcutTool]) {
          e.preventDefault();
          this.selectTool(shortcutTool);
          return;
        }
      }
      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault(); stopMotion();
          if (e.ctrlKey) {
            this.jumpReplayBookmark(-1);
          } else if (this.replayActive || e.shiftKey) {
            this.step(e.shiftKey ? -10 : -1);
          } else {
            this.panChartByCandles(-Math.max(1, Math.round(this.visibleCount * 0.08)));
          }
          break;
        case "ArrowRight":
          e.preventDefault(); stopMotion();
          if (e.ctrlKey) {
            this.jumpReplayBookmark(1);
          } else if (this.replayActive || e.shiftKey) {
            this.step(e.shiftKey ? 10 : 1);
          } else {
            this.panChartByCandles(Math.max(1, Math.round(this.visibleCount * 0.08)));
          }
          break;
        case "b": case "B":
          e.preventDefault(); this.placeTrade("BUY"); break;
        case "s": case "S":
          if (e.altKey) {
            e.preventDefault(); this.toggleScissorsTool();
          } else {
            e.preventDefault(); this.placeTrade("SELL");
          }
          break;
        case "l": case "L":
          e.preventDefault(); this.exitReplayToLive(); break;
        case "+": case "=":
          e.preventDefault(); this.zoomX("in"); break;
        case "-": case "_":
          e.preventDefault(); this.zoomX("out"); break;
        case "Home":
          e.preventDefault(); this.goToLatest(); break;
        case "Escape":
          if (this.drawingEngine?.state?.isDragging || this.drawingEngine?.state?.isResizing) {
            e.preventDefault();
            this.drawingEngine.cancelSelectionDrag();
            this.syncLegacyDrawingsFromEngine();
            this.scheduleDraw();
            return;
          }
          if (this.drawingEngine?.state?.temporaryDrawing) {
            e.preventDefault();
            this.drawingEngine.handleKeyDown(e);
            this.syncToolControllerResult();
            this.scheduleDraw();
            return;
          }
          if (this.pendingDrawing || this.selectedDrawingIds.length) {
            e.preventDefault();
            this.pendingDrawing = null;
            this.selectDrawing(null);
          } else if (this.replayActive || this.tool === "scissors") {
            e.preventDefault();
            this.exitReplayToLive();
          } else if (this.tool !== "crosshair") {
            e.preventDefault();
            this.selectTool("crosshair");
          }
          break;
        case "Delete":
        case "Backspace":
          if (this.selectedDrawingIds.length) {
            e.preventDefault();
            this.deleteSelectedDrawings();
          }
          break;
        case "End":
          e.preventDefault(); this.goToOldestLoaded(); break;
      }
    };
    this._keyUpHandler = (e) => {
      if (!document.querySelector(".tv-shell")) return;
      if (e.code !== "Space") return;
      const tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      e.preventDefault();
      const usedForPan = !!this._spacePanUsed;
      this._spacePan = false;
      this._spacePanUsed = false;
      if (!usedForPan) this.togglePlay();
    };
    document.addEventListener("keydown", this._keyHandler);
    document.addEventListener("keyup", this._keyUpHandler);

    // ---- Responsive: redraw when the chart's own container is resized ----
    // (covers panel drag-resize, sidebar collapse, and fullscreen toggling —
    // none of which fire a native window `resize` event.)
    if (window.ResizeObserver) {
      if (!this._resizeObserver) this._resizeObserver = new ResizeObserver(() => { this.crosshair = null; this.scheduleDraw(); });
      this._resizeObserver.disconnect();
      const area = container.querySelector(".tv-chart-area");
      // Each rerender() replaces the DOM, so re-observe the fresh node every time;
      // stale/detached nodes are simply ignored by the browser.
      if (area) this._resizeObserver.observe(area);
    }
    if (this._winResizeHandler) {
      window.removeEventListener("resize", this._winResizeHandler);
      window.removeEventListener("tfb:chart-resize", this._winResizeHandler);
    }
    this._winResizeHandler = () => this.scheduleDraw();
    window.addEventListener("resize", this._winResizeHandler);
    window.addEventListener("tfb:chart-resize", this._winResizeHandler);
  },

  // Zoom visibleCount smoothly (short animated tween) while keeping `anchorAbs`
  // (an absolute candle index) fixed under the cursor — professional, TradingView-
  // style cursor-centered zoom instead of a jarring jump.
  syncMouseEngineCamera() {
    if (!this.mouseEngine) return;
    if (this.mouseEngine.raf) cancelAnimationFrame(this.mouseEngine.raf);
    this.mouseEngine.raf = null;
    this.mouseEngine.targetCount = this.visibleCount;
    this.mouseEngine.targetEnd = this.viewEnd ?? this.idx;
  },

  zoomAroundAnchor(direction, anchorAbs) {
    this.stopZoomAnimation();
    const limit = this.getReplayLimit();
    if (!Number.isFinite(anchorAbs)) anchorAbs = this.viewEnd ?? this.idx ?? limit;
    anchorAbs = Math.max(0, Math.min(limit + this.futureSlots, anchorAbs));
    if (this.mouseEngine) {
      const currentEnd = this.viewEnd ?? this.idx;
      const currentStart = currentEnd - this.visibleCount + 1;
      const anchorFraction = Math.max(0, Math.min(1, (anchorAbs - currentStart) / Math.max(1, this.visibleCount)));
      const delta = direction === "in" ? -96 : 96;
      const engine = this.mouseEngine;
      const base = Math.max(this.minVisibleCount, Math.min(this.maxVisibleCount, engine.targetCount || this.visibleCount));
      engine.targetCount = Math.max(this.minVisibleCount, Math.min(this.maxVisibleCount, base * Math.exp(delta * 0.0018)));
      engine.targetEnd = this.clampViewEnd(anchorAbs + (1 - anchorFraction) * engine.targetCount - 1);
      if (!engine.raf) {
        const tick = () => {
          engine.raf = null;
          const countDiff = engine.targetCount - this.visibleCount;
          const endDiff = engine.targetEnd - (this.viewEnd ?? this.idx);
          if (Math.abs(countDiff) < 0.35 && Math.abs(endDiff) < 0.02) {
            this.visibleCount = engine.targetCount;
            this.viewEnd = this.clampViewEnd(engine.targetEnd);
            this.scheduleDraw();
            return;
          }
          this.visibleCount = Math.max(this.minVisibleCount, Math.min(this.maxVisibleCount, this.visibleCount + countDiff * 0.34));
          this.viewEnd = this.clampViewEnd((this.viewEnd ?? this.idx) + endDiff * 0.34);
          this.scheduleDraw();
          engine.raf = requestAnimationFrame(tick);
        };
        engine.raf = requestAnimationFrame(tick);
      }
      return;
    }
    const currentCount = this.visibleCount;
    const factor = direction === "in" ? 0.86 : 1.16;
    const nextCount = Math.max(this.minVisibleCount, Math.min(this.maxVisibleCount, currentCount * factor));
    if (nextCount === currentCount) return;
    const currentEnd = this.clampViewEnd(this.viewEnd ?? this.idx);
    const currentStart = currentEnd - currentCount + 1;
    const anchorFraction = Math.max(0, Math.min(1, (anchorAbs - currentStart) / Math.max(1, currentCount)));
    this.visibleCount = nextCount;
    this.viewEnd = this.clampViewEnd(anchorAbs + (1 - anchorFraction) * nextCount - 1);
    this.autoFollow = this.viewEnd >= this.getReplayLimit() ? this.autoFollow : false;
    this.ensureOlderCandles();
    this.scheduleDraw();
  },

  goToLatest() {
    if (this.tool === "scissors") this.tool = "crosshair";
    this.autoFollow = true;
    this.viewEnd = this.followViewEnd();
    this.syncMouseEngineCamera();
    this.scheduleDraw();
  },

  fitAllCandles() {
    const dataLength = this.replayActive ? this.getReplayLimit() + 1 : this.candles.length;
    this.visibleCount = Math.max(this.minVisibleCount, Math.min(this.maxVisibleCount, dataLength));
    this.viewEnd = this.clampViewEnd(dataLength - 1);
    this.autoFollow = this.viewEnd >= this.idx;
    this.syncMouseEngineCamera();
    this.scheduleDraw();
  },

  goToOldestLoaded() {
    this.autoFollow = false;
    this.viewEnd = this.clampViewEnd(this.visibleCount - 1);
    this.syncMouseEngineCamera();
    this.scheduleDraw();
  },

  resetChartView() {
    this.yZoom = 1;
    this.yOffset = 0;
    this.visibleCount = 120;
    this.goToLatest();
  },

  async changeTimeframeFromToolbar(newTf) {
    if (!newTf || newTf === this.timeframe) return;
    const wasReplayActive = this.replayActive;
    if (wasReplayActive) this.syncReplayTimestamp();
    const anchorTs = wasReplayActive ? this.replayTimestamp : null;
    const panOffset = (this.viewEnd ?? this.idx) - this.idx;
    this.stopPlay();
    this.dataSource = "loading";
    this.timeframe = newTf;
    this.sessionEngine?.clearCache?.();
    this.candles = MarketData.isLocal(this.symbol) ? [] : MarketData.generate(this.symbol, newTf, this.historyCountForTimestamp(newTf, anchorTs));
    this.idx = anchorTs != null ? this.snapIndexToTimestamp(anchorTs) : this.candles.length - 1;
    this.replayTimestamp = anchorTs;
    this.replayActive = wasReplayActive;
    this.replayCutIndex = wasReplayActive ? this.idx : null;
    this.syncReplayBuffers();
    this.viewEnd = this.clampViewEnd(this.idx + panOffset);
    this.sanitizeChartCamera();
    this.syncMouseEngineCamera();
    this.rerender();
    // Loading must not wait for a settings write, or remain blank if it fails.
    const loading = this.loadRealHistory();
    API.updateSettings({ timeframe: newTf, ...this.replaySettingsPayload() }).catch(error => console.warn('Timeframe preference could not be saved', error));
    await loading;
  },

  async switchSymbol(symbol) {
    const accountScope = this._chartAccountScope;
    this.stopPlay();
    this.dataSource = "loading";
    this.symbol = symbol;
    const anchorTs = this.replayActive ? (this.replayTimestamp ?? this.candles[this.idx]?.date?.getTime()) : null;
    this.candles = MarketData.isLocal(this.symbol) ? [] : MarketData.generate(this.symbol, this.timeframe, this.historyCountForTimestamp(this.timeframe, anchorTs));
    this.idx = this.candles.length - 1;
    this.replayActive = false;
    this.replayCutIndex = null;
    this.sessionEngine?.clearCache?.();
    this.loadDrawingStorage();
    this.syncReplayBuffers();
    this.viewEnd = this.idx;
    this.autoFollow = true;
    this.yOffset = 0;
    this.syncMouseEngineCamera();
    await API.updateSettings({ symbol: this.symbol, ...this.replaySettingsPayload() });
    if (accountScope !== this._chartAccountScope) return;
    this.rerender();
    this.loadRealHistory();
  },

  beginReplayFrom(index) {
    if (!this.canReplayAt(index)) return false;
    const cut = Math.max(0, Math.min(this.candles.length - 1, Math.round(index ?? this.idx)));
    this.stopPlay();
    this.revealAnim = null;
    this.replayActive = true;
    this.replayCutIndex = cut;
    this.idx = cut;
    this.syncReplayTimestamp();
    this.syncReplayBuffers();
    this.autoFollow = true;
    this.viewEnd = this.followViewEnd();
    this.yOffset = 0;
    this.syncMouseEngineCamera();
    this.updateReplayChrome();
    this.scheduleDraw();
    this.emitReplayEvent("ReplayStarted", { index: cut, timestamp: this.replayTimestamp });
    this.persistReplayState({ immediate: true });
    return true;
  },

  canReplayAt(index) {
    const system = window.SubscriptionSystem;
    if (!system?.canAccessFeature("replay")) { system?.requestUpgrade("replay"); return false; }
    const candle = this.candles[Math.max(0, Math.min(this.candles.length - 1, Math.round(index ?? this.idx)))];
    const timestamp = Number(candle?.time ?? candle?.date?.getTime());
    if (!Number.isFinite(timestamp)) return true;
    const range = system.getPermittedReplayRange(this.symbol, this.replayAvailability());
    if (!range) {
      toast("Historical data availability has not loaded, so the replay date cannot be validated yet.", "error");
      return false;
    }
    if (timestamp < range.start || timestamp > range.end) {
      const date = (value) => Number.isFinite(value) ? new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium" }).format(value) : "unknown";
      system.requestUpgrade("extendedHistoricalReplay", `This replay date is outside your plan's permitted history. Available on this dataset: ${date(range?.start)} – ${date(range?.end)} (IST). Red · Elite includes full supported history.`);
      return false;
    }
    return true;
  },

  replayAvailability() {
    const first = this.candles[0]?.date?.getTime?.();
    const last = this.candles.at(-1)?.date?.getTime?.();
    return {
      ...this.datasetInfo,
      first_timestamp: this.datasetInfo?.first_timestamp ?? first,
      last_timestamp: this.datasetInfo?.last_timestamp ?? last,
    };
  },

  toggleScissorsTool() {
    if (!window.SubscriptionSystem?.canAccessFeature("replay")) { window.SubscriptionSystem.requestUpgrade("replay"); return; }
    this.tool = this.tool === "scissors" ? "crosshair" : "scissors";
    this.pendingDrawing = null;
    this.scheduleDraw();
    this.container?.querySelector("#scissorsToolBtn")?.classList.toggle("active", this.tool === "scissors");
    toast(this.tool === "scissors" ? "Scissors active. Click a candle to start replay from there." : "Scissors disabled.", "info");
  },

  cutReplayAt(index) {
    if (!this.canReplayAt(index)) return;
    this.pushReplayUndo();
    const cut = Math.max(0, Math.min(this.candles.length - 1, Math.round(index)));
    this.beginReplayFrom(cut);
    this.tool = "crosshair";
    this.container?.querySelector("#scissorsToolBtn")?.classList.remove("active");
    const candle = this.candles[cut];
    toast(`Replay cut set at ${candle ? Fmt.dateTime(candle.date) : "selected candle"}. Future candles hidden.`, "success");
    this.rerender();
  },

  setReplaySpeed(speed, options = {}) {
    if (!Number.isFinite(speed) || speed <= 0) return;
    this.speed = Math.max(0.25, Math.min(100, speed));
    this.syncReplayBuffers();
    this.emitReplayEvent("ReplaySpeedChanged", { speed: this.speed });
    this.persistReplayState({ immediate: true });
    const label = this.container?.querySelector("#replaySpeedLabel");
    if (label) label.textContent = `${this.speed.toFixed(1)}x`;
    const slider = this.container?.querySelector("#speedSlider");
    if (slider) slider.value = String(this.speed * 10);
    if (this.playing) {
      this.stopPlay();
      this.startPlay();
    } else if (!options.keepDom) {
      this.rerender();
    }
  },

  async jumpReplayToDate(value) {
    if (!value) return;
    const ts = new Date(value).getTime();
    if (!Number.isFinite(ts)) return;
    if (!window.SubscriptionSystem?.canAccessFeature("replay")) { window.SubscriptionSystem.requestUpgrade("replay"); return; }
    const permitted = window.SubscriptionSystem?.getPermittedReplayRange(this.symbol, this.replayAvailability());
    if (window.SubscriptionSystem && !permitted) {
      toast("Historical data availability has not loaded, so the replay date cannot be validated yet.", "error");
      return;
    }
    if (permitted && (ts < permitted.start || ts > permitted.end)) {
      const format = value => new Intl.DateTimeFormat("en-IN", { timeZone:"Asia/Kolkata", dateStyle:"medium" }).format(value);
      window.SubscriptionSystem.requestUpgrade("extendedHistoricalReplay", `This date is outside your plan's permitted replay window. Available dataset window: ${format(permitted.start)} – ${format(permitted.end)} IST.`);
      return;
    }
    if (MarketData.isLocal(this.symbol)) {
      this.stopPlay();
      this.replayActive = true;
      this.replayTimestamp = ts;
      await this.loadRealHistory();
      return;
    }
    const index = this.snapIndexToTimestamp(ts);
    this.cutReplayAt(index);
    this.emitReplayEvent("ReplayJumped", { index, timestamp: ts, source: "date" });
  },

  toggleSessions() {
    const config = this.sessionEngine?.getConfig?.();
    this.updateSessionConfig({ enabled: !config?.enabled });
  },

  updateSessionConfig(patch, options = {}) {
    if (!this.sessionEngine) return;
    this.sessionEngine.setConfig(patch);
    this.saveSessionSettings();
    if (options.rerender !== false) this.rerender();
    else this.scheduleDraw();
  },

  handleSessionToggle(key, checked) {
    if (key === "enabled" || key === "showLabels" || key === "showHighLow" || key === "showOpen") {
      this.updateSessionConfig({ [key]: checked });
      return;
    }
    if (key?.startsWith("def:")) this.updateSessionDefinition(key.slice(4), { enabled: checked });
  },

  updateSessionDefinition(id, patch) {
    if(id==='new-york' && (patch.startTime || patch.endTime)){
      const key=patch.startTime?'ny_sst':'ny_est',value=patch.startTime || patch.endTime;
      const indicator=this.getFxnIndicator(),{values,shift}=indicator.clockSettings(this.candles[this.idx]?.time ?? this.candles[this.idx]?.date?.getTime() ?? Date.now());
      const [h,m]=value.split(':').map(Number),n=(h*60+m-shift+2880)%1440;
      this.updateFxnSettings({[key+'h']:String(Math.floor(n/60)).padStart(2,'0'),[key+'m']:String(n%60).padStart(2,'0')});return;
    }
    const config = this.sessionEngine?.getConfig?.();
    if (!config?.definitions?.[id]) return;
    this.updateSessionConfig({ definitions: { [id]: { ...config.definitions[id], ...patch } } });
  },

  jumpToSelectedSession() {
    const sessionType = this.container?.querySelector("#sessionSelectInput")?.value || this.selectedSessionType();
    const date = this.container?.querySelector("#sessionDateInput")?.value || this.sessionNavigator.date || this.sessionDateValue(null, sessionType);
    this.setSelectedSessionType(sessionType, { date, rerender: false });
    const session = this.fxnSessionOnIstDate(date, sessionType);
    if (!this.sessionHasLoadedCandles(session)) {
      toast("Session not found for that date.", "error");
      return;
    }
    this.seekReplayToSession(session, "selected-session");
  },

  fxnSessionOnIstDate(dateKey, sessionType) {
    const indicator=this.getFxnIndicator();
    if(!indicator || !/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey)))return null;
    const type=sessionType==='asia'?'asia':sessionType==='london'?'london':sessionType==='new-york'?'ny':null;
    if(!type)return null;
    const [year,month,day]=dateKey.split('-').map(Number);
    const bounds=indicator.bounds(Date.UTC(year,month-1,day,12),type);
    if(!bounds || !Number.isFinite(bounds.start) || !Number.isFinite(bounds.end) || this.sessionDateValue(bounds.start,sessionType)!==dateKey)return null;
    const def=this.sessionEngine?.getConfig?.().definitions?.[sessionType];
    const labels={asia:['Asian Session','ASIA'],london:['London Session','LONDON'],'new-york':['New York Session','NEW YORK']}[sessionType];
    return {id:`${sessionType}:${dateKey}`,type:sessionType,dateKey,name:def?.name||labels[0],shortName:def?.shortName||labels[1],start:bounds.start,end:bounds.end,timezone:'Asia/Kolkata',enabled:true};
  },

  jumpQuickSession(sessionType) {
    if (!this.setSelectedSessionType(sessionType, { rerender: false })) return;
    const ts = this.candles[this.idx]?.date?.getTime() || Date.now();
    const session = this.sessionEngine?.getNextOccurrence?.(ts - 1, sessionType);
    if (!this.sessionHasLoadedCandles(session)) {
      toast(`No additional ${this.sessionShortLabel(sessionType)} session available.`, "error");
      return;
    }
    this.sessionNavigator.date = this.sessionDateValue(session.start, sessionType);
    this.seekReplayToSession(session, "quick-session");
  },

  jumpRelativeSession(direction) {
    const ts = this.candles[this.idx]?.date?.getTime() || Date.now();
    const sessionType = this.selectedSessionType();
    const dateKey = this.sessionDateValue(ts, sessionType);
    const current = this.fxnSessionOnIstDate(dateKey, sessionType);
    const cutoff = direction < 0 && current && current.start <= ts && ts < current.end ? current.start : ts;
    let session = null;
    const date = new Date(`${dateKey}T12:00:00.000Z`);
    for (let offset = 0; offset <= 30 && !session; offset += 1) {
      const candidateDate = new Date(date);
      candidateDate.setUTCDate(candidateDate.getUTCDate() + (direction > 0 ? offset : -offset));
      const candidateKey = candidateDate.toISOString().slice(0, 10);
      const candidate = this.fxnSessionOnIstDate(candidateKey, sessionType);
      if (!candidate || !this.sessionHasLoadedCandles(candidate)) continue;
      if (direction > 0 ? candidate.start > ts : candidate.start < cutoff) session = candidate;
    }
    if (!this.sessionHasLoadedCandles(session)) {
      const label = this.sessionShortLabel(sessionType);
      toast(direction > 0 ? `No additional ${label} session available.` : `No previous ${label} session available.`, "error");
      return;
    }
    this.sessionNavigator.selectedSessionType = session.type;
    this.sessionNavigator.date = this.sessionDateValue(session.start, sessionType);
    this.seekReplayToSession(session, direction > 0 ? "next-session" : "previous-session");
  },

  sessionHasLoadedCandles(session) {
    if (!session || !this.candles.length) return false;
    const first = this.candles[0]?.date?.getTime?.() ?? 0;
    const last = this.candles[this.candles.length - 1]?.date?.getTime?.() ?? 0;
    if (session.end < first || session.start > last) return false;
    const index = this.sessionEngine?.lowerBoundCandles?.(this.candles, session.start) ?? this.snapIndexToTimestamp(session.start);
    return Number.isFinite(index) && index >= 0 && index < this.candles.length;
  },

  seekReplayToSession(session, source = "session") {
    if (!this.canReplayAt(this.snapIndexToTimestamp(session.start))) return;
    const index = this.snapIndexToTimestamp(session.start);
    if (!Number.isFinite(index)) return;
    this.stopPlay();
    this.beginReplayFrom(index);
    const tfMin = MarketData.TF_MINUTES[this.timeframe] || 1;
    const contextCandles = Math.max(8, Math.round(60 / tfMin));
    const sessionCandles = Math.max(20, Math.round((session.end - session.start) / (tfMin * 60000)));
    this.visibleCount = Math.max(this.minVisibleCount, Math.min(this.maxVisibleCount, Math.min(260, contextCandles + sessionCandles + 24)));
    this.viewEnd = this.clampViewEnd(index + Math.round(this.visibleCount * 0.72));
    this.autoFollow = false;
    this.syncMouseEngineCamera();
    this.updateReplayChrome();
    this.scheduleDraw();
    this.emitReplayEvent("SessionJumped", { source, sessionType: session.type, timestamp: session.start, index });
    toast(`${session.name} loaded. Replay jumped to session start.`, "success");
  },

  addReplayBookmark() {
    const c = this.candles[this.idx];
    if (!c) return;
    const bookmark = { timestamp: c.date.getTime(), symbol: this.symbol, timeframe: this.timeframe };
    if (!this.replayBookmarks.some((b) => b.timestamp === bookmark.timestamp)) {
      this.replayBookmarks.push(bookmark);
      this.replayBookmarks.sort((a, b) => a.timestamp - b.timestamp);
      this.saveReplayStorage();
      this.emitReplayEvent("ReplayBookmarkAdded", bookmark);
      toast("Replay bookmark added.", "success");
      this.updateReplayChrome();
    }
  },

  clearReplayBookmarks() {
    this.replayBookmarks = [];
    this.saveReplayStorage();
    this.emitReplayEvent("ReplayBookmarkRemoved", { all: true });
    this.updateReplayChrome();
    toast("Replay bookmarks cleared.", "info");
  },

  jumpReplayBookmark(direction) {
    if (!this.replayBookmarks.length) return;
    const nowTs = this.candles[this.idx]?.date?.getTime() || 0;
    const sorted = [...this.replayBookmarks].sort((a, b) => a.timestamp - b.timestamp);
    const target = direction > 0
      ? sorted.find((b) => b.timestamp > nowTs) || sorted[0]
      : [...sorted].reverse().find((b) => b.timestamp < nowTs) || sorted[sorted.length - 1];
    const index = this.snapIndexToTimestamp(target.timestamp);
    this.seekReplayToIndex(index);
    this.emitReplayEvent("ReplayJumped", { index, timestamp: target.timestamp, source: "bookmark" });
  },

  seekReplayToIndex(index) {
    if (!this.canReplayAt(index)) return;
    if (!Number.isFinite(index)) return;
    if (MarketData.isLocal(this.symbol) && this.replayActive && index > this.idx) { this.step(Math.round(index) - this.idx); return; }
    this.pushReplayUndo();
    const target = Math.max(0, Math.min(this.candles.length - 1, Math.round(index)));
    if (!this.replayActive) {
      this.beginReplayFrom(target);
    } else {
      const wasForward = target > this.idx;
      if (!wasForward) this.revealAnim = null;
      this.idx = target;
      if (this.replayCutIndex == null || target < this.replayCutIndex) this.replayCutIndex = target;
      this.syncReplayTimestamp();
      this.syncReplayBuffers();
      if (this.autoFollow) { this.viewEnd = this.followViewEnd(); this.syncMouseEngineCamera(); }
      if (wasForward) this.evaluateCandle().catch(() => {});
      if (wasForward) this.startRevealAnimation(target);
      this.updateReplayChrome();
      this.scheduleDraw();
      this.emitReplayEvent("ReplayJumped", { index: target, timestamp: this.replayTimestamp });
      this.persistReplayState({ immediate: true });
    }
  },

  selectedRiskPlan() {
    const selected = this.drawings.find((drawing) => this.selectedDrawingIds.includes(drawing.id));
    if (!selected) return null;
    const type = String(selected.type || "").toLowerCase();
    const isLong = type.includes("long") || type === "riskreward" && selected.geometry?.direction === "long";
    const isShort = type.includes("short") || type === "riskreward" && selected.geometry?.direction === "short";
    if (!isLong && !isShort) return null;
    const geometry = selected.geometry || {};
    const anchors = selected.anchors || [];
    const entry = geometry.entry || anchors.find((a) => a.role === "entry") || anchors[0];
    const stopLoss = geometry.stopLoss || anchors.find((a) => a.role === "stop") || anchors[1];
    const takeProfit = geometry.takeProfit || anchors.find((a) => a.role === "target") || anchors[2];
    if (!entry || !stopLoss || !takeProfit) return null;
    const price = (point) => Number(point?.price ?? point?.value);
    const values = { entry: price(entry), stopLoss: { price: price(stopLoss) }, takeProfit: { price: price(takeProfit) } };
    if (![values.entry, values.stopLoss.price, values.takeProfit.price].every(Number.isFinite)) return null;
    return { direction: isLong ? "long" : "short", ...values };
  },

  applyRiskPlanToOrder() {
    const plan = this.selectedRiskPlan();
    if (!plan) return;
    const meta = MarketData.getMeta(this.symbol);
    const pip = Number(meta.pip) || 0.01;
    this.slPips = Math.max(1, Math.round(Math.abs(plan.entry - plan.stopLoss.price) / pip));
    this.tpPips = Math.max(1, Math.round(Math.abs(plan.takeProfit.price - plan.entry) / pip));
    this.slEnabled = true;
    this.tpEnabled = true;
    const current = this.candles[this.idx]?.close;
    this.pendingPrice = plan.entry;
    this.orderTab = Math.abs(plan.entry-current) < pip/2 ? 'Market' :
      plan.direction === 'long' ? (plan.entry < current ? 'Limit' : 'Stop') : (plan.entry > current ? 'Limit' : 'Stop');
    this.rerender();
    toast("Chart risk/reward plan applied to the order ticket.", "success");
  },

  defaultReplayStartIndex() {
    const last = Math.max(0, this.candles.length - 1);
    const pointerIndex = Number.isFinite(this.crosshair?.index) ? Math.round(this.crosshair.index) : null;
    if (pointerIndex !== null && pointerIndex >= 0 && pointerIndex < last) return pointerIndex;
    const context = Math.max(20, Math.min(160, Math.round((this.visibleCount || 120) * 0.35)));
    return Math.max(0, last - context);
  },

  async step(n) {
    if (!window.SubscriptionSystem?.canAccessFeature("replay")) { window.SubscriptionSystem.requestUpgrade("replay"); return; }
    if (this._stepping || this._placingOrder) return;
    if (MarketData.isLocal(this.symbol) && (this.dataSource !== "local-csv" || this._historyError)) return;
    const accountScope = this._chartAccountScope;
    this._stepping = true;
    try {
    if (!this.replayActive) {
      this.beginReplayFrom(n > 0 ? this.defaultReplayStartIndex() : (this.crosshair?.index ?? this.idx));
    }
    if (n === 0) return;
    if (MarketData.isLocal(this.symbol) && n > 0) {
      for (let i = 0; i < n; i++) {
        if (this.idx >= this.candles.length - 1) await this.loadLocalPage(1);
        if (accountScope !== this._chartAccountScope) return;
        if (this._historyError || this.idx >= this.candles.length - 1) { this.stopPlay(); break; }
        this.idx++;
        this.syncReplayTimestamp();
        this.syncReplayBuffers();
        await this.evaluateCandle();
        if (accountScope !== this._chartAccountScope) return;
        this.playBarCloseSound();
      }
      if (this.autoFollow) { this.viewEnd = this.followViewEnd(); this.syncMouseEngineCamera(); }
      this.updateReplayChrome();
      this.scheduleDraw();
      this.emitReplayEvent("ReplayStep", { index: this.idx, direction: n > 0 ? 1 : -1 });
      this.persistReplayState();
      if (this.candles[this.idx]?.time >= this.datasetInfo?.last_timestamp) this.stopPlay();
      return;
    }
    const target = Math.max(0, Math.min(this.candles.length - 1, this.idx + n));
    if (target === this.idx) {
      this.stopPlay();
      return;
    }
    const movingForward = target > this.idx;
    if (!movingForward) this.revealAnim = null;
    if (movingForward) {
      while (this.idx < target) {
        this.idx++;
        this.syncReplayTimestamp();
        this.syncReplayBuffers();
        await this.evaluateCandle();
      if (accountScope !== this._chartAccountScope) return;
      this.playBarCloseSound();
      }
    } else {
      this.idx = target;
      this.syncReplayTimestamp();
      this.syncReplayBuffers();
    }
    if (this.autoFollow) { this.viewEnd = this.followViewEnd(); this.syncMouseEngineCamera(); }
    if (movingForward) this.startRevealAnimation(this.idx);
    this.updateReplayChrome();
    this.scheduleDraw();
    this.emitReplayEvent("ReplayStep", { index: this.idx, direction: n > 0 ? 1 : -1 });
    this.persistReplayState();
    if (this.idx >= this.candles.length - 1) this.stopPlay();
    } finally {
      if (accountScope === this._chartAccountScope) this._stepping = false;
    }
  },

  togglePlay() {
    if (this.playing) {
      this.stopPlay();
      return;
    }
    this.startPlay();
  },

  startPlay() {
    if (!window.SubscriptionSystem?.canAccessFeature("replay")) { window.SubscriptionSystem.requestUpgrade("replay"); return; }
    if (MarketData.isLocal(this.symbol) && (!this.candles.length || this.dataSource !== "local-csv" || this._historyError)) return;
    const wasReplayActive = this.replayActive;
    if (!this.replayActive) {
      this.beginReplayFrom(this.defaultReplayStartIndex());
    }
    if (MarketData.isLocal(this.symbol) && this.candles[this.idx]?.time >= this.datasetInfo?.last_timestamp) return;
    if (this.tool === "scissors") {
      this.tool = "crosshair";
      this.pendingDrawing = null;
      this.updateToolChrome();
      this.container?.querySelector("#scissorsToolBtn")?.classList.remove("active");
    }
    if (this.idx >= this.candles.length - 1 && !MarketData.isLocal(this.symbol)) {
      this.idx = Math.max(80, this.candles.length - this.visibleCount);
      this.replayCutIndex = this.idx;
    }
    this.syncReplayTimestamp();
    this.syncReplayBuffers();
    if (this.autoFollow) { this.viewEnd = this.followViewEnd(); this.syncMouseEngineCamera(); }
    this.playing = true;
    this.emitReplayEvent(wasReplayActive ? "ReplayResumed" : "ReplayStarted", { index: this.idx });
    this.startReplayLoop();
    this.updateReplayChrome();
    this.scheduleDraw();
  },

  startReplayLoop() {
    const token = ++this.playLoopToken;
    const tick = async () => {
      if (!this.playing || token !== this.playLoopToken) return;
      await this.step(1);
      if (!this.playing || token !== this.playLoopToken) return;
      this.playTimer = setTimeout(tick, Math.max(20, 1000 / this.speed));
    };
    this.playTimer = setTimeout(tick, Math.max(20, 1000 / this.speed));
  },

  stopPlay() {
    const wasPlaying = this.playing;
    this.playing = false;
    this.playLoopToken += 1;
    if (this.playTimer) clearTimeout(this.playTimer);
    this.playTimer = null;
    this.syncReplayBuffers();
    if (wasPlaying) this.emitReplayEvent("ReplayPaused", { index: this.idx });
    this.persistReplayState({ immediate: true });
    this.updateReplayChrome();
  },

  deleteAllDrawings() {
    if (!this.drawings.length) return;
    this.syncDrawingEngineFromLegacy();
    const ids = this.drawings.map((drawing) => drawing.id);
    this.drawingEngine?.deleteDrawings?.(ids);
    this.syncLegacyDrawingsFromEngine();
    this.selectedDrawingIds = [];
    this.saveDrawingStorage();
    this.scheduleDraw();
  },

  confirmDeleteAllDrawings() {
    const count = this.drawings.length;
    if (!count) return;
    const ok = confirm(`Delete All Drawings?\n\nThis will remove ${count} drawing${count === 1 ? "" : "s"}.\nThis action can be undone.`);
    if (!ok) return;
    this.deleteAllDrawings();
    toast("All drawings deleted.", "success");
  },

  updateReplayChrome() {
    this.syncOrderPrices();
    const c = this.candles[this.idx];
    const meta = MarketData.getMeta(this.symbol);
    const prev = this.candles[Math.max(0, this.idx - 1)] || c;
    const change = c && prev ? c.close - prev.close : 0;
    const changePct = prev ? (change / prev.close) * 100 : 0;
    UI?.updateStatusBar({
      statusMousePrice: c ? Fmt.price(c.close, meta.decimals) : "--",
      statusMouseTime: c ? Fmt.dateTime(c.date) : "--",
    });
    const currentSession = this.currentSessionStats();
    const statusSession = this.container?.querySelector("#statusSession");
    if (statusSession) statusSession.textContent = currentSession ? currentSession.shortName : "Off session";
    const price = this.container?.querySelector(".tv-price");
    const changeEl = this.container?.querySelector(".tv-change");
    const chip = this.container?.querySelector(".tv-datetime-chip");
    const hiddenEl = this.container?.querySelector("#replayHiddenCount");
    const bookmarkEl = this.container?.querySelector("#replayBookmarkCount");
    const playBtns = this.container?.querySelectorAll("#btnPlay, #chartReplayBtn, #replayJumpBtn, #fsBtnPlay");
    const scissorsBtn = this.container?.querySelector("#scissorsToolBtn");
    const liveBtn = this.container?.querySelector("#liveChartBtn");
    const latestBtn = this.container?.querySelector("#goLatestBtn");
    if (price && c) price.textContent = Fmt.price(c.close, meta.decimals);
    if (changeEl && c) changeEl.textContent = `${change >= 0 ? "+" : ""}${Fmt.price(change, meta.decimals)} (${changePct.toFixed(2)}%)`;
    if (chip && c) chip.textContent = this.axisDateTimeLabel(c.date);
    if (hiddenEl) hiddenEl.textContent = this.hiddenCandles.length.toLocaleString();
    if (bookmarkEl) bookmarkEl.textContent = this.replayBookmarks.length.toLocaleString();
    const progress = this.container?.querySelector("#replayProgress");
    const progressLabel = this.container?.querySelector("#replayProgressLabel");
    if (progress) progress.value = String(this.idx);
    if (progressLabel) {
      const max = Math.max(1, this.candles.length - 1);
      progressLabel.textContent = `${Math.round((this.idx / max) * 100)}%`;
    }
    const replayHead = this.container?.querySelector("#replayStateLabel");
    if (replayHead) replayHead.textContent = this.replayStateText();
    scissorsBtn?.classList.toggle("active", this.tool === "scissors");
    liveBtn?.classList.toggle("active", !this.replayActive && this.tool !== "scissors");
    latestBtn?.classList.toggle("active", this.autoFollow);
    playBtns?.forEach((btn) => {
      if (btn.id === "replayJumpBtn") btn.textContent = this.playing ? "Pause Replay" : this.tool === "scissors" ? "Select Candle" : this.replayActive ? "Start Replay" : "Bar Replay";
      else if (btn.id === "fsBtnPlay") btn.textContent = this.playing ? "Pause" : "Play";
      else btn.textContent = this.playing ? "Pause" : btn.id === "btnPlay" ? "Play" : "Replay";
      btn.classList.toggle("playing", this.playing);
      btn.classList.toggle("active", this.playing || this.tool === "scissors");
    });
    const fsDock = this.container?.querySelector("#fullscreenReplayDock");
    if (fsDock) {
      const hiddenCount = this.replayActive ? this.hiddenCandles.length : Math.max(0, this.candles.length - this.idx - 1);
      const progressMax = Math.max(0, this.candles.length - 1);
      const progressPct = progressMax > 0 ? Math.round((this.idx / progressMax) * 100) : 0;
      const state = fsDock.querySelector(".tv-fullscreen-replay-state");
      const meta = fsDock.querySelector(".tv-fullscreen-replay-meta");
      const speed = fsDock.querySelector("#fsReplaySpeed");
      if (state) state.textContent = `${this.playing ? "Replay running" : this.replayActive ? "Replay ready" : "Live mode"}${currentSession ? ` · ${currentSession.shortName}` : ""}`;
      if (meta) meta.textContent = `${progressPct}% · Hidden ${hiddenCount.toLocaleString()}`;
      if (speed && document.activeElement !== speed) speed.value = String(this.speed);
    }
  },

  // Button-triggered zoom (no mouse anchor available) — zooms around the
  // current viewport center, animated via zoomAroundAnchor.
  zoomX(direction) {
    const { start, end } = this.chartWindow();
    const center = (start + end) / 2;
    this.zoomAroundAnchor(direction, center);
  },

  zoomY(direction) {
    const factor = direction === "in" ? 1.2 : 1 / 1.2;
    this.yZoom = Math.max(this.minYZoom, Math.min(this.maxYZoom, this.yZoom * factor));
    this.scheduleDraw();
  },

  resetReplay() {
    if (this.replayActive || this.tool === "scissors") {
      this.exitReplayToLive();
      return;
    }
    this.pushReplayUndo();
    this.stopPlay();
    this.revealAnim = null;
    this.replayActive = false;
    this.replayCutIndex = null;
    this.idx = this.crosshair?.index ?? Math.max(80, Math.min(this.visibleCount, this.candles.length - 1));
    this.syncReplayTimestamp();
    this.syncReplayBuffers();
    this.autoFollow = true;
    this.viewEnd = this.followViewEnd();
    this.yOffset = 0;
    this.syncMouseEngineCamera();
    this.tool = "scissors";
    API.updateSettings(this.replaySettingsPayload()).catch(() => {});
    this.emitReplayEvent("ReplayReset", { index: this.idx });
    this.saveReplayStorage();
    this.rerender();
    toast("Replay reset. Scissors active: click a candle to choose a new start.", "info");
  },

  async goToReplayEnd() {
    if (!window.SubscriptionSystem?.canAccessFeature("replay")) { window.SubscriptionSystem.requestUpgrade("replay"); return; }
    if (MarketData.isLocal(this.symbol)) {
      this.stopPlay();
      // Process each intervening candle so open positions cannot skip SL/TP.
      while (this.candles[this.idx]?.time < this.datasetInfo.last_timestamp && !this._historyError) {
        const previous = this.candles[this.idx]?.time;
        await this.step(Math.max(1, this.candles.length - 1 - this.idx));
        if (this.candles[this.idx]?.time === previous) break;
      }
      return;
    }
    this.pushReplayUndo();
    if (!this.replayActive) this.beginReplayFrom(this.crosshair?.index ?? this.idx);
    this.revealAnim = null;
    this.idx = this.candles.length - 1;
    this.syncReplayTimestamp();
    this.syncReplayBuffers();
    if (this.autoFollow) { this.viewEnd = this.followViewEnd(); this.syncMouseEngineCamera(); }
    await this.evaluateCandle();
    await API.updateSettings(this.replaySettingsPayload());
    this.updateReplayChrome();
    this.emitReplayEvent("ReplayFinished", { index: this.idx });
    this.saveReplayStorage();
    this.scheduleDraw();
  },

  goToReplayStart() {
    if (!window.SubscriptionSystem?.canAccessFeature("replay")) { window.SubscriptionSystem.requestUpgrade("replay"); return; }
    this.pushReplayUndo();
    const cut = this.replayCutIndex ?? this.crosshair?.index ?? Math.max(0, this.idx);
    this.stopPlay();
    this.revealAnim = null;
    this.replayActive = true;
    this.idx = Math.max(0, Math.min(this.candles.length - 1, cut));
    this.replayCutIndex = this.idx;
    this.syncReplayTimestamp();
    this.syncReplayBuffers();
    if (this.autoFollow) { this.viewEnd = this.followViewEnd(); this.syncMouseEngineCamera(); }
    API.updateSettings(this.replaySettingsPayload()).catch(() => {});
    this.updateReplayChrome();
    this.emitReplayEvent("ReplayJumped", { index: this.idx, source: "start" });
    this.saveReplayStorage();
    this.scheduleDraw();
  },

  exitReplayToLive() {
    this.pushReplayUndo();
    this.stopPlay();
    this.replayActive = false;
    this.replayCutIndex = null;
    this.visibleCandles = { length: this.candles.length };
    this.hiddenCandles = { length: 0 };
    this.tool = "crosshair";
    this.crosshair = null;
    this.idx = Math.max(0, this.candles.length - 1);
    this.replayTimestamp = null;
    this.syncReplayBuffers();
    this.autoFollow = true;
    this.viewEnd = this.followViewEnd();
    this.syncMouseEngineCamera();
    this.emitReplayEvent("ReplayStopped", { index: this.idx });
    this.persistReplayState({ immediate: true });
    this.rerender();
    toast("Live chart restored. All candles visible.", "success");
  },

  async evaluateCandle() {
    if (this._evaluatingCandle || ![...Store.state.active_trades, ...(Store.state.pending_orders || [])].some(t => t.symbol === this.symbol)) return;
    const c = this.candles[this.idx];
    if (!c) return;
    const accountScope = this._chartAccountScope;
    this._evaluatingCandle = true;
    try {
      const result = await API.updateFloating({ [this.symbol]: { ...c, closed_time: c.time + this.candleDuration() } });
      if (accountScope !== this._chartAccountScope) return;
      if (result.closed?.length) {
        result.closed.forEach((t) => toast(`${t.symbol} closed ${t.reason}: ${Fmt.money(t.pnl)}`, t.pnl > 0 ? "success" : "error"));
        if (typeof UI !== "undefined" && UI.getSetting?.("autoPauseOnTrade")) this.stopPlay();
      }
      await Store.refresh({fresh:true});
      const propResult = window.PropFirmSession?.onMarketCandle?.(c.time + this.candleDuration(), Store.state);
      if (propResult?.failed && propResult.liquidate?.length) {
        const meta = MarketData.getMeta(this.symbol);
        await Promise.all(propResult.liquidate.map((trade) => API.closeTrade({
          id: trade.id,
          exit: c[trade.type === "BUY" ? "bid" : "ask"]?.close ?? c.close,
          reason: "PROP_RULE_BREACH",
          closed_at: new Date(c.time + this.candleDuration()).toISOString(),
        })));
        await Store.refresh({fresh:true});
        toast(`Practice round failed: ${propResult.reason || "a loss limit was breached"}. Positions on ${meta.name || this.symbol} were closed.`, "error");
      }
    } finally {
      if (accountScope === this._chartAccountScope) this._evaluatingCandle = false;
    }
  },

  previewOrder(type) {
    const candle = this.candles[this.idx];
    if (!candle || this._placingOrder || (MarketData.isLocal(this.symbol) && (this.dataSource !== 'local-csv' || this._historyError))) return;
    this.stopPlay();
    if (typeof UI !== "undefined" && !UI.getSetting?.("confirmBeforeOrder")) {
      this.placeTrade(type);
      return;
    }
    const entry = Number(this.orderPrice(type, candle));
    const pip = MarketData.getMeta(this.symbol).pip;
    const direction = type === 'BUY' ? 1 : -1;
    this.orderDraft = { type, symbol: this.symbol, timeframe: this.timeframe, time: candle.time,
      orderTab: this.orderTab, entry, lots: this.lots,
      sl: entry - direction * Math.max(1, this.slPips) * pip,
      tp: entry + direction * Math.max(1, this.tpPips) * pip, error: '', saving: false };
    // Every backtest preview starts with visible, editable protection levels.
    // The order ticket inputs remain available for exact numeric adjustments.
    this.slEnabled = true;
    this.tpEnabled = true;
    this.rerender();
    this.container?.querySelector('.tv-order-draft')?.scrollIntoView({ block: 'nearest' });
  },

  playBarCloseSound() {
    if (typeof UI === "undefined" || !UI.getSetting?.("soundOnBarClose")) return;
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) return;
      this._barAudio ||= new Audio();
      if (this._barAudio.state === "suspended") this._barAudio.resume().catch(() => {});
      const oscillator = this._barAudio.createOscillator();
      const gain = this._barAudio.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = 680;
      gain.gain.setValueAtTime(0.035, this._barAudio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this._barAudio.currentTime + 0.07);
      oscillator.connect(gain); gain.connect(this._barAudio.destination);
      oscillator.start(); oscillator.stop(this._barAudio.currentTime + 0.07);
    } catch (_) { /* Audio is optional and may be blocked by the browser. */ }
  },

  renderOrderDraft(meta) {
    const draft = this.orderDraft;
    if (!draft) return '';
    const risk = draft.sl == null ? null : Math.abs(draft.entry - draft.sl);
    const reward = draft.tp == null ? null : Math.abs(draft.tp - draft.entry);
    return `<section class="tv-order-draft" aria-label="Order preview">
      <b>${draft.type} ${draft.lots} lots · Preview</b>
      <div class="order-info-row"><span>Entry</span><b>${Fmt.price(draft.entry, meta.decimals)}</b></div>
      ${['sl', 'tp'].map(key => `<label class="field-row"><span>${key === 'sl' ? 'Stop Loss' : 'Take Profit'} price</span><input type="number" step="any" data-draft-price="${key}" value="${draft[key] ?? ''}" placeholder="Not set"></label>`).join('')}
      <div class="order-info-row"><span>Risk / Reward</span><b id="draftRiskReward">${risk > 0 && reward != null ? `1 : ${(reward / risk).toFixed(2)}` : '—'}</b></div>
      <p role="alert">${draft.error || 'Replay is paused. Confirm to submit at this candle.'}</p>
      <button type="button" class="${draft.type === 'BUY' ? 'bt-buy-btn' : 'bt-sell-btn'}" id="confirmOrderDraft" ${this._placingOrder ? 'disabled' : ''}>Confirm ${draft.type} ${draft.lots} lots</button>
      <button type="button" class="bt-close-btn" id="cancelOrderDraft">Cancel</button>
    </section>`;
  },

  async confirmOrderDraft() {
    const draft = this.orderDraft;
    if (!draft || this._placingOrder) return;
    const sameContext = draft.symbol === this.symbol && draft.timeframe === this.timeframe && draft.time === this.candles[this.idx]?.time && draft.orderTab === this.orderTab && draft.entry === Number(this.orderPrice(draft.type));
    const direction = draft.type === 'BUY' ? 1 : -1;
    const valid = Number.isFinite(draft.entry) && draft.entry > 0 && Number.isFinite(draft.lots) && draft.lots > 0 &&
      (draft.sl == null || (Number.isFinite(draft.sl) && draft.sl > 0 && direction * (draft.entry - draft.sl) > 0)) &&
      (draft.tp == null || (Number.isFinite(draft.tp) && draft.tp > 0 && direction * (draft.tp - draft.entry) > 0));
    if (!sameContext || !valid) {
      draft.error = !sameContext ? 'Chart time or order entry changed. Cancel and preview again.' : 'SL and TP must be on the correct sides of entry; prices and lots must be positive.';
      this.rerender();
      return;
    }
    draft.saving = true;
    await this.placeTrade(draft.type, draft);
    if (this.orderDraft === draft) {
      draft.saving = false;
      this.rerender();
    }
  },

  async placeTrade(type, draft = null) {
    if (this._placingOrder) return;
    if (MarketData.isLocal(this.symbol) && (this.dataSource !== "local-csv" || this._historyError)) return;
    const c = this.candles[this.idx];
    if (!c) return;
    const practiceCheck = window.PropFirmSession?.canTradeAt?.(c.time + this.candleDuration(), this.symbol);
    if (practiceCheck && !practiceCheck.ok) { toast(practiceCheck.message, "error"); return; }
    if (practiceCheck?.attempt && this.orderTab !== "Market") { toast("Prop Firm Session scoring currently supports market orders from the replay chart. Switch the order type to Market.", "info"); return; }
    const meta = MarketData.getMeta(this.symbol);
    const requested = this.orderTab === "Market" ? null : Number(this.pendingPrice ?? c.close);
    if (this.orderTab !== "Market" && (!Number.isFinite(requested) || requested <= 0)) {
      toast("Enter a valid trigger price for the pending order.", "error");
      return;
    }
    const entry = requested ?? (c[type === "BUY" ? "ask" : "bid"]?.close ?? c.close);
    const sl = draft ? draft.sl : this.slEnabled ? (type === "BUY" ? entry - this.slPips * meta.pip : entry + this.slPips * meta.pip) : null;
    const tp = draft ? draft.tp : this.tpEnabled ? (type === "BUY" ? entry + this.tpPips * meta.pip : entry - this.tpPips * meta.pip) : null;
    const lots = draft ? draft.lots : this.lots;
    this._placingOrder = true;
    this.syncOrderPrices();
    try {
    let result;
    if (this.orderTab === "Market") {
      result = await API.openTrade({ symbol: this.symbol, type, entry, lots, sl, tp, opened_at: new Date(c.time + this.candleDuration()).toISOString() });
    } else {
      result = await API.createPendingOrder({ symbol: this.symbol, type, order_type: this.orderTab.toLowerCase(), entry, lots, sl, tp, created_at: new Date(c.time + this.candleDuration()).toISOString() });
    }
    if (result?.error) throw new Error(result.error);
    this.orderDraft = null;
    await Store.refresh({fresh:true});
    window.PropFirmSession?.onMarketCandle?.(c.time + this.candleDuration(), Store.state);
    toast(`${this.orderTab} ${type} ${this.lots} ${this.symbol} @ ${Fmt.price(entry, meta.decimals)}`, "success");
    } catch (error) {
      if (draft) draft.error = 'Order could not be placed. Please retry.';
      toast(error.message || "Order could not be placed.", "error");
    } finally {
      this._placingOrder = false;
    }
    this.rerender();
  },

  orderPrice(type, candle = this.candles[this.idx]) {
    if (!candle) return null;
    return this.orderTab === "Market"
      ? candle[type === "BUY" ? "ask" : "bid"]?.close ?? candle.close
      : this.pendingPrice ?? candle.close;
  },

  syncOrderPrices() {
    const candle = this.candles[this.idx];
    const ready = !!candle && (!MarketData.isLocal(this.symbol) || (this.dataSource === "local-csv" && !this._historyError));
    const decimals = MarketData.getMeta(this.symbol).decimals;
    ["BUY", "SELL"].forEach((side) => {
      const button = this.container?.querySelector(side === "BUY" ? "#btnBuy" : "#btnSell");
      if (!button) return;
      button.disabled = !ready || !!this._placingOrder;
      const price = button.querySelector(".bt-px-value");
      if (price) price.textContent = ready ? Fmt.price(this.orderPrice(side, candle), decimals) : "--";
    });
    const time = this.container?.querySelector(".tv-order-card .tv-panel-head span");
    if (time) time.textContent = candle ? Fmt.dateTime(candle.date) : "";
    const trades = Store.state.active_trades.filter(t => t.symbol === this.symbol);
    const body = this.container?.querySelector(".bt-tabs-body");
    if (body) body.innerHTML = this.bottomTab === "open" ? this.renderOpenTable(trades) : this.renderClosedTable(Store.state.history.filter(t => t.symbol === this.symbol));
    const openTab = this.container?.querySelector('[data-bottomtab="open"]');
    if (openTab) openTab.textContent = `Open (${trades.length})`;
    const closedTab = this.container?.querySelector('[data-bottomtab="closed"]');
    if (closedTab) closedTab.textContent = `Closed (${Store.state.history.filter(t => t.symbol === this.symbol).length})`;
  },

  async closeActive() {
    const trade = Store.state.active_trades.find((t) => t.symbol === this.symbol);
    const c = this.candles[this.idx];
    if (!trade || !c) return;
    await API.closeTrade({ id: trade.id, exit: c[trade.type === "BUY" ? "bid" : "ask"]?.close ?? c.close, reason: "MANUAL", closed_at: new Date(c.time + this.candleDuration()).toISOString() });
    await Store.refresh({fresh:true});
    toast("Position closed", "info");
    this.rerender();
  },

  async closeAllPositions() {
    const c = this.candles[this.idx];
    const trades = Store.state.active_trades.filter((t) => t.symbol === this.symbol);
    if (!c || !trades.length) return;
    await Promise.all(trades.map((trade) => API.closeTrade({ id: trade.id, exit: c[trade.type === "BUY" ? "bid" : "ask"]?.close ?? c.close, reason: "MANUAL_CLOSE_ALL", closed_at: new Date(c.time + this.candleDuration()).toISOString() })));
    await Store.refresh({fresh:true});
    toast(`${trades.length} position${trades.length === 1 ? "" : "s"} closed`, "info");
    this.rerender();
  },

  rerender() {
    if (!this.container) return;
    const oldShell = this.container.querySelector(".tv-shell");
    const wasFullscreen = oldShell?.classList.contains("fullscreen-mode") || false;
    this.container.innerHTML = this.render();
    this.afterRender(this.container);
    if (wasFullscreen) {
      const shell = this.container.querySelector(".tv-shell");
      const workspace = this.container.querySelector(".tv-workspace");
      shell?.classList.add("fullscreen-mode", "fullscreen-chart");
      const fullscreenButton = shell?.querySelector("#fullscreenBtn");
      if (fullscreenButton) { fullscreenButton.textContent = "⛶ Exit fullscreen"; fullscreenButton.setAttribute("aria-pressed", "true"); }
      if (workspace) workspace.style.gridTemplateColumns = "48px minmax(0,1fr) 320px";
      requestAnimationFrame(() => this.drawChart());
    }
  },

  cleanup() {
    if (!this._initialized) return;
    this.stopPlay();
    clearTimeout(this._persistReplayTimer);
    clearTimeout(this._flashTimer);
    this._persistReplayTimer = null;
    if (this._drawRaf) cancelAnimationFrame(this._drawRaf);
    if (this.zoomAnim?.raf) cancelAnimationFrame(this.zoomAnim.raf);
    this._historyRequest = (this._historyRequest || 0) + 1;
    if (this._drawingPanelClickHandler) this._drawingPanelClickContainer?.removeEventListener('click', this._drawingPanelClickHandler);
    this.drawingEngine?.cancelSelectionDrag?.();
    this.drawingEngine?.toolController?.cancel?.({ silent: true });
    this.pendingDrawing = null;
    this.drawingDrag = null;
    if (this._keyHandler) document.removeEventListener("keydown", this._keyHandler);
    if (this._keyUpHandler) document.removeEventListener("keyup", this._keyUpHandler);
    if (this._winResizeHandler) {
      window.removeEventListener("resize", this._winResizeHandler);
      window.removeEventListener("tfb:chart-resize", this._winResizeHandler);
    }
    if (this._chartContextActionHandler) window.removeEventListener("ui:context-action", this._chartContextActionHandler);
    if (this.mouseEngine?.raf) cancelAnimationFrame(this.mouseEngine.raf);
    if (this.inertia?.raf) cancelAnimationFrame(this.inertia.raf);
    this._resizeObserver?.disconnect();
    if (this._interactionRaf) cancelAnimationFrame(this._interactionRaf);
    this._interactionRaf = null;
    if (this._drawingRaf) cancelAnimationFrame(this._drawingRaf);
    this._drawingRaf = null;
  },
};

window.PageBacktesting = PageBacktesting;

