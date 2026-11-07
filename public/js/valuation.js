/**
 * Valuační engine – dvoufázový DCF model ve třech scénářích.
 *
 * Model:
 *  - Projekce tržeb na 10 let: roky 1–5 růst g, roky 6–10 lineární zpomalení
 *    na terminální růst.
 *  - Marže peněžního toku se lineárně přesune z aktuální hodnoty na cílovou
 *    během 5 let.
 *  - Báze "fcf":      volný cash flow (OCF − capex) diskontovaný WACC,
 *                     hodnota firmy − čistý dluh = hodnota vlastního kapitálu.
 *  - Báze "earnings": čistý zisk × (1 − g/ROE) = FCFE (zisk po reinvesticích),
 *                     diskontovaný nákladem vlastního kapitálu (banky, pojišťovny,
 *                     firmy bez údajů o investicích).
 *  - Terminální hodnota: Gordonův model růstu.
 *
 * Všechny sazby jsou desetinná čísla (0.08 = 8 %).
 */

export const SCENARIOS = ["bear", "base", "bull"];
export const SCENARIO_LABELS = { bear: "Pesimistický", base: "Základní", bull: "Optimistický" };
export const BASIS_LABELS = { fcf: "Volný cash flow (FCF)", earnings: "Čistý zisk (FCFE)" };

export const YEARS = 10;
export const HIGH_GROWTH_YEARS = 5;
export const MARGIN_CONVERGENCE_YEARS = 5;

/** Přibližné výnosy 10letých státních dluhopisů (bezriziková sazba) podle měny. */
const RISK_FREE = {
  USD: 0.042, EUR: 0.028, CZK: 0.041, GBP: 0.045, CHF: 0.007, JPY: 0.016, CAD: 0.033,
  AUD: 0.044, NZD: 0.045, SEK: 0.025, NOK: 0.039, DKK: 0.024, PLN: 0.053, HUF: 0.065,
  HKD: 0.038, CNY: 0.018, TWD: 0.016, KRW: 0.029, SGD: 0.025, INR: 0.065, BRL: 0.13,
  MXN: 0.09, ZAR: 0.10, ILS: 0.042, TRY: 0.28,
};

/** Riziková prémie země (přibližně podle Damodarana). */
const COUNTRY_RISK = {
  CZK: 0.009, PLN: 0.012, HUF: 0.022, CNY: 0.010, TWD: 0.007, KRW: 0.007, INR: 0.025,
  BRL: 0.035, MXN: 0.025, ZAR: 0.035, TRY: 0.06, ILS: 0.012, HKD: 0.007,
};

export const EQUITY_RISK_PREMIUM = 0.045;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const mean = (arr) => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : null);
const round = (v, step = 0.001) => Math.round(v / step) * step;

export function cagr(first, last, years) {
  if (!isNum(first) || !isNum(last) || first <= 0 || last <= 0 || years <= 0) return null;
  return (last / first) ** (1 / years) - 1;
}

export function isFinancial(d) {
  const sector = (d.sector || "").toLowerCase();
  if (sector.includes("financial")) return true;
  const a = d.annual || [];
  // Banky typicky nemají hrubý zisk ani provozní výsledek
  return a.length > 0 && a.every((r) => r.grossProfit == null && r.operatingIncome == null);
}

