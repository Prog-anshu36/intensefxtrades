/* router.js — page switching & sidebar nav wiring */

const Router = {
  pages: {
    "dashboard": { title: "Dashboard", mod: () => PageDashboard },
    "trades": { title: "Trades", mod: () => PageTrades },
    "journal": { title: "Journal", mod: () => PageJournal },
    "performance": { title: "Analysis", mod: () => PagePerformance },
    "trade-analysis": { title: "Analysis", mod: () => PageTradeAnalysis },
    "ai-coach": { title: "AI Coach", mod: () => PageAICoach },
    "backtesting": { title: "Backtesting", mod: () => PageBacktesting },
    "prop-firm-session": { title: "Prop Firm Session", mod: () => window.PagePropFirmSession },
    "prop-chart": { title: "Prop Practice Chart", mod: () => window.PagePropChart },
    "prop-performance": { title: "Prop Performance", mod: () => window.PagePropPerformance },
    "prop-trade-analysis": { title: "Prop Trade Analysis", mod: () => window.PagePropTradeAnalysis },
    "prop-ai-coach": { title: "Prop AI Coach", mod: () => window.PagePropAICoach },
    "tradingview": { title: "TradingView", mod: () => PageTradingView },
    "subscription": { title: "Plans & Billing", mod: () => PageSubscription },
  },
  pageFeatures: { dashboard: "dashboard", trades: "trades", journal: "trades", performance: ["analysis", "performance"], "trade-analysis": "tradeAnalysis", "ai-coach": "aiCoach", backtesting: "backtesting", "prop-firm-session": "backtesting", "prop-chart": "backtesting", "prop-performance": ["backtesting", "performance"], "prop-trade-analysis": ["backtesting", "tradeAnalysis"], "prop-ai-coach": ["backtesting", "aiCoach"], tradingview: "tradingView" },
  current: "dashboard",

  updatePlanNavigation() {
    const system = window.SubscriptionSystem;
    const plan = system?.getUserPlan?.();
    const badge = document.getElementById("userPlanBadge");
    if (badge && plan) {
      badge.dataset.plan = plan.code;
      badge.style.setProperty("--plan-color", plan.color);
      const label = badge.querySelector("span");
      if (label) label.textContent = plan.name + " · " + plan.tier;
      badge.title = "Current plan: " + plan.name + " · " + plan.tier + ". Open plans and billing.";
    }
    document.querySelectorAll(".nav-item[data-page]").forEach((item) => {
      const requirements = this.pageFeatures[item.dataset.page];
      const lockedFeature = Array.isArray(requirements)
        ? requirements.find((feature) => !system?.canAccessFeature(feature))
        : requirements && !system?.canAccessFeature(requirements) ? requirements : null;
      const locked = Boolean(lockedFeature);
      item.classList.toggle("plan-locked", locked);
      if (locked) {
        const plan = system?.requiredPlan(lockedFeature);
        const label = plan ? plan.name + " · " + plan.tier : "Plan required";
        item.dataset.lockedFeature = lockedFeature;
        item.dataset.planLabel = label;
        item.title = (system?.FEATURES?.[lockedFeature]?.label || item.dataset.page) + " · " + label;
        item.setAttribute("aria-label", item.textContent.trim() + ", locked: " + label);
      } else {
        delete item.dataset.lockedFeature;
        delete item.dataset.planLabel;
        item.removeAttribute("aria-label");
      }
    });
  },

  init() {
    this.updatePlanNavigation();
    document.getElementById("userPlanBadge")?.addEventListener("click", () => this.go("subscription"));
    window.addEventListener("intensefx:subscription-changed", () => this.updatePlanNavigation());
    document.querySelectorAll(".nav-item[data-page]").forEach((item) => {
      item.setAttribute("role", "button");
      item.setAttribute("tabindex", item.classList.contains("disabled") ? "-1" : "0");
      item.addEventListener("click", () => {
        const page = item.dataset.page;
        if (!this.pages[page]) return; // disabled / coming soon pages
        this.go(page);
      });
      item.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        item.click();
      });
    });

    document.querySelectorAll(".nav-group-toggle").forEach((toggle) => {
      toggle.addEventListener("click", () => {
        const group = toggle.dataset.group;
        toggle.classList.toggle("open");
        document.querySelector(`.nav-sub[data-group="${group}"]`).classList.toggle("open");
      });
    });

    document.querySelector('.nav-group-toggle[data-group="analysis"]')?.classList.add("open");
    document.querySelector('.nav-sub[data-group="analysis"]')?.classList.add("open");

    window.addEventListener("hashchange", () => {
      const page = this.pageFromHash();
      if (page && page !== this.current) this.go(page, { fromHash: true });
    });

    this.go(this.pageFromHash() || this.current, { fromHash: true });
  },

  pageFromHash() {
    const page = (window.location.hash || "").replace(/^#/, "").trim();
    return this.pages[page] ? page : null;
  },

  go(page, options = {}) {
    if (!this.pages[page]) return;
    this.updatePlanNavigation();
    const pageRequirement = this.pageFeatures[page];
    const feature = Array.isArray(pageRequirement)
      ? pageRequirement.find((required) => !window.SubscriptionSystem?.canAccessFeature(required))
      : pageRequirement;
    let subscriptionRedirect = false;
    if (feature && !window.SubscriptionSystem?.canAccessFeature(feature)) {
      const requested = page;
      page = "subscription";
      if (window.PageSubscription) PageSubscription.pendingFeature = feature;
      subscriptionRedirect = true;
      if (window.PageSubscription && window.SubscriptionSystem) PageSubscription.message = "The " + requested.replaceAll("-", " ") + " workspace is available on " + window.SubscriptionSystem.requiredPlan(feature).name + " · " + window.SubscriptionSystem.requiredPlan(feature).tier + ".";
    }
    // tear down previous page (stop timers etc.)
    const prevMod = this.pages[this.current] ? this.pages[this.current].mod() : null;
    if (prevMod && prevMod.cleanup) prevMod.cleanup();

    this.current = page;

    // Keep the desktop workspace/tab model in lockstep with the routed page.
    // Without this event, a sidebar navigation can leave the visible page and
    // the active workspace tab pointing at different screens until the next
    // periodic workspace capture.
    window.dispatchEvent(new CustomEvent("tfb:route-change", { detail: { page } }));

    document.querySelectorAll(".nav-item").forEach((el) => el.classList.remove("active"));
    const navEl = document.querySelector(`.nav-item[data-page="${page}"]`);
    if (navEl) navEl.classList.add("active");

    // auto-expand the Analysis group if navigating into it
    if (page === "performance" || page === "trade-analysis" || page === "ai-coach") {
      document.querySelector('.nav-group-toggle[data-group="analysis"]')?.classList.add("open");
      document.querySelector('.nav-sub[data-group="analysis"]')?.classList.add("open");
    }

    if (page.startsWith('prop-')) {
      document.querySelector('.nav-group-toggle[data-group="prop-analysis"]')?.classList.add('open');
      document.querySelector('.nav-sub[data-group="prop-analysis"]')?.classList.add('open');
    }
    const meta = this.pages[page];
    document.getElementById("pageTitle").textContent = meta.title;

    const container = document.getElementById("pageContainer");
    const pageMod = meta.mod();
    // init() seeds page-local state (e.g. candle history). Only run it the
    // first time we visit a page, so an in-progress replay/session survives
    // navigating away and back.
    if (pageMod.init && !pageMod._initialized) {
      pageMod.init();
      pageMod._initialized = true;
    }
    container.innerHTML = pageMod.render();
    if (pageMod.afterRender) pageMod.afterRender(container);

    if ((!options.fromHash || subscriptionRedirect) && window.location.hash !== `#${page}`) {
      window.location.hash = page;
    }
  },
};

if (typeof window !== "undefined") window.Router = Router;
