/* api.js — thin wrapper around the Flask backend */
const API = {
  base: "",

  async signup(payload) {
    const r = await fetch(`${this.base}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return r.json();
  },

  async login(payload) {
    const r = await fetch(`${this.base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return r.json();
  },

  async forgotPassword(email) {
    const r = await fetch(`${this.base}/api/auth/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    return r.json();
  },

  async getState() {
    const r = await fetch(`${this.base}/api/state`);
    return r.json();
  },

  async getMarketHistory(symbol, timeframe, count = 5000, options = {}) {
    const params = new URLSearchParams({ symbol, timeframe, count, ...options });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
    const r = await fetch(`${this.base}/api/market/history?${params}`, { signal: controller.signal });
    const payload = await r.json();
    if (!r.ok) throw new Error(payload.error || "Historical data could not be loaded.");
    return payload;
    } finally { clearTimeout(timeout); }
  },

  async updateSettings(payload) {
    const r = await fetch(`${this.base}/api/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return r.json();
  },

  async createAccount(payload) {
    const r = await fetch(`${this.base}/api/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return r.json();
  },

  async archiveAccount(id) {
    const r = await fetch(`${this.base}/api/accounts/archive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    return r.json();
  },

  async restoreAccount(id) {
    const r = await fetch(`${this.base}/api/accounts/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    return r.json();
  },

  async deleteAccount(id) {
    const r = await fetch(`${this.base}/api/accounts/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    return r.json();
  },

  async switchAccount(id) {
    const r = await fetch(`${this.base}/api/accounts/switch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    return r.json();
  },

  async resetAccount() {
    const r = await fetch(`${this.base}/api/accounts/reset`, { method: "POST" });
    return r.json();
  },

  async openTrade(payload) {
    const r = await fetch(`${this.base}/api/trades/open`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return r.json();
  },

  async createPendingOrder(payload) {
    const r = await fetch(`${this.base}/api/trades/pending`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return r.json();
  },

  async closeTrade(payload) {
    const r = await fetch(`${this.base}/api/trades/close`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return r.json();
  },

  async updateFloating(ticks) {
    const r = await fetch(`${this.base}/api/trades/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticks }),
    });
    return r.json();
  },

  async getJournal() {
    const r = await fetch(`${this.base}/api/journal`);
    return r.json();
  },

  async addJournal(payload) {
    const r = await fetch(`${this.base}/api/journal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return r.json();
  },

  async deleteJournal(id) {
    const r = await fetch(`${this.base}/api/journal/${id}`, { method: "DELETE" });
    return r.json();
  },

  async resetAll() {
    const r = await fetch(`${this.base}/api/reset`, { method: "POST" });
    return r.json();
  },
};