/** Připraví vstupy modelu z dat API. */
export function prepareInputs(d) {
  const annual = (d.annual || []).filter((r) => isNum(r.revenue) && r.revenue > 0);
  const lastA = annual[annual.length - 1];
  const ttm = d.ttm || {};
  const bal = d.balance || {};
  const warnings = [];

  const revenue0 = isNum(ttm.revenue) && ttm.revenue > 0 ? ttm.revenue : lastA?.revenue ?? null;
  const netIncome0 = isNum(ttm.netIncome) ? ttm.netIncome : lastA?.netIncome ?? null;
  const fcf0 = isNum(ttm.freeCashFlow) ? ttm.freeCashFlow : lastA?.freeCashFlow ?? null;

  const fcfMargins = annual.filter((r) => isNum(r.freeCashFlow)).map((r) => r.freeCashFlow / r.revenue);
  const netMargins = annual.filter((r) => isNum(r.netIncome)).map((r) => r.netIncome / r.revenue);
  const currentFcfMargin = isNum(fcf0) && revenue0 ? fcf0 / revenue0 : fcfMargins[fcfMargins.length - 1] ?? null;
  const currentNetMargin = isNum(netIncome0) && revenue0 ? netIncome0 / revenue0 : netMargins[netMargins.length - 1] ?? null;

  const first = annual[0];
  const revenueCagr = annual.length >= 2 ? cagr(first.revenue, lastA.revenue, annual.length - 1) : null;
  const prev = annual[annual.length - 2];
  const revenueYoy = prev ? lastA.revenue / prev.revenue - 1 : null;

  const financial = isFinancial(d);
  const fcfReliable = fcfMargins.length >= 2 && isNum(currentFcfMargin);
  const defaultBasis = financial || !fcfReliable ? "earnings" : "fcf";

  const fx = isNum(d.fx) && d.fx > 0 ? d.fx : 1;
  const shares = isNum(d.sharesListing) && d.sharesListing > 0 ? d.sharesListing : null;
  const price = isNum(d.price) ? d.price : null;
  const marketCap = isNum(d.marketCap) ? d.marketCap : price && shares ? price * shares : null;

  const debt = isNum(bal.totalDebt) ? bal.totalDebt : 0;
  const cash = isNum(bal.cash) ? bal.cash : 0;
  const equityBook = isNum(bal.equity) ? bal.equity : lastA?.equity ?? null;

  const roeRaw = isNum(netIncome0) && isNum(equityBook) && equityBook > 0 ? netIncome0 / equityBook : null;
  const roe = clamp(isNum(roeRaw) ? roeRaw : 0.12, 0.05, 0.4);

  const taxRates = annual.map((r) => r.taxRate).filter((t) => isNum(t) && t > 0 && t < 0.5);
  const taxRate = clamp(mean(taxRates) ?? 0.21, 0.05, 0.35);

  const currency = d.currency || "USD";
  const fin = d.financialCurrency || currency;
  const rf = RISK_FREE[fin] ?? RISK_FREE[currency] ?? 0.04;
  const crp = COUNTRY_RISK[fin] ?? 0;
  const betaRaw = d.beta?.adjusted;
  const beta = clamp(isNum(betaRaw) ? betaRaw : 1, 0.6, 2.0);
  if (!isNum(betaRaw)) warnings.push("Beta není k dispozici, použita hodnota 1,0.");

  const costOfEquity = rf + crp + beta * EQUITY_RISK_PREMIUM;
  const interest = annual.map((r) => r.interestExpense).filter(isNum).pop();
  const impliedKd = isNum(interest) && debt > 0 ? Math.abs(interest) / debt : null;
  const costOfDebt = clamp(isNum(impliedKd) ? impliedKd : rf + 0.015, rf + 0.005, rf + 0.05);

  const debtPx = debt * fx;
  const weightE = marketCap ? marketCap / (marketCap + debtPx) : 1;
  const wacc = weightE * costOfEquity + (1 - weightE) * costOfDebt * (1 - taxRate);

  if (!revenue0) warnings.push("Chybí údaje o tržbách – DCF nelze spočítat.");
  if (!shares) warnings.push("Chybí počet akcií – hodnotu na akcii nelze spočítat.");

  return {
    currency, financialCurrency: fin, fx, shares, price, marketCap,
    revenue0, netIncome0, fcf0, debt, cash, equityBook, roe, taxRate,
    fcfMargins, netMargins, currentFcfMargin, currentNetMargin,
    revenueCagr, revenueYoy, financial, fcfReliable, defaultBasis,
    rf, crp, erp: EQUITY_RISK_PREMIUM, beta, costOfEquity, costOfDebt, wacc,
    eps0: isNum(netIncome0) && shares ? (netIncome0 * fx) / shares : null,
    bvps: isNum(equityBook) && shares ? (equityBook * fx) / shares : null,
    warnings,
  };
}

