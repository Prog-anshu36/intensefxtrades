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
      features: new Set(["dashboard", "trades", "generalSettings", "tradingView"]), accountLimit: 1, demoAccountLimit: 1, performanceSessionLimit: 1, maxPlaybackSpeed: 1, sameDayChallenge: false,
      bullets: ["Dashboard, trades and journal", "Chart workspace", "One demo trading account"] },
    green: { code: "green", name: "Green", tier: "Starter", color: COLORS.green, price: 49,
      features: new Set(["dashboard", "trades", "generalSettings", "tradingView", "analysis", "performance", "backtesting", "additionalAccount"]), accountLimit: Infinity, demoAccountLimit: 3, performanceSessionLimit: 3, maxPlaybackSpeed: 3, sameDayChallenge: true,
      bullets: ["Everything in Blue", "Analysis and performance", "Backtesting", "Additional trading accounts"] },
    purple: { code: "purple", name: "Purple", tier: "Pro", color: COLORS.purple, price: 149,
      features: new Set(["dashboard", "trades", "generalSettings", "tradingView", "analysis", "performance", "backtesting", "replay", "tradeAnalysis", "technicalIndicators", "additionalAccount"]), accountLimit: Infinity, demoAccountLimit: 5, performanceSessionLimit: 5, maxPlaybackSpeed: 5, sameDayChallenge: true,
      bullets: ["Everything in Green", "Replay and technical indicators", "Trading Analysis", "Replay history limited to one year"] },
    red: { code: "red", name: "Red", tier: "Elite", color: COLORS.red, price: 199,
      features: new Set(Object.keys(FEATURES)), accountLimit: Infinity, demoAccountLimit: 10, performanceSessionLimit: 10, maxPlaybackSpeed: 10, sameDayChallenge: true,
      bullets: ["Everything in Purple", "AI Coach and premium settings", "Full supported XAUUSD history", "All available replay history"] },
  };
  const ORDER = ["blue", "green", "purple", "red"];
  const GOLDEN_PASS = { code: 'golden_vip', name: 'Golden VIP', tier: 'Pass', color: '#efc75e', price: 249, features: new Set(Object.keys(FEATURES)) };
  function purchaseQuote(product, months = 1) {
    const item = product === 'golden_vip' ? GOLDEN_PASS : PLANS[product];
    if (!item || ![1,3,12].includes(months)) throw new Error('Choose a valid access term.');
    return { product, months, amount: item.price * months, amountPaise: item.price * months * 100, currency: 'INR' };
  }

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
  // Legacy browser VIP values are deliberately ignored; leave stored data intact.
  function getVipPlanCode() {
    const subscription = window.IntenseFXAuth?.getSubscription?.();
    return subscription?.provider === "vip" && normalizePlan(subscription) !== "blue" ? subscription.plan_code : null;
  }
  async function redeemVipKey(value) {
    const key = String(value ?? "").trim();
    if (!key) return { ok: false, message: "Enter a VIP key." };
    if (!window.IntenseFXAuth?.redeemVipKey) return { ok: false, message: "VIP redemption requires configured authentication and the server redemption service." };
    try { return await window.IntenseFXAuth.redeemVipKey(key); }
    catch { return { ok: false, message: "Could not reach VIP redemption. Check your connection and try again." }; }
  }
  function getUserPlan() {
    const subscription = window.IntenseFXAuth?.getSubscription?.();
    const plan = PLANS[normalizePlan(subscription)];
    return plan.code === 'red' && subscription?.product_code === 'golden_vip' ? { ...plan, name: GOLDEN_PASS.name, tier: GOLDEN_PASS.tier, color: GOLDEN_PASS.color, productCode: 'golden_vip', demoAccountLimit: 50, performanceSessionLimit: 50, maxPlaybackSpeed: 100, sameDayChallenge: true } : plan;
  }
  function getUserEntitlements(plan = getUserPlan()) { return new Set(plan.features); }
  function canAccessFeature(feature, plan = getUserPlan()) { return Boolean(plan?.features.has(feature)); }
  function requiredPlan(feature) { return PLANS[FEATURES[feature]?.required || "blue"]; }
  function canCreateAccount(existingAccounts = [], plan = getUserPlan()) {
    const count = Array.isArray(existingAccounts) ? existingAccounts.length : Number(existingAccounts || 0);
    return count < plan.accountLimit;
  }
  function canCreateDemoAccount(existingAccounts = [], plan = getUserPlan()) {
    const demos = Array.isArray(existingAccounts) ? existingAccounts.filter(account => String(account?.type || "Demo").toLowerCase() === "demo").length : Number(existingAccounts || 0);
    return demos < Number(plan.demoAccountLimit ?? plan.accountLimit);
  }
  function canCreatePerformanceSession(existingCount = 0, plan = getUserPlan()) {
    const count = Array.isArray(existingCount) ? existingCount.length : Number(existingCount || 0);
    return count < Number(plan.performanceSessionLimit ?? 1);
  }
  function getMaxPlaybackSpeed(plan = getUserPlan()) { return Number(plan.maxPlaybackSpeed || 1); }
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

  // A missing permission module must never turn a restricted control into an
  // allowed one. The data-plan-feature contract is shared by chart controls,
  // settings, menus, and future premium actions.
  function guardFeature(feature, message) {
    if (canAccessFeature(feature)) return true;
    requestUpgrade(feature, message);
    return false;
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
        control.title = `${FEATURES[feature].label} is included with ${required.name} · ${required.tier}`;
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

  window.addEventListener("intensefx:subscription-changed", () => protectFeatureControls());
  document.addEventListener("DOMContentLoaded", () => protectFeatureControls());

  window.SubscriptionSystem = { PLANS, FEATURES, ORDER, GOLDEN_PASS, purchaseQuote, normalizePlan, getUserPlan, getUserEntitlements,
    canAccessFeature, requiredPlan, canCreateAccount, canCreateDemoAccount, canCreatePerformanceSession, getMaxPlaybackSpeed, getPermittedReplayRange, canAccessHistoricalData, canAccessReplayRange,
    guardFeature, protectFeatureControls, getVipPlanCode, redeemVipKey, requestUpgrade };
})();

