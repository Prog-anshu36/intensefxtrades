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
    "tradingview": { title: "TradingView", mod: () => PageTradingView },
  },
  current: "dashboard",

  init() {
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

    if (!options.fromHash && window.location.hash !== `#${page}`) {
      window.location.hash = page;
    }
  },
};
