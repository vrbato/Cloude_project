/**
 * Odvozené ukazatele pro dashboard: ocenění, ziskovost, zadlužení, trendy
 * a jednoduchý test "zdraví" firmy.
 */
import { cagr, isFinancial } from "./valuation.js";

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const div = (a, b) => (isNum(a) && isNum(b) && b !== 0 ? a / b : null);
const pos = (v) => (isNum(v) && v > 0 ? v : null);

/** Lineární regrese – sklon relativně k průměru (≈ průměrná roční změna). */
export function trend(values) {
  const pts = values.map((v, i) => [i, v]).filter(([, v]) => isNum(v));
  if (pts.length < 3) return null;
  const n = pts.length;
  const mx = pts.reduce((s, [x]) => s + x, 0) / n;
  const my = pts.reduce((s, [, y]) => s + y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const [x, y] of pts) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
  }
  const slope = sxy / sxx;
  const r2 = syy ? (sxy * sxy) / (sxx * syy) : 1;
  const rel = my !== 0 ? slope / Math.abs(my) : null;
  return { slope, rel, r2 };
}

export function trendLabel(t) {
  if (!t || !isNum(t.rel)) return { key: "na", label: "Nedostatek dat" };
  const r = t.rel;
  if (r > 0.1) return { key: "up-strong", label: "Silně rostoucí" };
  if (r > 0.02) return { key: "up", label: "Rostoucí" };
  if (r >= -0.02) return { key: "flat", label: "Stabilní" };
  if (r >= -0.1) return { key: "down", label: "Klesající" };
  return { key: "down-strong", label: "Silně klesající" };
}

function seriesCagr(rows, field) {
  const pts = rows.filter((r) => isNum(r[field]));
  if (pts.length < 2) return null;
  return cagr(pts[0][field], pts[pts.length - 1][field], pts[pts.length - 1].year - pts[0].year);
}

