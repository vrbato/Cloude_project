import test from "node:test";
import assert from "node:assert/strict";
import * as V from "../public/js/valuation.js";
import { computeMetrics, healthChecks, trend, trendLabel } from "../public/js/metrics.js";

/** Jednoduchá firma: tržby 100, FCF marže 10 %, bez dluhu, 10 akcií. */
function inputs(over = {}) {
  return {
    revenue0: 100,
    currentFcfMargin: 0.1,
    currentNetMargin: 0.1,
    shares: 10,
    fx: 1,
    price: 10,
    debt: 0,
    cash: 0,
    roe: 0.2,
    ...over,
  };
}
const flat = { growth: 0, margin: 0.1, discount: 0.1, terminalGrowth: 0, probability: 1 };

test("DCF s nulovým růstem odpovídá věčné rentě CF / r", () => {
  const r = V.runDcf(inputs(), "fcf", flat);
  // 10 / 0,10 = 100 → 10 na akcii
  assert.ok(Math.abs(r.enterpriseValue - 100) < 1e-9);
  assert.ok(Math.abs(r.perShare - 10) < 1e-9);
});

test("čistý dluh snižuje hodnotu jen u báze FCF", () => {
  const withDebt = inputs({ debt: 30, cash: 10 });
  assert.ok(Math.abs(V.runDcf(withDebt, "fcf", flat).perShare - 8) < 1e-9);
  // báze zisku (FCFE) dluh neodečítá, při g = 0 se nereinvestuje
  assert.ok(Math.abs(V.runDcf(withDebt, "earnings", flat).perShare - 10) < 1e-9);
});

test("kurz a počet akcií se promítnou do hodnoty na akcii", () => {
  const r = V.runDcf(inputs({ fx: 0.5, shares: 5 }), "fcf", flat);
  assert.ok(Math.abs(r.perShare - 10) < 1e-9); // 100 × 0,5 / 5
});

test("vyšší růst i marže zvyšují hodnotu, vyšší diskont ji snižuje", () => {
  const base = V.runDcf(inputs(), "fcf", { ...flat, growth: 0.05, terminalGrowth: 0.02 }).perShare;
  assert.ok(V.runDcf(inputs(), "fcf", { ...flat, growth: 0.08, terminalGrowth: 0.02 }).perShare > base);
  assert.ok(V.runDcf(inputs(), "fcf", { ...flat, growth: 0.05, margin: 0.12, terminalGrowth: 0.02 }).perShare > base);
  assert.ok(V.runDcf(inputs(), "fcf", { ...flat, growth: 0.05, discount: 0.11, terminalGrowth: 0.02 }).perShare < base);
});

test("terminální růst se omezí pod diskontní sazbu", () => {
  const r = V.runDcf(inputs(), "fcf", { ...flat, terminalGrowth: 0.12 });
  assert.ok(r.terminalGrowthUsed < flat.discount);
  assert.ok(Number.isFinite(r.perShare));
});

test("reverzní DCF najde růst, při kterém hodnota = cena", () => {
  const inp = inputs({ price: 14 });
  const s = { ...flat, terminalGrowth: 0.02 };
  const rev = V.reverseDcf(inp, "fcf", s);
  assert.equal(rev.bound, null);
  const v = V.runDcf(inp, "fcf", { ...s, growth: rev.growth }).perShare;
  assert.ok(Math.abs(v - 14) < 1e-3);
});

test("verdikt podle potenciálu", () => {
  assert.equal(V.verdictFor(0.5).key, "strong-under");
  assert.equal(V.verdictFor(0.15).key, "under");
  assert.equal(V.verdictFor(0).key, "fair");
  assert.equal(V.verdictFor(-0.2).key, "over");
  assert.equal(V.verdictFor(-0.5).key, "strong-over");
});

/* --- realističtější data ve tvaru odpovědi API --- */

function apiData(over = {}) {
  const years = [2022, 2023, 2024, 2025];
  const revenue = [800, 880, 960, 1050];
  return {
    symbol: "TEST",
    sector: "Technology",
    currency: "USD",
    financialCurrency: "USD",
    fx: 1,
    price: 50,
    marketCap: 5000,
    sharesListing: 100,
    shareFactor: 1,
    beta: { adjusted: 1.1 },
    valuation: { pe: 30 },
    annual: years.map((y, i) => ({
      date: `${y}-12-31`,
      year: y,
      revenue: revenue[i],
      grossProfit: revenue[i] * 0.5,
      operatingIncome: revenue[i] * 0.2,
      netIncome: revenue[i] * 0.15,
      eps: (revenue[i] * 0.15) / 100,
      freeCashFlow: revenue[i] * 0.16,
      operatingCashFlow: revenue[i] * 0.2,
      totalDebt: 300,
      cash: 200,
      equity: 1000,
      dilutedShares: 100 - i,
      taxRate: 0.2,
    })),
    ttm: { revenue: 1080, netIncome: 165, freeCashFlow: 175, operatingCashFlow: 220, date: "2026-03-31" },
    balance: { totalDebt: 300, cash: 200, equity: 1000, currentAssets: 500, currentLiabilities: 300 },
    quarterly: [],
    prices: { weekly: [], daily: [] },
    dividends: [],
    ttmDividend: 0.5,
    ...over,
  };
}

test("výchozí scénáře jsou seřazené: pesimistický ≤ základní ≤ optimistický", () => {
  const inp = V.prepareInputs(apiData());
  const a = V.defaultAssumptions(inp);
  assert.equal(a.basis, "fcf");
  const v = V.valuate(inp, a);
  assert.ok(v.results.bear.perShare < v.results.base.perShare);
  assert.ok(v.results.base.perShare < v.results.bull.perShare);
  assert.ok(v.fairValue > v.results.bear.perShare && v.fairValue < v.results.bull.perShare);
  const p = Object.values(a.scenarios).reduce((s, x) => s + x.probability, 0);
  assert.ok(Math.abs(p - 1) < 1e-9);
});

test("banka používá bázi čistého zisku", () => {
  const d = apiData({ sector: "Financial Services" });
  const inp = V.prepareInputs(d);
  assert.equal(inp.defaultBasis, "earnings");
});

test("ztrátová firma dostane kladnou cílovou marži a upozornění", () => {
  const d = apiData();
  d.annual.forEach((r) => {
    r.freeCashFlow = -50;
    r.netIncome = -60;
  });
  d.ttm.freeCashFlow = -40;
  d.ttm.netIncome = -55;
  const inp = V.prepareInputs(d);
  const a = V.defaultAssumptions(inp);
  assert.ok(a.scenarios.base.margin > 0);
  assert.ok(a.notes.length > 0);
});

test("ukazatele a trendy", () => {
  const d = apiData();
  const m = computeMetrics(d);
  assert.ok(Math.abs(m.netMargin - 165 / 1080) < 1e-9);
  assert.ok(Math.abs(m.debtToEquity - 0.3) < 1e-9);
  assert.ok(m.revenueCagr > 0.09 && m.revenueCagr < 0.1);
  assert.ok(m.sharesChange < 0); // zpětné odkupy
  assert.equal(trendLabel(trend([1, 2, 3, 4])).key, "up-strong");
  assert.equal(trendLabel(trend([100, 100.5, 100, 100.4])).key, "flat");
  const h = healthChecks(d, m);
  assert.ok(h.passed >= 8 && h.total === 10);
});
