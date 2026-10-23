const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const sandbox = { window: {}, Date, Math, API: { getMarketHistory: async () => ({
  source: "yahoo-cache",
  candles: [{ time: 1, open: 1, high: 2, low: 1, close: 2, volume: 1 }],
}) } };
vm.createContext(sandbox);
vm.runInContext(`${fs.readFileSync(path.join(__dirname, "../frontend/static/js/marketdata.js"), "utf8")}\nthis.MarketData = MarketData;`, sandbox);
const MarketData = sandbox.MarketData;

assert.deepStrictEqual(Array.from(MarketData.generate("XAUUSD", "1m", 100)), []);
assert.deepStrictEqual(Array.from(MarketData.generate("GOLD", "5m", 100)), []);

(async () => {
  const result = await MarketData.history("XAUUSD", "1m", 100);
  assert.strictEqual(result.source, "unavailable");
  assert.deepStrictEqual(Array.from(result.candles), []);
  assert.strictEqual(result.error, "XAUUSD historical dataset could not be loaded.");

  let calls = 0;
  const cachedSandbox = { window: {}, Date, Math, API: { getMarketHistory: async () => {
    calls += 1;
    return { source: "local-csv", candles: [
      { time: 1, open: 1, high: 2, low: 1, close: 2, volume: 1 },
      { time: 2, open: 2, high: 3, low: 2, close: 3, volume: 1 },
    ] };
  } } };
  vm.createContext(cachedSandbox);
  vm.runInContext(`${fs.readFileSync(path.join(__dirname, "../frontend/static/js/marketdata.js"), "utf8")}\nthis.MarketData = MarketData;`, cachedSandbox);
  await cachedSandbox.MarketData.history("XAUUSD", "1m", 2);
  await cachedSandbox.MarketData.history("XAUUSD", "1m", 2);
  assert.strictEqual(calls, 1, "identical local history requests should be served from the frontend cache");
  const concurrent = await Promise.all(Array.from({length:8},()=>cachedSandbox.MarketData.history('XAUUSD','4h',2)));
  assert.strictEqual(calls,2,'concurrent identical requests share one fetch');
  concurrent[0].candles[0].close=999;
  assert.notEqual(concurrent[1].candles[0].close,999,'callers receive isolated candle values');
  console.log("marketdata_local.test.js passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