export function computeMetrics(d) {
  const annual = d.annual || [];
  const ttm = d.ttm || {};
  const bal = d.balance || {};
  const val = d.valuation || {};
  const lastA = annual[annual.length - 1] || {};
  const fx = d.fx || 1;
  const price = d.price;
  const mcap = d.marketCap;
  const financial = isFinancial(d);

  const revenue = ttm.revenue ?? lastA.revenue;
  const netIncome = ttm.netIncome ?? lastA.netIncome;
  const grossProfit = ttm.grossProfit ?? lastA.grossProfit;
  const operatingIncome = ttm.operatingIncome ?? lastA.operatingIncome;
  const ebitda = ttm.ebitda ?? lastA.ebitda;
  const fcf = ttm.freeCashFlow ?? lastA.freeCashFlow;
  const ocf = ttm.operatingCashFlow ?? lastA.operatingCashFlow;

  const debt = bal.totalDebt ?? lastA.totalDebt;
  const cash = bal.cash ?? lastA.cash;
  const equity = bal.equity ?? lastA.equity;
  const netDebt = isNum(debt) ? debt - (cash ?? 0) : null;
  const toPx = (v) => (isNum(v) ? v * fx : null);

  const ev = isNum(mcap) && isNum(netDebt) && !financial ? mcap + toPx(netDebt) : val.enterpriseValue;

  const epsListing = d.sharesListing && isNum(netIncome) ? toPx(netIncome) / d.sharesListing : null;
  const pe = val.pe ?? (pos(epsListing) ? price / epsListing : null);

  const taxRate = lastA.taxRate ?? 0.21;
  const nopat = isNum(operatingIncome) ? operatingIncome * (1 - taxRate) : null;
  const investedCapital = lastA.investedCapital ?? (isNum(equity) && isNum(netDebt) ? equity + netDebt : null);

  const dividendYield = price && isNum(d.ttmDividend) ? d.ttmDividend / price : null;
  const payout = isNum(lastA.dividendsPaid) && pos(lastA.netIncome) ? Math.abs(lastA.dividendsPaid) / lastA.netIncome : null;

  // Počet akcií – průměrná roční změna (záporná = zpětné odkupy)
  const shareRows = annual.filter((r) => isNum(r.dilutedShares ?? r.sharesOutstanding));
  const sharesChange =
    shareRows.length >= 2
      ? cagr(
          shareRows[0].dilutedShares ?? shareRows[0].sharesOutstanding,
          shareRows[shareRows.length - 1].dilutedShares ?? shareRows[shareRows.length - 1].sharesOutstanding,
          shareRows[shareRows.length - 1].year - shareRows[0].year,
        )
      : null;

  // Kvartální meziroční růst (poslední kvartál vs. stejný kvartál před rokem)
  const q = d.quarterly || [];
  const qLast = q[q.length - 1];
  const qYearAgo = q.length >= 5 ? q[q.length - 5] : null;
  const quarterRevenueYoy = qLast && qYearAgo ? div(qLast.revenue, qYearAgo.revenue) - 1 : null;
  const quarterNetIncomeYoy =
    qLast && qYearAgo && pos(qYearAgo.netIncome) && isNum(qLast.netIncome) ? qLast.netIncome / qYearAgo.netIncome - 1 : null;

  // Historické P/E k datu konce fiskálního roku
  const weekly = d.prices?.weekly || [];
  const shareFactor = d.shareFactor || 1;
  const peHistory = annual
    .map((r) => {
      const t = Date.parse(r.date + "T23:59:59Z") / 1000;
      let p = null;
      for (const [ts, c] of weekly) {
        if (ts <= t) p = c;
        else break;
      }
      const eps = isNum(r.eps) ? r.eps * shareFactor * fx : null;
      return { year: r.year, pe: pos(eps) && p ? p / eps : null };
    })
    .filter((x) => isNum(x.pe));

  const revenueSeries = annual.map((r) => r.revenue);
  const netIncomeSeries = annual.map((r) => r.netIncome);

  return {
    financial,
    price,
    marketCap: mcap,
    enterpriseValue: ev,
    pe,
    forwardPe: val.forwardPe,
    peg: val.peg,
    ps: val.ps ?? div(mcap, toPx(revenue)),
    pb: val.pb ?? div(mcap, toPx(pos(equity))),
    evEbitda: financial ? null : val.evEbitda ?? div(ev, toPx(pos(ebitda))),
    pFcf: financial ? null : div(mcap, toPx(pos(fcf))),
    fcfYield: financial ? null : div(toPx(fcf), mcap),
    earningsYield: div(toPx(netIncome), mcap),
    dividendYield,
    payout,
    grossMargin: div(grossProfit, revenue),
    operatingMargin: div(operatingIncome, revenue),
    netMargin: div(netIncome, revenue),
    fcfMargin: financial ? null : div(fcf, revenue),
    roe: div(netIncome, pos(equity)),
    roa: div(netIncome, lastA.totalAssets),
    roic: financial ? null : div(nopat, pos(investedCapital)),
    debtToEquity: div(debt, pos(equity)),
    netDebtToEbitda: financial ? null : div(netDebt, pos(ebitda)),
    currentRatio: financial ? null : div(bal.currentAssets ?? lastA.currentAssets, bal.currentLiabilities ?? lastA.currentLiabilities),
    netDebt,
    cash,
    debt,
    equity,
    ocf,
    fcf,
    netIncome,
    revenue,
    epsListing,
    beta: d.beta?.adjusted ?? null,
    revenueCagr: seriesCagr(annual, "revenue"),
    netIncomeCagr: seriesCagr(annual, "netIncome"),
    epsCagr: seriesCagr(annual, "eps"),
    fcfCagr: seriesCagr(annual, "freeCashFlow"),
    revenueYoy: annual.length >= 2 ? div(lastA.revenue, annual[annual.length - 2].revenue) - 1 : null,
    quarterRevenueYoy,
    quarterNetIncomeYoy,
    sharesChange,
    revenueTrend: trend(revenueSeries),
    netIncomeTrend: trend(netIncomeSeries),
    peHistory,
    years: annual.length ? `${annual[0].year}–${lastA.year}` : null,
  };
}

