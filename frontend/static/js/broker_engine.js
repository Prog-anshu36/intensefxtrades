/* broker_engine.js - broker connection workspace shell.
   Frontend-only integration state. It does not place orders, alter trading
   logic, or call backend broker APIs. */

const BrokerIntegrationEngine = (() => {
  const KEY = "tfb_broker_connections_v1";

  function safeJsonGet(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
    catch { return fallback; }
  }

  function all() {
    return safeJsonGet(KEY, {});
  }

  function get(name = "oanda") {
    return all()[name] || {
      name,
      broker: "OANDA",
      status: "not_connected",
      environment: "practice",
      accountId: "",
      tokenPresent: false,
      lastCheckedAt: null,
    };
  }

  function save(name, patch) {
    const connections = all();
    connections[name] = { ...get(name), ...patch, updatedAt: Date.now() };
    localStorage.setItem(KEY, JSON.stringify(connections));
    window.dispatchEvent(new CustomEvent("tfb:broker-updated", { detail: connections[name] }));
    return connections[name];
  }

  function connectOanda({ environment, accountId, token }) {
    const connected = save("oanda", {
      broker: "OANDA",
      status: accountId ? "configured" : "needs_account",
      environment: environment || "practice",
      accountId: accountId || "",
      tokenPresent: !!token,
      lastCheckedAt: new Date().toISOString(),
    });
    return connected;
  }

  function disconnect(name = "oanda") {
    return save(name, {
      status: "not_connected",
      accountId: "",
      tokenPresent: false,
      lastCheckedAt: new Date().toISOString(),
    });
  }

  function statusLabel(conn = get()) {
    if (conn.status === "configured") return "Configured";
    if (conn.status === "needs_account") return "Needs account";
    return "Not connected";
  }

  function renderOandaPanel() {
    const conn = get("oanda");
    return `
      <div class="broker-panel" data-broker-panel="oanda">
        <div class="broker-status-row">
          <span class="broker-dot ${conn.status === "configured" ? "ok" : ""}"></span>
          <div>
            <b>OANDA</b>
            <small>${statusLabel(conn)}${conn.accountId ? ` · ${escapeHtml(conn.accountId)}` : ""}</small>
          </div>
        </div>
        <label>Environment</label>
        <select data-oanda-env>
          <option value="practice" ${conn.environment !== "live" ? "selected" : ""}>Practice</option>
          <option value="live" ${conn.environment === "live" ? "selected" : ""}>Live</option>
        </select>
        <label>Account ID</label>
        <input data-oanda-account type="text" value="${escapeHtml(conn.accountId || "")}" placeholder="001-001-0000000-000">
        <label>API token</label>
        <input data-oanda-token type="password" placeholder="${conn.tokenPresent ? "Token saved for this session" : "Paste token to configure"}">
        <div class="broker-actions">
          <button class="btn btn-primary" data-oanda-connect>Save Connection</button>
          <button class="btn" data-oanda-disconnect>Disconnect</button>
        </div>
        <p class="broker-note">Connection state is local. Live order routing is intentionally disabled until backend broker execution is added.</p>
      </div>
    `;
  }

  function bind(container = document) {
    container.querySelectorAll("[data-oanda-connect]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const root = btn.closest("[data-broker-panel='oanda']");
        const conn = connectOanda({
          environment: root?.querySelector("[data-oanda-env]")?.value,
          accountId: root?.querySelector("[data-oanda-account]")?.value?.trim(),
          token: root?.querySelector("[data-oanda-token]")?.value,
        });
        toast(`OANDA ${statusLabel(conn).toLowerCase()}.`, conn.status === "configured" ? "success" : "warning");
      });
    });
    container.querySelectorAll("[data-oanda-disconnect]").forEach((btn) => {
      btn.addEventListener("click", () => {
        disconnect("oanda");
        toast("OANDA disconnected.", "info");
      });
    });
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-oanda-connect], [data-oanda-disconnect]")) return;
  });

  return { get, all, connectOanda, disconnect, statusLabel, renderOandaPanel, bind };
})();

window.BrokerIntegrationEngine = BrokerIntegrationEngine;
