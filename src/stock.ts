/**
 * Sestaví normalizovaná data o firmě z několika dotazů na Yahoo Finance.
 * Výkazy zůstávají v měně účetnictví (financialCurrency), ceny v měně kotace.
 * Přepočet mezi nimi zajišťuje `fx` a `shareFactor` (pro ADR).
 */
import { getChart, getFxRate, getTimeseries, search, stripDiacritics, type Chart, type TimeseriesMap, type TsPoint } from "./yahoo";

/* Položky výkazů (bez prefixu annual/quarterly/trailing). */
const ANNUAL_FIELDS = [
  "TotalRevenue",
  "GrossProfit",
  "OperatingIncome",
  "EBIT",
  "EBITDA",
  "NetIncome",
  "NetIncomeCommonStockholders",
  "DilutedEPS",
  "DilutedAverageShares",
  "InterestExpense",
  "TaxRateForCalcs",
  "PretaxIncome",
  "ResearchAndDevelopment",
  "TotalDebt",
  "CashAndCashEquivalents",
  "CashCashEquivalentsAndShortTermInvestments",
  "StockholdersEquity",
  "TotalAssets",
  "CurrentAssets",
  "CurrentLiabilities",
  "OrdinarySharesNumber",
  "InvestedCapital",
  "OperatingCashFlow",
  "CapitalExpenditure",
  "FreeCashFlow",
  "CashDividendsPaid",
  "RepurchaseOfCapitalStock",
  "StockBasedCompensation",
] as const;

const TRAILING_FIELDS = [
  "TotalRevenue",
  "GrossProfit",
  "OperatingIncome",
  "EBITDA",
  "NetIncome",
  "NetIncomeCommonStockholders",
  "DilutedEPS",
  "OperatingCashFlow",
  "CapitalExpenditure",
  "FreeCashFlow",
] as const;

const VALUATION_FIELDS = [
  "PeRatio",
  "ForwardPeRatio",
  "PegRatio",
  "PsRatio",
  "PbRatio",
  "EnterpriseValue",
  "EnterprisesValueEBITDARatio",
  "MarketCap",
] as const;

const QUARTERLY_FIELDS = [
  "TotalRevenue",
  "NetIncome",
  "NetIncomeCommonStockholders",
  "DilutedEPS",
  "TotalDebt",
  "CashAndCashEquivalents",
  "CashCashEquivalentsAndShortTermInvestments",
  "StockholdersEquity",
  "CurrentAssets",
  "CurrentLiabilities",
  "OrdinarySharesNumber",
] as const;

const TS_TYPES = [
  ...ANNUAL_FIELDS.map((f) => "annual" + f),
  ...TRAILING_FIELDS.map((f) => "trailing" + f),
  ...VALUATION_FIELDS.map((f) => "trailing" + f),
  ...QUARTERLY_FIELDS.map((f) => "quarterly" + f),
];

/* Měny kotované v setinách (pence apod.). */
const MINOR_UNITS: Record<string, [string, number]> = {
  GBp: ["GBP", 100],
  GBX: ["GBP", 100],
  ZAc: ["ZAR", 100],
  ILA: ["ILS", 100],
};

/* Srovnávací index pro výpočet bety podle přípony tickeru. */
function benchmarkFor(symbol: string): { symbol: string; name: string } {
  const suffix = symbol.includes(".") ? symbol.split(".").pop()!.toUpperCase() : "";
  const map: Record<string, [string, string]> = {
    "": ["^GSPC", "S&P 500"],
    DE: ["^GDAXI", "DAX"],
    F: ["^GDAXI", "DAX"],
    L: ["^FTSE", "FTSE 100"],
    PA: ["^FCHI", "CAC 40"],
    AS: ["^AEX", "AEX"],
    SW: ["^SSMI", "SMI"],
    T: ["^N225", "Nikkei 225"],
    HK: ["^HSI", "Hang Seng"],
    TO: ["^GSPTSE", "S&P/TSX"],
    ST: ["^OMXS30", "OMX Stockholm 30"],
  };
  const europe = ["PR", "WA", "MI", "MC", "BR", "LS", "VI", "HE", "CO", "OL", "IR", "AT", "BD"];
  if (map[suffix]) return { symbol: map[suffix][0], name: map[suffix][1] };
  if (europe.includes(suffix)) return { symbol: "^STOXX", name: "STOXX Europe 600" };
  return { symbol: "^GSPC", name: "S&P 500" };
}

