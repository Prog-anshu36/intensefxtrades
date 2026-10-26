/* workspace_engine.js - Phase 8 desktop workspace layer.
   Browser-based workstation features only; does not alter chart, replay,
   drawing, trading, analytics, or backend calculations. */

const WorkspaceEngine = (() => {
  const KEY = "tfb_desktop_workspaces_v1";
  const ACTIVE_KEY = "tfb_desktop_active_workspace_v1";
  const RECOVERY_KEY = "tfb_desktop_recovery_v1";
  const CLOSED_TABS_KEY = "tfb_desktop_closed_tabs_v1";
  const PREF_KEY = "tfb_desktop_prefs_v1";

  const DEFAULT_WORKSPACES = [
    ["backtesting", "Backtesting", "backtesting"],
    ["scalping", "Scalping", "backtesting"],
    ["day-trading", "Day Trading", "dashboard"],
    ["analysis", "Analysis", "performance"],
    ["journal-review", "Journal Review", "journal"],
  ];

  const state = {
    workspaces: {},
    activeId: "backtesting",
    commandOpen: false,
    pageBackStack: [],
    notificationSettings: { enabled: true, journalMissing: true, tradeClosed: true },
    dragWindow: null,
    resizeWindow: null,
  };

  function isTextField(target) {
    const tag = (target?.tagName || "").toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select" || target?.isContentEditable;
  }

  function chartPage() {
    return typeof PageBacktesting !== "undefined" ? PageBacktesting : null;
  }

  function workspaceStorage() {
    return window.ChartAccountState?.storageForCurrent() || localStorage;
  }

  function safeJsonGet(key, fallback) {
    try { return JSON.parse(workspaceStorage().getItem(key) || JSON.stringify(fallback)); }
    catch { return fallback; }
  }

  function save() {
    workspaceStorage().setItem(KEY, JSON.stringify(state.workspaces));
    workspaceStorage().setItem(ACTIVE_KEY, state.activeId);
    autosaveRecovery();
  }

  function defaultWorkspace(id, name, page) {
    return {
      id,
      name,
      activePage: page,
      layout: { sidebarCollapsed: false, density: "comfortable", focusMode: false, chartOnly: false },
      panels: {
        sidebar: { visible: true, dock: "left", size: 248 },
        main: { visible: true, dock: "center" },
        watchlist: { visible: true, dock: "right", size: 300 },
        tradePanel: { visible: true, dock: "right", size: 300 },
        journal: { visible: true, dock: "floating", rect: { x: 96, y: 96, w: 520, h: 520 }, minimized: false },
        analytics: { visible: true, dock: "floating", rect: { x: 140, y: 120, w: 620, h: 520 }, minimized: false },
        ai: { visible: false, dock: "floating", rect: { x: 180, y: 150, w: 560, h: 520 }, minimized: false },
      },
      tabs: [{ id: `${id}-main`, title: name, page }],
      activeTabId: `${id}-main`,
      chart: { symbol: null, timeframe: null, visibleCount: null, viewEnd: null, yZoom: null, replayTimestamp: null },
      sync: { symbol: true, time: true, crosshair: false, replay: true, drawings: true, timeframe: false },
      watchlists: [{ id: "default", name: "Default", symbols: ["GOLD", "SILVER", "XAUUSD", "EURUSD", "GBPUSD", "USDJPY", "BTCUSD", "ETHUSD"] }],
      settings: {},
      updatedAt: Date.now(),
    };
  }

  function initState() {
    try { workspaceStorage().removeItem('tfb_broker_connections_v1'); } catch {}
    state.workspaces = safeJsonGet(KEY, {});
    if (!Object.keys(state.workspaces).length) {
      DEFAULT_WORKSPACES.forEach(([id, name, page]) => { state.workspaces[id] = defaultWorkspace(id, name, page); });
    }
    state.activeId = workspaceStorage().getItem(ACTIVE_KEY) || "backtesting";
    if (!state.workspaces[state.activeId]) state.activeId = Object.keys(state.workspaces)[0] || "backtesting";
    state.notificationSettings = { ...state.notificationSettings, ...safeJsonGet(PREF_KEY, {}).notificationSettings };
  }

  function active() {
    return state.workspaces[state.activeId] || state.workspaces.backtesting;
  }

  function syncRoute(page) {
    const ws = active();
    if (!ws || !page) return;
    ws.activePage = page;
    const activeTab = (ws.tabs || []).find((tab) => tab.id === ws.activeTabId);
    if (activeTab) {
      activeTab.page = page;
      const pageTitles = {
        performance: "Performance",
        "trade-analysis": "Trade Analysis",
        "ai-coach": "AI Coach",
        backtesting: "Backtesting",
        tradingview: "TradingView",
      };
      activeTab.title = pageTitles[page] || (page.charAt(0).toUpperCase() + page.slice(1));
    }
    ws.updatedAt = Date.now();
    save();
    renderTabs();
  }

  function capture() {
    const ws = active();
    const sidebar = document.getElementById("sidebar");
    const chart = chartPage();
    ws.activePage = window.Router?.current || ws.activePage;
    if (window.Router?.current) syncRoute(window.Router.current);
    ws.layout.sidebarCollapsed = !!sidebar?.classList.contains("collapsed");
    ws.layout.focusMode = document.body.classList.contains("desktop-focus-mode");
    ws.layout.chartOnly = document.body.classList.contains("desktop-chart-only");
    ws.layout.density = document.body.dataset.density || ws.layout.density || "comfortable";
    if (chart?._initialized) {
      ws.chart = {
        symbol: chart.symbol,
        timeframe: chart.timeframe,
        visibleCount: chart.visibleCount,
        viewEnd: chart.viewEnd,
        yZoom: chart.yZoom,
        replayTimestamp: chart.replayTimestamp,
        replayActive: chart.replayActive,
      };
    }
    document.querySelectorAll("[data-floating-panel]").forEach((el) => {
      const id = el.dataset.floatingPanel;
      ws.panels[id] = {
        ...(ws.panels[id] || {}),
        dock: "floating",
        visible: !el.classList.contains("closed"),
        minimized: el.classList.contains("minimized"),
        rect: {
          x: parseFloat(el.style.left) || el.offsetLeft,
          y: parseFloat(el.style.top) || el.offsetTop,
          w: parseFloat(el.style.width) || el.offsetWidth,
          h: parseFloat(el.style.height) || el.offsetHeight,
        },
      };
    });
    ws.updatedAt = Date.now();
    save();
  }

  function apply(ws = active()) {
    if (!ws) return;
    const supported = ['sidebar','main','watchlist','tradePanel','journal','analytics','ai'];
    ws.panels = Object.fromEntries(Object.entries(ws.panels || {}).filter(([id])=>supported.includes(id)));
    document.body.classList.toggle("desktop-focus-mode", !!ws.layout?.focusMode);
    document.body.classList.toggle("desktop-chart-only", !!ws.layout?.chartOnly);
    document.body.dataset.density = ws.layout?.density || "comfortable";
    document.getElementById("sidebar")?.classList.toggle("collapsed", !!ws.layout?.sidebarCollapsed);
    renderShell();
    renderTabs();
    renderDockedPanels();
    renderFloatingPanels();
    if (window.Router && ws.activePage && Router.current !== ws.activePage) Router.go(ws.activePage);
    if (chartPage()?._initialized && ws.chart) applyChartSnapshot(ws.chart);
    window.dispatchEvent(new Event("tfb:chart-resize"));
  }

  async function applyChartSnapshot(chartSnap) {
    const chart = chartPage();
    if (!chart || !chart._initialized) return;
    if (chartSnap.symbol && chartSnap.symbol !== chart.symbol && chart.switchSymbol) {
      await chart.switchSymbol(chartSnap.symbol);
    }
    if (chartSnap.timeframe && chartSnap.timeframe !== chart.timeframe) {
      const btn = document.querySelector(`[data-tf="${chartSnap.timeframe}"]`);
      btn?.click();
    }
    chart.visibleCount = chartSnap.visibleCount || chart.visibleCount;
    chart.viewEnd = chartSnap.viewEnd ?? chart.viewEnd;
    chart.yZoom = chartSnap.yZoom || chart.yZoom;
    chart.scheduleDraw?.();
  }

  function renderShell() {
    document.getElementById("desktopWorkspaceBar")?.remove();
  }

  function goPage(page) {
    if (!window.Router || !Router.pages?.[page]) return;
    if (Router.current && Router.current !== page) state.pageBackStack.push(Router.current);
    Router.go(page);
    active().activePage = page;
    save();
    renderShell();
  }

  function goBack() {
    const previous = state.pageBackStack.pop();
    if (previous && window.Router?.pages?.[previous]) {
      Router.go(previous);
      active().activePage = previous;
      save();
      renderShell();
      return;
    }
    if (Router?.current !== "backtesting") goPage("backtesting");
  }

  function renderTabs() {
    let tabs = document.getElementById("desktopTabs");
    if (!tabs) {
      tabs = document.createElement("div");
      tabs.id = "desktopTabs";
      tabs.className = "desktop-tabs";
      document.querySelector(".main-area")?.insertBefore(tabs, document.getElementById("pageContainer"));
    }
    const ws = active();
    tabs.innerHTML = `
      ${(ws.tabs || []).map((tab) => `<button class="desktop-tab ${tab.id === ws.activeTabId ? "active" : ""}" draggable="true" data-tab-id="${tab.id}">
        <span>${escapeHtml(tab.title)}</span><i data-close-tab="${tab.id}">x</i>
      </button>`).join("")}
      <button class="desktop-tab-add" id="desktopNewTabBtn">+</button>
    `;
  }

  function renderFloatingPanels() {
    document.querySelectorAll("[data-floating-panel]").forEach((el) => el.remove());
    const ws = active();
    Object.entries(ws.panels || {}).forEach(([id, panel]) => {
      if (panel.dock !== "floating" || panel.visible === false) return;
      createFloatingPanel(id, panel);
    });
  }

  function renderDockedPanels() {
    document.getElementById("desktopDockHost")?.remove();
    const ws = active();
    const docked = Object.entries(ws.panels || {}).filter(([, panel]) => panel.visible !== false && panel.dock && panel.dock !== "floating");
    if (!docked.length) return;
    const host = document.createElement("aside");
    host.id = "desktopDockHost";
    host.className = "desktop-dock-host";
    host.innerHTML = docked.map(([id]) => `
      <section class="desktop-dock-panel" data-dock-panel="${id}">
        <header>
          <b>${panelTitle(id)}</b>
          <div class="desktop-panel-actions">
            <button class="desktop-panel-action" data-float-panel="${id}" title="Float panel" aria-label="Float panel">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5H5v3M16 5h3v3M19 16v3h-3M5 16v3h3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <button class="desktop-panel-action desktop-panel-action-close" data-close-dock-panel="${id}" title="Close panel" aria-label="Close panel">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>
            </button>
          </div>
        </header>
        <div class="desktop-dock-body">${floatingContent(id)}</div>
      </section>
    `).join("");
    document.body.appendChild(host);
  }

  function createFloatingPanel(id, panel) {
    const rect = recoverRect(panel.rect || { x: 80, y: 80, w: 520, h: 420 });
    const el = document.createElement("section");
    el.className = `desktop-floating-panel ${panel.minimized ? "minimized" : ""}`;
    el.dataset.floatingPanel = id;
    el.style.left = `${rect.x}px`;
    el.style.top = `${rect.y}px`;
    el.style.width = `${rect.w}px`;
    el.style.height = `${rect.h}px`;
    el.innerHTML = `
      <header class="desktop-floating-head" data-drag-floating>
        <b>${panelTitle(id)}</b>
        <div class="desktop-panel-actions">
          <button class="desktop-panel-action" data-minimize-floating="${id}" title="Minimize panel" aria-label="Minimize panel">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 18h12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
          <button class="desktop-panel-action" data-maximize-floating="${id}" title="Maximize panel" aria-label="Maximize panel">
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>
          </button>
          <button class="desktop-panel-action desktop-panel-action-dock" data-dock-floating="${id}" title="Dock panel" aria-label="Dock panel">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6.5A1.5 1.5 0 016.5 5h11A1.5 1.5 0 0119 6.5v11a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 015 17.5zM15 5v14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
            <span>Dock</span>
          </button>
          <button class="desktop-panel-action desktop-panel-action-close" data-close-floating="${id}" title="Close panel" aria-label="Close panel">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>
          </button>
        </div>
      </header>
      <div class="desktop-floating-body">${floatingContent(id)}</div>
      <i class="desktop-floating-resize" data-resize-floating></i>
    `;
    document.body.appendChild(el);
  }

  function floatingContent(id) {
    if (id === "journal") return `<button class="btn btn-primary" data-open-page="journal">Open Journal</button><p>Keep journal review available while charting.</p>`;
    if (id === "analytics") return `<button class="btn btn-primary" data-open-page="performance">Open Analytics</button><p>Performance, risk, session, and psychology analytics.</p>`;
    if (id === "ai") return renderAiCoachPanel();
    if (id === "tradePanel") return `<button class="btn btn-primary" data-command="place-buy">Buy</button><button class="btn" data-command="place-sell">Sell</button>`;
    return `<p>${panelTitle(id)}</p>`;
  }

  function panelTitle(id) {
    return ({journal:"Journal",analytics:"Analytics",ai:"AI Coach",tradePanel:"Trade Manager",watchlist:"Watchlist"})[id] || id;
  }

  function renderAiCoachPanel() {
    if (typeof TradeAnalyticsEngine === "undefined") return `<p>AI Coach analytics unavailable.</p>`;
    const snap = TradeAnalyticsEngine.snapshot(Store.state);
    const top = snap.insights.slice(0, 4);
    return `
      <div class="desktop-ai-panel">
        <button class="btn btn-primary" data-open-page="ai-coach">Open AI Coach</button>
        <div class="desktop-ai-score">
          <span>Win rate</span><b>${snap.performance.winRate.toFixed(1)}%</b>
          <span>Expectancy</span><b class="${Fmt.cls(snap.performance.expectancy)}">${Fmt.money(snap.performance.expectancy)}</b>
        </div>
        ${top.map((i) => `<div class="desktop-ai-insight ${i.severity}"><b>${escapeHtml(i.title)}</b><span>${escapeHtml(i.body)}</span></div>`).join("") || `<p>Close trades and add journal notes to unlock coach insights.</p>`}
      </div>
    `;
  }

  function recoverRect(rect) {
    const margin = 24;
    const maxX = Math.max(margin, window.innerWidth - margin);
    const maxY = Math.max(margin, window.innerHeight - margin);
    return {
      x: Math.max(margin, Math.min(rect.x || margin, maxX - 160)),
      y: Math.max(margin, Math.min(rect.y || margin, maxY - 80)),
      w: Math.max(280, Math.min(rect.w || 520, window.innerWidth - margin * 2)),
      h: Math.max(160, Math.min(rect.h || 420, window.innerHeight - margin * 2)),
    };
  }

  function openWorkspaceMenu(anchor) {
    const items = [
      { label: "Save Workspace", action: "workspace-save" },
      { label: "Create Workspace", action: "workspace-create" },
      { label: "Duplicate Workspace", action: "workspace-duplicate" },
      { label: "Export Workspace", action: "workspace-export" },
      { label: "Import Workspace", action: "workspace-import" },
      "sep",
      { label: "Open AI Coach Panel", action: "panel-ai" },
      { label: "Open Journal Panel", action: "panel-journal" },
      { label: "Open Analytics Panel", action: "panel-analytics" },
      { label: "Dock AI Coach Right", action: "dock-ai" },
      "sep",
      { label: "Density: Compact", action: "density-compact" },
      { label: "Density: Comfortable", action: "density-comfortable" },
      { label: "Density: Spacious", action: "density-spacious" },
      "sep",
      ...Object.values(state.workspaces).map((ws) => ({ label: `Switch: ${ws.name}`, action: `workspace-switch:${ws.id}` })),
    ];
    UI?.showContextMenu(anchor.getBoundingClientRect().left, anchor.getBoundingClientRect().bottom + 4, items);
  }

  function commandList() {
    return [
      ["open-chart", "Open Chart", () => goPage("backtesting")],
      ["open-journal", "Open Journal", () => goPage("journal")],
      ["open-analytics", "Open Analytics", () => goPage("performance")],
      ["open-ai-coach", "Open AI Coach", () => goPage("ai-coach")],
      ["open-trades", "Open Trades", () => goPage("trades")],
      ["panel-ai", "Open AI Coach Panel", () => openPanel("ai")],
      ["panel-journal", "Open Journal Floating Panel", () => openPanel("journal")],
      ["panel-analytics", "Open Analytics Floating Panel", () => openPanel("analytics")],
      ["panel-trade", "Open Trade Manager Panel", () => openPanel("tradePanel")],
      ["dock-ai", "Dock AI Coach Right", () => dockPanel("ai")],
      ["dock-journal", "Dock Journal Right", () => dockPanel("journal")],
      ["dock-analytics", "Dock Analytics Right", () => dockPanel("analytics")],
      ["start-replay", "Start / Pause Replay", () => PageBacktesting?.togglePlay?.()],
      ["next-candle", "Next Candle", () => PageBacktesting?.step?.(1)],
      ["place-buy", "Place Buy", () => PageBacktesting?.placeTrade?.("BUY")],
      ["place-sell", "Place Sell", () => PageBacktesting?.placeTrade?.("SELL")],
      ["reset-chart", "Reset Chart", () => PageBacktesting?.resetChartView?.()],
      ["toggle-focus", "Toggle Focus Mode", () => toggleFocusMode()],
      ["chart-only", "Toggle Chart Only Mode", () => toggleChartOnly()],
      ["create-workspace", "Create Workspace", () => createWorkspace()],
      ["duplicate-workspace", "Duplicate Workspace", () => duplicateWorkspace()],
      ["import-workspace", "Import Workspace", () => importWorkspace()],
      ["restore-tab", "Restore Closed Tab", () => restoreClosedTab()],
      ["export-workspace", "Export Workspace", () => exportWorkspace()],
      ["density-compact", "Density Compact", () => setDensity("compact")],
      ["density-comfortable", "Density Comfortable", () => setDensity("comfortable")],
      ["density-spacious", "Density Spacious", () => setDensity("spacious")],
      ["settings", "Open Settings", () => UI?.openModal?.("settingsModal")],
    ];
  }

  function openPanel(id) {
    const ws = active();
    const defaults = defaultWorkspace(ws.id, ws.name, ws.activePage).panels;
    ws.panels[id] = {
      ...(defaults[id] || { dock: "floating", rect: { x: 120, y: 120, w: 520, h: 420 } }),
      ...(ws.panels[id] || {}),
      dock: "floating",
      visible: true,
      minimized: false,
    };
    save();
    renderDockedPanels();
    renderFloatingPanels();
  }

  function dockPanel(id, dock = "right") {
    const ws = active();
    const defaults = defaultWorkspace(ws.id, ws.name, ws.activePage).panels;
    ws.panels[id] = {
      ...(defaults[id] || { rect: { x: 120, y: 120, w: 520, h: 420 } }),
      ...(ws.panels[id] || {}),
      dock,
      visible: true,
      minimized: false,
    };
    save();
    renderFloatingPanels();
    renderDockedPanels();
    window.dispatchEvent(new Event("tfb:chart-resize"));
  }

  function openCommandPalette() {
    closeCommandPalette();
    state.commandOpen = true;
    const el = document.createElement("div");
    el.id = "desktopCommandPalette";
    el.className = "desktop-command-backdrop";
    el.innerHTML = `
      <div class="desktop-command">
        <input id="desktopCommandInput" type="text" placeholder="Type a command, symbol, trade, journal note, or workspace...">
        <div id="desktopCommandResults"></div>
      </div>
    `;
    document.body.appendChild(el);
    const input = el.querySelector("#desktopCommandInput");
    const results = el.querySelector("#desktopCommandResults");
    const render = () => {
      const q = input.value.toLowerCase().trim();
      const commands = commandList().filter(([, label]) => !q || label.toLowerCase().includes(q));
      const workspaces = Object.values(state.workspaces)
        .filter((ws) => !q || ws.name.toLowerCase().includes(q))
        .map((ws) => [`workspace:${ws.id}`, `Workspace: ${ws.name}`, () => switchWorkspace(ws.id)]);
      const trades = q && typeof TradeAnalyticsEngine !== "undefined" ? TradeAnalyticsEngine.search(q).slice(0, 8).map((t) => [`trade:${t.id}`, `Trade #${t.id} ${t.symbol} ${Fmt.money(t.pnl)}`, () => goPage("trade-analysis")]) : [];
      const rows = [...commands, ...workspaces, ...trades].slice(0, 14);
      results.innerHTML = rows.map(([id, label]) => `<button data-command-id="${id}">${escapeHtml(label)}</button>`).join("") || `<div class="desktop-command-empty">No results</div>`;
      results.querySelectorAll("[data-command-id]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const row = rows.find(([id]) => id === btn.dataset.commandId);
          closeCommandPalette();
          row?.[2]?.();
        });
      });
    };
    input.addEventListener("input", render);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") results.querySelector("button")?.click();
      if (e.key === "Escape") closeCommandPalette();
    });
    el.addEventListener("click", (e) => { if (e.target === el) closeCommandPalette(); });
    render();
    requestAnimationFrame(() => input.focus());
  }

  function closeCommandPalette() {
    document.getElementById("desktopCommandPalette")?.remove();
    state.commandOpen = false;
  }

  function switchWorkspace(id) {
    if (!state.workspaces[id]) return;
    capture();
    state.activeId = id;
    workspaceStorage().setItem(ACTIVE_KEY, id);
    apply(active());
    notify(`Workspace switched to ${active().name}`, "success");
  }

  function createWorkspace() {
    const name = prompt("Workspace name", "Custom");
    if (!name) return;
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || `workspace-${Date.now()}`;
    state.workspaces[id] = { ...defaultWorkspace(id, name, Router?.current || "dashboard"), chart: { ...active().chart } };
    state.activeId = id;
    save();
    apply(active());
    notify(`Workspace ${name} created`, "success");
  }

  function duplicateWorkspace() {
    const source = active();
    const id = `${source.id}-copy-${Date.now()}`;
    state.workspaces[id] = structuredClone({ ...source, id, name: `${source.name} Copy`, updatedAt: Date.now() });
    state.activeId = id;
    save();
    apply(active());
    notify("Workspace duplicated", "success");
  }

  function exportWorkspace() {
    capture();
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      workspace: active(),
    };
    delete payload.workspace.settings?.credentials;
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `intensefxTRADES-workspace-${active().id}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    notify("Workspace exported", "success");
  }

  function importWorkspace() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text());
        const ws = parsed.workspace || parsed;
        if (!ws.id || !ws.name) throw new Error("Invalid workspace file");
        ws.id = `${ws.id}-import-${Date.now()}`;
        ws.name = `${ws.name} Import`;
        state.workspaces[ws.id] = ws;
        state.activeId = ws.id;
        save();
        apply(active());
        notify("Workspace imported", "success");
      } catch (err) {
        notify("Could not import workspace", "error");
      }
    });
    input.click();
  }

  function closeActiveTab() {
    const ws = active();
    if ((ws.tabs || []).length <= 1) return notify("Last tab cannot be closed", "warning");
    const closed = ws.tabs.find((t) => t.id === ws.activeTabId);
    ws.tabs = ws.tabs.filter((t) => t.id !== ws.activeTabId);
    ws.activeTabId = ws.tabs[0]?.id;
    ws.activePage = ws.tabs[0]?.page || ws.activePage;
    const closedTabs = safeJsonGet(CLOSED_TABS_KEY, []);
    closedTabs.unshift({ workspaceId: ws.id, tab: closed });
    workspaceStorage().setItem(CLOSED_TABS_KEY, JSON.stringify(closedTabs.slice(0, 20)));
    save();
    apply(ws);
  }

  function restoreClosedTab() {
    const closedTabs = safeJsonGet(CLOSED_TABS_KEY, []);
    const entry = closedTabs.shift();
    if (!entry) return notify("No closed tab to restore", "info");
    const ws = state.workspaces[entry.workspaceId] || active();
    ws.tabs = [...(ws.tabs || []), entry.tab];
    ws.activeTabId = entry.tab.id;
    ws.activePage = entry.tab.page;
    workspaceStorage().setItem(CLOSED_TABS_KEY, JSON.stringify(closedTabs));
    state.activeId = ws.id;
    save();
    apply(ws);
  }

  function addTab(page = Router?.current || "dashboard") {
    const ws = active();
    const tab = { id: `tab_${Date.now()}`, title: Router?.pages?.[page]?.title || page, page };
    ws.tabs = [...(ws.tabs || []), tab];
    ws.activeTabId = tab.id;
    ws.activePage = page;
    save();
    apply(ws);
  }

  function toggleFocusMode() {
    document.body.classList.toggle("desktop-focus-mode");
    active().layout.focusMode = document.body.classList.contains("desktop-focus-mode");
    save();
    window.dispatchEvent(new Event("tfb:chart-resize"));
  }

  function toggleChartOnly() {
    document.body.classList.toggle("desktop-chart-only");
    active().layout.chartOnly = document.body.classList.contains("desktop-chart-only");
    save();
    window.dispatchEvent(new Event("tfb:chart-resize"));
  }

  function setDensity(density) {
    document.body.dataset.density = density;
    active().layout.density = density;
    save();
  }

  function notify(message, kind = "info") {
    if (!state.notificationSettings.enabled) return;
    UI?.toast?.(message, kind);
    if (UI?.getSetting?.("desktopNotifications") && "Notification" in window && Notification.permission === "granted") {
      try { new Notification("intensefxTRADES", { body: String(message), tag: `tfb-${kind}` }); }
      catch (error) { console.warn("Desktop notification could not be shown", error); }
    }
    window.dispatchEvent(new CustomEvent("tfb:notification", { detail: { message, kind, at: Date.now() } }));
  }

  function autosaveRecovery() {
    const payload = { activeId: state.activeId, workspaces: state.workspaces, savedAt: Date.now(), pending: true };
    workspaceStorage().setItem(RECOVERY_KEY, JSON.stringify(payload));
  }

  function markCleanShutdown() {
    const payload = safeJsonGet(RECOVERY_KEY, null);
    if (!payload) return;
    payload.pending = false;
    payload.savedAt = Date.now();
    workspaceStorage().setItem(RECOVERY_KEY, JSON.stringify(payload));
  }

  function maybeShowRecoveryPrompt() {
    const recovery = safeJsonGet(RECOVERY_KEY, null);
    if (!recovery?.pending || !recovery?.savedAt || Date.now() - recovery.savedAt > 86400000) return;
    if (sessionStorage.getItem("tfb_recovery_checked")) return;
    sessionStorage.setItem("tfb_recovery_checked", "1");
    setTimeout(() => showRecoveryBanner(recovery), 600);
  }

  function showRecoveryBanner(recovery) {
    if (document.getElementById("desktopRecoveryBanner")) return;
    const banner = document.createElement("div");
    banner.id = "desktopRecoveryBanner";
    banner.className = "desktop-recovery-banner";
    banner.innerHTML = `
      <span>Previous workspace state is available.</span>
      <button data-recovery-restore>Restore</button>
      <button data-recovery-dismiss>Dismiss</button>
    `;
    document.body.appendChild(banner);
    banner.querySelector("[data-recovery-restore]")?.addEventListener("click", () => {
      state.workspaces = recovery.workspaces || state.workspaces;
      state.activeId = recovery.activeId || state.activeId;
      save();
      apply(active());
      banner.remove();
      notify("Workspace restored", "success");
    });
    banner.querySelector("[data-recovery-dismiss]")?.addEventListener("click", () => {
      markCleanShutdown();
      banner.remove();
    });
  }

  function handleContextAction(action) {
    if (action === "workspace-save") { capture(); notify("Workspace saved", "success"); }
    else if (action === "workspace-create") createWorkspace();
    else if (action === "workspace-duplicate") duplicateWorkspace();
    else if (action === "workspace-export") exportWorkspace();
    else if (action === "workspace-import") importWorkspace();
    else if (String(action).startsWith("workspace-switch:")) switchWorkspace(action.split(":")[1]);
    else if (String(action).startsWith("panel-")) openPanel(action.replace("panel-", ""));
    else if (String(action).startsWith("dock-")) dockPanel(action.replace("dock-", ""));
    else if (String(action).startsWith("density-")) setDensity(action.replace("density-", ""));
  }

  function bindEvents() {
    document.addEventListener("click", (e) => {
      if (e.target.closest("#desktopBackBtn")) goBack();
      if (e.target.closest("#desktopWorkspaceMenuBtn")) openWorkspaceMenu(e.target.closest("#desktopWorkspaceMenuBtn"));
      if (e.target.closest("#desktopFocusBtn")) toggleFocusMode();
      if (e.target.closest("#desktopCommandBtn")) openCommandPalette();
      if (e.target.closest(".search-box input")) {
        e.preventDefault();
        e.target.closest(".search-box input")?.blur();
        openCommandPalette();
      }
      if (e.target.closest("#desktopNewTabBtn")) addTab();
      const tab = e.target.closest("[data-tab-id]");
      if (tab && !e.target.closest("[data-close-tab]")) {
        const ws = active();
        const model = ws.tabs.find((t) => t.id === tab.dataset.tabId);
        if (model) { ws.activeTabId = model.id; ws.activePage = model.page; save(); apply(ws); }
      }
      const closeTab = e.target.closest("[data-close-tab]");
      if (closeTab) { e.stopPropagation(); active().activeTabId = closeTab.dataset.closeTab; closeActiveTab(); }
      const openPage = e.target.closest("[data-open-page]");
      if (openPage) goPage(openPage.dataset.openPage);
      const command = e.target.closest("[data-command]");
      if (command) commandList().find(([id]) => id === command.dataset.command)?.[2]?.();
      const closeFloating = e.target.closest("[data-close-floating]");
      if (closeFloating) {
        active().panels[closeFloating.dataset.closeFloating].visible = false;
        save();
        renderFloatingPanels();
      }
      const dockFloating = e.target.closest("[data-dock-floating]");
      if (dockFloating) dockPanel(dockFloating.dataset.dockFloating);
      const floatPanel = e.target.closest("[data-float-panel]");
      if (floatPanel) openPanel(floatPanel.dataset.floatPanel);
      const closeDockPanel = e.target.closest("[data-close-dock-panel]");
      if (closeDockPanel) {
        active().panels[closeDockPanel.dataset.closeDockPanel].visible = false;
        save();
        renderDockedPanels();
        window.dispatchEvent(new Event("tfb:chart-resize"));
      }
      const minFloating = e.target.closest("[data-minimize-floating]");
      if (minFloating) e.target.closest("[data-floating-panel]")?.classList.toggle("minimized");
      const maxFloating = e.target.closest("[data-maximize-floating]");
      if (maxFloating) e.target.closest("[data-floating-panel]")?.classList.toggle("maximized");
    });

    document.addEventListener("mousedown", (e) => {
      const panel = e.target.closest("[data-floating-panel]");
      if (!panel) return;
      panel.style.zIndex = String(1000 + Date.now() % 100000);
      if (e.target.closest("[data-drag-floating]")) {
        state.dragWindow = { panel, dx: e.clientX - panel.offsetLeft, dy: e.clientY - panel.offsetTop };
      }
      if (e.target.closest("[data-resize-floating]")) {
        state.resizeWindow = { panel, sx: e.clientX, sy: e.clientY, sw: panel.offsetWidth, sh: panel.offsetHeight };
      }
    });
    document.addEventListener("mousemove", (e) => {
      if (state.dragWindow) {
        const { panel, dx, dy } = state.dragWindow;
        panel.style.left = `${Math.max(8, Math.min(window.innerWidth - 80, e.clientX - dx))}px`;
        panel.style.top = `${Math.max(8, Math.min(window.innerHeight - 40, e.clientY - dy))}px`;
      }
      if (state.resizeWindow) {
        const { panel, sx, sy, sw, sh } = state.resizeWindow;
        panel.style.width = `${Math.max(280, sw + e.clientX - sx)}px`;
        panel.style.height = `${Math.max(160, sh + e.clientY - sy)}px`;
      }
    });
    document.addEventListener("mouseup", () => {
      if (state.dragWindow || state.resizeWindow) capture();
      state.dragWindow = null;
      state.resizeWindow = null;
    });

    document.addEventListener("keydown", (e) => {
      if (UI?.getSetting?.("keyboardShortcuts") === false) return;
      if (isTextField(e.target)) return;
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "k" || (e.shiftKey && e.key.toLowerCase() === "p"))) {
        e.preventDefault(); openCommandPalette(); return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "w") { e.preventDefault(); closeActiveTab(); return; }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "t") { e.preventDefault(); restoreClosedTab(); return; }
      if ((e.ctrlKey || e.metaKey) && ["1", "2", "3", "4"].includes(e.key)) {
        e.preventDefault();
        const page = { "1": "backtesting", "2": "journal", "3": "performance", "4": "dashboard" }[e.key];
        goPage(page);
      }
    });

    window.addEventListener("ui:context-action", (e) => handleContextAction(e.detail?.action));
    window.addEventListener("tfb:route-change", (e) => syncRoute(e.detail?.page));
    window.addEventListener("tfb:chart-account-change", () => {
      state.pageBackStack = [];
      state.dragWindow = null;
      state.resizeWindow = null;
      initState();
      document.getElementById("desktopRecoveryBanner")?.remove();
      if (typeof Router !== "undefined") syncRoute(Router.current);
      renderTabs();
    });
    window.addEventListener("beforeunload", () => { capture(); markCleanShutdown(); });
    window.addEventListener("tfb:ReplayFinished", () => notify("Replay finished", "info"));
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function init() {
    initState();
    renderShell();
    renderTabs();
    renderDockedPanels();
    bindEvents();
    maybeShowRecoveryPrompt();
    setInterval(capture, 10000);
  }

  document.addEventListener("DOMContentLoaded", init);

  return {
    active,
    syncRoute,
    capture,
    apply,
    switchWorkspace,
    createWorkspace,
    duplicateWorkspace,
    exportWorkspace,
    importWorkspace,
    openCommandPalette,
    notify,
    setDensity,
    toggleFocusMode,
    toggleChartOnly,
  };
})();
