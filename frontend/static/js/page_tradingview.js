/* page_tradingview.js - Online TradingView Advanced Chart Widget page */

const TradingViewWidgetLoader = (() => {
  const SCRIPT_ID = "tradingview-widget-script";
  const SCRIPT_SRC = "https://s3.tradingview.com/tv.js";
  let loadPromise = null;

  function isReady() {
    return !!(window.TradingView && typeof window.TradingView.widget === "function");
  }

  function load() {
    if (isReady()) return Promise.resolve(window.TradingView);
    if (loadPromise) return loadPromise;

    loadPromise = new Promise((resolve, reject) => {
      const existing = document.getElementById(SCRIPT_ID);
      if (existing) {
        if (isReady()) {
          resolve(window.TradingView);
          return;
        }
        if (existing.dataset.status === "error") existing.remove();
      }

      const current = document.getElementById(SCRIPT_ID);
      if (current) {
        existing.addEventListener("load", () => resolve(window.TradingView), { once: true });
        existing.addEventListener("error", () => {
          loadPromise = null;
          reject(new Error("TradingView widget script failed to load."));
        }, { once: true });
        return;
      }

      const script = document.createElement("script");
      script.id = SCRIPT_ID;
      script.src = SCRIPT_SRC;
      script.async = true;
      script.onload = () => {
        script.dataset.status = "loaded";
        if (isReady()) {
          resolve(window.TradingView);
        } else {
          loadPromise = null;
          reject(new Error("TradingView widget API was not available after script load."));
        }
      };
      script.onerror = () => {
        script.dataset.status = "error";
        script.remove();
        loadPromise = null;
        reject(new Error("TradingView widget script failed to load."));
      };
      document.head.appendChild(script);
    });

    return loadPromise;
  }

  return { load, isReady, SCRIPT_SRC };
})();