export class NotFoundError extends Error {}

/* -------------------------------------------------------------- utilities */

const last = <T>(arr: T[] | undefined): T | undefined => (arr && arr.length ? arr[arr.length - 1] : undefined);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const round = (v: number | null, decimals = 4): number | null => (v == null ? null : Number(v.toFixed(decimals)));

function priceSeries(chart: Chart | null, divisor: number): [number, number][] {
  if (!chart) return [];
  const out: [number, number][] = [];
  chart.timestamps.forEach((t, i) => {
    const c = chart.close[i];
    if (typeof c === "number" && Number.isFinite(c)) out.push([t, Number((c / divisor).toPrecision(6))]);
  });
  return out;
}

function priceAt(series: [number, number][], isoDate: string): number | null {
  const t = Date.parse(isoDate + "T23:59:59Z") / 1000;
  let found: number | null = null;
  for (const [ts, p] of series) {
    if (ts <= t) found = p;
    else break;
  }
  return found;
}

/** Měsíční výnosy z adjclose, klíč YYYY-MM. */
function monthlyReturns(chart: Chart | null): Map<string, number> {
  const out = new Map<string, number>();
  if (!chart) return out;
  let prev: number | null = null;
  chart.timestamps.forEach((t, i) => {
    const c = chart.adjclose[i];
    if (typeof c !== "number" || !Number.isFinite(c) || c <= 0) return;
    const key = new Date(t * 1000).toISOString().slice(0, 7);
    if (prev != null) out.set(key, c / prev - 1);
    prev = c;
  });
  return out;
}

function computeBeta(stock: Chart | null, bench: Chart | null): { raw: number; adjusted: number; months: number } | null {
  const a = monthlyReturns(stock);
  const b = monthlyReturns(bench);
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [k, r] of a) {
    const m = b.get(k);
    if (m != null && Math.abs(r) < 1.5) {
      xs.push(m);
      ys.push(r);
    }
  }
  if (xs.length < 24) return null;
  const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
  const mx = mean(xs);
  const my = mean(ys);
  let cov = 0;
  let varx = 0;
  for (let i = 0; i < xs.length; i++) {
    cov += (xs[i] - mx) * (ys[i] - my);
    varx += (xs[i] - mx) ** 2;
  }
  if (varx === 0) return null;
  const raw = cov / varx;
  // Blumeho úprava (beta má tendenci k 1)
  return { raw: round(raw, 3)!, adjusted: round(0.67 * raw + 0.33, 3)!, months: xs.length };
}

/* ------------------------------------------------------------ statements */

export interface AnnualRow {
  date: string;
  year: number;
  revenue: number | null;
  grossProfit: number | null;
  operatingIncome: number | null;
  ebit: number | null;
  ebitda: number | null;
  netIncome: number | null;
  eps: number | null;
  dilutedShares: number | null;
  interestExpense: number | null;
  taxRate: number | null;
  pretaxIncome: number | null;
  rnd: number | null;
  totalDebt: number | null;
  cash: number | null;
  equity: number | null;
  totalAssets: number | null;
  currentAssets: number | null;
  currentLiabilities: number | null;
  sharesOutstanding: number | null;
  investedCapital: number | null;
  operatingCashFlow: number | null;
  capex: number | null;
  freeCashFlow: number | null;
  dividendsPaid: number | null;
  buybacks: number | null;
  sbc: number | null;
}

function pick(ts: TimeseriesMap, type: string, date: string): number | null {
  const p = ts[type]?.find((x) => x.date === date);
  return p ? p.value : null;
}

function epsFrom(reported: number | null, netIncome: number | null, shares: number | null): number | null {
  const computed = netIncome != null && shares ? netIncome / shares : null;
  if (reported == null || reported === 0) return computed;
  // Yahoo občas vrací nesmysl (např. 0 nebo v jiné jednotce) – pokud se liší o víc než 50 %, věř výpočtu
  if (computed != null && Math.abs(reported / computed - 1) > 0.5) return computed;
  return reported;
}

