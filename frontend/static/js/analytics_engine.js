/* analytics_engine.js - professional trade analytics and journaling engines.
   Reads existing Store state; does not mutate trading, replay, drawing, or chart logic. */

const TradeAnalyticsEngine = {
  checklistDefaults: ["HTF Trend", "Liquidity Sweep", "BOS", "CHOCH", "Order Block", "FVG", "Risk 1%", "News Checked", "Patience", "Discipline"],
  emotionDefaults: ["fear", "greed", "fomo", "revenge", "patience", "confidence", "stress", "calm", "discipline", "excitement"],
  strategyDefaults: ["ICT", "SMC", "Breakout", "Scalp", "Swing", "Trend", "Range"],

  snapshot(state = Store.state) {
    const trades = this.normalizeTrades(state.history || [], state.journal || []);
    const performance = this.performance(trades, state.initial_balance || 10000);
    const risk = this.risk(trades, state.initial_balance || 10000);
    const sessions = this.groupAnalytics(trades, (t) => t.session);
    const symbols = this.groupAnalytics(trades, (t) => t.symbol);
    const strategies = this.groupAnalytics(trades, (t) => t.strategy || "Unspecified");
    const emotions = this.groupAnalytics(trades, (t) => t.emotion || "Unspecified");
    const calendar = this.calendar(trades);
    const time = this.timeAnalytics(trades);
    const insights = this.insights({ trades, performance, risk, sessions, symbols, strategies, emotions, time });
    return { trades, performance, risk, sessions, symbols, strategies, emotions, calendar, time, insights };
  },

  normalizeTrades(history, journal) {
    const byTrade = new Map();
    journal.forEach((entry) => {
      if (!entry.trade_id) return;
      if (!byTrade.has(entry.trade_id)) byTrade.set(entry.trade_id, []);
      byTrade.get(entry.trade_id).push(entry);
    });
    return history.map((trade) => {
      const entries = byTrade.get(trade.id) || [];
      const latest = entries[0] || {};
      const opened = new Date(trade.opened_at || trade.closed_at || Date.now());
      const closed = new Date(trade.closed_at || trade.opened_at || Date.now());
      const durationMs = Math.max(0, closed - opened);
      const tags = [...new Set([...(trade.tags || []), ...(latest.tags || [])])];
      return {
        ...trade,
        pnl: Number(trade.pnl || 0),
        lots: Number(trade.lots || 0),
        journalEntries: entries,
        tags,
        strategy: latest.strategy || trade.strategy || this.tagMatch(tags, this.strategyDefaults) || "Unspecified",
        session: latest.session || this.sessionForDate(opened),
        emotion: latest.emotion || latest.mood || "Unspecified",
        mistake: latest.mistake || "",
        lesson: latest.lesson || "",
        confidence: Number(latest.confidence || 0),
        executionRating: Number(latest.execution_rating || latest.executionRating || 0),
        tradeRating: Number(latest.trade_rating || latest.tradeRating || 0),
        marketCondition: latest.market_condition || latest.marketCondition || "",
        checklist: latest.checklist || {},
        screenshots: latest.screenshots || [],
        durationMs,
        rr: this.estimateRR(trade),
        riskAmount: this.estimateRisk(trade),
      };
    });
  },

  performance(trades, initialBalance) {
    const total = trades.length;
    const wins = trades.filter((t) => t.pnl > 0);
    const losses = trades.filter((t) => t.pnl < 0);
    const grossProfit = this.sum(wins, "pnl");
    const grossLoss = Math.abs(this.sum(losses, "pnl"));
    const netProfit = this.sum(trades, "pnl");
    const avgWin = wins.length ? grossProfit / wins.length : 0;
    const avgLoss = losses.length ? -grossLoss / losses.length : 0;
    const largestWin = wins.length ? Math.max(...wins.map((t) => t.pnl)) : 0;
    const largestLoss = losses.length ? Math.min(...losses.map((t) => t.pnl)) : 0;
    const avgRR = this.avg(trades.map((t) => t.rr).filter(Number.isFinite));
    const expectancy = total ? netProfit / total : 0;
    const maxDrawdown = this.maxDrawdown(trades, initialBalance);
    const avgWinAbs = Math.max(avgWin, 0);
    const avgLossAbs = Math.abs(avgLoss);
    const winRate = total ? wins.length / total : 0;
    const lossRate = total ? losses.length / total : 0;
    const kelly = avgLossAbs ? winRate - (lossRate / (avgWinAbs / avgLossAbs || 1)) : 0;
    return {
      totalTrades: total,
      winningTrades: wins.length,
      losingTrades: losses.length,
      winRate: winRate * 100,
      lossRate: lossRate * 100,
      grossProfit,
      grossLoss,
      netProfit,
      totalPnl: netProfit,
      avgWin,
      avgLoss,
      largestWin,
      largestLoss,
      best: largestWin,
      worst: largestLoss,
      profitFactor: grossLoss ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
      avgRR,
      expectancy,
      avgHoldingTime: this.avg(trades.map((t) => t.durationMs)),
      winStreak: this.maxStreak(trades, true),
      lossStreak: this.maxStreak(trades, false),
      wins: wins.length,
      losses: losses.length,
      kellyPercentage: Math.max(0, kelly * 100),
      recoveryFactor: maxDrawdown ? netProfit / Math.abs(maxDrawdown) : 0,
      maxDrawdown,
    };
  },

  risk(trades, initialBalance) {
    const risks = trades.map((t) => t.riskAmount).filter(Number.isFinite);
    const daily = this.periodDrawdown(trades, "day");
    const weekly = this.periodDrawdown(trades, "week");
    const monthly = this.periodDrawdown(trades, "month");
    return {
      averageRisk: this.avg(risks),
      largestRisk: risks.length ? Math.max(...risks) : 0,
      dailyDrawdown: daily,
      weeklyDrawdown: weekly,
      monthlyDrawdown: monthly,
      maximumDrawdown: this.maxDrawdown(trades, initialBalance),
      riskConsistency: this.consistencyScore(risks),
      averagePositionSize: this.avg(trades.map((t) => t.lots)),
      averageStopLoss: this.avg(trades.map((t) => Math.abs((t.entry || 0) - (t.sl || t.entry || 0))).filter((v) => v > 0)),
      averageTakeProfit: this.avg(trades.map((t) => Math.abs((t.tp || t.entry || 0) - (t.entry || 0))).filter((v) => v > 0)),
      averageTradeDuration: this.avg(trades.map((t) => t.durationMs)),
    };
  },

  groupAnalytics(trades, keyFn) {
    const groups = {};
    trades.forEach((trade) => {
      const key = keyFn(trade) || "Unspecified";
      if (!groups[key]) groups[key] = [];
      groups[key].push(trade);
    });
    return Object.entries(groups).map(([name, rows]) => {
      const p = this.performance(rows, 0);
      return {
        name,
        trades: rows.length,
        winRate: p.winRate,
        profit: p.netProfit,
        loss: p.grossLoss,
        averageRR: p.avgRR,
        averageHoldingTime: p.avgHoldingTime,
        bestSymbol: this.bestBy(rows, "symbol"),
        worstSymbol: this.worstBy(rows, "symbol"),
        bestStrategy: this.bestBy(rows, "strategy"),
        bestSession: this.bestBy(rows, "session"),
      };
    }).sort((a, b) => b.profit - a.profit);
  },

  calendar(trades) {
    const days = {};
    trades.forEach((trade) => {
      const key = this.dateKey(trade.closed_at || trade.opened_at);
      if (!days[key]) days[key] = { date: key, trades: [], pnl: 0, wins: 0, losses: 0 };
      days[key].trades.push(trade);
      days[key].pnl += trade.pnl;
      if (trade.pnl > 0) days[key].wins += 1; else days[key].losses += 1;
    });
    return Object.values(days).map((day) => ({
      ...day,
      status: day.pnl > 0 ? "green" : day.pnl < 0 ? "red" : "neutral",
      winRate: day.trades.length ? (day.wins / day.trades.length) * 100 : 0,
    })).sort((a, b) => a.date.localeCompare(b.date));
  },

  timeAnalytics(trades) {
    const byHour = this.pnlGroups(trades, (t) => new Date(t.opened_at || t.closed_at).getHours());
    const byWeekday = this.pnlGroups(trades, (t) => new Date(t.opened_at || t.closed_at).toLocaleDateString("en-US", { weekday: "short" }));
    const byMonth = this.pnlGroups(trades, (t) => new Date(t.opened_at || t.closed_at).toLocaleDateString("en-US", { month: "short" }));
    return {
      byHour,
      byWeekday,
      byMonth,
      bestTradingHour: byHour[0]?.name ?? "--",
      worstTradingHour: byHour.at(-1)?.name ?? "--",
      bestWeekday: byWeekday[0]?.name ?? "--",
      worstWeekday: byWeekday.at(-1)?.name ?? "--",
      bestMonth: byMonth[0]?.name ?? "--",
      worstMonth: byMonth.at(-1)?.name ?? "--",
    };
  },

  insights(snapshot) {
    const { trades, performance, risk, sessions, symbols, strategies, emotions } = snapshot;
    const insights = [];
    if (!trades.length) return [{ title: "No trade data yet", body: "Close trades and add journal notes to unlock behavioral analytics.", severity: "info" }];
    const todayCount = trades.filter((t) => this.dateKey(t.closed_at) === this.dateKey(new Date())).length;
    if (todayCount >= 5) insights.push({ title: "Overtrading risk", body: `${todayCount} trades today. Review whether every trade followed the checklist.`, severity: "warning" });
    if (performance.profitFactor < 1) insights.push({ title: "Negative edge", body: "Profit factor is below 1.0; reduce size and isolate the worst session/strategy first.", severity: "danger" });
    if (risk.riskConsistency < 65) insights.push({ title: "Risk inconsistency", body: "Position risk varies heavily. Standardize risk before evaluating strategy quality.", severity: "warning" });
    const worstSession = sessions.at(-1);
    if (worstSession?.trades >= 2 && worstSession.profit < 0) insights.push({ title: "Weak session", body: `${worstSession.name} is currently the weakest session at ${this.money(worstSession.profit)}.`, severity: "warning" });
    const bestSymbol = symbols[0];
    if (bestSymbol?.trades) insights.push({ title: "Best symbol", body: `${bestSymbol.name} is your strongest symbol with ${this.money(bestSymbol.profit)} net.`, severity: "success" });
    const worstStrategy = strategies.at(-1);
    if (worstStrategy?.trades >= 2 && worstStrategy.profit < 0) insights.push({ title: "Strategy drag", body: `${worstStrategy.name} is underperforming. Compare its screenshots and checklist misses.`, severity: "warning" });
    const revenge = emotions.find((e) => ["revenge", "fomo", "fear", "greed"].includes(String(e.name).toLowerCase()) && e.profit < 0);
    if (revenge) insights.push({ title: "Psychology pattern", body: `${revenge.name} trades are negative overall. Add a pre-entry pause rule for that state.`, severity: "warning" });
    return insights.slice(0, 8);
  },

  search(query, state = Store.state) {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return [];
    const snap = this.snapshot(state);
    return snap.trades.filter((t) => [
      t.id, t.symbol, t.type, t.session, t.strategy, t.emotion, t.mistake, t.lesson,
      ...(t.tags || []), ...(t.journalEntries || []).flatMap((j) => [j.title, j.note, ...(j.tags || [])]),
    ].some((v) => String(v || "").toLowerCase().includes(q)));
  },

  report(period = "all", state = Store.state) {
    const snap = this.snapshot(state);
    return { generatedAt: new Date().toISOString(), period, account: state.active_account_id, ...snap };
  },

  exportCsv(trades) {
    const cols = ["id", "symbol", "type", "entry", "exit", "lots", "pnl", "result", "session", "strategy", "emotion", "closed_at"];
    return [cols.join(","), ...trades.map((t) => cols.map((c) => JSON.stringify(t[c] ?? "")).join(","))].join("\n");
  },

  estimateRisk(t) {
    if (t.risk != null && Number.isFinite(Number(t.risk))) return Number(t.risk);
    const contracts = {XAUUSD:100, GOLD:100, EURUSD:100000, GBPUSD:100000, USDJPY:100000, BTCUSD:1, ETHUSD:1};
    if (t.sl && t.entry && contracts[t.symbol]) return Math.abs(Number(t.entry) - Number(t.sl)) * Number(t.lots || 0) * contracts[t.symbol];
    return null;
  },

  estimateRR(t) {
    if (t.tp && t.sl && t.entry) {
      const reward = Math.abs(Number(t.tp) - Number(t.entry));
      const risk = Math.abs(Number(t.entry) - Number(t.sl));
      return risk ? reward / risk : 0;
    }
    const risk = this.estimateRisk(t);
    return risk ? Number(t.pnl || 0) / risk : null;
  },

  sessionForDate(date) {
    const h = new Date(date).getUTCHours();
    if (h >= 21 || h < 6) return "Sydney";
    if (h >= 0 && h < 9) return "Tokyo";
    if (h >= 7 && h < 16) return "London";
    if (h >= 12 && h < 21) return "New York";
    return "Overlap";
  },

  maxDrawdown(trades, initialBalance) {
    let equity = initialBalance || 0, peak = equity, maxDd = 0;
    [...trades].sort((a, b) => new Date(a.closed_at || 0) - new Date(b.closed_at || 0)).forEach((t) => {
      equity += t.pnl;
      peak = Math.max(peak, equity);
      maxDd = Math.min(maxDd, equity - peak);
    });
    return maxDd;
  },

  periodDrawdown(trades, mode) {
    const groups = this.pnlGroups(trades, (t) => {
      const d = new Date(t.closed_at || t.opened_at);
      if (mode === "day") return this.dateKey(d);
      if (mode === "week") return `${d.getFullYear()}-W${Math.ceil((((d - new Date(d.getFullYear(), 0, 1)) / 86400000) + 1) / 7)}`;
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    });
    return groups.length ? Math.min(...groups.map((g) => g.profit)) : 0;
  },

  pnlGroups(trades, keyFn) {
    const grouped = {};
    trades.forEach((t) => {
      const key = keyFn(t);
      if (!grouped[key]) grouped[key] = { name: key, trades: 0, profit: 0 };
      grouped[key].trades += 1;
      grouped[key].profit += t.pnl;
    });
    return Object.values(grouped).sort((a, b) => b.profit - a.profit);
  },

  maxStreak(trades, winning) {
    let streak = 0, max = 0;
    trades.forEach((t) => {
      if ((t.pnl > 0) === winning) streak += 1; else streak = 0;
      max = Math.max(max, streak);
    });
    return max;
  },

  consistencyScore(values) {
    if (values.length < 2) return 100;
    const avg = this.avg(values);
    const variance = this.avg(values.map((v) => Math.pow(v - avg, 2)));
    const cv = Math.sqrt(variance) / Math.max(Math.abs(avg), 1e-9);
    return Math.max(0, Math.min(100, 100 - cv * 100));
  },

  bestBy(rows, key) {
    return this.pnlGroups(rows, (t) => t[key] || "Unspecified")[0]?.name || "--";
  },

  worstBy(rows, key) {
    return this.pnlGroups(rows, (t) => t[key] || "Unspecified").at(-1)?.name || "--";
  },

  tagMatch(tags, allowed) {
    const lower = tags.map((t) => String(t).toLowerCase());
    return allowed.find((item) => lower.includes(item.toLowerCase()));
  },

  dateKey(date) {
    const d = new Date(date || Date.now());
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  },

  avg(values) {
    const nums = values.filter((v) => Number.isFinite(v));
    return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
  },

  sum(rows, key) {
    return rows.reduce((sum, row) => sum + Number(row[key] || 0), 0);
  },

  money(value) {
    return `${value >= 0 ? "+" : ""}${Number(value || 0).toFixed(2)}`;
  },
};