/** Kontrolní seznam kvality firmy. status: true / false / null (nelze posoudit) */
export function healthChecks(d, m) {
  const annual = d.annual || [];
  const first = annual[0] || {};
  const lastA = annual[annual.length - 1] || {};
  const firstMargin = div(first.netIncome, first.revenue);
  const lastMargin = m.netMargin;
  const checks = [
    {
      label: "Firma je zisková",
      detail: "Čistý zisk za posledních 12 měsíců je kladný.",
      ok: isNum(m.netIncome) ? m.netIncome > 0 : null,
    },
    {
      label: "Kladný provozní cash flow",
      detail: "Podnikání generuje hotovost.",
      ok: m.financial ? null : isNum(m.ocf) ? m.ocf > 0 : null,
    },
    {
      label: "Kvalitní zisk",
      detail: "Provozní cash flow převyšuje účetní zisk.",
      ok: m.financial ? null : isNum(m.ocf) && isNum(m.netIncome) ? m.ocf > m.netIncome : null,
    },
    {
      label: "Rostoucí tržby",
      detail: m.years ? `Průměrný roční růst tržeb za ${m.years} je kladný.` : "Tržby rostou.",
      ok: isNum(m.revenueCagr) ? m.revenueCagr > 0 : null,
    },
    {
      label: "Rostoucí zisk",
      detail: "Čistý zisk je vyšší než na začátku sledovaného období.",
      ok: isNum(first.netIncome) && isNum(lastA.netIncome) ? lastA.netIncome > first.netIncome : null,
    },
    {
      label: "Stabilní nebo rostoucí marže",
      detail: "Čistá marže neklesla o víc než 1 procentní bod.",
      ok: isNum(firstMargin) && isNum(lastMargin) ? lastMargin >= firstMargin - 0.01 : null,
    },
    {
      label: "Přiměřené zadlužení",
      detail: "Čistý dluh je nižší než 3× EBITDA.",
      ok: m.financial ? null : isNum(m.netDebtToEbitda) ? m.netDebtToEbitda < 3 : isNum(m.netDebt) ? m.netDebt <= 0 : null,
    },
    {
      label: "Dostatečná likvidita",
      detail: "Oběžná aktiva pokrývají krátkodobé závazky (běžná likvidita > 1).",
      ok: isNum(m.currentRatio) ? m.currentRatio > 1 : null,
    },
    {
      label: "Vysoká rentabilita kapitálu",
      detail: "ROE je vyšší než 12 %.",
      ok: isNum(m.roe) ? m.roe > 0.12 : null,
    },
    {
      label: "Bez ředění akcionářů",
      detail: "Počet akcií neroste rychleji než 1 % ročně.",
      ok: isNum(m.sharesChange) ? m.sharesChange <= 0.01 : null,
    },
  ];
  const rated = checks.filter((c) => c.ok !== null);
  const passed = rated.filter((c) => c.ok).length;
  return { checks, passed, total: rated.length, score: rated.length ? passed / rated.length : null };
}

/**
 * Hodnocení jednotlivého ukazatele pro barevný indikátor.
 * Vrací "good" | "neutral" | "bad" | null. Prahy jsou orientační.
 */
export function rate(key, v, m) {
  if (!isNum(v)) return null;
  const between = (good, bad, higherIsBetter = true) => {
    if (higherIsBetter) return v >= good ? "good" : v <= bad ? "bad" : "neutral";
    return v <= good ? "good" : v >= bad ? "bad" : "neutral";
  };
  switch (key) {
    case "pe":
    case "forwardPe":
      return v <= 0 ? "bad" : between(15, 30, false);
    case "peg":
      return v <= 0 ? null : between(1, 2.5, false);
    case "ps":
      return between(2, 8, false);
    case "pb":
      return m.financial ? between(1.2, 2.5, false) : between(2, 8, false);
    case "evEbitda":
      return v <= 0 ? null : between(10, 20, false);
    case "pFcf":
      return between(15, 35, false);
    case "fcfYield":
    case "earningsYield":
      return between(0.06, 0.025);
    case "grossMargin":
      return between(0.4, 0.2);
    case "operatingMargin":
      return between(0.15, 0.05);
    case "netMargin":
      return between(0.1, 0.03);
    case "fcfMargin":
      return between(0.1, 0.02);
    case "roe":
      return between(0.15, 0.07);
    case "roic":
      return between(0.12, 0.06);
    case "roa":
      return between(0.07, 0.02);
    case "debtToEquity":
      return m.financial ? null : between(0.5, 1.5, false);
    case "netDebtToEbitda":
      return between(1, 3, false);
    case "currentRatio":
      return between(1.5, 1);
    case "sharesChange":
      return between(-0.005, 0.02, false);
    case "revenueCagr":
    case "netIncomeCagr":
    case "epsCagr":
    case "revenueYoy":
    case "quarterRevenueYoy":
      return between(0.07, 0);
    default:
      return null;
  }
}