function buildAnnual(ts: TimeseriesMap): AnnualRow[] {
  const dates = new Set<string>();
  for (const key of ["annualTotalRevenue", "annualNetIncome", "annualOperatingCashFlow", "annualTotalAssets"]) {
    ts[key]?.forEach((p) => dates.add(p.date));
  }
  const rows = [...dates].sort().map((date): AnnualRow => {
    const g = (f: string) => pick(ts, "annual" + f, date);
    const netIncome = g("NetIncomeCommonStockholders") ?? g("NetIncome");
    const dilutedShares = g("DilutedAverageShares");
    const sharesOutstanding = g("OrdinarySharesNumber");
    const ocf = g("OperatingCashFlow");
    const capex = g("CapitalExpenditure");
    let fcf = g("FreeCashFlow");
    // Bez údaje o investicích (capex) je Yahoo FCF = OCF, což je zavádějící
    if (capex == null && fcf != null && ocf != null && fcf === ocf) fcf = null;
    return {
      date,
      year: Number(date.slice(0, 4)),
      revenue: g("TotalRevenue"),
      grossProfit: g("GrossProfit"),
      operatingIncome: g("OperatingIncome"),
      ebit: g("EBIT"),
      ebitda: g("EBITDA"),
      netIncome,
      eps: epsFrom(g("DilutedEPS"), netIncome, dilutedShares ?? sharesOutstanding),
      dilutedShares,
      interestExpense: g("InterestExpense"),
      taxRate: g("TaxRateForCalcs"),
      pretaxIncome: g("PretaxIncome"),
      rnd: g("ResearchAndDevelopment"),
      totalDebt: g("TotalDebt"),
      cash: g("CashCashEquivalentsAndShortTermInvestments") ?? g("CashAndCashEquivalents"),
      equity: g("StockholdersEquity"),
      totalAssets: g("TotalAssets"),
      currentAssets: g("CurrentAssets"),
      currentLiabilities: g("CurrentLiabilities"),
      sharesOutstanding,
      investedCapital: g("InvestedCapital"),
      operatingCashFlow: ocf,
      capex,
      freeCashFlow: fcf,
      dividendsPaid: g("CashDividendsPaid"),
      buybacks: g("RepurchaseOfCapitalStock"),
      sbc: g("StockBasedCompensation"),
    };
  });
  // Ponech jen roky, které mají aspoň tržby nebo zisk
  return rows.filter((r) => r.revenue != null || r.netIncome != null);
}

function buildQuarterly(ts: TimeseriesMap) {
  const dates = new Set<string>();
  ts["quarterlyTotalRevenue"]?.forEach((p) => dates.add(p.date));
  ts["quarterlyNetIncome"]?.forEach((p) => dates.add(p.date));
  return [...dates].sort().map((date) => {
    const netIncome = pick(ts, "quarterlyNetIncomeCommonStockholders", date) ?? pick(ts, "quarterlyNetIncome", date);
    const shares = pick(ts, "quarterlyOrdinarySharesNumber", date);
    return {
      date,
      revenue: pick(ts, "quarterlyTotalRevenue", date),
      netIncome,
      eps: epsFrom(pick(ts, "quarterlyDilutedEPS", date), netIncome, shares),
    };
  });
}

function latestPoint(ts: TimeseriesMap, field: string): TsPoint | undefined {
  const q = last(ts["quarterly" + field]);
  const a = last(ts["annual" + field]);
  if (q && a) return q.date >= a.date ? q : a;
  return q ?? a;
}

function buildTtm(ts: TimeseriesMap, annual: AnnualRow[]) {
  const t = (f: string) => last(ts["trailing" + f]);
  const lastAnnual = last(annual);
  const rev = t("TotalRevenue");
  // TTM bereme jen pokud je novější nebo stejně starý jako poslední roční výkaz
  const fresh = (p?: TsPoint) => (p && (!lastAnnual || p.date >= lastAnnual.date) ? p.value : null);
  const capex = fresh(t("CapitalExpenditure"));
  const ocf = fresh(t("OperatingCashFlow"));
  let fcf = fresh(t("FreeCashFlow"));
  if (capex == null && fcf != null && ocf != null && fcf === ocf) fcf = null;
  return {
    date: rev?.date ?? lastAnnual?.date ?? null,
    revenue: fresh(rev),
    grossProfit: fresh(t("GrossProfit")),
    operatingIncome: fresh(t("OperatingIncome")),
    ebitda: fresh(t("EBITDA")),
    netIncome: fresh(t("NetIncomeCommonStockholders")) ?? fresh(t("NetIncome")),
    eps: fresh(t("DilutedEPS")),
    operatingCashFlow: ocf,
    capex,
    freeCashFlow: fcf,
  };
}