/** Výchozí předpoklady tří scénářů odvozené z historie firmy. */
export function defaultAssumptions(inp, basis = inp.defaultBasis) {
  const notes = [];
  const margins = basis === "fcf" ? inp.fcfMargins : inp.netMargins;
  const current = basis === "fcf" ? inp.currentFcfMargin : inp.currentNetMargin;
  const recent = margins.slice(-4);
  const avg = mean(isNum(current) ? [...recent, current] : recent);

  let baseMargin = isNum(current) && isNum(avg) ? 0.5 * current + 0.5 * avg : avg ?? current ?? 0.08;
  if (!isNum(baseMargin) || baseMargin < 0.03) {
    baseMargin = basis === "fcf" ? 0.08 : 0.07;
    notes.push(
      "Firma je v současnosti ztrátová nebo má velmi nízkou marži – model předpokládá, že během 5 let dosáhne běžné ziskovosti. Výsledek berte s velkou rezervou.",
    );
  }
  baseMargin = clamp(baseMargin, 0.01, 0.6);

  const cagr = isNum(inp.revenueCagr) ? inp.revenueCagr : 0.04;
  const yoy = isNum(inp.revenueYoy) ? inp.revenueYoy : cagr;
  const baseGrowth = clamp(0.6 * cagr + 0.4 * yoy, -0.05, 0.25);
  if (0.6 * cagr + 0.4 * yoy > 0.25) notes.push("Historický růst tržeb byl velmi vysoký – základní scénář jej omezuje na 25 % ročně.");

  const baseDiscount = clamp(basis === "fcf" ? inp.wacc : inp.costOfEquity, 0.06, 0.15);
  const baseTerminal = clamp(Math.min(0.025, inp.rf + 0.005), 0.01, 0.03);

  const bearGrowth = baseGrowth > 0 ? baseGrowth * 0.6 - 0.005 : baseGrowth - 0.03;
  const bullGrowth = baseGrowth > 0 ? baseGrowth * 1.25 + 0.01 : baseGrowth + 0.04;

  const s = (growth, margin, discount, terminalGrowth, probability) => ({
    growth: round(growth),
    margin: round(margin),
    discount: round(discount),
    terminalGrowth: round(terminalGrowth),
    probability,
  });

  return {
    basis,
    notes,
    scenarios: {
      bear: s(clamp(bearGrowth, -0.08, 0.2), baseMargin * 0.85, baseDiscount + 0.0075, Math.max(0.005, baseTerminal - 0.005), 0.25),
      base: s(baseGrowth, baseMargin, baseDiscount, baseTerminal, 0.5),
      bull: s(clamp(bullGrowth, -0.03, 0.35), Math.min(0.65, baseMargin * 1.1), Math.max(0.05, baseDiscount - 0.005), baseTerminal + 0.005, 0.25),
    },
  };
}

/** Výpočet DCF pro jeden scénář. */
export function runDcf(inp, basis, s) {
  if (!inp.revenue0 || !inp.shares) return null;
  const r = s.discount;
  const gT = Math.min(s.terminalGrowth, r - 0.01);
  const current = basis === "fcf" ? inp.currentFcfMargin : inp.currentNetMargin;
  const startMargin = clamp(isNum(current) ? current : s.margin, -0.5, 0.7);

  const rows = [];
  let revenue = inp.revenue0;
  let pvSum = 0;
  for (let t = 1; t <= YEARS; t++) {
    const g = t <= HIGH_GROWTH_YEARS ? s.growth : s.growth + ((gT - s.growth) * (t - HIGH_GROWTH_YEARS)) / (YEARS - HIGH_GROWTH_YEARS);
    revenue *= 1 + g;
    const margin = startMargin + (s.margin - startMargin) * Math.min(t / MARGIN_CONVERGENCE_YEARS, 1);
    const profit = revenue * margin;
    // U báze "earnings" se odečtou reinvestice potřebné k růstu (g / ROE)
    const payout = basis === "earnings" ? clamp(1 - Math.max(g, 0) / inp.roe, 0.2, 1) : 1;
    const cf = profit * payout;
    const df = (1 + r) ** -t;
    pvSum += cf * df;
    rows.push({ year: t, growth: g, revenue, margin, profit, cf, df, pv: cf * df });
  }

  const lastRow = rows[rows.length - 1];
  const terminalPayout = basis === "earnings" ? clamp(1 - gT / inp.roe, 0.2, 1) : 1;
  const terminalCf = lastRow.profit * terminalPayout * (1 + gT);
  const terminalValue = terminalCf > 0 ? terminalCf / (r - gT) : 0;
  const pvTerminal = terminalValue * lastRow.df;

  const enterpriseValue = pvSum + pvTerminal;
  const netDebt = basis === "fcf" ? inp.debt - inp.cash : 0;
  const equityValue = enterpriseValue - netDebt;
  const perShareRaw = (equityValue * inp.fx) / inp.shares;

  return {
    rows,
    pvSum,
    pvTerminal,
    terminalValue,
    terminalShare: enterpriseValue > 0 ? pvTerminal / enterpriseValue : null,
    enterpriseValue,
    netDebt,
    equityValue,
    perShare: Math.max(0, perShareRaw),
    negative: perShareRaw <= 0,
    terminalGrowthUsed: gT,
  };
}

