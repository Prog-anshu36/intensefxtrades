/* ============================================================
   ui-enhance.js
   Phase 1 UI/UX layer: tooltips, toasts, context menu, modals,
   splash screen, resizable/collapsible panels, fullscreen chart,
   keyboard shortcuts help, and settings window.

   This file is purely presentational / UI-state. It never touches
   trading logic, replay logic, backend calls, or API contracts —
   it only reads DOM + Store.state for display purposes.
   ============================================================ */

const UI = (() => {

  /* ---------------- Toast (upgrades components.js toast()) ---------------- */
  const ICONS = {
    success: '<svg viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    error: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 9v4M12 17h.01" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/></svg>',
    warning: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 9v4M12 17h.01" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M10.3 3.9L1.8 18a1.6 1.6 0 001.4 2.4h17.6a1.6 1.6 0 001.4-2.4L13.7 3.9a1.6 1.6 0 00-2.8 1.6z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 11v5M12 8h.01" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/></svg>',
  };

  function toastHost() {
    let host = document.getElementById("toastHost");
    if (!host) {
      host = document.createElement("div");
      host.id = "toastHost";
      document.body.appendChild(host);
    }
    return host;
  }

  function showToast() { /* Button notifications are disabled. */ }
  // Override the legacy global toast() from components.js with the polished version.
  window.toast = showToast;

  /* ---------------- Tooltips (title + optional data-shortcut) ---------------- */
  function initTooltips() {
    let tipEl = null;
    let showTimer = null;

    function makeTip() {
      if (tipEl) return tipEl;
      tipEl = document.createElement("div");
      tipEl.className = "ui-tooltip";
      document.body.appendChild(tipEl);
      return tipEl;
    }

    document.addEventListener("mouseover", (e) => {
      const target = e.target.closest("[title]");
      if (!target || !target.getAttribute("title")) return;
      const label = target.getAttribute("title");
      // Suppress native tooltip, use our own.
      target.setAttribute("data-ui-title", label);
      target.removeAttribute("title");

      clearTimeout(showTimer);
      showTimer = setTimeout(() => {
        const tip = makeTip();
        const shortcut = target.getAttribute("data-shortcut");
        tip.innerHTML = shortcut
          ? `<div>${label}</div><div style="opacity:.55;font-size:10px;margin-top:2px;">Shortcut: ${shortcut}</div>`
          : label;
        const rect = target.getBoundingClientRect();
        tip.style.left = "0px";
        tip.style.top = "0px";
        tip.classList.add("visible");
        requestAnimationFrame(() => {
          const tw = tip.offsetWidth;
          let left = rect.left + rect.width / 2 - tw / 2;
          left = Math.max(6, Math.min(left, window.innerWidth - tw - 6));
          tip.style.left = `${left}px`;
          tip.style.top = `${rect.bottom + 8}px`;
        });
      }, 350);
    });

    document.addEventListener("mouseout", (e) => {
      const target = e.target.closest("[data-ui-title]");
      if (!target) return;
      clearTimeout(showTimer);
      if (tipEl) tipEl.classList.remove("visible");
      target.setAttribute("title", target.getAttribute("data-ui-title"));
    });
  }

  /* ---------------- Generic modal shell ---------------- */
  function openModal(id) {
    const backdrop = document.getElementById(id);
    if (backdrop) backdrop.classList.add("visible");
  }
  function closeModal(id) {
    const backdrop = document.getElementById(id);
    if (backdrop) backdrop.classList.remove("visible");
  }
  function initModals() {
    document.querySelectorAll(".ui-modal-backdrop").forEach((backdrop) => {
      backdrop.addEventListener("click", (e) => {
        if (e.target === backdrop) backdrop.classList.remove("visible");
      });
      backdrop.querySelectorAll(".ui-modal-close").forEach((btn) => {
        btn.addEventListener("click", () => backdrop.classList.remove("visible"));
      });
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        document.querySelectorAll(".ui-modal-backdrop.visible").forEach((b) => b.classList.remove("visible"));
        hideContextMenu();
      }
      // Focus trap: keep Tab cycling inside the topmost open modal.
      if (e.key === "Tab") {
        const open = document.querySelector(".ui-modal-backdrop.visible");
        if (!open) return;
        const focusables = open.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault(); last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault(); first.focus();
        }
      }
    });
  }

  /* ---------------- Settings tabs ---------------- */
  function initSettingsModal() {
    const modal = document.getElementById("settingsModal");
    if (!modal) return;
    modal.querySelectorAll(".ui-settings-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        modal.querySelectorAll(".ui-settings-tab").forEach((t) => t.classList.remove("active"));
        modal.querySelectorAll(".ui-settings-panel").forEach((p) => p.classList.remove("active"));
        tab.classList.add("active");
        modal.querySelector(`.ui-settings-panel[data-panel="${tab.dataset.tab}"]`)?.classList.add("active");
      });
    });
    modal.querySelectorAll(".ui-toggle").forEach((tg) => {
      tg.addEventListener("click", () => tg.classList.toggle("on"));
    });
  }

  /* ---------------- Keyboard shortcuts modal ---------------- */
  function initShortcuts() {
    document.addEventListener("keydown", (e) => {
      const tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (e.key === "?" || (e.shiftKey && e.key === "/")) {
        e.preventDefault();
        openModal("shortcutsModal");
      }
    });
  }

  /* ---------------- Right-click context menu ---------------- */
  let ctxMenuEl = null;
  function hideContextMenu() {
    if (ctxMenuEl) { ctxMenuEl.remove(); ctxMenuEl = null; }
  }
  function showContextMenu(x, y, items) {
    hideContextMenu();
    const menu = document.createElement("div");
    menu.className = "ui-context-menu";
    menu.innerHTML = items.map((item) => {
      if (item === "sep") return `<div class="ui-context-menu-sep"></div>`;
      return `<div class="ui-context-menu-item" data-action="${item.action}"><span>${item.label}</span>${item.kbd ? `<kbd>${item.kbd}</kbd>` : ""}</div>`;
    }).join("");
    document.body.appendChild(menu);
    ctxMenuEl = menu;

    const rect = menu.getBoundingClientRect();
    const left = Math.min(x, window.innerWidth - rect.width - 8);
    const top = Math.min(y, window.innerHeight - rect.height - 8);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    requestAnimationFrame(() => menu.classList.add("visible"));

    menu.querySelectorAll(".ui-context-menu-item").forEach((el) => {
      el.addEventListener("click", () => {
        const action = el.dataset.action;
        hideContextMenu();
        window.dispatchEvent(new CustomEvent("ui:context-action", { detail: { action } }));
      });
    });
  }
  function initContextMenu() {
    document.addEventListener("click", (e) => {
      if (ctxMenuEl && !ctxMenuEl.contains(e.target)) hideContextMenu();
    });
    document.addEventListener("contextmenu", (e) => {
      const chart = e.target.closest(".tv-chart-card, .tv-canvas");
      if (!chart) return;
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY, [
        { label: "Copy price", action: "chart-copy-price" },
        { label: "Copy time", action: "chart-copy-time" },
        "sep",
        { label: "Copy drawing", action: "chart-drawing-copy", kbd: "Ctrl+C" },
        { label: "Paste drawing", action: "chart-drawing-paste", kbd: "Ctrl+V" },
        { label: "Duplicate drawing", action: "chart-drawing-duplicate", kbd: "Ctrl+D" },
        { label: "Rename drawing", action: "chart-drawing-rename" },
        { label: "Group selected", action: "chart-drawing-group" },
        { label: "Save as template", action: "chart-drawing-save-template" },
        { label: "Delete drawing", action: "chart-drawing-delete", kbd: "Del" },
        { label: "Lock / unlock drawing", action: "chart-drawing-lock" },
        { label: "Hide / show drawing", action: "chart-drawing-hide" },
        { label: "Bring to front", action: "chart-drawing-front" },
        { label: "Send to back", action: "chart-drawing-back" },
        { label: "Delete all drawings", action: "chart-drawing-delete-all" },
        "sep",
        { label: "Replay from here", action: "chart-replay-from-here" },
        { label: "Add bookmark", action: "chart-add-bookmark" },
        { label: "Add horizontal line", action: "chart-add-horizontal-line" },
        { label: "Scissors replay reset", action: "chart-toggle-scissors", kbd: "Alt+S" },
        { label: "Go to live chart", action: "chart-go-live", kbd: "Home" },
        "sep",
        { label: "Reset zoom", action: "chart-reset-zoom", kbd: "Dbl click" },
        { label: "Fit content", action: "chart-fit-content" },
        { label: "Reset price scale", action: "chart-reset-price" },
        { label: "Reset time scale", action: "chart-reset-time" },
        { label: "Chart settings", action: "chart-settings" },
        "sep",
        { label: "Take screenshot", action: "screenshot", kbd: "S" },
        { label: "Fullscreen chart", action: "fullscreen", kbd: "F11" },
      ]);
    });
    window.addEventListener("ui:context-action", (e) => {
      const { action } = e.detail;
      if (String(action).startsWith("chart-")) return;
      if (String(action).startsWith("workspace-")) return;
      if (action === "fullscreen") toggleFullscreenChart();
      else if (action === "screenshot") takeChartScreenshot();
      else if (action === "reset-zoom") showToast("Zoom reset.", "info");
      else showToast(`${action.replace(/-/g, " ")} — coming soon.`, "info");
    });
  }

  /* ---------------- Fullscreen chart ---------------- */
  document.addEventListener("fullscreenchange", () => {
    // Look up the live chart, never an obsolete shell from a prior render.
    if (!document.fullscreenElement && document.querySelector(".tv-shell.fullscreen-mode")) {
      toggleFullscreenChart();
    }
  });
  function toggleFullscreenChart() {
    const shell = document.querySelector(".tv-shell");
    if (!shell) return;
    shell.classList.toggle("fullscreen-mode");
    shell.classList.toggle("fullscreen-chart");
    const entering = shell.classList.contains("fullscreen-mode");
    const button = shell.querySelector("#fullscreenBtn");
    if (button) {
      button.textContent = entering ? "⛶ Exit fullscreen" : "⛶ Full screen";
      button.setAttribute("aria-pressed", String(entering));
    }
    // Use browser fullscreen when available; retain the expanded layout if denied.
    if (entering && !document.fullscreenElement && document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else if (!entering && document.fullscreenElement === document.documentElement) {
      document.exitFullscreen?.().catch(() => {});
    }
    const workspace = shell.querySelector(".tv-workspace");
    if (workspace) {
      if (shell.classList.contains("fullscreen-mode")) {
        workspace.dataset.prevGrid = workspace.style.gridTemplateColumns || "";
        workspace.style.gridTemplateColumns = "48px minmax(0,1fr) 320px";
      } else {
        workspace.style.gridTemplateColumns = workspace.dataset.prevGrid || "";
        delete workspace.dataset.prevGrid;
      }
    }
    window.dispatchEvent(new Event("resize"));
    window.dispatchEvent(new Event("tfb:chart-resize"));
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event("resize"));
      window.dispatchEvent(new Event("tfb:chart-resize"));
      window.PageBacktesting?.drawChart?.();
    });
    showToast(shell.classList.contains("fullscreen-mode") ? "Fullscreen chart enabled. Press Esc or F11 to exit." : "Exited fullscreen.", "info");
  }
  function initFullscreenShortcut() {
    document.addEventListener("keydown", (e) => {
      if (e.key === "F11") {
        e.preventDefault();
        toggleFullscreenChart();
      }
      if (e.key === "Escape") {
        queueMicrotask(() => {
          if (!e.defaultPrevented && document.querySelector(".tv-shell.fullscreen-mode")) toggleFullscreenChart();
        });
      }
    });
  }
  /* ---------------- Screenshot (canvas capture, UI-only) ---------------- */
  function takeChartScreenshot() {
    const canvas = document.querySelector(".tv-canvas");
    if (!canvas || !canvas.toDataURL) {
      showToast("Nothing to capture yet.", "warning");
      return;
    }
    try {
      const link = document.createElement("a");
      link.download = `intensefxTRADES-chart-${Date.now()}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
      showToast("Screenshot saved.", "success");
    } catch (err) {
      showToast("Couldn't capture screenshot.", "error");
    }
  }

  /* ---------------- Resizable / collapsible workspace panels ---------------- */
  function initResizablePanels() {
    document.addEventListener("mousedown", (e) => {
      const handle = e.target.closest(".tv-resize-handle");
      if (!handle) return;
      e.preventDefault();
      const workspace = handle.closest(".tv-workspace");
      if (!workspace) return;
      const side = handle.dataset.side; // "left" or "right"
      handle.classList.add("dragging");
      document.body.style.userSelect = "none";

      function hasLeftRail() {
        return !!workspace.querySelector(".tv-left-rail");
      }
      function currentWidths() {
        const leftW = hasLeftRail() ? (workspace.style.getPropertyValue("--tv-left-w") || "44px") : "0px";
        const rightW = workspace.style.getPropertyValue("--tv-right-w") || "300px";
        return { leftW, rightW };
      }
      function applyWidths({ leftW, rightW }) {
        workspace.style.setProperty("--tv-left-w", leftW);
        workspace.style.setProperty("--tv-right-w", rightW);
        workspace.style.gridTemplateColumns = hasLeftRail()
          ? `${leftW} minmax(0,1fr) 5px ${rightW}`
          : `minmax(0,1fr) 5px ${rightW}`;
      }

      function onMove(ev) {
        const rect = workspace.getBoundingClientRect();
        const widths = currentWidths();
        if (side === "left" && hasLeftRail()) {
          const w = Math.max(44, Math.min(ev.clientX - rect.left, 340));
          applyWidths({ leftW: `${w}px`, rightW: widths.rightW });
        } else if (side === "right") {
          const w = Math.max(220, Math.min(rect.right - ev.clientX, 460));
          applyWidths({ leftW: widths.leftW, rightW: `${w}px` });
        }
      }
      function onUp() {
        handle.classList.remove("dragging");
        document.body.style.userSelect = "";
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      }
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });

    document.addEventListener("click", (e) => {
      const btn = e.target.closest(".tv-rail-collapse-btn, .tv-panel-collapse-btn");
      if (!btn) return;
      const workspace = btn.closest(".tv-workspace");
      if (!workspace) return;
      const rail = workspace.querySelector(".tv-left-rail");
      const panel = workspace.querySelector(".tv-right-panel");
      const hasRail = !!rail;
      const leftW = hasRail ? (workspace.style.getPropertyValue("--tv-left-w") || "44px") : "0px";
      const rightW = workspace.style.getPropertyValue("--tv-right-w") || "300px";

      if (btn.classList.contains("tv-rail-collapse-btn") && rail) {
        rail.classList.toggle("collapsed");
        const collapsed = rail.classList.contains("collapsed");
        btn.textContent = collapsed ? "›" : "‹";
        workspace.style.setProperty("--tv-left-w", collapsed ? "0px" : "44px");
        workspace.style.gridTemplateColumns = `${collapsed ? "0px" : "44px"} minmax(0,1fr) 5px ${rightW}`;
      } else if (panel) {
        panel.classList.toggle("collapsed");
        const collapsed = panel.classList.contains("collapsed");
        btn.textContent = collapsed ? "‹" : "›";
        workspace.style.setProperty("--tv-right-w", collapsed ? "0px" : "300px");
        workspace.style.gridTemplateColumns = hasRail
          ? `${leftW} minmax(0,1fr) 5px ${collapsed ? "0px" : "300px"}`
          : `minmax(0,1fr) 5px ${collapsed ? "0px" : "300px"}`;
      }
    });
  }

  /* ---------------- 4. Micro-interactions: ripple + animated counters ---------------- */
  function initRipple() {
    document.addEventListener("mousedown", (e) => {
      const el = e.target.closest("button, .nav-item, .tv-rail-btn, .tv-icon-action, .icon-btn");
      if (!el || el.disabled) return;
      el.classList.add("ui-ripple-host");
      const rect = el.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height);
      const ripple = document.createElement("span");
      ripple.className = "ui-ripple";
      ripple.style.width = ripple.style.height = `${size}px`;
      ripple.style.left = `${e.clientX - rect.left - size / 2}px`;
      ripple.style.top = `${e.clientY - rect.top - size / 2}px`;
      el.appendChild(ripple);
      setTimeout(() => ripple.remove(), 520);
    });
  }

  /* Animate a numeric text node from its current value to `to`, formatted with `fmt`. */
  function animateNumber(el, to, fmt = (v) => v.toFixed(2), duration = 450) {
    if (!el) return;
    const fromText = (el.textContent || "0").replace(/[^0-9.\-]/g, "");
    const from = parseFloat(fromText) || 0;
    if (from === to) { el.textContent = fmt(to); return; }
    const start = performance.now();
    el.classList.add("ui-anim-number");
    function tick(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = fmt(from + (to - from) * eased);
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  /* ---------------- 9. Theme customization ---------------- */
  const THEME_KEY = "tfb_theme_prefs_v1";
  const THEME_DEFAULTS = {
    accent: "#3d7fff", fontScale: 1, sidebarW: 248, compact: false,
    cardDensity: 1, radiusScale: 1, animScale: 1, chartBgOpacity: 1, gridOpacity: 1,
  };
  function loadThemePrefs() {
    try { return { ...THEME_DEFAULTS, ...JSON.parse(localStorage.getItem(THEME_KEY) || "{}") }; }
    catch { return { ...THEME_DEFAULTS }; }
  }
  function saveThemePrefs(prefs) {
    localStorage.setItem(THEME_KEY, JSON.stringify(prefs));
  }
  function applyThemePrefs(prefs) {
    const root = document.documentElement;
    root.style.setProperty("--user-accent", prefs.accent);
    root.style.setProperty("--user-font-scale", prefs.fontScale);
    root.style.setProperty("--user-sidebar-w", `${prefs.sidebarW}px`);
    root.style.setProperty("--user-card-density", prefs.cardDensity);
    root.style.setProperty("--user-radius-scale", prefs.radiusScale);
    root.style.setProperty("--user-anim-scale", prefs.animScale);
    root.style.setProperty("--user-chart-bg-opacity", prefs.chartBgOpacity);
    root.style.setProperty("--user-grid-opacity", prefs.gridOpacity);
    document.body.classList.toggle("compact-mode", !!prefs.compact);
  }
  function initThemeCustomization() {
    const prefs = loadThemePrefs();
    applyThemePrefs(prefs);

    const modal = document.getElementById("settingsModal");
    if (!modal) return;

    // Accent swatches
    const swatchHost = modal.querySelector("#accentSwatches");
    if (swatchHost) {
      swatchHost.querySelectorAll(".ui-color-swatch").forEach((sw) => {
        if (sw.dataset.color === prefs.accent) sw.classList.add("active");
        sw.addEventListener("click", () => {
          swatchHost.querySelectorAll(".ui-color-swatch").forEach((s) => s.classList.remove("active"));
          sw.classList.add("active");
          prefs.accent = sw.dataset.color;
          applyThemePrefs(prefs); saveThemePrefs(prefs);
        });
      });
    }

    const ranges = [
      ["fontScaleRange", "fontScale", (v) => `${Math.round(v * 100)}%`],
      ["sidebarWRange", "sidebarW", (v) => `${v}px`],
      ["cardDensityRange", "cardDensity", (v) => `${Math.round(v * 100)}%`],
      ["radiusScaleRange", "radiusScale", (v) => `${Math.round(v * 100)}%`],
      ["animScaleRange", "animScale", (v) => `${Math.round(v * 100)}%`],
      ["chartBgRange", "chartBgOpacity", (v) => `${Math.round(v * 100)}%`],
      ["gridOpacityRange", "gridOpacity", (v) => `${Math.round(v * 100)}%`],
    ];
    ranges.forEach(([id, key, fmt]) => {
      const input = modal.querySelector(`#${id}`);
      const label = modal.querySelector(`#${id}Val`);
      if (!input) return;
      input.value = prefs[key];
      if (label) label.textContent = fmt(prefs[key]);
      input.addEventListener("input", () => {
        prefs[key] = parseFloat(input.value);
        if (label) label.textContent = fmt(prefs[key]);
        applyThemePrefs(prefs); saveThemePrefs(prefs);
      });
    });

    const compactToggle = modal.querySelector("#compactModeToggle");
    if (compactToggle) {
      compactToggle.classList.toggle("on", prefs.compact);
      compactToggle.addEventListener("click", () => {
        prefs.compact = compactToggle.classList.contains("on");
        applyThemePrefs(prefs); saveThemePrefs(prefs);
      });
    }

    const resetBtn = modal.querySelector("#resetThemeBtn");
    if (resetBtn) resetBtn.addEventListener("click", () => {
      Object.assign(prefs, THEME_DEFAULTS);
      applyThemePrefs(prefs); saveThemePrefs(prefs);
      showToast("Appearance reset to defaults.", "info");
      openModal("settingsModal"); // keep open, just refresh visually via reload of controls
      closeModal("settingsModal"); openModal("settingsModal");
    });
  }

  /* ---------------- 3. Tool favorites & recently-used (left rail) ---------------- */
  const FAV_KEY = "tfb_fav_tools_v1";
  const RECENT_KEY = "tfb_recent_tools_v1";
  function getFavoriteTools() { try { return JSON.parse(localStorage.getItem(FAV_KEY) || "[]"); } catch { return []; } }
  function getRecentTools() { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); } catch { return []; } }
  function toggleFavoriteTool(tool) {
    let favs = getFavoriteTools();
    favs = favs.includes(tool) ? favs.filter((t) => t !== tool) : [...favs, tool];
    localStorage.setItem(FAV_KEY, JSON.stringify(favs));
    return favs;
  }
  function trackToolUse(tool) {
    let recent = getRecentTools().filter((t) => t !== tool);
    recent.unshift(tool);
    recent = recent.slice(0, 3);
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
  }
  function initToolFavorites() {
    document.addEventListener("click", (e) => {
      const star = e.target.closest(".tv-rail-fav-btn");
      if (!star) return;
      e.stopPropagation();
      const tool = star.dataset.favTool;
      toggleFavoriteTool(tool);
      if (window.PageBacktesting?.rerender) window.PageBacktesting.rerender();
    });
  }

  /* ---------------- 6. Status bar (lightweight, no full rerender) ---------------- */
  function updateStatusBar(partial) {
    Object.entries(partial).forEach(([id, val]) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    });
  }

  /* ---------------- 2. Workspace management ---------------- */
  const WS_KEY = "tfb_workspaces_v1";
  const WS_SESSION_KEY = "tfb_last_session_v1";
  function getWorkspaces() { try { return JSON.parse(localStorage.getItem(WS_KEY) || "{}"); } catch { return {}; } }
  function setWorkspaces(obj) { localStorage.setItem(WS_KEY, JSON.stringify(obj)); }

  function captureWorkspaceSnapshot() {
    const workspace = document.querySelector(".tv-workspace");
    const rail = document.querySelector(".tv-left-rail");
    const panel = document.querySelector(".tv-right-panel");
    return {
      symbol: window.PageBacktesting?.symbol || null,
      timeframe: window.PageBacktesting?.timeframe || null,
      leftW: rail ? (workspace?.style.getPropertyValue("--tv-left-w") || "44px") : "0px",
      rightW: workspace?.style.getPropertyValue("--tv-right-w") || "300px",
      railCollapsed: rail?.classList.contains("collapsed") || false,
      panelCollapsed: panel?.classList.contains("collapsed") || false,
      sidebarCollapsed: document.getElementById("sidebar")?.classList.contains("collapsed") || false,
      savedAt: Date.now(),
    };
  }
  function applyWorkspaceSnapshot(snap) {
    if (!snap) return;
    const workspace = document.querySelector(".tv-workspace");
    const rail = document.querySelector(".tv-left-rail");
    const panel = document.querySelector(".tv-right-panel");
    if (workspace) {
      workspace.style.setProperty("--tv-left-w", snap.railCollapsed ? "0px" : snap.leftW);
      workspace.style.setProperty("--tv-right-w", snap.panelCollapsed ? "0px" : snap.rightW);
      workspace.style.gridTemplateColumns = rail
        ? `${snap.railCollapsed ? "0px" : snap.leftW} minmax(0,1fr) 5px ${snap.panelCollapsed ? "0px" : snap.rightW}`
        : `minmax(0,1fr) 5px ${snap.panelCollapsed ? "0px" : snap.rightW}`;
    }
    if (rail) rail.classList.toggle("collapsed", !!snap.railCollapsed);
    if (panel) panel.classList.toggle("collapsed", !!snap.panelCollapsed);
    if (snap.sidebarCollapsed) document.getElementById("sidebar")?.classList.add("collapsed");
  }
  function autoSaveSession() {
    localStorage.setItem(WS_SESSION_KEY, JSON.stringify(captureWorkspaceSnapshot()));
  }
  function restoreLastSession() {
    try {
      const snap = JSON.parse(localStorage.getItem(WS_SESSION_KEY) || "null");
      applyWorkspaceSnapshot(snap);
    } catch { /* ignore malformed session */ }
  }

  function renderWorkspaceMenuItems() {
    const workspaces = getWorkspaces();
    const names = Object.keys(workspaces);
    if (!names.length) {
      return `<div class="ui-dropdown-item" style="color:var(--text-tertiary);cursor:default;">No saved workspaces yet</div>`;
    }
    return names.map((name) => `
      <div class="ui-dropdown-item" data-load-workspace="${name}">
        <span>${name}</span>
        <span class="ws-actions">
          <span data-rename-workspace="${name}" title="Rename">✎</span>
          <span data-duplicate-workspace="${name}" title="Duplicate">⧉</span>
          <span data-delete-workspace="${name}" title="Delete">🗑</span>
        </span>
      </div>`).join("");
  }

  function openWorkspaceMenu(anchor) {
    document.querySelectorAll(".ui-dropdown").forEach((d) => d.remove());
    const dropdown = document.createElement("div");
    dropdown.className = "ui-dropdown ui-workspace-menu";
    dropdown.innerHTML = `
      <div class="ui-dropdown-item" data-save-new-workspace style="font-weight:700;color:var(--user-accent, var(--blue));">+ Save current as new workspace…</div>
      <div class="ui-context-menu-sep"></div>
      ${renderWorkspaceMenuItems()}
    `;
    document.body.appendChild(dropdown);
    const rect = anchor.getBoundingClientRect();
    dropdown.style.left = `${Math.min(rect.left, window.innerWidth - 260)}px`;
    dropdown.style.top = `${rect.bottom + 6}px`;
    requestAnimationFrame(() => dropdown.classList.add("visible"));

    function close() { dropdown.remove(); document.removeEventListener("click", onDocClick); }
    function onDocClick(e) { if (!dropdown.contains(e.target) && e.target !== anchor) close(); }
    setTimeout(() => document.addEventListener("click", onDocClick), 0);

    dropdown.addEventListener("click", (e) => {
      const saveNew = e.target.closest("[data-save-new-workspace]");
      const loadEl = e.target.closest("[data-load-workspace]");
      const renameEl = e.target.closest("[data-rename-workspace]");
      const dupEl = e.target.closest("[data-duplicate-workspace]");
      const delEl = e.target.closest("[data-delete-workspace]");

      if (saveNew) {
        const name = prompt("Workspace name", `Workspace ${Object.keys(getWorkspaces()).length + 1}`);
        if (!name) return;
        const workspaces = getWorkspaces();
        workspaces[name] = captureWorkspaceSnapshot();
        setWorkspaces(workspaces);
        showToast(`Workspace "${name}" saved.`, "success");
        close();
      } else if (renameEl) {
        e.stopPropagation();
        const oldName = renameEl.dataset.renameWorkspace;
        const newName = prompt("Rename workspace", oldName);
        if (!newName || newName === oldName) return;
        const workspaces = getWorkspaces();
        workspaces[newName] = workspaces[oldName];
        delete workspaces[oldName];
        setWorkspaces(workspaces);
        showToast(`Renamed to "${newName}".`, "success");
        close();
      } else if (dupEl) {
        e.stopPropagation();
        const name = dupEl.dataset.duplicateWorkspace;
        const workspaces = getWorkspaces();
        let copyName = `${name} copy`;
        let n = 2;
        while (workspaces[copyName]) { copyName = `${name} copy ${n}`; n++; }
        workspaces[copyName] = { ...workspaces[name] };
        setWorkspaces(workspaces);
        showToast(`Duplicated as "${copyName}".`, "success");
        close();
      } else if (delEl) {
        e.stopPropagation();
        const name = delEl.dataset.deleteWorkspace;
        if (!confirm(`Delete workspace "${name}"?`)) return;
        const workspaces = getWorkspaces();
        delete workspaces[name];
        setWorkspaces(workspaces);
        showToast(`Deleted "${name}".`, "info");
        close();
      } else if (loadEl) {
        const name = loadEl.dataset.loadWorkspace;
        const workspaces = getWorkspaces();
        applyWorkspaceSnapshot(workspaces[name]);
        showToast(`Loaded workspace "${name}".`, "success");
        close();
      }
    });
  }

  function initWorkspaceManagement() {
    restoreLastSession();
    document.addEventListener("click", (e) => {
      const btn = e.target.closest("#saveWorkspaceBtn");
      if (!btn) return;
      openWorkspaceMenu(btn);
    });
    // Auto-save on layout-affecting interactions (debounced).
    let saveTimer = null;
    ["mouseup", "click"].forEach((evt) => {
      document.addEventListener(evt, (e) => {
        if (!e.target.closest(".tv-resize-handle, .tv-rail-collapse-btn, .tv-panel-collapse-btn, #sidebar")) return;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(autoSaveSession, 400);
      });
    });
    window.addEventListener("beforeunload", autoSaveSession);
  }
  /* ---------------- Splash screen ---------------- */
  function initSplash() {
    const splash = document.getElementById("appSplash");
    if (!splash || window.TradeFXBookPages) return;
    window.addEventListener("load", () => {
      setTimeout(() => splash.classList.add("hidden"), 260);
    });
    // Safety net in case 'load' already fired.
    setTimeout(() => splash.classList.add("hidden"), 2200);
  }

  /* ---------------- Init ---------------- */
  function init() {
    initTooltips();
    initModals();
    initSettingsModal();
    initThemeCustomization();
    initShortcuts();
    initContextMenu();
    initFullscreenShortcut();
    initResizablePanels();
    initRipple();
    initToolFavorites();
    initWorkspaceManagement();
    initSplash();

    const settingsBtn = document.getElementById("openSettingsBtn");
    if (settingsBtn) settingsBtn.addEventListener("click", () => openModal("settingsModal"));
    const shortcutsBtn = document.getElementById("openShortcutsBtn");
    if (shortcutsBtn) shortcutsBtn.addEventListener("click", () => openModal("shortcutsModal"));
  }

  document.addEventListener("DOMContentLoaded", init);

  return {
    toast: showToast, openModal, closeModal, toggleFullscreenChart, takeChartScreenshot,
    showContextMenu, hideContextMenu, animateNumber, updateStatusBar,
    getFavoriteTools, getRecentTools, trackToolUse,
  };
})();