function buildBalance(ts: TimeseriesMap) {
  const p = (f: string) => latestPoint(ts, f);
  const debt = p("TotalDebt");
  const cash = p("CashCashEquivalentsAndShortTermInvestments") ?? p("CashAndCashEquivalents");
  return {
    date: debt?.date ?? cash?.date ?? null,
    totalDebt: debt?.value ?? null,
    cash: cash?.value ?? null,
    equity: p("StockholdersEquity")?.value ?? null,
    currentAssets: p("CurrentAssets")?.value ?? null,
    currentLiabilities: p("CurrentLiabilities")?.value ?? null,
    sharesOutstanding: p("OrdinarySharesNumber")?.value ?? null,
  };
}

/* ------------------------------------------------------------------ main */

export interface StockData {
  [key: string]: unknown;
}

async function resolveSymbol(input: string): Promise<string | null> {
  const hits = await search(input, 6);
  const equity = hits.filter((h) => h.type === "EQUITY");
  const exact = equity.find((h) => h.symbol.toUpperCase() === input.toUpperCase());
  return (exact ?? equity[0] ?? hits[0])?.symbol ?? null;
}

export async function loadStock(input: string): Promise<StockData> {
  let symbol = stripDiacritics(input.trim()).toUpperCase();
  let resolvedFrom: string | null = null;

  let daily = await getChart(symbol, "1y", "1d");
  if (!daily) {
    const resolved = await resolveSymbol(input.trim());
    if (!resolved) throw new NotFoundError(`Ticker „${input}“ nebyl nalezen.`);
    resolvedFrom = symbol;
    symbol = resolved;
    daily = await getChart(symbol, "1y", "1d");
    if (!daily) throw new NotFoundError(`Ticker „${input}“ nebyl nalezen.`);
  }

  const bench = benchmarkFor(symbol);
  const [long, monthly, benchMonthly, ts, hits] = await Promise.all([
    getChart(symbol, "10y", "1wk", true).catch(() => null),
    getChart(symbol, "5y", "1mo").catch(() => null),
    getChart(bench.symbol, "5y", "1mo").catch(() => null),
    getTimeseries(symbol, TS_TYPES).catch((): TimeseriesMap => ({})),
    search(symbol, 6).catch(() => []),
  ]);

  const meta = daily.meta;
  const warnings: string[] = [];
  const rawCurrency: string = meta.currency ?? "USD";
  const [currency, divisor] = MINOR_UNITS[rawCurrency] ?? [rawCurrency, 1];

  const price = num(meta.regularMarketPrice) != null ? meta.regularMarketPrice / divisor : null;
  const dailySeries = priceSeries(daily, divisor);
  const longSeries = priceSeries(long, divisor);
  const prevClose =
    dailySeries.length > 1 ? dailySeries[dailySeries.length - 2][1] : num(meta.previousClose) ?? num(meta.chartPreviousClose);
  let change = num(meta.regularMarketChange);
  let changePct = num(meta.regularMarketChangePercent);
  if (price != null && prevClose != null && (change == null || changePct == null)) {
    change = price - prevClose;
    changePct = (price / prevClose - 1) * 100;
  } else if (change != null) {
    change = change / divisor;
  }

  // Profil firmy
  const hit = hits.find((h) => h.symbol.toUpperCase() === symbol.toUpperCase());
  const name: string = meta.longName || hit?.name || meta.shortName || symbol;

  // Výkazy
  const annual = buildAnnual(ts);
  const quarterly = buildQuarterly(ts);
  const ttm = buildTtm(ts, annual);
  const balance = buildBalance(ts);

  const financialCurrency =
    ts["annualTotalRevenue"]?.find((p) => p.currency)?.currency ??
    ts["annualNetIncome"]?.find((p) => p.currency)?.currency ??
    currency;

  let fx = 1;
  if (financialCurrency !== currency) {
    const rate = await getFxRate(financialCurrency, currency).catch(() => null);
    if (rate) fx = rate;
    else warnings.push(`Nepodařilo se získat kurz ${financialCurrency}/${currency}, výpočty na akcii mohou být nepřesné.`);
  }

  // Ocenění podle Yahoo (poslední hodnoty)
  const v = (f: string) => last(ts["trailing" + f]);
  const mcPoint = v("MarketCap");
  let marketCap: number | null = mcPoint?.value ?? null;

  // Počet akcií v jednotkách kotace (u ADR se liší od počtu kmenových akcií)
  let sharesListing: number | null = null;
  const reportedShares = balance.sharesOutstanding;
  if (marketCap != null && price) {
    const pAt = priceAt(dailySeries, mcPoint!.date) ?? priceAt(longSeries, mcPoint!.date) ?? price;
    const implied = marketCap / pAt;
    if (reportedShares && financialCurrency === currency && Math.abs(implied / reportedShares - 1) < 0.15) {
      sharesListing = reportedShares;
    } else {
      sharesListing = implied;
    }
  } else if (reportedShares) {
    sharesListing = reportedShares;
    if (financialCurrency !== currency) {
      warnings.push("U zahraniční kotace (ADR) není znám poměr akcií – hodnota na akcii může být zkreslená.");
    }
  }
  if (sharesListing && price) marketCap = sharesListing * price;
  const shareFactor = reportedShares && sharesListing ? reportedShares / sharesListing : 1;

  // Dividendy (na akcii v měně kotace)
  const dividends = (long?.dividends ?? []).map((d) => ({ date: d.date, amount: d.amount / divisor }));
  const yearAgo = Date.now() / 1000 - 365 * 86400;
  const ttmDividend = dividends.filter((d) => d.date >= yearAgo).reduce((s, d) => s + d.amount, 0);

  const beta = computeBeta(monthly, benchMonthly);

  const instrumentType: string = meta.instrumentType ?? hit?.type ?? "EQUITY";
  if (instrumentType !== "EQUITY") {
    warnings.push("Nejde o akcii (např. ETF/index) – vnitřní hodnotu nelze smysluplně spočítat.");
  }
  if (!annual.length) warnings.push("Pro tento titul nejsou k dispozici účetní výkazy.");

  return {
    symbol,
    resolvedFrom,
    name,
    shortName: meta.shortName ?? null,
    exchange: meta.exchangeName ?? null,
    exchangeName: meta.fullExchangeName ?? hit?.exchangeName ?? meta.exchangeName ?? null,
    instrumentType,
    sector: hit?.sector ?? null,
    industry: hit?.industry ?? null,
    currency,
    financialCurrency,
    fx,
    shareFactor: round(shareFactor, 4),
    price,
    previousClose: prevClose,
    change,
    changePct,
    dayHigh: num(meta.regularMarketDayHigh) != null ? meta.regularMarketDayHigh / divisor : null,
    dayLow: num(meta.regularMarketDayLow) != null ? meta.regularMarketDayLow / divisor : null,
    fiftyTwoWeekHigh: num(meta.fiftyTwoWeekHigh) != null ? meta.fiftyTwoWeekHigh / divisor : null,
    fiftyTwoWeekLow: num(meta.fiftyTwoWeekLow) != null ? meta.fiftyTwoWeekLow / divisor : null,
    volume: num(meta.regularMarketVolume),
    marketTime: num(meta.regularMarketTime),
    timezone: meta.exchangeTimezoneName ?? null,
    marketCap,
    sharesListing,
    beta,
    benchmark: bench,
    valuation: {
      pe: v("PeRatio")?.value ?? null,
      forwardPe: v("ForwardPeRatio")?.value ?? null,
      peg: v("PegRatio")?.value ?? null,
      ps: v("PsRatio")?.value ?? null,
      pb: v("PbRatio")?.value ?? null,
      evEbitda: v("EnterprisesValueEBITDARatio")?.value ?? null,
      enterpriseValue: v("EnterpriseValue")?.value ?? null,
    },
    annual,
    quarterly,
    ttm,
    balance,
    dividends,
    ttmDividend,
    prices: { daily: dailySeries, weekly: longSeries },
    warnings,
    source: "Yahoo Finance",
    fetchedAt: new Date().toISOString(),
  };
}
