/* Chart and desktop persistence is owned by a trading account, never a tab. */
(function () {
  const chart = typeof PageBacktesting !== 'undefined' ? PageBacktesting : window.PageBacktesting;
  const clone = value => typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  const defaults = Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(chart || {})).filter(([, d]) => 'value' in d && typeof d.value !== 'function').map(([key, d]) => [key, clone(d.value)]));
  const adapters = new Map();
  const bootstrap = new Map();
  let activeScope = null;

  function scopeFor(state) {
    const account = state?.active_account_id || state?.id;
    return account ? `${encodeURIComponent(state.active_user_id || 'local')}:${encodeURIComponent(account)}` : null;
  }

  function storageFor(scope) {
    if (adapters.has(scope)) return adapters.get(scope);
    const memory = scope ? new Map() : bootstrap;
    const prefix = `tfb_account_chart_v1:${scope}:`;
    const adapter = {
      getItem(key) {
        if (scope) { try { const value = localStorage.getItem(prefix + key); if (value !== null) return value; } catch (_) {} }
        return memory.get(key) ?? null;
      },
      setItem(key, value) {
        memory.set(key, String(value));
        if (scope) { try { localStorage.setItem(prefix + key, String(value)); } catch (_) {} }
      },
      removeItem(key) {
        memory.delete(key);
        if (scope) { try { localStorage.removeItem(prefix + key); } catch (_) {} }
      },
    };
    adapters.set(scope, adapter);
    return adapter;
  }

  function migrateLegacy(scope) {
    // Assign the old shared chart to one account only. Keep the original keys
    // as a recovery copy; a newly created account never imports them again.
    const user = scope.split(':')[0];
    const marker = `tfb_chart_legacy_owner_v1:${user}`;
    try {
      if (localStorage.getItem(marker)) return;
      const destination = storageFor(scope);
      const exact = new Set(['tfb_replay_engine_v1', 'tfb_fxn_asian_range_v1',
        'tfb_fxn_hide_yellow_levels_v1', 'tfb_fxn_hide_yellow_levels_v2', 'tfb_fxn_ist_boundary_v1',
        'tfb_session_settings_v1', 'tfb_volume_visible_v1', 'tfb_stay_drawing_v1',
        'tfb_drawing_workspace_ux_v1', 'tfb_drawing_manager_hidden_v1',
        'tfb_backtesting_bottom_panel_height', 'tfb_desktop_workspaces_v1',
        'tfb_desktop_active_workspace_v1', 'tfb_desktop_recovery_v1',
        'tfb_desktop_closed_tabs_v1', 'tfb_desktop_prefs_v1']);
      const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index));
      for (const key of keys) {
        if (key && (exact.has(key) || key.startsWith('tfb_drawings_v1_'))) {
          if (destination.getItem(key) === null) destination.setItem(key, localStorage.getItem(key));
        }
      }
      localStorage.setItem(marker, scope);
    } catch (_) { /* Account isolation still works if storage is unavailable. */ }
  }

  function resetChart() {
    if (!chart) return;
    const historyGeneration = (chart._historyRequest || 0) + 1;
    const replayGeneration = (chart.playLoopToken || 0) + 1;
    if (chart._initialized) {
      chart.saveDrawingStorage();
      chart.saveReplayStorage();
      chart.cleanup();
    }
    chart.drawingEngine?.destroy?.();
    for (const key of Object.keys(chart)) if (!Object.getOwnPropertyDescriptor(chart, key)?.get && typeof chart[key] !== 'function') delete chart[key];
    for (const [key, value] of Object.entries(defaults)) chart[key] = clone(value);
    // Pending history responses and playback ticks must never match a new
    // account's requests, even if it uses the same symbol and timeframe.
    chart._historyRequest = historyGeneration;
    chart.playLoopToken = replayGeneration;
    chart._initialized = false;
  }

  function activate(state) {
    const scope = scopeFor(state);
    if (!scope || scope === activeScope) return;
    const originalAccount = state.accounts?.[0]?.id || state.active_account_id || state.id;
    migrateLegacy(scopeFor({ ...state, active_account_id: originalAccount }));
    resetChart();
    activeScope = scope;
    if (chart) {
      chart._chartAccountScope = scope;
      chart._chartAccountStorage = storageFor(scope);
    }
    window.dispatchEvent(new CustomEvent('tfb:chart-account-change', { detail: { scope } }));
  }

  window.ChartAccountState = {
    scopeFor,
    storageFor,
    storageForCurrent: () => storageFor(scopeFor(Store.state)),
    isCurrent: page => !page._chartAccountScope || page._chartAccountScope === scopeFor(Store.state),
    activate,
  };
  Store.subscribe(activate);
})();

