/* session-engine.js - analytical market-session engine for chart overlays and replay navigation. */

(function () {
  const SessionTypes = Object.freeze({
    ASIA: "asia",
    LONDON: "london",
    NEW_YORK: "new-york",
  });

  const SessionDefaults = Object.freeze({
    enabled: true,
    displayTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    showBoxes: true,
    showLabels: true,
    showHighLow: true,
    showOpen: true,
    navigatorSession: SessionTypes.NEW_YORK,
    definitions: Object.freeze({
      [SessionTypes.ASIA]: Object.freeze({
        id: SessionTypes.ASIA,
        name: "Asian Session",
        shortName: "ASIA",
        timezone: "Asia/Tokyo",
        startTime: "09:00",
        endTime: "15:00",
        enabled: true,
        style: Object.freeze({
          backgroundColor: "#f3c969",
          backgroundOpacity: 0.075,
          borderColor: "#f3c969",
          borderOpacity: 0.42,
          borderWidth: 1,
          labelColor: "#f3c969",
          lineColor: "#f3c969",
        }),
      }),
      [SessionTypes.LONDON]: Object.freeze({
        id: SessionTypes.LONDON,
        name: "London Session",
        shortName: "LONDON",
        timezone: "Europe/London",
        startTime: "08:00",
        endTime: "16:30",
        enabled: true,
        style: Object.freeze({
          backgroundColor: "#3d7fff",
          backgroundOpacity: 0.065,
          borderColor: "#3d7fff",
          borderOpacity: 0.42,
          borderWidth: 1,
          labelColor: "#8cb3ff",
          lineColor: "#8cb3ff",
        }),
      }),
      [SessionTypes.NEW_YORK]: Object.freeze({
        id: SessionTypes.NEW_YORK,
        name: "New York Session",
        shortName: "NEW YORK",
        timezone: "America/New_York",
        startTime: "08:00",
        endTime: "17:00",
        enabled: true,
        style: Object.freeze({
          backgroundColor: "#00b894",
          backgroundOpacity: 0.065,
          borderColor: "#00b894",
          borderOpacity: 0.42,
          borderWidth: 1,
          labelColor: "#5ee0c0",
          lineColor: "#5ee0c0",
        }),
      }),
    }),
  });

  function clone(value) {
    return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  }

  const timezoneValidity = new Map();
  const zoneFormatters = new Map();
  function isValidTimezone(timezone) {
    if (timezoneValidity.has(timezone)) return timezoneValidity.get(timezone);
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
      timezoneValidity.set(timezone, true);
      return true;
    } catch {
      timezoneValidity.set(timezone, false);
      return false;
    }
  }

  function partsInZone(timestamp, timezone) {
    const zone = isValidTimezone(timezone) ? timezone : "UTC";
    let fmt = zoneFormatters.get(zone);
    if (!fmt) {
      fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
      zoneFormatters.set(zone, fmt);
    }
    const parts = Object.fromEntries(fmt.formatToParts(new Date(timestamp)).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
    const hour = parts.hour === "24" ? "00" : parts.hour;
    return {
      year: Number(parts.year),
      month: Number(parts.month),
      day: Number(parts.day),
      hour: Number(hour),
      minute: Number(parts.minute),
      second: Number(parts.second),
      dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    };
  }

  function zonedTimeToUtc(dateKey, timeText, timezone) {
    const [year, month, day] = String(dateKey).split("-").map(Number);
    const [hour, minute] = String(timeText || "00:00").split(":").map(Number);
    if (![year, month, day, hour, minute].every(Number.isFinite)) return null;
    let guess = Date.UTC(year, month - 1, day, hour, minute, 0);
    for (let i = 0; i < 4; i += 1) {
      const p = partsInZone(guess, timezone);
      const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second || 0);
      guess += Date.UTC(year, month - 1, day, hour, minute, 0) - asIfUtc;
    }
    return guess;
  }

  function addDays(dateKey, delta) {
    const [year, month, day] = String(dateKey).split("-").map(Number);
    const next = new Date(Date.UTC(year, month - 1, day + delta));
    return next.toISOString().slice(0, 10);
  }

  function normalizeConfig(config = {}) {
    const definitions = {};
    Object.values(SessionDefaults.definitions).forEach((def) => {
      const patch = config.definitions?.[def.id] || {};
      definitions[def.id] = {
        ...clone(def),
        ...patch,
        timezone: isValidTimezone(patch.timezone || def.timezone) ? (patch.timezone || def.timezone) : def.timezone,
        style: { ...clone(def.style), ...(patch.style || {}) },
        enabled: patch.enabled ?? def.enabled,
      };
    });
    return {
      enabled: config.enabled ?? SessionDefaults.enabled,
      displayTimezone: isValidTimezone(config.displayTimezone || SessionDefaults.displayTimezone) ? (config.displayTimezone || SessionDefaults.displayTimezone) : "UTC",
      showBoxes: config.showBoxes ?? SessionDefaults.showBoxes,
      showLabels: config.showLabels ?? SessionDefaults.showLabels,
      showHighLow: config.showHighLow ?? SessionDefaults.showHighLow,
      showOpen: config.showOpen ?? SessionDefaults.showOpen,
      asianRange: config.asianRange ?? false,
      navigatorSession: config.navigatorSession || SessionDefaults.navigatorSession,
      definitions,
    };
  }

  class SessionEngine {
    constructor(options = {}) {
      this.config = normalizeConfig(options.config || {});
      this.cache = new Map();
      this.cacheVersion = 0;
    }

    setConfig(config = {}) {
      this.config = normalizeConfig({ ...this.config, ...config, definitions: { ...this.config.definitions, ...(config.definitions || {}) } });
      this.clearCache();
      return this.getConfig();
    }

    getConfig() {
      return clone(this.config);
    }

    clearCache() {
      this.cache.clear();
      this.cacheVersion += 1;
    }

    getSessionDefinitions() {
      return Object.values(this.config.definitions).map(clone);
    }

    getSessionStart(timestamp, sessionType) {
      return this.getSession(timestamp, sessionType)?.start ?? null;
    }

    getSessionEnd(timestamp, sessionType) {
      return this.getSession(timestamp, sessionType)?.end ?? null;
    }

    getSession(timestamp, sessionType) {
      const def = this.config.definitions[sessionType];
      if (!def) return null;
      const local = partsInZone(timestamp, def.timezone);
      const candidates = [local.dateKey, addDays(local.dateKey, -1), addDays(local.dateKey, 1)]
        .map((dateKey) => this.buildSessionForDate(dateKey, sessionType))
        .filter(Boolean)
        .sort((a, b) => Math.abs(timestamp - a.start) - Math.abs(timestamp - b.start));
      return candidates.find((session) => timestamp >= session.start && timestamp < session.end) || candidates[0] || null;
    }

    getSessionAt(timestamp) {
      if (!this.config.enabled) return null;
      return this.getSessionDefinitions()
        .filter((def) => def.enabled)
        .map((def) => this.getSession(timestamp, def.id))
        .filter((session) => session && timestamp >= session.start && timestamp < session.end)
        .sort((a, b) => b.start - a.start)[0] || null;
    }

    buildSessionForDate(dateKey, sessionType) {
      const def = this.config.definitions[sessionType];
      if (!def) return null;
      const key = `${sessionType}:${dateKey}`;
      if (this.cache.has(key)) return clone(this.cache.get(key));
      const start = zonedTimeToUtc(dateKey, def.startTime, def.timezone);
      let end = zonedTimeToUtc(dateKey, def.endTime, def.timezone);
      if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
      if (end <= start) end = zonedTimeToUtc(addDays(dateKey, 1), def.endTime, def.timezone);
      const session = {
        id: `${def.id}:${dateKey}`,
        type: def.id,
        dateKey,
        name: def.name,
        shortName: def.shortName,
        timezone: def.timezone,
        start,
        end,
        enabled: def.enabled,
        style: clone(def.style),
      };
      this.cache.set(key, session);
      if (this.cache.size > 2048) this.cache.delete(this.cache.keys().next().value);
      return clone(session);
    }

    getSessionsInRange(start, end) {
      if (!this.config.enabled || !Number.isFinite(start) || !Number.isFinite(end)) return [];
      const from = Math.min(start, end);
      const to = Math.max(start, end);
      const rows = [];
      this.getSessionDefinitions().filter((def) => def.enabled).forEach((def) => {
        const localStart = partsInZone(from - 48 * 60 * 60 * 1000, def.timezone).dateKey;
        const localEnd = partsInZone(to + 48 * 60 * 60 * 1000, def.timezone).dateKey;
        let dateKey = localStart;
        let guard = 0;
        while (dateKey <= localEnd && guard < 420) {
          const session = this.buildSessionForDate(dateKey, def.id);
          if (session && session.end >= from && session.start <= to) rows.push(session);
          dateKey = addDays(dateKey, 1);
          guard += 1;
        }
      });
      return rows.sort((a, b) => a.start - b.start);
    }

    getNextSession(timestamp, sessionType = null) {
      const range = this.getSessionsInRange(timestamp + 1, timestamp + 14 * 86400000)
        .filter((session) => !sessionType || session.type === sessionType);
      return range.find((session) => session.start > timestamp) || null;
    }

    getPreviousSession(timestamp, sessionType = null) {
      const active = this.getSessionAt(timestamp);
      const cutoff = active && (!sessionType || active.type === sessionType) ? active.start : timestamp;
      const range = this.getSessionsInRange(cutoff - 14 * 86400000, cutoff - 1)
        .filter((session) => !sessionType || session.type === sessionType);
      return range.reverse().find((session) => session.start < cutoff) || null;
    }

    getNextSessionOfType(timestamp, sessionType) {
      return this.getNextSession(timestamp, sessionType);
    }

    getPreviousSessionOfType(timestamp, sessionType) {
      return this.getPreviousSession(timestamp, sessionType);
    }

    getSessionOfTypeOnDate(dateKey, sessionType) {
      return this.getSessionByDate(dateKey, sessionType);
    }

    getNextOccurrence(timestamp, sessionType) {
      return this.getNextSessionOfType(timestamp, sessionType);
    }

    getPreviousOccurrence(timestamp, sessionType) {
      return this.getPreviousSessionOfType(timestamp, sessionType);
    }

    getSessionByDate(dateKey, sessionType) {
      const def = this.config.definitions[sessionType];
      if (!def) return null;
      return this.buildSessionForDate(dateKey, sessionType);
    }

    calculateSessionStats(session, candles = [], options = {}) {
      if (!session) return null;
      const replayLimit = Number.isFinite(options.replayLimit) ? options.replayLimit : candles.length - 1;
      const limitTs = candles[Math.max(0, Math.min(candles.length - 1, replayLimit))]?.date?.getTime?.() ?? Infinity;
      const effectiveEnd = Math.min(session.end, options.replayActive ? limitTs : session.end);
      if (!candles.length || effectiveEnd <= session.start) return { ...session, open: null, high: null, low: null, close: null, range: null, candleCount: 0, complete: effectiveEnd >= session.end };
      const startIndex = this.lowerBoundCandles(candles, session.start);
      const endIndex = Math.min(this.lowerBoundCandles(candles, effectiveEnd), options.replayActive ? replayLimit + 1 : candles.length);
      if (endIndex <= startIndex) return { ...session, open: null, high: null, low: null, close: null, range: null, candleCount: 0, complete: effectiveEnd >= session.end };
      let high = -Infinity;
      let low = Infinity;
      let open = null;
      let closeCandidate = null;
      let candleCount = 0;
      for (let i = startIndex; i < endIndex; i += 1) {
        const candle = candles[i];
        const h = Number(candle.high);
        const l = Number(candle.low);
        if (open == null) open = Number(candle.open);
        if (Number.isFinite(h) && h > high) high = h;
        if (Number.isFinite(l) && l < low) low = l;
        closeCandidate = Number(candle.close);
        candleCount += 1;
      }
      if (!candleCount || !Number.isFinite(high) || !Number.isFinite(low)) return { ...session, open: null, high: null, low: null, close: null, range: null, candleCount: 0, complete: effectiveEnd >= session.end };
      const close = effectiveEnd >= session.end ? closeCandidate : null;
      return {
        ...session,
        open,
        high,
        low,
        close,
        range: Number.isFinite(high) && Number.isFinite(low) ? high - low : null,
        candleCount,
        complete: effectiveEnd >= session.end,
        effectiveEnd,
      };
    }

    lowerBoundCandles(candles, timestamp) {
      let lo = 0;
      let hi = candles.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        const ts = candles[mid]?.date?.getTime?.() ?? candles[mid]?.time ?? 0;
        if (ts < timestamp) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    }

    formatTime(timestamp, timezone = this.config.displayTimezone) {
      if (!Number.isFinite(timestamp)) return "--";
      return new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(timestamp));
    }
  }

  window.IntenseSessions = window.IntenseSessions || {};
  window.IntenseSessions.SessionTypes = SessionTypes;
  window.IntenseSessions.SessionDefaults = SessionDefaults;
  window.IntenseSessions.SessionEngine = SessionEngine;
  window.IntenseSessions.partsInZone = partsInZone;
  window.IntenseSessions.zonedTimeToUtc = zonedTimeToUtc;
  window.IntenseSessions.createSessionEngine = (options = {}) => new SessionEngine(options);
})();
