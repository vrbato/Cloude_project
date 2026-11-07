/**
 * Cloudflare Worker – API pro aplikaci Valuace akcií.
 *
 *   GET /api/search?q=apple      → vyhledání tickeru / firmy
 *   GET /api/stock/AAPL          → kompletní data pro dashboard a valuaci
 *   GET /api/health              → kontrola dostupnosti
 *
 * Vše ostatní (HTML, JS, CSS, ikony) servíruje binding ASSETS ze složky /public.
 */
import { loadStock, NotFoundError } from "./stock";
import { search, UpstreamError } from "./yahoo";

export interface Env {
  ASSETS: Fetcher;
}

/* Jednoduchá cache v paměti isolate (přežije několik minut mezi požadavky). */
const memo = new Map<string, { expires: number; body: string }>();
const STOCK_TTL_MS = 10 * 60 * 1000;
const SEARCH_TTL_MS = 60 * 60 * 1000;

function cached(key: string): string | null {
  const hit = memo.get(key);
  if (!hit) return null;
  if (hit.expires < Date.now()) {
    memo.delete(key);
    return null;
  }
  return hit.body;
}

function remember(key: string, body: string, ttl: number) {
  if (memo.size > 200) {
    const oldest = memo.keys().next().value;
    if (oldest) memo.delete(oldest);
  }
  memo.set(key, { expires: Date.now() + ttl, body });
}

function json(body: unknown, status = 200, maxAge = 0): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": maxAge ? `public, max-age=${maxAge}` : "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

const SYMBOL_RE = /^[A-Za-z0-9.\-^=&]{1,20}$/;

async function handleApi(url: URL): Promise<Response> {
  const path = url.pathname.replace(/\/+$/, "");

  if (path === "/api/health") {
    return json({ ok: true, time: new Date().toISOString() });
  }

  if (path === "/api/search") {
    const q = (url.searchParams.get("q") ?? "").trim().slice(0, 60);
    if (!q) return json({ results: [] });
    const key = "s:" + q.toLowerCase();
    const hit = cached(key);
    if (hit) return json(hit, 200, 3600);
    const results = await search(q, 8);
    const body = JSON.stringify({ results });
    remember(key, body, SEARCH_TTL_MS);
    return json(body, 200, 3600);
  }

  const m = path.match(/^\/api\/stock\/(.+)$/);
  if (m) {
    const raw = decodeURIComponent(m[1]).trim();
    if (!raw || raw.length > 40) return json({ error: "Neplatný ticker." }, 400);
    // Ticker přímo, případně název firmy (pak se dohledá přes vyhledávání)
    const input = SYMBOL_RE.test(raw) ? raw.toUpperCase() : raw;
    const key = "t:" + input.toUpperCase();
    const fresh = url.searchParams.has("fresh");
    const hit = fresh ? null : cached(key);
    if (hit) return json(hit, 200, 300);
    const data = await loadStock(input);
    const body = JSON.stringify(data);
    remember(key, body, STOCK_TTL_MS);
    return json(body, 200, 300);
  }

  return json({ error: "Neznámý endpoint." }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" },
      });
    }
    if (request.method !== "GET") return json({ error: "Metoda není povolena." }, 405);
    try {
      return await handleApi(url);
    } catch (err) {
      if (err instanceof NotFoundError) return json({ error: err.message }, 404);
      if (err instanceof UpstreamError) {
        const status = err.status === 429 ? 429 : 502;
        return json({ error: "Zdroj dat (Yahoo Finance) je dočasně nedostupný. Zkuste to prosím za chvíli.", detail: err.message }, status);
      }
      console.error(err);
      return json({ error: "Neočekávaná chyba serveru.", detail: String(err) }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
