/* app.js — bootstraps the whole frontend */

const NEWS_ITEMS = [
  "Unemployment Rate", "ADP Employment Change Weekly", "S&P/Case-Shiller Home Price YoY",
  "Fed Interest Rate Decision", "Core CPI m/m", "Non-Farm Payrolls", "Retail Sales m/m",
  "ISM Manufacturing PMI", "Initial Jobless Claims", "GDP Growth Rate QoQ",
];

function startClock() {
  const el = document.getElementById("clock");
  function tick() {
    const now = new Date();
    el.textContent = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }
  tick();
  setInterval(tick, 1000);
}

function setPageDate() {
  const el = document.getElementById("pageDate");
  const now = new Date();
  el.textContent = now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function buildTicker(target = document.getElementById("tickerTrack")) {
  const track = typeof target === "string" ? document.querySelector(target) : target;
  if (!track) return;
  const items = [...NEWS_ITEMS, ...NEWS_ITEMS]; // duplicate for seamless loop
  track.innerHTML = items.map((label) => {
    const h = Math.floor(Math.random() * 12) + 1;
    const m = Math.floor(Math.random() * 60).toString().padStart(2, "0");
    const ampm = Math.random() > 0.5 ? "AM" : "PM";
    return `<span><span class="t-time">${h}:${m} ${ampm}</span>${label}</span>`;
  }).join("");
}

function initSidebarCollapse() {
  const sidebar = document.getElementById("sidebar");
  const btn = document.getElementById("collapseBtn");
  btn.addEventListener("click", () => sidebar.classList.toggle("collapsed"));
}

function initThemeToggle() {
  const btn = document.getElementById("themeToggle");
  document.body.classList.toggle("light-mode", Store.state.settings?.theme === "light");
  btn.addEventListener("click", () => {
    const next = document.body.classList.toggle("light-mode") ? "light" : "dark";
    API.updateSettings({ theme: next });
    toast(`${next === "light" ? "Light" : "Dark"} mode enabled.`, "success");
  });
}

function initNewTradeButton() {
  const btn = document.getElementById("newTradeBtn");
  btn.addEventListener("click", () => {
    Router.go("backtesting");
  });
}

function accountInitials(name) {
  return (name || "Account")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("") || "AC";
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function refreshCurrentPage() {
  Router.go(Router.current);
}

function renderAccountControls() {
  const accounts = Store.state.accounts || [];
  const activeId = Store.state.active_account_id;
  const active = accounts.find((a) => a.id === activeId) || accounts[0] || {};
  const select = document.getElementById("accountSelect");
  const name = document.getElementById("accountName");
  const balance = document.getElementById("accountBalance");
  const avatar = document.getElementById("accountAvatar");

  if (!select || !name || !balance || !avatar) return;

  select.innerHTML = accounts.map((account) => (
    `<option value="${escapeHtml(account.id)}" ${account.id === activeId ? "selected" : ""}>${account.archived ? "[Archived] " : ""}${escapeHtml(account.name)}</option>`
  )).join("");
  name.textContent = `${active.name || "Account"} ${active.type ? `(${active.type})` : ""}`;
  balance.textContent = Fmt.moneyPlain(Store.state.balance || active.balance || 0);
  avatar.textContent = accountInitials(active.name);
}

function renderUser() {
  const avatar = document.getElementById("userAvatar");
  if (!avatar) return;
  avatar.textContent = accountInitials(Store.state.user?.name || Store.state.user?.email || "Local User");
}

function initAuthControls() {
  const pill = document.getElementById("userPill");
  if (!pill) return;
  Store.subscribe(renderUser);
  renderUser();
  pill.addEventListener("click", async () => {
    const action = (prompt("User action: login, signup, or forgot", "login") || "").toLowerCase();
    if (!["login", "signup", "forgot"].includes(action)) return;
    const email = prompt("Email", Store.state.user?.email || "");
    if (!email) return;
    if (action === "forgot") {
      await API.forgotPassword(email);
      toast("Password reset request saved locally.", "success");
      return;
    }
    const password = prompt("Password", "");
    if (!password) return;
    const payload = { email, password };
    if (action === "signup") payload.name = prompt("Display name", email.split("@")[0]) || email.split("@")[0];
    const data = action === "signup" ? await API.signup(payload) : await API.login(payload);
    if (data.error) {
      toast(data.error, "error");
      return;
    }
    Store.state = data;
    Store.notify();
    refreshCurrentPage();
    toast(action === "signup" ? "Signed up." : "Logged in.", "success");
  });
}

function initAccountControls() {
  const select = document.getElementById("accountSelect");
  const addBtn = document.getElementById("addAccountBtn");
  const resetBtn = document.getElementById("resetAccountBtn");
  const archiveBtn = document.getElementById("archiveAccountBtn");
  const restoreBtn = document.getElementById("restoreAccountBtn");
  const deleteBtn = document.getElementById("deleteAccountBtn");

  Store.subscribe(renderAccountControls);
  renderAccountControls();

  select.addEventListener("change", async () => {
    const data = await API.switchAccount(select.value);
    Store.state = data;
    Store.notify();
    refreshCurrentPage();
    toast("Account switched.", "success");
  });

  addBtn.addEventListener("click", async () => {
    const name = prompt("Account name", `Account ${(Store.state.accounts || []).length + 1}`);
    if (!name) return;
    const type = prompt("Account type: Paper, Demo, or Real", "Demo") || "Demo";
    const starting = parseFloat(prompt("Starting balance", "10000") || "10000");
    const currency = prompt("Currency code", "USD") || "USD";
    const symbols = { USD: "$", EUR: "€", GBP: "£", INR: "₹", JPY: "¥", AED: "د.إ" };
    const currencySymbol = prompt("Currency symbol", symbols[currency.toUpperCase()] || currency.toUpperCase()) || "$";
    const data = await API.createAccount({
      name,
      type,
      starting_balance: Number.isFinite(starting) ? starting : 10000,
      currency: currency.toUpperCase(),
      currency_symbol: currencySymbol,
    });
    Store.state = data;
    Store.notify();
    refreshCurrentPage();
    toast("Account created.", "success");
  });

  resetBtn.addEventListener("click", async () => {
    const label = document.getElementById("accountName").textContent || "this account";
    if (!confirm(`Reset ${label}? This clears trades, journal entries, and balance for this account only.`)) return;
    const data = await API.resetAccount();
    Store.state = data;
    Store.notify();
    refreshCurrentPage();
    toast("Account reset.", "success");
  });

  archiveBtn.addEventListener("click", async () => {
    const id = Store.state.active_account_id;
    if (!id || !confirm("Archive this account? You can restore it later.")) return;
    const data = await API.archiveAccount(id);
    Store.state = data;
    Store.notify();
    refreshCurrentPage();
    toast("Account archived.", "success");
  });

  restoreBtn.addEventListener("click", async () => {
    const id = select.value;
    if (!id) return;
    const data = await API.restoreAccount(id);
    Store.state = data;
    Store.notify();
    refreshCurrentPage();
    toast("Account restored.", "success");
  });

  deleteBtn.addEventListener("click", async () => {
    const id = select.value;
    if (!id || !confirm("Permanently delete this account? This cannot be undone.")) return;
    const data = await API.deleteAccount(id);
    if (data.error) {
      toast(data.error, "error");
      return;
    }
    Store.state = data;
    Store.notify();
    refreshCurrentPage();
    toast("Account deleted.", "success");
  });
}

async function boot() {
  startClock();
  setPageDate();
  buildTicker();
  initSidebarCollapse();
  initThemeToggle();
  initNewTradeButton();

  try {
    await Store.init();
  } catch (error) {
    const splash = document.getElementById("appSplash");
    if (splash) {
      splash.querySelector(".splash-label")?.replaceChildren(document.createTextNode(window.TradeFXBookPages ? "Browser workspace could not start: " + error.message + ". Check your connection and browser storage, then reload." : "Unable to connect to the local trading workspace."));
      splash.classList.add("error");
    }
    console.error("TradeFXBook boot failed", error);
    return;
  }
  document.body.classList.toggle("light-mode", Store.state.settings?.theme === "light");
  Router.init();
  if (window.TradeFXBookPages) document.getElementById("appSplash")?.classList.add("hidden");
  initAccountControls();
  initAuthControls();

  // periodically refresh shared state in the background so KPIs across
  // pages stay in sync even if multiple actions happen (e.g. SL/TP hits).
  setInterval(() => {
    if (document.visibilityState === "visible") Store.refresh().catch((error) => console.warn("Workspace refresh failed", error));
  }, 8000);
}

document.addEventListener("DOMContentLoaded", boot);
