/* store.js — central app state, synced with backend, shared across pages. */

const Store = {
  state: {
    balance: 10000,
    initial_balance: 10000,
    active_trades: [],
    pending_orders: [],
    history: [],
    journal: [],
    settings: { symbol: "EURUSD", timeframe: "1h", current_idx: 200, theme: "dark" },
  },
  listeners: [],
  _refreshInFlight: null,

  async init() {
    const data = await API.getState();
    this.state = data;
    this.notify();
    return this.state;
  },

  subscribe(fn) {
    this.listeners.push(fn);
    return () => { this.listeners = this.listeners.filter((l) => l !== fn); };
  },

  notify() {
    this.listeners.forEach((fn) => fn(this.state));
  },

  async refresh({ fresh = false } = {}) {
    // A post-mutation read must not reuse a GET started before that mutation.
    if (fresh && this._refreshInFlight) {
      try { await this._refreshInFlight; } catch (_) { /* retry the latest state */ }
    }
    if (this._refreshInFlight) return this._refreshInFlight;
    const accountAtStart = this.state.active_account_id;
    this._refreshInFlight = API.getState()
      .then((data) => {
        if (accountAtStart && (this.state.active_account_id !== accountAtStart || data.active_account_id !== accountAtStart)) return this.state;
        this.state = data;
        this.notify();
        return data;
      })
      .finally(() => { this._refreshInFlight = null; });
    return this._refreshInFlight;
  },

  // ---- derived helpers ----
  equity() {
    const floating = this.state.active_trades.reduce((s, t) => s + (t.floating_pnl || 0), 0);
    return this.state.balance + floating;
  },

  floatingPnl() {
    return this.state.active_trades.reduce((s, t) => s + (t.floating_pnl || 0), 0);
  },

  metrics(historyOverride) {
    const history = historyOverride || this.state.history;
    if (typeof TradeAnalyticsEngine !== "undefined") {
      const journal = historyOverride ? [] : (this.state.journal || []);
      const trades = TradeAnalyticsEngine.normalizeTrades(history, journal);
      const p = TradeAnalyticsEngine.performance(trades, this.state.initial_balance || 10000);
      return {
        ...p,
        avgWin: p.avgWin,
        avgLoss: p.avgLoss,
        best: p.largestWin,
        worst: p.largestLoss,
        winStreak: p.winStreak,
        lossStreak: p.lossStreak,
        wins: p.winningTrades,
        losses: p.losingTrades,
      };
    }
    const total = history.length;
    if (total === 0) {
      return {
        totalPnl: 0, winRate: 0, profitFactor: 0, expectancy: 0,
        avgWin: 0, avgLoss: 0, best: 0, worst: 0,
        winStreak: 0, lossStreak: 0, wins: 0, losses: 0,
      };
    }
    const pnls = history.map((t) => t.pnl);
    const wins = pnls.filter((p) => p > 0);
    const losses = pnls.filter((p) => p <= 0);
    const grossProfit = wins.reduce((a, b) => a + b, 0);
    const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));
    const totalPnl = pnls.reduce((a, b) => a + b, 0);

    let streak = 0, maxWinStreak = 0, maxLossStreak = 0, isWinning = null;
    for (const p of pnls) {
      const win = p > 0;
      if (isWinning === win) streak++; else { isWinning = win; streak = 1; }
      if (win) maxWinStreak = Math.max(maxWinStreak, streak);
      else maxLossStreak = Math.max(maxLossStreak, streak);
    }

    return {
      totalPnl,
      winRate: (wins.length / total) * 100,
      profitFactor: grossLoss === 0 ? (grossProfit > 0 ? Infinity : 0) : grossProfit / grossLoss,
      expectancy: totalPnl / total,
      avgWin: wins.length ? grossProfit / wins.length : 0,
      avgLoss: losses.length ? -grossLoss / losses.length : 0,
      best: pnls.length ? Math.max(...pnls) : 0,
      worst: pnls.length ? Math.min(...pnls) : 0,
      winStreak: maxWinStreak,
      lossStreak: maxLossStreak,
      wins: wins.length,
      losses: losses.length,
    };
  },
};
