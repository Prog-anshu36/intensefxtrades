const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const sandbox = {
  window: {},
  Intl,
  Date,
  Map,
  JSON,
  Math,
  structuredClone: global.structuredClone,
};
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, "frontend/static/js/session-engine.js"), "utf8"), sandbox, { filename: "session-engine.js" });

const { SessionEngine, SessionTypes } = sandbox.window.IntenseSessions;
const engine = new SessionEngine({ config: { displayTimezone: "UTC" } });

const londonWinter = engine.getSessionByDate("2026-01-15", SessionTypes.LONDON);
const londonSummer = engine.getSessionByDate("2026-08-13", SessionTypes.LONDON);
assert.equal(new Date(londonWinter.start).toISOString().slice(11, 16), "08:00", "London winter start is UTC 08:00");
assert.equal(new Date(londonSummer.start).toISOString().slice(11, 16), "07:00", "London summer start accounts for DST");

const nySummer = engine.getSessionByDate("2026-08-13", SessionTypes.NEW_YORK);
assert.equal(new Date(nySummer.start).toISOString().slice(11, 16), "12:00", "New York summer start accounts for DST");

const asia = engine.getSessionByDate("2026-08-13", SessionTypes.ASIA);
assert.equal(new Date(asia.start).toISOString().slice(11, 16), "00:00", "Asia Tokyo session converts to UTC");

const next = engine.getNextSession(londonSummer.start + 1000);
assert.equal(next.type, SessionTypes.NEW_YORK, "next session after London start is New York");
const previous = engine.getPreviousSession(nySummer.start + 1000);
assert.equal(previous.type, SessionTypes.LONDON, "previous session before New York is London");

const base = londonSummer.start;
const candles = Array.from({ length: 12 }, (_, i) => ({
  date: new Date(base + i * 60 * 60 * 1000),
  open: 100 + i,
  high: 105 + i,
  low: 95 - i,
  close: 101 + i,
}));
const replayStats = engine.calculateSessionStats(londonSummer, candles, { replayActive: true, replayLimit: 2 });
assert.equal(replayStats.candleCount, 2, "replay stats only use candles before replay cursor boundary");
assert.equal(replayStats.high, 106, "replay high excludes future candles");
assert.equal(replayStats.close, null, "incomplete replay session does not invent close");

const finalStats = engine.calculateSessionStats(londonSummer, candles, { replayActive: false });
assert.ok(finalStats.candleCount > replayStats.candleCount, "normal stats can use all session candles");
assert.ok(finalStats.range > replayStats.range, "final range includes later candles");

engine.setConfig({ definitions: { [SessionTypes.NEW_YORK]: { enabled: false } } });
assert.equal(engine.getSessionDefinitions().find((def) => def.id === SessionTypes.NEW_YORK).enabled, false, "individual session toggle persists in config");

console.log("session_engine.test.js passed");