export function verdictFor(upside) {
  if (!isNum(upside)) return { key: "na", label: "Nelze určit" };
  if (upside > 0.3) return { key: "strong-under", label: "Výrazně podhodnocená" };
  if (upside > 0.1) return { key: "under", label: "Podhodnocená" };
  if (upside >= -0.1) return { key: "fair", label: "Férově oceněná" };
  if (upside >= -0.3) return { key: "over", label: "Nadhodnocená" };
  return { key: "strong-over", label: "Výrazně nadhodnocená" };
}

/** Kompletní valuace: tři scénáře + vážený průměr. */
export function valuate(inp, assumptions) {
  const results = {};
  let weighted = 0;
  let totalP = 0;
  for (const key of SCENARIOS) {
    const s = assumptions.scenarios[key];
    const res = runDcf(inp, assumptions.basis, s);
    results[key] = res;
    if (res) {
      weighted += res.perShare * s.probability;
      totalP += s.probability;
    }
  }
  const fairValue = totalP > 0 ? weighted / totalP : null;
  const upside = isNum(fairValue) && inp.price ? fairValue / inp.price - 1 : null;
  return {
    results,
    fairValue,
    upside,
    marginOfSafety: isNum(fairValue) && fairValue > 0 && inp.price ? 1 - inp.price / fairValue : null,
    verdict: verdictFor(upside),
  };
}

/** Reverzní DCF: jaký růst tržeb (roky 1–5) odpovídá aktuální ceně při ostatních předpokladech základního scénáře. */
export function reverseDcf(inp, basis, s) {
  if (!inp.price || !inp.revenue0 || !inp.shares) return null;
  const valueAt = (g) => runDcf(inp, basis, { ...s, growth: g })?.perShare ?? 0;
  let lo = -0.3;
  let hi = 0.8;
  if (valueAt(hi) < inp.price) return { growth: hi, bound: "above" };
  if (valueAt(lo) > inp.price) return { growth: lo, bound: "below" };
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (valueAt(mid) < inp.price) lo = mid;
    else hi = mid;
  }
  return { growth: (lo + hi) / 2, bound: null };
}

/** Citlivostní tabulka: diskontní sazba × terminální růst (hodnota na akcii). */
export function sensitivity(inp, basis, s) {
  const discounts = [-0.02, -0.01, 0, 0.01, 0.02].map((d) => s.discount + d).filter((r) => r > 0.03);
  const terminals = [-0.01, -0.005, 0, 0.005, 0.01].map((d) => s.terminalGrowth + d).filter((g) => g >= 0);
  const grid = terminals.map((g) =>
    discounts.map((r) => (g >= r - 0.01 ? null : runDcf(inp, basis, { ...s, discount: r, terminalGrowth: g })?.perShare ?? null)),
  );
  return { discounts, terminals, grid };
}

/** Grahamovo číslo √(22,5 × EPS × účetní hodnota na akcii). */
export function grahamNumber(inp) {
  if (!isNum(inp.eps0) || !isNum(inp.bvps) || inp.eps0 <= 0 || inp.bvps <= 0) return null;
  return Math.sqrt(22.5 * inp.eps0 * inp.bvps);
}