const PageTradingView = {
  TRADINGVIEW_DEFAULT_SYMBOL: "FX_IDC:XAUUSD",
  TRADINGVIEW_DEFAULT_INTERVAL: "1",
  TRADINGVIEW_DEFAULT_RANGE: "YTD",
  TRADINGVIEW_DEFAULT_GO_TO_DATE: "2026-01-01",
  _initialized: false,
  widget: null,
  loadTimeout: null,
  mountToken: 0,
  chartReady: false,

  init() {},

  render() {
    return `
      <section class="tradingview-page" aria-label="TradingView online chart">
        <div class="tradingview-page-head">
          <div>
            <h2>TradingView</h2>
          </div>
          <div class="tradingview-page-actions">
            <label class="tradingview-date-jump">
              <span>Go to</span>
              <input type="date" id="tradingViewDateInput" value="${this.TRADINGVIEW_DEFAULT_GO_TO_DATE}" min="2026-01-01">
            </label>
            <button class="tradingview-action-btn primary" id="tradingViewDateGoBtn" type="button" title="Go to selected date">
              ${this.iconSvg("calendar")}
              <span>GO</span>
            </button>
            <button class="tradingview-action-btn" id="tradingViewRefreshBtn" type="button" title="Reload TradingView chart">
              ${this.iconSvg("refresh")}
            </button>
            <button class="tradingview-action-btn" id="tradingViewOpenBtn" type="button" title="Open chart on TradingView">
              ${this.iconSvg("external")}
            </button>
            <span class="tradingview-online-pill">Online</span>
          </div>
        </div>
        <div class="tradingview-page-note" id="tradingViewDateNote" role="status" hidden></div>
        <div class="tradingview-widget-shell">
          <div class="tradingview-state tradingview-loading" id="tradingViewLoading">
            <div class="tradingview-spinner"></div>
            <strong>Loading TradingView...</strong>
            <span>This page requires internet access.</span>
          </div>
          <div class="tradingview-state tradingview-error" id="tradingViewError" hidden>
            <strong>Unable to load TradingView.</strong>
            <span>Check your internet connection and try again.</span>
            <button class="empty-action" id="tradingViewRetryBtn" type="button">Retry</button>
          </div>
          <div class="tradingview-widget-frame" id="tradingViewWidgetHost"></div>
        </div>
      </section>
    `;
  },

  afterRender(container) {
    this.container = container;
    this.host = container.querySelector("#tradingViewWidgetHost");
    this.loadingEl = container.querySelector("#tradingViewLoading");
    this.errorEl = container.querySelector("#tradingViewError");
    container.querySelector("#tradingViewRetryBtn")?.addEventListener("click", () => this.mountWidget());
    container.querySelector("#tradingViewDateGoBtn")?.addEventListener("click", () => this.goToSelectedDate());
    container.querySelector("#tradingViewRefreshBtn")?.addEventListener("click", () => this.mountWidget());
    container.querySelector("#tradingViewOpenBtn")?.addEventListener("click", () => this.openTradingView());
    this.mountWidget();
  },

  cleanup() {
    this.mountToken += 1;
    this.chartReady = false;
    clearTimeout(this.loadTimeout);
    this.loadTimeout = null;
    if (this.widget && typeof this.widget.remove === "function") {
      try { this.widget.remove(); } catch (error) { console.warn("TradingView cleanup failed", error); }
    }
    this.widget = null;
    if (this.host) this.host.innerHTML = "";
  },

  openTradingView() {
    const symbol = encodeURIComponent(this.TRADINGVIEW_DEFAULT_SYMBOL);
    window.open(`https://www.tradingview.com/chart/?symbol=${symbol}`, "_blank", "noopener,noreferrer");
  },

  setStatus(status) {
    if (!this.loadingEl || !this.errorEl || !this.host) return;
    this.loadingEl.hidden = status !== "loading";
    this.errorEl.hidden = status !== "error";
    this.host.hidden = status !== "ready";
  },

  async mountWidget() {
    if (!this.host) return;
    this.cleanup();
    const token = this.mountToken;
    this.setStatus("loading");

    let timedOut = false;
    const timeoutPromise = new Promise((_, reject) => {
      this.loadTimeout = setTimeout(() => {
        timedOut = true;
        reject(new Error("TradingView load timed out."));
      }, 15000);
    });

    try {
      await Promise.race([TradingViewWidgetLoader.load(), timeoutPromise]);
      if (timedOut || !this.host || token !== this.mountToken) return;
      clearTimeout(this.loadTimeout);
      this.loadTimeout = null;
      this.host.innerHTML = "";
      this.host.hidden = false;
      this.widget = new window.TradingView.widget(this.widgetOptions());
      this.bindWidgetReady(token);
      this.setStatus("ready");
    } catch (error) {
      if (token !== this.mountToken) return;
      clearTimeout(this.loadTimeout);
      this.loadTimeout = null;
      console.error("Unable to load TradingView", error);
      this.setStatus("error");
    }
  },

  bindWidgetReady(token) {
    if (!this.widget || typeof this.widget.onChartReady !== "function") return;
    try {
      this.widget.onChartReady(() => {
        if (token !== this.mountToken) return;
        this.chartReady = true;
      });
    } catch (error) {
      console.warn("TradingView chart ready hook unavailable", error);
    }
  },

  goToSelectedDate() {
    const input = this.container?.querySelector("#tradingViewDateInput");
    const requested = input?.value || this.TRADINGVIEW_DEFAULT_GO_TO_DATE;
    this.goToDate(requested);
  },

  goToDate(dateValue) {
    const note = this.container?.querySelector("#tradingViewDateNote");
    if (note) note.hidden = false;
    const date = new Date(`${dateValue}T00:00:00Z`);
    if (!Number.isFinite(date.getTime())) {
      if (note) note.textContent = "Choose a valid date first.";
      return false;
    }

    const from = Math.floor(date.getTime() / 1000);
    const daysToShow = this.visibleWindowDaysForInterval(this.TRADINGVIEW_DEFAULT_INTERVAL);
    const to = from + daysToShow * 86400;
    const chart = this.getActiveTradingViewChart();

    if (!chart || typeof chart.setVisibleRange !== "function") {
      if (note) {
        note.textContent = "TradingView did not expose direct date navigation in this embed yet. Use the widget's YTD/date-range controls, or drag/scroll left through available 1m history.";
      }
      toast?.("Use TradingView's built-in date controls or scroll the chart left.", "info");
      return false;
    }

    try {
      chart.setVisibleRange({ from, to });
      if (note) {
        note.textContent = `Requested ${dateValue}. If that date has no candle, TradingView will show the nearest available data from ${this.TRADINGVIEW_DEFAULT_SYMBOL}.`;
      }
      return true;
    } catch (error) {
      console.warn("TradingView date navigation failed", error);
      if (note) note.textContent = "TradingView could not navigate to that date for the selected symbol/feed.";
      toast?.("TradingView could not navigate to that date.", "error");
      return false;
    }
  },

  getActiveTradingViewChart() {
    if (!this.widget) return null;
    try {
      if (typeof this.widget.activeChart === "function") return this.widget.activeChart();
      if (typeof this.widget.chart === "function") return this.widget.chart();
    } catch (error) {
      console.warn("TradingView active chart API unavailable", error);
    }
    return null;
  },

  visibleWindowDaysForInterval(interval) {
    const intradayMinutes = Number(interval);
    if (Number.isFinite(intradayMinutes) && intradayMinutes <= 30) return 21;
    if (Number.isFinite(intradayMinutes)) return 45;
    if (interval === "D") return 180;
    return 60;
  },

  iconSvg(name) {
    const icons = {
      calendar: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v4M17 3v4M4 9h16M6 5h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"/></svg>`,
      refresh: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6v5h-5M4 18v-5h5M18.6 9a7 7 0 0 0-11.8-2.4L4 9.2M20 14.8l-2.8 2.6A7 7 0 0 1 5.4 15"/></svg>`,
      external: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M20 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4"/></svg>`,
    };
    return icons[name] || "";
  },

  widgetOptions() {
    return {
      autosize: true,
      symbol: this.TRADINGVIEW_DEFAULT_SYMBOL,
      interval: this.TRADINGVIEW_DEFAULT_INTERVAL,
      range: this.TRADINGVIEW_DEFAULT_RANGE,
      timezone: "Asia/Kolkata",
      theme: "dark",
      style: "1",
      locale: "en",
      enable_publishing: false,
      allow_symbol_change: true,
      withdateranges: true,
      time_frames: [
        { text: "5y", resolution: "1W", description: "5 Years" },
        { text: "1y", resolution: "1D", description: "1 Year" },
        { text: "ytd", resolution: "1", description: "Year to Date" },
        { text: "6m", resolution: "1", description: "6 Months" },
        { text: "3m", resolution: "1", description: "3 Months" },
        { text: "1m", resolution: "1", description: "1 Month" },
        { text: "5d", resolution: "1", description: "5 Days" },
        { text: "1d", resolution: "1", description: "1 Day" },
      ],
      hide_side_toolbar: false,
      hide_top_toolbar: false,
      hide_legend: false,
      hide_volume: false,
      save_image: true,
      calendar: false,
      support_host: "https://www.tradingview.com",
      container_id: "tradingViewWidgetHost",
      studies: ["Volume@tv-basicstudies"],
    };
  },
};

window.TradingViewWidgetLoader = TradingViewWidgetLoader;
window.PageTradingView = PageTradingView;
