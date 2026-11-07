/**
 * Nízkoúrovňový klient pro veřejné endpointy Yahoo Finance, které nevyžadují
 * přihlášení ani "crumb": chart (ceny, dividendy), search (vyhledání tickeru,
 * sektor) a fundamentals-timeseries (účetní výkazy, ocenění).
 */

// Pozor: plný "prohlížečový" User-Agent bez cookies Yahoo odmítá kódem 429.
const USER_AGENT = "Mozilla/5.0";
const HOSTS = ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"];

export class UpstreamError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type FetchResult = { ok: true; data: any } | { ok: false; notFound: true };

async function yahooGet(path: string, cacheTtl: number, preferHost = 0): Promise<FetchResult> {
  let lastError: unknown = null;
  for (let i = 0; i < HOSTS.length; i++) {
    const host = HOSTS[(i + preferHost) % HOSTS.length];
    try {
      const res = await fetch(host + path, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        // chybové odpovědi (např. 429) se na edge necachují
        cf: { cacheEverything: true, cacheTtlByStatus: { "200-299": cacheTtl, "400-599": -1 } },
      } as RequestInit);
      if (res.status === 404) return { ok: false, notFound: true };
      if (!res.ok) {
        lastError = new UpstreamError(res.status, `Yahoo ${res.status} pro ${path.split("?")[0]}`);
        continue;
      }
      return { ok: true, data: await res.json() };
    } catch (err) {
      lastError = err;
    }
  }
  if (lastError instanceof UpstreamError) throw lastError;
  throw new UpstreamError(502, `Yahoo nedostupné: ${String(lastError)}`);
}

/* ------------------------------------------------------------------ chart */

export interface Chart {
  meta: Record<string, any>;
  timestamps: number[];
  close: (number | null)[];
  adjclose: (number | null)[];
  dividends: { date: number; amount: number }[];
  splits: { date: number; ratio: number }[];
}

export async function getChart(
  symbol: string,
  range: string,
  interval: string,
  withEvents = false,
): Promise<Chart | null> {
  const qs = new URLSearchParams({ range, interval, includePrePost: "false" });
  if (withEvents) qs.set("events", "div|split");
  const r = await yahooGet(`/v8/finance/chart/${encodeURIComponent(symbol)}?${qs}`, 300, 0);
  if (!r.ok) return null;
  const result = r.data?.chart?.result?.[0];
  if (!result?.meta) return null;
  const quote = result.indicators?.quote?.[0] ?? {};
  const adj = result.indicators?.adjclose?.[0]?.adjclose ?? quote.close ?? [];
  const ev = result.events ?? {};
  return {
    meta: result.meta,
    timestamps: result.timestamp ?? [],
    close: quote.close ?? [],
    adjclose: adj,
    dividends: Object.values(ev.dividends ?? {})
      .map((d: any) => ({ date: Number(d.date), amount: Number(d.amount) }))
      .filter((d) => Number.isFinite(d.amount))
      .sort((a, b) => a.date - b.date),
    splits: Object.values(ev.splits ?? {})
      .map((s: any) => ({ date: Number(s.date), ratio: Number(s.numerator) / Number(s.denominator) }))
      .filter((s) => Number.isFinite(s.ratio))
      .sort((a, b) => a.date - b.date),
  };
}

/* ----------------------------------------------------------------- search */

export interface SearchHit {
  symbol: string;
  name: string;
  exchange: string;
  exchangeName: string;
  type: string;
  sector?: string;
  industry?: string;
}

/** Yahoo hledá jen bez diakritiky: „ČEZ“ → „CEZ“, „Komerční“ → „Komercni“. */
export const stripDiacritics = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

export async function search(query: string, count = 8): Promise<SearchHit[]> {
  const qs = new URLSearchParams({
    q: stripDiacritics(query),
    quotesCount: String(count),
    newsCount: "0",
    listsCount: "0",
    enableFuzzyQuery: "false",
  });
  const r = await yahooGet(`/v1/finance/search?${qs}`, 3600, 1);
  if (!r.ok) return [];
  const quotes: any[] = r.data?.quotes ?? [];
  return quotes
    .filter((q) => q.symbol && (q.quoteType === "EQUITY" || q.quoteType === "ETF"))
    .map((q) => ({
      symbol: String(q.symbol),
      name: String(q.longname || q.shortname || q.symbol).trim(),
      exchange: String(q.exchange ?? ""),
      exchangeName: String(q.exchDisp ?? q.exchange ?? ""),
      type: String(q.quoteType),
      sector: q.sectorDisp || q.sector || undefined,
      industry: q.industryDisp || q.industry || undefined,
    }));
}

/* ------------------------------------------------------------- timeseries */

export interface TsPoint {
  date: string; // YYYY-MM-DD (konec období)
  value: number;
  currency: string | null;
}

export type TimeseriesMap = Record<string, TsPoint[]>;

export async function getTimeseries(symbol: string, types: string[]): Promise<TimeseriesMap> {
  const now = Math.floor(Date.now() / 1000);
  const qs = new URLSearchParams({
    symbol,
    type: types.join(","),
    period1: "493590046",
    period2: String(now + 86400),
    merge: "false",
    padTimeSeries: "false",
  });
  const path = `/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}?${qs}`;
  const r = await yahooGet(path, 3600, 1);
  const out: TimeseriesMap = {};
  if (!r.ok) return out;
  for (const item of r.data?.timeseries?.result ?? []) {
    const type: string | undefined = item?.meta?.type?.[0];
    if (!type) continue;
    const points: TsPoint[] = [];
    for (const v of item[type] ?? []) {
      const raw = v?.reportedValue?.raw;
      if (!v || typeof raw !== "number" || !Number.isFinite(raw)) continue;
      points.push({ date: String(v.asOfDate), value: raw, currency: v.currencyCode ?? null });
    }
    points.sort((a, b) => a.date.localeCompare(b.date));
    out[type] = points;
  }
  return out;
}

/* --------------------------------------------------------------------- FX */

/** Kurz: kolik jednotek `to` stojí 1 jednotka `from`. */
export async function getFxRate(from: string, to: string): Promise<number | null> {
  if (from === to) return 1;
  const direct = await getChart(`${from}${to}=X`, "5d", "1d").catch(() => null);
  const p = direct?.meta?.regularMarketPrice;
  if (typeof p === "number" && p > 0) return p;
  const inverse = await getChart(`${to}${from}=X`, "5d", "1d").catch(() => null);
  const q = inverse?.meta?.regularMarketPrice;
  if (typeof q === "number" && q > 0) return 1 / q;
  return null;
}
