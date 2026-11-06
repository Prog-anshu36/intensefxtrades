/* Cloud history for signed-in users. Guest workspaces remain entirely local. */
(() => {
  "use strict";
  const RETRIES = [1000, 3000, 8000];
  const state = { started: false, dirty: false, saving: false, timer: null, lastPayload: "", userId: null };

  const iso = (value) => {
    const date = new Date(value || 0);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  };
  const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
  const safeId = (value, fallback) => String(value || fallback).slice(0, 220);
  function status(text, kind = "idle") {
    let node = document.getElementById("cloudHistoryStatus");
    if (!node) {
      node = document.createElement("span");
      node.id = "cloudHistoryStatus";
      node.className = "cloud-history-status";
      node.setAttribute("role", "status");
      const target = document.getElementById("userPill")?.parentElement || document.querySelector(".topbar-actions");
      target?.prepend(node);
    }
    if (node) { node.textContent = text; node.dataset.state = kind; }
  }
  function clientAndUser() {
    const auth = window.IntenseFXAuth;
    const user = auth?.getUser?.();
    const client = auth?.getClient?.();
    return user && client ? { user, client } : null;
  }
  async function backup() {
    const response = await window.TradeFXBookPages?.request?.("/browser/backup");
    if (!response?.ok) throw new Error("The browser workspace could not be read.");
    const data = await response.json();
    const prefix = `tfb_user_${state.userId}_`;
    const preferences = {};
    for (const physicalKey of Object.keys(localStorage)) {
      if (!physicalKey.startsWith(prefix)) continue;
      const logicalKey = physicalKey.slice(prefix.length);
      preferences[logicalKey] = localStorage.getItem(physicalKey);
    }
    return { ...data, preferences };
  }
  function allAccounts(workspace) {
    const rows = [];
    for (const account of workspace?.accounts || []) {
      rows.push(account);
      for (const practice of Object.values(account.prop_practice || {})) rows.push(practice);
    }
    return rows;
  }
  function tradeRows(workspace, now) {
    return allAccounts(workspace).flatMap((account) => [
      ...(account.history || []).map((trade, index) => ({ trade, status: "closed", index })),
      ...(account.active_trades || []).map((trade, index) => ({ trade, status: "open", index })),
    ].map(({ trade, status: tradeStatus, index }) => ({
      user_id: state.userId, account_id: safeId(account.id, "account"),
      trade_id: safeId(trade.id, `${trade.opened_at || trade.created_at || "trade"}:${trade.closed_at || ""}:${trade.symbol || ""}:${trade.type || ""}:${trade.entry || ""}:${index}`),
      status: tradeStatus, symbol: trade.symbol || null, side: trade.type || trade.side || null,
      opened_at: iso(trade.opened_at || trade.created_at), closed_at: iso(trade.closed_at), pnl: number(trade.pnl ?? trade.floating_pnl), state: trade, client_updated_at: now,
    })));
  }
  function evaluationRows(preferences, now) {
    const rows = [];
    for (const [key, value] of Object.entries(preferences || {})) {
      if (!key.startsWith("tfb_prop_firm_practice_v1:")) continue;
      try {
        for (const attempt of JSON.parse(value || "{}").attempts || []) rows.push({
          user_id: state.userId, evaluation_id: safeId(attempt.id, `evaluation:${key}`),
          owner_account_id: key.split(":").at(-1) || null, status: attempt.status || null,
          phase: Number.isInteger(attempt.phase) ? attempt.phase : null, state: attempt, client_updated_at: now,
        });
      } catch (_) { /* A damaged local preference must not stop account history sync. */ }
    }
    return rows;
  }
  function payloadRows(snapshot) {
    const now = new Date().toISOString(), workspace = snapshot.state || {};
    const accounts = allAccounts(workspace);
    const accountRows = accounts.map((account) => ({
      user_id: state.userId, account_id: safeId(account.id, "account"), name: String(account.name || "Account").slice(0, 200),
      account_type: String(account.type || "Demo").slice(0, 80), currency: String(account.currency || "USD").slice(0, 20),
      currency_symbol: String(account.currency_symbol || "$").slice(0, 20), archived: Boolean(account.archived),
      initial_balance: number(account.initial_balance), balance: number(account.balance), state: account, client_updated_at: now,
    }));
    const equityRows = accounts.flatMap((account) => {
      const accountId = safeId(account.id, "account");
      let runningBalance = number(account.initial_balance);
      const points = (account.history || []).map((trade, index) => {
        runningBalance += number(trade.pnl);
        const key = safeId(trade.id, `${trade.closed_at || trade.opened_at || "trade"}:${trade.symbol || ""}:${index}`);
        return { user_id: state.userId, account_id: accountId, point_id: `trade:${key}`, recorded_at: iso(trade.closed_at || trade.opened_at), balance: runningBalance, equity: runningBalance, state: { trade_id: trade.id || null, pnl: number(trade.pnl) }, client_updated_at: now };
      });
      points.push({ user_id: state.userId, account_id: accountId, point_id: "latest", recorded_at: now, balance: number(account.balance), equity: number(account.balance) + (account.active_trades || []).reduce((total, trade) => total + number(trade.floating_pnl), 0), state: { balance: account.balance, active_trades: account.active_trades || [], history_count: (account.history || []).length }, client_updated_at: now });
      return points;
    });
    const analytics = accounts.map((account) => {
      const trades = account.history || [];
      const metrics = window.TradeAnalyticsEngine?.performance?.(window.TradeAnalyticsEngine.normalizeTrades(trades, account.journal || []), number(account.initial_balance)) || {};
      return { user_id: state.userId, account_id: safeId(account.id, "account"), snapshot_key: "latest", computed_at: now, state: metrics };
    });
    return { workspace, now, accountRows, equityRows, analytics, trades: tradeRows(workspace, now), evaluations: evaluationRows(snapshot.preferences, now) };
  }
  async function writeSnapshot(snapshot) {
    const { client } = clientAndUser() || {};
    if (!client) return;
    const rows = payloadRows(snapshot);
    const operations = [
      client.from("cloud_workspaces").upsert({ user_id: state.userId, version: 1, state: rows.workspace, preferences: snapshot.preferences || {}, client_updated_at: rows.now }, { onConflict: "user_id" }),
      rows.accountRows.length && client.from("trading_accounts").upsert(rows.accountRows, { onConflict: "user_id,account_id" }),
      rows.trades.length && client.from("trades").upsert(rows.trades, { onConflict: "user_id,account_id,trade_id" }),
      rows.equityRows.length && client.from("account_equity_history").upsert(rows.equityRows, { onConflict: "user_id,account_id,point_id" }),
      rows.evaluations.length && client.from("prop_firm_evaluations").upsert(rows.evaluations, { onConflict: "user_id,evaluation_id" }),
      rows.analytics.length && client.from("performance_analytics").upsert(rows.analytics, { onConflict: "user_id,account_id,snapshot_key" }),
    ].filter(Boolean);
    const results = await Promise.all(operations);
    const failed = results.find((result) => result.error);
    if (failed) throw failed.error;
  }
  function restorePreferences(preferences) {
    for (const [key, value] of Object.entries(preferences || {})) {
      if (!key.startsWith("tfb_") || typeof value !== "string") continue;
      localStorage.setItem(key, value);
    }
  }
  async function restore(snapshot) {
    const response = await window.TradeFXBookPages?.request?.("/browser/restore", { method: "POST", body: JSON.stringify({ format: "intensefxtrades-browser-v1", state: snapshot.state }) });
    if (!response?.ok) throw new Error("Cloud history could not be restored safely.");
    restorePreferences(snapshot.preferences);
    await window.Store?.init?.();
  }
  async function save(attempt = 0) {
    if (!state.started || !state.dirty || state.saving || !navigator.onLine) return;
    state.saving = true; status("Saving…", "saving");
    try {
      const snapshot = await backup();
      const serial = JSON.stringify(snapshot);
      if (serial !== state.lastPayload) await writeSnapshot(snapshot);
      state.lastPayload = serial; state.dirty = false; status("Saved", "saved");
    } catch (error) {
      state.dirty = true;
      if (attempt < RETRIES.length) window.setTimeout(() => save(attempt + 1), RETRIES[attempt]);
      else status("Cloud sync pending", "error");
      console.warn("Cloud history sync failed", error);
    } finally { state.saving = false; }
  }
  function schedule() {
    if (!state.started) return;
    state.dirty = true; window.clearTimeout(state.timer);
    state.timer = window.setTimeout(() => save(), 800);
  }
  async function initialize() {
    const context = clientAndUser();
    if (!context || state.started) return;
    state.userId = context.user.id; status("Syncing history…", "saving");
    const local = await backup();
    const { data: cloud, error } = await context.client.from("cloud_workspaces").select("state,preferences,updated_at").eq("user_id", state.userId).maybeSingle();
    if (error) { status("Cloud sync pending", "error"); console.warn("Cloud history unavailable", error); return; }
    if (cloud?.state?.accounts?.length) {
      await restore(cloud); state.lastPayload = JSON.stringify({ format: "intensefxtrades-browser-v1", state: cloud.state, preferences: cloud.preferences || {} });
      status("History restored", "saved");
    } else {
      await writeSnapshot(local); state.lastPayload = JSON.stringify(local); status("History saved", "saved");
    }
    state.started = true;
    window.Store?.subscribe?.(schedule);
    window.addEventListener("intensefx:workspace-mutated", schedule);
    window.addEventListener("intensefx:prop-evaluation-mutated", schedule);
    window.addEventListener("online", schedule);
  }
  window.IntenseFXCloudHistory = { initialize, schedule, save };
})();
