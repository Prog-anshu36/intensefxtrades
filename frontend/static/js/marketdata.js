/* marketdata.js — local XAUUSD history plus deterministic non-local fixtures.
   XAUUSD/GOLD always use the backend local CSV provider. Other instruments keep
   the existing deterministic fixture fallback used by the demo workspace. */

const MarketData = (() => {

  // Simple seeded PRNG (mulberry32) for reproducible "history"
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashStr(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; }
    return h;
  }

  const SYMBOLS = {
    EURUSD: { base: 1.1850, vol: 0.00045, decimals: 5, pip: 0.0001, kind: "fx", color: "#3d7fff" },
    GBPUSD: { base: 1.2680, vol: 0.00055, decimals: 5, pip: 0.0001, kind: "fx", color: "#1ec98b" },
    USDJPY: { base: 154.20, vol: 0.045,   decimals: 3, pip: 0.01,   kind: "fx", color: "#d9a441" },
    XAUUSD: { base: 3390.20, vol: 1.85,   decimals: 2, pip: 0.1,    kind: "metal", color: "#f3c969" },
    BTCUSD: { base: 96500,  vol: 145,     decimals: 1, pip: 1,      kind: "crypto", color: "#ff9f43" },
    ETHUSD: { base: 3500,   vol: 18,      decimals: 2, pip: 0.1,    kind: "crypto", color: "#627eea" },
    GOLD:   { base: 3390.20, vol: 1.85,   decimals: 2, pip: 0.1,    kind: "metal", color: "#f3c969" },
    SILVER: { base: 32.20,  vol: 0.055,   decimals: 3, pip: 0.01,   kind: "metal", color: "#b8beca" },
  };

  const TF_MINUTES = { "1m": 1, "3m": 3, "5m": 5, "15m": 15, "30m": 30, "1h": 60, "4h": 240, "1d": 1440, "1w": 10080, "1M": 43200 };

  // generate N candles ending "now" (simulated), going backwards
  function generate(symbol, timeframe, count = 600) {
    if (isLocal(symbol)) return [];
    const meta = SYMBOLS[symbol] || SYMBOLS.EURUSD;
    const tfMin = TF_MINUTES[timeframe] || 60;
    const seed = hashStr(`${symbol}_${timeframe}_v1`);
    const rand = mulberry32(seed);

    // mild trend regimes so price looks like it "moves somewhere" not pure noise
    let price = meta.base * (0.985 + rand() * 0.03);
    const candles = [];
    const now = new Date();
    // align "now" to timeframe grid roughly
    const msPerCandle = tfMin * 60 * 1000;
    let t = now.getTime() - count * msPerCandle;

    let trendBias = (rand() - 0.5) * 0.4;
    let trendCounter = 0;

    for (let i = 0; i < count; i++) {
      trendCounter++;
      if (trendCounter > 40 + rand() * 60) {
        trendBias = (rand() - 0.5) * 0.6;
        trendCounter = 0;
      }

      const open = price;
      const drift = trendBias * meta.vol;
      const shock = (rand() - 0.5) * 2 * meta.vol;
      let close = open + drift + shock;
      if (close <= 0) close = open * 0.999;

      const hi = Math.max(open, close) + rand() * meta.vol * 1.3;
      const lo = Math.min(open, close) - rand() * meta.vol * 1.3;
      const volume = Math.round(500 + rand() * 4500);

      candles.push({
        time: t,
        date: new Date(t),
        open: round(open, meta.decimals),
        high: round(hi, meta.decimals),
        low: round(lo, meta.decimals),
        close: round(close, meta.decimals),
        volume,
      });

      price = close;
      t += msPerCandle;
    }
    return candles;
  }

  function round(v, decimals) {
    const f = Math.pow(10, decimals);
    return Math.round(v * f) / f;
  }

  function listSymbols() {
    return Object.keys(SYMBOLS).map((k) => ({ symbol: k, ...SYMBOLS[k] }));
  }

  function getMeta(symbol) {
    return SYMBOLS[symbol] || SYMBOLS.EURUSD;
  }

  function isLocal(symbol) { return ["XAUUSD", "GOLD"].includes(String(symbol).toUpperCase()); }

  const historyCache = new Map();
  const pendingHistory = new Map();
  const MAX_HISTORY_CACHE = 8;

  function cacheKey(symbol, timeframe, count, options) {
    return JSON.stringify([String(symbol).toUpperCase(), timeframe, count, Object.keys(options || {}).sort().map((key) => [key, options[key]])]);
  }

  function clonePayload(payload, count) {
    return {
      ...payload,
      candles: (payload.candles || []).slice(-count).map((c) => ({ ...c, date: new Date(c.time) })),
    };
  }

  async function history(symbol, timeframe, count = 1800, options = {}) {
    const requestedCount = isLocal(symbol) ? Math.min(count, 5000) : count;
    const key = cacheKey(symbol, timeframe, requestedCount, options);
    if (historyCache.has(key)) {
      const cached = historyCache.get(key);
      historyCache.delete(key);
      historyCache.set(key, cached);
      return clonePayload(cached, count);
    }
    try {
      let pending = pendingHistory.get(key);
      if (!pending) {
        pending = Promise.resolve().then(() => API.getMarketHistory(symbol, timeframe, requestedCount, options));
        pendingHistory.set(key, pending);
      }
      let payload;
      try { payload = await pending; }
      finally { if (pendingHistory.get(key) === pending) pendingHistory.delete(key); }
      if (isLocal(symbol) && payload.source !== "local-csv") throw new Error("Unexpected XAUUSD data source");
      if (payload.candles && (payload.candles.length || payload.source === "local-csv")) {
        historyCache.set(key, payload);
        while (historyCache.size > MAX_HISTORY_CACHE) historyCache.delete(historyCache.keys().next().value);
        return clonePayload(payload, count);
      }
      throw new Error(payload.error || "No real candles returned");
    } catch (error) {
      if (isLocal(symbol)) return { source: "unavailable", error: "XAUUSD historical dataset could not be loaded.", candles: [] };
      return {
        source: "simulated-fallback",
        error: error.message,
        candles: generate(symbol, timeframe, count),
      };
    }
  }

  return { generate, history, isLocal, listSymbols, getMeta, SYMBOLS, TF_MINUTES };
})();
