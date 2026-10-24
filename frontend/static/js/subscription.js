/* Central plan catalogue and entitlement checks. Plan colour is presentation only. */
(() => {
  "use strict";

  const COLORS = { blue: "#4388ff", green: "#31c48d", purple: "#a879ff", red: "#ff5364" };
  const FEATURES = {
    dashboard: { label: "Dashboard", required: "blue" },
    trades: { label: "Trades and journal", required: "blue" },
    generalSettings: { label: "General settings", required: "blue" },
    tradingView: { label: "Chart workspace", required: "blue" },
    analysis: { label: "Analysis", required: "green" },
    performance: { label: "Performance", required: "green" },
    backtesting: { label: "Backtesting", required: "green" },
    replay: { label: "Replay", required: "purple" },
    tradeAnalysis: { label: "Trading Analysis", required: "purple" },
    technicalIndicators: { label: "Technical indicators", required: "purple" },
    premiumAppearance: { label: "Premium appearance settings", required: "red" },
    advancedSettings: { label: "Advanced application settings", required: "red" },
    premiumXauusd: { label: "Full historical XAUUSD data", required: "red" },
    extendedHistoricalReplay: { label: "Extended historical replay", required: "red" },
    aiCoach: { label: "AI Coach", required: "red" },
    additionalAccount: { label: "Additional trading accounts", required: "green" },
  };
  const PLANS = {
    blue: { code: "blue", name: "Blue", tier: "Free", color: COLORS.blue, price: 0,
      features: new Set(["dashboard", "trades", "generalSettings", "tradingView"]), accountLimit: 1,
      bullets: ["Dashboard, trades and journal", "Chart workspace", "One demo trading account"] },
    green: { code: "green", name: "Green", tier: "Starter", color: COLORS.green, price: null,
      features: new Set(["dashboard", "trades", "generalSettings", "tradingView", "analysis", "performance", "backtesting", "additionalAccount"]), accountLimit: Infinity,
      bullets: ["Everything in Blue", "Analysis and performance", "Backtesting", "Additional trading accounts"] },
    purple: { code: "purple", name: "Purple", tier: "Pro", color: COLORS.purple, price: null,
      features: new Set(["dashboard", "trades", "generalSettings", "tradingView", "analysis", "performance", "backtesting", "replay", "tradeAnalysis", "technicalIndicators", "additionalAccount"]), accountLimit: Infinity,
      bullets: ["Everything in Green", "Replay and technical indicators", "Trading Analysis", "Replay history limited to one year"] },
    red: { code: "red", name: "Red", tier: "Elite", color: COLORS.red, price: null,
      features: new Set(Object.keys(FEATURES)), accountLimit: Infinity,
      bullets: ["Everything in Purple", "AI Coach and premium settings", "Full supported XAUUSD history", "All available replay history"] },
  };
  const ORDER = ["blue", "green", "purple", "red"];
  const configuredPrices = window.IntenseFXPlanPricing || {};
  for (const code of ["green", "purple", "red"]) {
    const amount = configuredPrices[code];
    if (amount !== undefined && amount !== null && amount !== "" && Number.isFinite(Number(amount)) && Number(amount) >= 0) PLANS[code].price = Number(amount);
  }
  function timestampMillis(value) {
    if (typeof value === "number" || /^\d+(\.\d+)?$/.test(String(value ?? ""))) {
      const number = Number(value);
      return number < 1e11 ? number * 1000 : number;
    }
    return Date.parse(value ?? "");
  }

  function normalizePlan(subscription) {
    const code = typeof subscription === "string" ? subscription : subscription?.plan_code;
    const status = subscription && typeof subscription === "object" ? String(subscription.status || "active").toLowerCase() : "active";
    const hasEnd = Boolean(subscription && typeof subscription === "object" && subscription.current_period_end);
    const end = hasEnd ? Date.parse(subscription.current_period_end) : null;
    if (!PLANS[code] || !["active", "trialing"].includes(status) || (hasEnd && (!Number.isFinite(end) || end <= Date.now()))) return "blue";
    return code;
  }
  const VIP_KEYS = Object.freeze({ siuuu: "red", pro: "green", elite: "purple" });
  const VIP_STORAGE_KEY = "intensefx_vip_plan";
  function getVipPlanCode() {
    try {
      const code = localStorage.getItem(VIP_STORAGE_KEY);
      return ORDER.includes(code) && code !== "blue" ? code : null;
    } catch { return null; }
  }
  function redeemVipKey(value) {
    const code = String(value ?? "").trim().toLowerCase();
    const planCode = VIP_KEYS[code];
    if (!planCode) return { ok: false };
    try { localStorage.setItem(VIP_STORAGE_KEY, planCode); }
    catch { return { ok: false, storageUnavailable: true }; }
    window.dispatchEvent(new Event("intensefx:subscription-changed"));
    return { ok: true, plan: PLANS[planCode] };
  }
  function getUserPlan() {
    const verified = normalizePlan(window.IntenseFXAuth?.getSubscription?.());
    return PLANS[verified !== "blue" ? verified : (getVipPlanCode() || "blue")];
  }
  function getUserEntitlements(plan = getUserPlan()) { return new Set(plan.features); }
  function canAccessFeature(feature, plan = getUserPlan()) { return Boolean(plan?.features.has(feature)); }
  function requiredPlan(feature) { return PLANS[FEATURES[feature]?.required || "blue"]; }
  function canCreateAccount(existingAccounts = [], plan = getUserPlan()) {
    const count = Array.isArray(existingAccounts) ? existingAccounts.length : Number(existingAccounts || 0);
    return count < plan.accountLimit;
  }
  function getPermittedReplayRange(instrument, availability, plan = getUserPlan()) {
    const start = timestampMillis(availability?.start ?? availability?.first_timestamp);
    const end = timestampMillis(availability?.end ?? availability?.last_timestamp);
    if (!canAccessFeature("replay", plan) || !Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
    const earliest = plan.code === "red" ? start : Math.max(start, end - 365 * 24 * 60 * 60 * 1000);
    return { instrument, start: earliest, end, fullHistory: plan.code === "red" };
  }
  function canAccessHistoricalData(instrument, range, availability, plan = getUserPlan()) {
    if (String(instrument).toUpperCase() === "XAUUSD" && plan.code !== "purple" && plan.code !== "red") return false;
    const permitted = getPermittedReplayRange(instrument, availability, plan);
    if (!permitted || !range) return Boolean(permitted);
    const from = timestampMillis(range.start), to = timestampMillis(range.end);
    return Number.isFinite(from) && Number.isFinite(to) && from >= permitted.start && to <= permitted.end;
  }
  function canAccessReplayRange(instrument, range, availability, plan = getUserPlan()) {
    const permitted = getPermittedReplayRange(instrument, availability, plan);
    if (!permitted) return false;
    if (!range) return true;
    const from = timestampMillis(range.start);
    const to = timestampMillis(range.end);
    return Number.isFinite(from) && Number.isFinite(to) && from >= permitted.start && to <= permitted.end;
  }
  function requestUpgrade(feature, message) {
    if (window.PageSubscription?.requestFeature) {
      window.PageSubscription.requestFeature(feature, message);
      return;
    }
    window.location.hash = "subscription";
  }

  function protectFeatureControls(root = document) {
    root.querySelectorAll?.("[data-plan-feature]").forEach((control) => {
      const feature = control.dataset.planFeature;
      if (!FEATURES[feature]) return;
      const allowed = canAccessFeature(feature);
      control.classList.toggle("plan-feature-locked", !allowed);
      control.setAttribute("aria-disabled", String(!allowed));
      if (!allowed) {
        const required = requiredPlan(feature);
        control.title = FEATURES[feature].label + " is included with " + required.name + " · " + required.tier;
      }
    });
  }

  document.addEventListener("click", (event) => {
    const control = event.target.closest?.("[data-plan-feature]");
    if (!control) return;
    const feature = control.dataset.planFeature;
    if (!FEATURES[feature] || canAccessFeature(feature)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    requestUpgrade(feature);
  }, true);

  document.addEventListener("intensefx:subscription-changed", () => protectFeatureControls());
  document.addEventListener("DOMContentLoaded", () => protectFeatureControls());

  window.SubscriptionSystem = { PLANS, FEATURES, ORDER, normalizePlan, getUserPlan, getUserEntitlements,
    canAccessFeature, requiredPlan, canCreateAccount, getPermittedReplayRange, canAccessHistoricalData, canAccessReplayRange,
    protectFeatureControls, getVipPlanCode, redeemVipKey, requestUpgrade };
})();
