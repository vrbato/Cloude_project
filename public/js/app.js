import * as F from "./format.js";
import * as V from "./valuation.js";
import { computeMetrics, healthChecks, rate, trendLabel } from "./metrics.js";
import { barChart, lineChart, rangeChart } from "./charts.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const app = $("#app");

/* ------------------------------------------------------------ storage */

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem("valuace:" + key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      if (value == null) localStorage.removeItem("valuace:" + key);
      else localStorage.setItem("valuace:" + key, JSON.stringify(value));
    } catch {}
  },
};

/* -------------------------------------------------------------- icons */

const svg = (d, extra = "") =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;
const ICON = {
  star: svg('<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>'),
  starFill: svg('<path fill="currentColor" d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>'),
  refresh: svg('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>'),
  up: svg('<path d="M12 19V5"/><path d="M5 12l7-7 7 7"/>'),
  down: svg('<path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/>'),
  flat: svg('<path d="M5 12h14"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 'stroke-width="3"'),
  x: svg('<path d="M7 7l10 10M17 7L7 17"/>', 'stroke-width="3"'),
  minus: svg('<path d="M7 12h10"/>', 'stroke-width="3"'),
  target: svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>'),
  layers: svg('<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>'),
  scale: svg('<path d="M12 3v18"/><path d="M5 7h14"/><path d="M5 7l-3 7a4 4 0 0 0 6 0z"/><path d="M19 7l-3 7a4 4 0 0 0 6 0z"/>'),
  shield: svg('<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>'),
  chart: svg('<path d="M4 19h16"/><path d="M7 15l4-4 3 3 5-6"/>'),
  sliders: svg('<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>'),
  grid: svg('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M4 15h16M10 4v16M15 4v16"/>'),
  book: svg('<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/>'),
  alert: svg('<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h0"/>'),
  chevron: svg('<path d="M9 6l6 6-6 6"/>'),
  moon: svg('<path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9z"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  auto: svg('<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/>'),
};

const SCEN_COLOR = { base: "var(--series-1)", bear: "var(--series-2)", bull: "var(--series-3)" };

/* -------------------------------------------------------------- theme */

const THEMES = ["auto", "light", "dark"];
function applyTheme(t) {
  if (t === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  const btn = $("#theme-btn");
  btn.innerHTML = t === "light" ? ICON.sun : t === "dark" ? ICON.moon : ICON.auto;
  btn.setAttribute("aria-label", `Vzhled: ${t === "auto" ? "podle systému" : t === "light" ? "světlý" : "tmavý"}`);
  const meta = $$('meta[name="theme-color"]');
  if (t !== "auto") meta.forEach((m) => m.setAttribute("content", t === "light" ? "#f1f3f8" : "#07090f"));
}
let theme = store.get("theme", "auto");
applyTheme(theme);
$("#theme-btn").addEventListener("click", () => {
  theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
  store.set("theme", theme === "auto" ? null : theme);
  try {
    if (theme === "auto") localStorage.removeItem("valuace:theme");
    else localStorage.setItem("valuace:theme", theme);
  } catch {}
  applyTheme(theme);
});

/* ----------------------------------------------------------- api */

async function api(path, { timeout = 25000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(path, { signal: ctrl.signal });
    const isJson = (res.headers.get("content-type") || "").includes("application/json");
    const body = isJson ? await res.json().catch(() => null) : null;
    if (!body) {
      // Odpověď není JSON z našeho API → serverová část (Worker) vůbec neběží
      const err = new Error(
        `Server vrátil ${res.status === 200 ? "stránku" : `chybu ${res.status}`} místo dat. Aplikace je nejspíš nasazená jen jako statické soubory bez serverové části. Nasaďte ji jako Worker ze souboru valuace-akcii-worker.js (návod v README).`,
      );
      err.status = res.status;
      err.apiDown = true;
      throw err;
    }
    if (!res.ok) {
      const err = new Error(body.error || `Chyba ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return body;
  } catch (e) {
    if (e.name === "AbortError") throw new Error("Server neodpověděl včas. Zkuste to znovu.");
    if (e instanceof TypeError) throw new Error("Nelze se připojit k serveru. Zkontrolujte připojení k internetu.");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------------------------------------------------- search */

const searchForm = $("#search");
const searchInput = $("#search-input");
const results = $("#search-results");
let searchTimer = 0;
let searchSeq = 0;
let activeIndex = -1;

function closeResults() {
  results.hidden = true;
  results.replaceChildren();
  activeIndex = -1;
}

function go(symbol) {
  closeResults();
  searchInput.value = "";
  searchInput.blur();
  const target = "#" + encodeURIComponent(symbol.toUpperCase());
  if (location.hash === target) route();
  else location.hash = target;
}

searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  const q = searchInput.value.trim();
  if (q.length < 1) return closeResults();
  searchTimer = setTimeout(async () => {
    const seq = ++searchSeq;
    try {
      const { results: hits } = await api(`/api/search?q=${encodeURIComponent(q)}`, { timeout: 8000 });
      if (seq !== searchSeq) return;
      results.replaceChildren();
      for (const h of hits.filter((h) => h.type === "EQUITY").slice(0, 7)) {
        const li = document.createElement("li");
        const b = document.createElement("button");
        b.type = "button";
        b.className = "search__item";
        b.setAttribute("role", "option");
        b.innerHTML = `<span class="search__sym"></span><span class="search__name"></span><span class="search__ex"></span>`;
        b.children[0].textContent = h.symbol;
        b.children[1].textContent = h.name;
        b.children[2].textContent = h.exchangeName;
        b.addEventListener("click", () => go(h.symbol));
        li.appendChild(b);
        results.appendChild(li);
      }
      results.hidden = !results.children.length;
      activeIndex = -1;
    } catch {
      /* našeptávač je jen pomocník */
    }
  }, 220);
});

searchInput.addEventListener("keydown", (e) => {
  const items = $$(".search__item", results);
  if (!items.length || results.hidden) return;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    activeIndex = (activeIndex + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items.forEach((it, i) => it.classList.toggle("is-active", i === activeIndex));
  } else if (e.key === "Escape") {
    closeResults();
  }
});

searchForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const items = $$(".search__item", results);
  if (activeIndex >= 0 && items[activeIndex]) return items[activeIndex].click();
  const q = searchInput.value.trim();
  if (q) go(q);
});

document.addEventListener("click", (e) => {
  if (!searchForm.contains(e.target)) closeResults();
});

/* ------------------------------------------------------------ sheet */

const sheet = $("#sheet");
function openSheet(title, value, html) {
  $("#sheet-title").textContent = title;
  $("#sheet-value").textContent = value;
  $("#sheet-body").innerHTML = html;
  sheet.hidden = false;
}
const closeSheet = () => (sheet.hidden = true);
$("#sheet-close").addEventListener("click", closeSheet);
sheet.addEventListener("click", (e) => e.target === sheet && closeSheet());
document.addEventListener("keydown", (e) => e.key === "Escape" && closeSheet());

/* -------------------------------------------------------- watchlist */

const watchlist = () => store.get("watch", []);
const isWatched = (s) => watchlist().some((w) => w.symbol === s);
function toggleWatch(symbol, name) {
  const list = watchlist();
  const i = list.findIndex((w) => w.symbol === symbol);
  if (i >= 0) list.splice(i, 1);
  else list.unshift({ symbol, name });
  store.set("watch", list.slice(0, 40));
  return i < 0;
}
function pushRecent(symbol, name) {
  const list = store.get("recent", []).filter((r) => r.symbol !== symbol);
  list.unshift({ symbol, name });
  store.set("recent", list.slice(0, 8));
}

/* ------------------------------------------------------------- home */

const POPULAR = [
  ["AAPL", "Apple"],
  ["MSFT", "Microsoft"],
  ["NVDA", "Nvidia"],
  ["GOOGL", "Alphabet"],
  ["KO", "Coca-Cola"],
  ["CEZ.PR", "ČEZ"],
  ["KOMB.PR", "Komerční banka"],
  ["SAP.DE", "SAP"],
];

function listRows(list) {
  return list
    .map(
      (w) =>
        `<a class="list-row" href="#${encodeURIComponent(w.symbol)}"><span class="list-row__sym">${F.esc(w.symbol)}</span><span class="list-row__name">${F.esc(w.name)}</span>${ICON.chevron}</a>`,
    )
    .join("");
}

function renderHome() {
  document.title = "Valuace akcií";
  const watch = watchlist();
  const recent = store.get("recent", []);
  app.innerHTML = `
    <div class="stack fade-in">
      <section class="hero">
        <h1>Kolik akcie <span>skutečně stojí?</span></h1>
        <p>Zadejte ticker z burzy. Aplikace stáhne data firmy, spočítá vnitřní hodnotu ve třech scénářích a ukáže klíčové ukazatele.</p>
        <div class="chips">${POPULAR.map(([s, n]) => `<a class="chip" href="#${s}">${s} <small>${n}</small></a>`).join("")}</div>
      </section>
      ${watch.length ? `<section class="card"><div class="card__head"><h2 class="card__title">Sledované</h2></div>${listRows(watch)}</section>` : ""}
      ${recent.length ? `<section class="card"><div class="card__head"><h2 class="card__title">Naposledy zobrazené</h2></div>${listRows(recent)}</section>` : ""}
      <section class="card">
        <div class="features">
          <div class="feature"><span class="feature__icon">${ICON.target}</span><div><h3>Vnitřní hodnota</h3><p>DCF model na 10 let v pesimistickém, základním a optimistickém scénáři.</p></div></div>
          <div class="feature"><span class="feature__icon">${ICON.sliders}</span><div><h3>Vlastní předpoklady</h3><p>Upravte růst, marži i diskontní sazbu – výsledek se přepočítá okamžitě.</p></div></div>
          <div class="feature"><span class="feature__icon">${ICON.chart}</span><div><h3>Trendy a ukazatele</h3><p>P/E, marže, ROE, zadlužení, vývoj tržeb, zisku a cash flow.</p></div></div>
          <div class="feature"><span class="feature__icon">${ICON.shield}</span><div><h3>Zdraví firmy</h3><p>Rychlý kontrolní seznam kvality: ziskovost, dluh, likvidita, ředění.</p></div></div>
        </div>
      </section>
      <p class="disclaimer">Tipy: české akcie mají příponu <b>.PR</b> (CEZ.PR), německé <b>.DE</b>, londýnské <b>.L</b>, pařížské <b>.PA</b>. Můžete napsat i název firmy.</p>
    </div>`;
}

/* ------------------------------------------------------------ loading */

function renderLoading(symbol) {
  document.title = `${symbol} · Valuace`;
  const sk = (h, w = "100%") => `<div class="skeleton" style="height:${h}px;width:${w}"></div>`;
  app.innerHTML = `
    <div class="stack">
      <section class="card"><div class="company__top"><div class="skeleton" style="width:48px;height:48px;border-radius:14px"></div><div style="flex:1;display:grid;gap:8px">${sk(22, "60%")}${sk(14, "40%")}</div></div><div style="margin-top:18px">${sk(44, "45%")}</div></section>
      <section class="card">${sk(14, "30%")}<div style="margin:12px 0">${sk(56, "50%")}</div><div class="scenarios">${sk(74)}${sk(74)}${sk(74)}</div></section>
      <section class="card">${sk(200)}</section>
    </div>`;
}

function renderError(symbol, err) {
  app.innerHTML = `
    <section class="card state fade-in">
      <div class="state__icon">${ICON.alert}</div>
      <h2>${err.apiDown ? "Serverová část aplikace neběží" : err.status === 404 ? "Ticker nenalezen" : "Data se nepodařilo načíst"}</h2>
      <p>${F.esc(err.message)}</p>
      <div class="chips" style="justify-content:center">
        <button class="btn btn--primary" id="retry" type="button">${ICON.refresh} Zkusit znovu</button>
        <a class="btn" href="#">Zpět na úvod</a>
      </div>
    </section>`;
  $("#retry").addEventListener("click", () => loadStock(symbol, true));
}

/* --------------------------------------------------------- stock load */

let current = null;
let loadSeq = 0;

async function loadStock(symbol, fresh = false) {
  const seq = ++loadSeq;
  if (!current || current.data.symbol !== symbol.toUpperCase()) renderLoading(symbol.toUpperCase());
  try {
    const data = await api(`/api/stock/${encodeURIComponent(symbol)}${fresh ? "?fresh=1" : ""}`);
    if (seq !== loadSeq) return;
    if (data.symbol && data.symbol !== symbol.toUpperCase()) {
      history.replaceState(null, "", "#" + encodeURIComponent(data.symbol));
    }
    pushRecent(data.symbol, data.name);
    renderStock(data);
  } catch (err) {
    if (seq !== loadSeq) return;
    renderError(symbol, err);
  }
}

/* --------------------------------------------------------- formatting */

function priceFmt(d) {
  return (v) => F.money(v, d.currency);
}

/** Odhad hodnoty – bez falešné přesnosti (229 $ místo 228,67 $). */
function valueFmt(d) {
  return (v) => F.money(v, d.currency, Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2);
}

function finFmt(d) {
  const c = d.financialCurrency;
  return (v, tip) => (tip ? F.compactMoney(v, c) : F.compactAuto(v));
}

function updown(v, decimals = 1) {
  if (!isNum(v)) return `<span class="pill pill--neutral">${F.DASH}</span>`;
  const cls = v > 0.0005 ? "good" : v < -0.0005 ? "bad" : "neutral";
  const icon = v > 0.0005 ? "▲" : v < -0.0005 ? "▼" : "●";
  return `<span class="pill pill--${cls}"><span aria-hidden="true">${icon}</span> ${F.pct(v, decimals, true)}</span>`;
}

function initials(name) {
  return (
    String(name)
      .replace(/[^A-Za-zÀ-ž0-9 ]/g, " ")
      .split(/\s+/)
      .filter((w) => w && !/^(inc|corp|plc|ltd|ag|se|sa|nv|as|a|the|co|company|group|holding|holdings)$/i.test(w))
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || "?"
  );
}

/* --------------------------------------------------------- stock view */

function renderStock(d) {
  document.title = `${d.symbol} · ${d.name} · Valuace`;
  const inputs = V.prepareInputs(d);
  const saved = store.get("assump:" + d.symbol, null);
  let assumptions = saved && saved.version === 1 ? saved.data : V.defaultAssumptions(inputs);
  if (assumptions.basis === "fcf" && !inputs.fcfReliable) assumptions = V.defaultAssumptions(inputs, "earnings");
  const metrics = computeMetrics(d);
  current = { data: d, inputs, assumptions, metrics, customized: !!saved, scenario: "base" };

  const lastAnnual = d.annual[d.annual.length - 1];
  const valuationOk = d.instrumentType === "EQUITY" && inputs.revenue0 && inputs.shares;

  app.innerHTML = `
    <div class="stack fade-in">
      ${companyCard(d, metrics)}
      ${d.warnings?.length ? `<ul class="notes warnings">${d.warnings.map((w) => `<li>${F.esc(w)}</li>`).join("")}</ul>` : ""}
      ${valuationOk ? valuationCard(d) : ""}
      ${metricsCard(d, metrics)}
      <section class="card">
        <div class="card__head">
          <div><h2 class="card__title">Vývoj ceny</h2><p class="card__sub" id="price-stat"></p></div>
          <div class="seg" id="price-range" role="group" aria-label="Období">
            ${["1M", "6M", "1R", "5L", "10L"].map((r) => `<button type="button" data-r="${r}" aria-pressed="${r === "1R"}">${r}</button>`).join("")}
          </div>
        </div>
        <div id="chart-price"></div>
      </section>
      <div class="grid-2">
        <section class="card">
          <div class="card__head">
            <div><h2 class="card__title">Tržby a čistý zisk</h2><p class="card__sub">v ${F.esc(d.financialCurrency)}</p></div>
            <div class="seg" id="rev-mode" role="group" aria-label="Perioda">
              <button type="button" data-m="a" aria-pressed="true">Roky</button><button type="button" data-m="q" aria-pressed="false">Kvartály</button>
            </div>
          </div>
          <div id="chart-revenue"></div>
          ${trendsRow(metrics)}
        </section>
        <section class="card">
          <div class="card__head"><div><h2 class="card__title">Marže</h2><p class="card__sub">podíl na tržbách</p></div></div>
          <div id="chart-margins"></div>
        </section>
        <section class="card">
          <div class="card__head"><div><h2 class="card__title">Cash flow</h2><p class="card__sub">provozní a volný cash flow, v ${F.esc(d.financialCurrency)}</p></div></div>
          <div id="chart-cf"></div>
        </section>
        <section class="card">
          <div class="card__head"><div><h2 class="card__title">Zisk na akcii (EPS)</h2><p class="card__sub">zředěný, v ${F.esc(d.financialCurrency)}${d.shareFactor && Math.abs(d.shareFactor - 1) > 0.05 ? " na kmenovou akcii" : ""}</p></div></div>
          <div id="chart-eps"></div>
          ${peHistoryNote(metrics)}
        </section>
        <section class="card">
          <div class="card__head"><div><h2 class="card__title">Hotovost a dluh</h2><p class="card__sub">rozvaha ke konci období, v ${F.esc(d.financialCurrency)}</p></div></div>
          <div id="chart-debt"></div>
        </section>
        <section class="card">
          <div class="card__head"><div><h2 class="card__title">Dividendy</h2><p class="card__sub">vyplaceno na akcii za rok, v ${F.esc(d.currency)}</p></div></div>
          <div id="chart-div"></div>
        </section>
      </div>
      ${healthCard(d, metrics)}
      ${statementsCard(d)}
      <p class="disclaimer">
        Data: ${F.esc(d.source)} · načteno ${F.dateTime(d.fetchedAt)}${lastAnnual ? ` · poslední výroční zpráva ${F.date(lastAnnual.date)}` : ""}.<br />
        Výpočty jsou orientační a slouží ke vzdělávacím účelům. Nejde o investiční doporučení.
      </p>
    </div>`;

  bindCompany(d);
  if (valuationOk) {
    buildEditor();
    renderValuation();
    bindValuation();
  }
  bindMetrics(metrics, d);
  drawPrice(d, "1R");
  $$("#price-range button").forEach((b) =>
    b.addEventListener("click", () => {
      $$("#price-range button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      drawPrice(d, b.dataset.r);
    }),
  );
  drawRevenue(d, "a");
  $$("#rev-mode button").forEach((b) =>
    b.addEventListener("click", () => {
      $$("#rev-mode button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      drawRevenue(d, b.dataset.m);
    }),
  );
  drawMargins(d);
  drawCashflow(d);
  drawEps(d);
  drawDebt(d);
  drawDividends(d);
}

/* -------------------------------------------------------- company card */

function companyCard(d, m) {
  const fp = priceFmt(d);
  const lo = d.fiftyTwoWeekLow;
  const hi = d.fiftyTwoWeekHigh;
  const pos = isNum(lo) && isNum(hi) && hi > lo ? Math.min(1, Math.max(0, (d.price - lo) / (hi - lo))) : null;
  const watched = isWatched(d.symbol);
  return `
    <section class="card company">
      <div class="company__top">
        <div class="monogram" aria-hidden="true">${F.esc(initials(d.name))}</div>
        <div class="company__id">
          <h1 class="company__name">${F.esc(d.name)}</h1>
          <div class="company__meta">
            <span><b>${F.esc(d.symbol)}</b></span>
            ${d.exchangeName ? `<span>${F.esc(d.exchangeName)}</span>` : ""}
            ${d.sector ? `<span>${F.esc(d.sector)}</span>` : ""}
            ${d.industry ? `<span>${F.esc(d.industry)}</span>` : ""}
          </div>
        </div>
        <div class="company__actions">
          <button class="icon-btn ${watched ? "is-on" : ""}" id="watch-btn" type="button" aria-pressed="${watched}" aria-label="Sledovat">${watched ? ICON.starFill : ICON.star}</button>
          <button class="icon-btn" id="refresh-btn" type="button" aria-label="Obnovit data">${ICON.refresh}</button>
        </div>
      </div>
      <div class="price-row">
        <span class="price-row__price">${fp(d.price)}</span>
        ${updown(isNum(d.changePct) ? d.changePct / 100 : null, 2)}
        <span class="fair__note num">${isNum(d.change) ? (d.change > 0 ? "+" : "") + F.number(d.change, 2) : ""}</span>
        <span class="price-row__time">${d.marketTime ? `Cena k ${F.dateTime(d.marketTime * 1000)}` : ""} · ${F.esc(d.currency)}</span>
      </div>
      ${
        pos != null
          ? `<div class="range52">
        <div class="range52__labels"><span>52 týdnů</span><span>${Math.round(pos * 100)} % rozpětí</span></div>
        <div class="range52__bar"><div class="range52__fill" style="width:${pos * 100}%"></div><div class="range52__dot" style="left:${pos * 100}%"></div></div>
        <div class="range52__labels num"><span>${fp(lo)}</span><span>${fp(hi)}</span></div>
      </div>`
          : ""
      }
      <div class="quick">
        <div class="quick__item"><div class="quick__label">Tržní kapitalizace</div><div class="quick__value">${F.compactMoney(d.marketCap, d.currency, 2)}</div></div>
        <div class="quick__item"><div class="quick__label">P/E (TTM)</div><div class="quick__value">${m.pe > 0 ? F.multiple(m.pe) : "ztráta"}</div></div>
        <div class="quick__item"><div class="quick__label">Dividendový výnos</div><div class="quick__value">${F.pct(m.dividendYield, 2)}</div></div>
        <div class="quick__item"><div class="quick__label">Beta (5 let)</div><div class="quick__value">${F.number(m.beta, 2)}</div></div>
      </div>
    </section>`;
}

function bindCompany(d) {
  const wb = $("#watch-btn");
  wb.addEventListener("click", () => {
    const on = toggleWatch(d.symbol, d.name);
    wb.classList.toggle("is-on", on);
    wb.setAttribute("aria-pressed", String(on));
    wb.innerHTML = on ? ICON.starFill : ICON.star;
  });
  $("#refresh-btn").addEventListener("click", () => loadStock(d.symbol, true));
}

/* ------------------------------------------------------ valuation card */

function valuationCard(d) {
  return `
    <section class="card valuation" id="valuation">
      <div class="card__head">
        <div><div class="eyebrow">Vnitřní hodnota akcie</div><p class="card__sub" id="v-sub"></p></div>
      </div>
      <div class="fair" id="v-fair"></div>
      <div class="scenarios" id="v-scen"></div>
      <div id="v-range" style="margin-top:20px"></div>
      <ul class="insights" id="v-insights"></ul>
      <ul class="notes" id="v-notes"></ul>
      <div class="actions">
        <button class="btn btn--primary" type="button" data-panel="editor" aria-expanded="false">${ICON.sliders} Upravit předpoklady</button>
        <button class="btn" type="button" data-panel="sens" aria-expanded="false">${ICON.grid} Citlivost</button>
        <button class="btn" type="button" data-panel="method" aria-expanded="false">${ICON.book} Jak se to počítá</button>
      </div>
      <div class="panel" id="panel-editor" hidden></div>
      <div class="panel" id="panel-sens" hidden></div>
      <div class="panel method" id="panel-method" hidden></div>
    </section>`;
}

const FIELDS = [
  { key: "growth", label: "Růst tržeb", hint: "ročně v letech 1–5, pak zpomalí na terminální růst", min: -0.1, max: 0.4, step: 0.005 },
  { key: "margin", label: "Cílová marže", hint: "", min: -0.05, max: 0.6, step: 0.005 },
  { key: "discount", label: "Diskontní sazba", hint: "požadovaný výnos (WACC / náklady kapitálu)", min: 0.05, max: 0.16, step: 0.0025 },
  { key: "terminalGrowth", label: "Terminální růst", hint: "dlouhodobý růst po roce 10", min: 0, max: 0.04, step: 0.0025 },
  { key: "probability", label: "Váha scénáře", hint: "pro výpočet váženého průměru", min: 0, max: 1, step: 0.05 },
];

function marginHint(basis) {
  return basis === "fcf" ? "volný cash flow / tržby, dosažená do 5 let" : "čistý zisk / tržby, dosažená do 5 let";
}

function buildEditor() {
  const { inputs, assumptions } = current;
  const p = $("#panel-editor");
  p.innerHTML = `
    <h3>Předpoklady modelu</h3>
    <p>Výchozí hodnoty jsou odvozené z historie firmy. Změny se ukládají jen ve vašem zařízení.</p>
    <div class="field" style="border-top:0;padding-top:0">
      <div class="field__top"><span class="field__label">Báze peněžních toků</span></div>
      <div class="seg seg--wide" id="basis-seg" role="group" aria-label="Báze modelu">
        <button type="button" data-b="fcf" aria-pressed="${assumptions.basis === "fcf"}" ${inputs.fcfReliable ? "" : "disabled"}>Volný cash flow</button>
        <button type="button" data-b="earnings" aria-pressed="${assumptions.basis === "earnings"}">Čistý zisk</button>
      </div>
      ${!inputs.fcfReliable ? '<span class="field__hint">FCF není pro tuto firmu spolehlivě k dispozici (banka nebo chybí údaje o investicích).</span>' : ""}
    </div>
    <div class="field">
      <div class="seg seg--wide" id="scen-seg" role="group" aria-label="Scénář">
        ${V.SCENARIOS.map((s) => `<button type="button" data-s="${s}" aria-pressed="${s === current.scenario}">${V.SCENARIO_LABELS[s]}</button>`).join("")}
      </div>
    </div>
    <div id="fields"></div>
    <div class="editor__foot">
      <span id="editor-state"></span>
      <button class="btn btn--ghost" type="button" id="reset-btn">${ICON.refresh} Výchozí hodnoty</button>
    </div>`;
  renderFields();

  $$("#scen-seg button").forEach((b) =>
    b.addEventListener("click", () => {
      current.scenario = b.dataset.s;
      $$("#scen-seg button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      renderFields();
    }),
  );
  $$("#basis-seg button").forEach((b) =>
    b.addEventListener("click", () => {
      if (b.disabled || current.assumptions.basis === b.dataset.b) return;
      current.assumptions = V.defaultAssumptions(current.inputs, b.dataset.b);
      current.customized = true;
      $$("#basis-seg button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      saveAssumptions();
      renderFields();
      renderValuation();
    }),
  );
  $("#reset-btn").addEventListener("click", () => {
    current.assumptions = V.defaultAssumptions(current.inputs);
    current.customized = false;
    store.set("assump:" + current.data.symbol, null);
    $$("#basis-seg button").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.b === current.assumptions.basis)));
    renderFields();
    renderValuation();
  });
}

function fieldValueText(f, v) {
  return f.key === "probability" ? F.pct(v, 0) : F.pct(v, f.step < 0.005 ? 2 : 1);
}

function renderFields() {
  const s = current.assumptions.scenarios[current.scenario];
  const wrap = $("#fields");
  wrap.innerHTML = FIELDS.map((f) => {
    const v = s[f.key];
    const hint = f.key === "margin" ? marginHint(current.assumptions.basis) : f.hint;
    const min = Math.min(f.min, v);
    const max = Math.max(f.max, v);
    return `
      <label class="field">
        <span class="field__top"><span><span class="field__label">${f.label}</span><br /><span class="field__hint">${hint}</span></span><span class="field__value" data-v="${f.key}">${fieldValueText(f, v)}</span></span>
        <input type="range" data-k="${f.key}" min="${min}" max="${max}" step="${f.step}" value="${v}" style="--p:${((v - min) / (max - min)) * 100}%" />
      </label>`;
  }).join("");
  $$("input[type=range]", wrap).forEach((inp) =>
    inp.addEventListener("input", () => {
      const f = FIELDS.find((x) => x.key === inp.dataset.k);
      const v = Number(inp.value);
      current.assumptions.scenarios[current.scenario][f.key] = v;
      inp.style.setProperty("--p", `${((v - inp.min) / (inp.max - inp.min)) * 100}%`);
      $(`[data-v="${f.key}"]`, wrap).textContent = fieldValueText(f, v);
      current.customized = true;
      saveAssumptions();
      renderValuation();
    }),
  );
  $("#editor-state").textContent = current.customized ? "Upravené předpoklady (uloženo v zařízení)" : "Výchozí předpoklady";
}

let saveTimer = 0;
function saveAssumptions() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => store.set("assump:" + current.data.symbol, { version: 1, data: current.assumptions }), 300);
}

function bindValuation() {
  $$("#valuation [data-panel]").forEach((b) =>
    b.addEventListener("click", () => {
      const panel = $("#panel-" + b.dataset.panel);
      const open = panel.hidden;
      panel.hidden = !open;
      b.setAttribute("aria-expanded", String(open));
    }),
  );
}

function verdictClass(key) {
  return key.includes("under") ? "good" : key.includes("over") ? "bad" : "neutral";
}

function renderValuation() {
  const { data: d, inputs, assumptions } = current;
  const fp = valueFmt(d);
  const res = V.valuate(inputs, assumptions);
  const base = assumptions.scenarios.base;
  const baseRes = res.results.base;
  current.valuation = res;

  $("#v-sub").textContent = `DCF na 10 let · vážený průměr 3 scénářů · báze: ${V.BASIS_LABELS[assumptions.basis]}`;
  const vc = verdictClass(res.verdict.key);
  $("#v-fair").innerHTML = `
    <div class="fair__value">${fp(res.fairValue)}</div>
    <div class="fair__line">
      <span class="verdict verdict--${vc}">${vc === "good" ? ICON.up : vc === "bad" ? ICON.down : ICON.flat} ${res.verdict.label}</span>
      <span class="fair__note">${
        isNum(res.upside)
          ? `${res.upside >= 0 ? "Potenciál" : "Prémie"} <b class="${res.upside >= 0 ? "up" : "down"}">${F.pct(res.upside, 1, true)}</b> vůči ceně ${F.money(d.price, d.currency)}`
          : ""
      }</span>
    </div>`;

  $("#v-scen").innerHTML = V.SCENARIOS.map((k) => {
    const r = res.results[k];
    const s = assumptions.scenarios[k];
    const up = r && d.price ? r.perShare / d.price - 1 : null;
    return `
      <div class="scenario" style="--c:${SCEN_COLOR[k]}">
        <div class="scenario__label">${V.SCENARIO_LABELS[k]}</div>
        <div class="scenario__value">${r ? fp(r.perShare) : F.DASH}</div>
        <div class="scenario__meta">
          <span class="${isNum(up) ? (up >= 0 ? "up" : "down") : ""}">${isNum(up) ? (up >= 0 ? "▲ " : "▼ ") + F.pct(up, 0, true) : ""}</span>
          <span>růst ${F.pct(s.growth, 1)}</span><span>váha ${F.pct(s.probability, 0)}</span>
        </div>
      </div>`;
  }).join("");

  rangeChart($("#v-range"), {
    items: [
      { label: "Pesimistický", value: res.results.bear?.perShare, color: SCEN_COLOR.bear },
      { label: "Základní", value: res.results.base?.perShare, color: SCEN_COLOR.base },
      { label: "Optimistický", value: res.results.bull?.perShare, color: SCEN_COLOR.bull },
      { label: "Vážený", value: res.fairValue, color: "var(--text-secondary)" },
    ],
    price: d.price,
    format: valueFmt(d),
  });

  // Postřehy
  const rev = V.reverseDcf(inputs, assumptions.basis, base);
  const graham = V.grahamNumber(inputs);
  const items = [];
  if (rev) {
    const g = rev.bound === "above" ? `více než ${F.pct(rev.growth, 0)}` : rev.bound === "below" ? `méně než ${F.pct(rev.growth, 0)}` : F.pct(rev.growth, 1);
    items.push(
      `${ICON.target}<span>Současná cena odpovídá růstu tržeb o <b>${g}</b> ročně po dobu 5 let (reverzní DCF, ostatní předpoklady jako v základním scénáři). Historicky firma rostla o <b>${F.pct(inputs.revenueCagr, 1)}</b> ročně.</span>`,
    );
  }
  if (isNum(res.fairValue) && res.fairValue > 0) {
    items.push(`${ICON.shield}<span>Nákupní cena s 25% bezpečnostním polštářem: <b>${fp(res.fairValue * 0.75)}</b>.</span>`);
  }
  if (baseRes && isNum(baseRes.terminalShare) && baseRes.terminalShare > 0 && baseRes.terminalShare <= 1) {
    items.push(
      `${ICON.layers}<span>Terminální hodnota (po roce 10) tvoří <b>${F.pct(baseRes.terminalShare, 0)}</b> hodnoty v základním scénáři${baseRes.terminalShare > 0.75 ? " – výsledek silně závisí na dlouhodobých předpokladech" : ""}.</span>`,
    );
  }
  if (isNum(graham)) {
    items.push(`${ICON.scale}<span>Grahamovo číslo (konzervativní hodnota pro stabilní firmy): <b>${fp(graham)}</b>.</span>`);
  }
  $("#v-insights").innerHTML = items.map((i) => `<li>${i}</li>`).join("");

  const notes = [...(assumptions.notes || []), ...inputs.warnings];
  if (V.SCENARIOS.some((k) => res.results[k]?.negative)) notes.push("V některém scénáři vychází hodnota vlastního kapitálu záporná (zobrazeno jako 0).");
  $("#v-notes").innerHTML = notes.map((n) => `<li>${F.esc(n)}</li>`).join("");

  renderSensitivity();
  renderMethod();
  const st = $("#editor-state");
  if (st) st.textContent = current.customized ? "Upravené předpoklady (uloženo v zařízení)" : "Výchozí předpoklady";
}

function renderSensitivity() {
  const { data: d, inputs, assumptions } = current;
  const base = assumptions.scenarios.base;
  const sens = V.sensitivity(inputs, assumptions.basis, base);
  const cell = (v) => F.number(v, Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2);
  $("#panel-sens").innerHTML = `
    <h3>Citlivostní analýza (základní scénář)</h3>
    <p>Vnitřní hodnota na akcii (${F.esc(F.currencySymbol(d.currency))}) při různé diskontní sazbě <b>r</b> (sloupce) a terminálním růstu <b>g</b> (řádky). Zelená = nad aktuální cenou ${F.money(d.price, d.currency)}, rámeček = základní scénář.</p>
    <div class="table-wrap">
      <table class="sens">
        <thead><tr><th>g \\ r</th>${sens.discounts.map((r) => `<th>${F.pct(r, 1)}</th>`).join("")}</tr></thead>
        <tbody>
          ${sens.terminals
            .map(
              (g, gi) =>
                `<tr><th>${F.pct(g, 1)}</th>${sens.grid[gi]
                  .map((v, ri) => {
                    const isBase = Math.abs(g - base.terminalGrowth) < 1e-9 && Math.abs(sens.discounts[ri] - base.discount) < 1e-9;
                    const cls = !isNum(v) ? "" : v >= d.price ? "is-up" : "is-down";
                    return `<td class="${cls} ${isBase ? "is-base" : ""}">${isNum(v) ? cell(v) : F.DASH}</td>`;
                  })
                  .join("")}</tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </div>`;
}

function renderMethod() {
  const { data: d, inputs, assumptions } = current;
  const r = current.valuation?.results.base;
  const fc = d.financialCurrency;
  const basis = assumptions.basis;
  $("#panel-method").innerHTML = `
    <h3>Metodika</h3>
    <ol>
      <li>Výchozí tržby za posledních 12 měsíců: <b>${F.compactMoney(inputs.revenue0, fc)}</b>.</li>
      <li>Tržby se projektují 10 let: v letech 1–5 rostou zvoleným tempem, v letech 6–10 růst lineárně zpomalí na terminální růst.</li>
      <li>Marže ${basis === "fcf" ? "volného cash flow" : "čistého zisku"} se během 5 let přesune z aktuální úrovně (${F.pct(basis === "fcf" ? inputs.currentFcfMargin : inputs.currentNetMargin, 1)}) na cílovou.</li>
      ${
        basis === "fcf"
          ? `<li>Volný cash flow se diskontuje průměrnými náklady kapitálu (WACC). Od hodnoty firmy se odečte čistý dluh ${F.compactMoney(inputs.debt - inputs.cash, fc)}.</li>`
          : `<li>Z čistého zisku se odečtou reinvestice potřebné k růstu (podíl g / ROE, ROE ${F.pct(inputs.roe, 1)}) a zbytek se diskontuje náklady vlastního kapitálu.</li>`
      }
      <li>Po roce 10 se počítá terminální hodnota Gordonovým modelem: CF × (1 + g) / (r − g).</li>
      <li>Hodnota vlastního kapitálu se vydělí počtem akcií (${F.compact(inputs.shares, 2)})${inputs.fx !== 1 ? ` a přepočte kurzem ${F.number(inputs.fx, 4)} ${fc}/${d.currency}` : ""}.</li>
      <li>Výsledná vnitřní hodnota je vážený průměr tří scénářů.</li>
    </ol>
    <dl>
      <dt>Bezriziková sazba</dt><dd>${F.pct(inputs.rf, 2)}</dd>
      ${inputs.crp ? `<dt>Riziková prémie země</dt><dd>${F.pct(inputs.crp, 2)}</dd>` : ""}
      <dt>Tržní riziková prémie</dt><dd>${F.pct(inputs.erp, 2)}</dd>
      <dt>Beta (upravená)</dt><dd>${F.number(inputs.beta, 2)}</dd>
      <dt>Náklady vlastního kapitálu</dt><dd>${F.pct(inputs.costOfEquity, 2)}</dd>
      <dt>Náklady dluhu (před daní)</dt><dd>${F.pct(inputs.costOfDebt, 2)}</dd>
      <dt>WACC</dt><dd>${F.pct(inputs.wacc, 2)}</dd>
      <dt>Daňová sazba</dt><dd>${F.pct(inputs.taxRate, 1)}</dd>
    </dl>
    ${
      r
        ? `<h3 style="margin-top:16px">Projekce – základní scénář</h3>
    <div class="table-wrap"><table class="fin-table" style="min-width:460px">
      <thead><tr><th>Rok</th><th>Tržby</th><th>Růst</th><th>Marže</th><th>Peněžní tok</th><th>Současná hodnota</th></tr></thead>
      <tbody>${r.rows
        .map(
          (x) =>
            `<tr><td>${x.year}</td><td>${F.compact(x.revenue)}</td><td>${F.pct(x.growth, 1)}</td><td>${F.pct(x.margin, 1)}</td><td>${F.compact(x.cf)}</td><td>${F.compact(x.pv)}</td></tr>`,
        )
        .join("")}
        <tr class="is-sub"><td>Terminální</td><td></td><td>${F.pct(r.terminalGrowthUsed, 1)}</td><td></td><td>${F.compact(r.terminalValue)}</td><td>${F.compact(r.pvTerminal)}</td></tr>
      </tbody>
    </table></div>
    <p style="margin-top:10px">Hodnota firmy ${F.compactMoney(r.enterpriseValue, fc)}${basis === "fcf" ? ` − čistý dluh ${F.compactMoney(r.netDebt, fc)}` : ""} = hodnota vlastního kapitálu <b>${F.compactMoney(r.equityValue, fc)}</b> → <b>${F.money(r.perShare, d.currency)}</b> na akcii.</p>`
        : ""
    }`;
}

/* --------------------------------------------------------- metrics card */

const METRIC_INFO = {
  pe: ["P/E (TTM)", "Cena akcie dělená ziskem na akcii za posledních 12 měsíců. Říká, kolik let současného zisku zaplatíte. Srovnávejte s historií firmy a s odvětvím."],
  forwardPe: ["Forward P/E", "Cena akcie dělená očekávaným ziskem na akcii (odhady analytiků na příští rok). Nižší než trailing P/E znamená očekávaný růst zisku."],
  peg: ["PEG", "P/E dělené očekávaným tempem růstu zisku. Hodnota kolem 1 je považována za férovou cenu za růst, pod 1 za levnou."],
  ps: ["P/S", "Tržní kapitalizace dělená tržbami. Užitečné u firem, které zatím nejsou ziskové."],
  pb: ["P/B", "Cena dělená účetní hodnotou vlastního kapitálu. Klíčový ukazatel hlavně u bank a pojišťoven."],
  evEbitda: ["EV/EBITDA", "Hodnota firmy včetně dluhu dělená provozním ziskem před odpisy. Umožňuje srovnat firmy s různým zadlužením."],
  pFcf: ["P/FCF", "Tržní kapitalizace dělená volným cash flow – kolik platíte za hotovost, kterou firma reálně vygeneruje."],
  fcfYield: ["FCF výnos", "Volný cash flow dělený tržní kapitalizací. Kolik hotovosti připadá na každou investovanou korunu. Srovnejte s výnosem dluhopisů."],
  grossMargin: ["Hrubá marže", "Hrubý zisk / tržby. Ukazuje cenovou sílu a náklady na výrobu."],
  operatingMargin: ["Provozní marže", "Provozní zisk / tržby. Efektivita hlavní činnosti firmy."],
  netMargin: ["Čistá marže", "Čistý zisk / tržby. Kolik z každé koruny tržeb zůstane akcionářům."],
  fcfMargin: ["FCF marže", "Volný cash flow / tržby. Kolik hotovosti po investicích firma vytvoří z tržeb."],
  roe: ["ROE", "Čistý zisk / vlastní kapitál. Jak efektivně firma zhodnocuje peníze akcionářů. Pozor – vysoké ROE může být i důsledkem vysokého dluhu."],
  roic: ["ROIC", "Provozní zisk po zdanění / investovaný kapitál (vlastní kapitál + čistý dluh). Firmy s ROIC trvale nad náklady kapitálu vytvářejí hodnotu."],
  roa: ["ROA", "Čistý zisk / celková aktiva."],
  debtToEquity: ["Dluh / vlastní kapitál", "Celkový finanční dluh dělený vlastním kapitálem. Nad 1,5 značí vyšší zadlužení."],
  netDebtToEbitda: ["Čistý dluh / EBITDA", "Za kolik let by firma splatila čistý dluh z provozního zisku. Pod 1 je výborné, nad 3 rizikové. Záporná hodnota = více hotovosti než dluhu."],
  currentRatio: ["Běžná likvidita", "Oběžná aktiva / krátkodobé závazky. Pod 1 může signalizovat problém se splácením krátkodobých závazků."],
  beta: ["Beta", "Citlivost akcie na pohyb trhu za posledních 5 let (měsíční data, upraveno směrem k 1). 1 = jako trh, nad 1 = kolísavější."],
  netDebt: ["Čistý dluh", "Finanční dluh minus hotovost a krátkodobé investice. Záporná hodnota znamená čistou hotovost."],
  revenueCagr: ["Růst tržeb (CAGR)", "Průměrné roční tempo růstu tržeb za dostupné roky."],
  netIncomeCagr: ["Růst zisku (CAGR)", "Průměrné roční tempo růstu čistého zisku. Nepočítá se, pokud byl zisk na začátku nebo na konci záporný."],
  epsCagr: ["Růst EPS (CAGR)", "Průměrné roční tempo růstu zisku na akcii – zahrnuje i vliv zpětných odkupů."],
  quarterRevenueYoy: ["Tržby za kvartál", "Meziroční změna tržeb v posledním vykázaném kvartálu oproti stejnému kvartálu před rokem."],
  dividendYield: ["Dividendový výnos", "Dividendy vyplacené za posledních 12 měsíců dělené aktuální cenou."],
  payout: ["Výplatní poměr", "Podíl čistého zisku vyplacený na dividendách. Nad 100 % není dlouhodobě udržitelné."],
  sharesChange: ["Změna počtu akcií", "Průměrná roční změna počtu akcií. Záporná = zpětné odkupy (dobré pro akcionáře), kladná = ředění."],
  marketCap: ["Tržní kapitalizace", "Cena akcie × počet akcií."],
  enterpriseValue: ["Hodnota firmy (EV)", "Tržní kapitalizace + čistý dluh. Kolik by stálo koupit celou firmu včetně dluhů."],
};

function metricsCard(d, m) {
  const fc = d.financialCurrency;
  const peAvg = m.peHistory.length ? m.peHistory.reduce((s, x) => s + x.pe, 0) / m.peHistory.length : null;
  const groups = [
    {
      title: "Ocenění",
      items: [
        ["pe", m.pe > 0 ? F.multiple(m.pe) : m.pe != null ? "ztráta" : F.DASH, isNum(peAvg) ? `hist. ⌀ ${F.multiple(peAvg)}` : ""],
        ["forwardPe", F.multiple(m.forwardPe), ""],
        ["peg", F.number(m.peg, 2), ""],
        ["ps", F.multiple(m.ps), ""],
        ["pb", F.multiple(m.pb), ""],
        ...(m.financial ? [["enterpriseValue", F.compactMoney(m.marketCap, d.currency), ""]] : [["evEbitda", F.multiple(m.evEbitda), ""]]),
        ...(m.financial ? [] : [["pFcf", F.multiple(m.pFcf), ""], ["fcfYield", F.pct(m.fcfYield, 1), ""]]),
      ],
    },
    {
      title: "Ziskovost",
      items: [
        ...(m.financial ? [] : [["grossMargin", F.pct(m.grossMargin), ""], ["operatingMargin", F.pct(m.operatingMargin), ""]]),
        ["netMargin", F.pct(m.netMargin), ""],
        ...(m.financial ? [["roa", F.pct(m.roa), ""]] : [["fcfMargin", F.pct(m.fcfMargin), ""]]),
        ["roe", F.pct(m.roe), ""],
        ...(m.financial ? [] : [["roic", F.pct(m.roic), ""]]),
      ],
    },
    {
      title: "Růst",
      items: [
        ["revenueCagr", F.pct(m.revenueCagr, 1, true), m.years ?? ""],
        ["netIncomeCagr", F.pct(m.netIncomeCagr, 1, true), m.years ?? ""],
        ["epsCagr", F.pct(m.epsCagr, 1, true), m.years ?? ""],
        ["quarterRevenueYoy", F.pct(m.quarterRevenueYoy, 1, true), "meziročně"],
      ],
    },
    {
      title: "Finanční zdraví a akcionáři",
      items: [
        ...(m.financial
          ? []
          : [
              ["netDebtToEbitda", isNum(m.netDebt) && m.netDebt < 0 ? "0×" : F.multiple(m.netDebtToEbitda), isNum(m.netDebt) && m.netDebt < 0 ? "více hotovosti než dluhu" : ""],
              ["currentRatio", F.number(m.currentRatio, 2), ""],
            ]),
        ["debtToEquity", F.number(m.debtToEquity, 2), ""],
        ["netDebt", F.compactMoney(m.netDebt, fc), m.netDebt < 0 ? "čistá hotovost" : ""],
        ["dividendYield", F.pct(m.dividendYield, 2), isNum(d.ttmDividend) && d.ttmDividend > 0 ? F.money(d.ttmDividend, d.currency, 2) + " / rok" : ""],
        ["payout", F.pct(m.payout, 0), ""],
        ["sharesChange", F.pct(m.sharesChange, 1, true), "ročně"],
        ["beta", F.number(m.beta, 2), d.benchmark?.name ? `vs. ${d.benchmark.name}` : ""],
      ],
    },
  ];
  return `
    <section class="card">
      <div class="card__head"><div><h2 class="card__title">Klíčové ukazatele</h2><p class="card__sub">posledních 12 měsíců · klepnutím zobrazíte vysvětlení</p></div></div>
      <div class="metric-groups">
        ${groups
          .map(
            (g) => `
          <div class="metric-group">
            <h3 class="eyebrow">${g.title}</h3>
            <div class="tiles">
              ${g.items
                .map(([key, value, sub]) => {
                  const r = rate(key, m[key], m);
                  return `<button class="tile" type="button" data-metric="${key}">
                    ${r ? `<span class="tile__rating tile__rating--${r}" aria-hidden="true"></span>` : ""}
                    <div class="tile__label">${METRIC_INFO[key]?.[0] ?? key}</div>
                    <div class="tile__value num">${value}</div>
                    ${sub ? `<div class="tile__sub">${F.esc(sub)}</div>` : ""}
                  </button>`;
                })
                .join("")}
            </div>
          </div>`,
          )
          .join("")}
      </div>
      <div class="legend-inline" aria-hidden="true">
        <span><i style="background:var(--good)"></i>příznivé</span>
        <span><i style="background:var(--text-muted)"></i>neutrální</span>
        <span><i style="background:var(--bad)"></i>pozor</span>
      </div>
    </section>`;
}

const RATING_TEXT = { good: "Hodnota je příznivá.", neutral: "Hodnota je v běžném pásmu.", bad: "Hodnota vyžaduje pozornost." };

function bindMetrics(m) {
  $$(".tile[data-metric]").forEach((t) =>
    t.addEventListener("click", () => {
      const key = t.dataset.metric;
      const [title, text] = METRIC_INFO[key] ?? [key, ""];
      const r = rate(key, m[key], m);
      openSheet(
        title,
        t.querySelector(".tile__value").textContent,
        `<p>${text}</p>${r ? `<p><span class="pill pill--${r === "good" ? "good" : r === "bad" ? "bad" : "neutral"}">${RATING_TEXT[r]}</span></p><p style="font-size:12px">Prahy hodnocení jsou orientační a liší se podle odvětví.</p>` : ""}`,
      );
    }),
  );
}

function trendsRow(m) {
  const item = (label, t, extra) => {
    const tl = trendLabel(t);
    const icon = tl.key.startsWith("up") ? ICON.up : tl.key.startsWith("down") ? ICON.down : ICON.flat;
    const cls = tl.key.startsWith("up") ? "up" : tl.key.startsWith("down") ? "down" : "";
    return `<div class="trend"><div class="trend__label">${label}</div><div class="trend__value"><span class="${cls}">${icon}</span>${tl.label}</div>${extra ? `<div class="trend__label">${extra}</div>` : ""}</div>`;
  };
  return `<div class="trend-row">
    ${item("Trend tržeb", m.revenueTrend, `CAGR ${F.pct(m.revenueCagr, 1, true)}`)}
    ${item("Trend zisku", m.netIncomeTrend, `CAGR ${F.pct(m.netIncomeCagr, 1, true)}`)}
    <div class="trend"><div class="trend__label">Tržby – posl. kvartál</div><div class="trend__value num">${F.pct(m.quarterRevenueYoy, 1, true)}</div><div class="trend__label">meziročně</div></div>
    <div class="trend"><div class="trend__label">Zisk – posl. kvartál</div><div class="trend__value num">${F.pct(m.quarterNetIncomeYoy, 1, true)}</div><div class="trend__label">meziročně</div></div>
  </div>`;
}

function peHistoryNote(m) {
  if (!m.peHistory.length) return "";
  const hist = m.peHistory.slice(-3);
  return `<p class="card__sub" style="margin-top:14px">Historické P/E (cena ke konci fiskálního roku / EPS)</p>
  <div class="trend-row" style="grid-template-columns:repeat(${hist.length + 1},1fr);margin-top:8px">
    ${hist.map((x) => `<div class="trend"><div class="trend__label">${x.year}</div><div class="trend__value num">${F.multiple(x.pe)}</div></div>`).join("")}
    <div class="trend"><div class="trend__label">Nyní</div><div class="trend__value num">${m.pe > 0 ? F.multiple(m.pe) : F.DASH}</div></div>
  </div>`;
}

/* ------------------------------------------------------------ health */

function healthCard(d, m) {
  const h = healthChecks(d, m);
  const color = h.score >= 0.7 ? "var(--good)" : h.score >= 0.45 ? "var(--warn)" : "var(--bad)";
  const label = h.score >= 0.7 ? "Solidní kvalita" : h.score >= 0.45 ? "Smíšený obrázek" : "Slabší kvalita";
  return `
    <section class="card">
      <div class="health__top">
        <div class="score" style="--v:${h.score ?? 0};--score-color:${color}"><span>${h.passed}/${h.total}</span></div>
        <div><h2 class="card__title">Zdraví firmy</h2><p class="card__sub">${label} · splněno ${h.passed} z ${h.total} kritérií</p></div>
      </div>
      <ul class="checks">
        ${h.checks
          .map((c) => {
            const cls = c.ok === null ? "na" : c.ok ? "ok" : "fail";
            const icon = c.ok === null ? ICON.minus : c.ok ? ICON.check : ICON.x;
            return `<li class="check check--${cls}"><span class="check__icon" aria-label="${c.ok === null ? "nelze posoudit" : c.ok ? "splněno" : "nesplněno"}">${icon}</span><div><div class="check__label">${c.label}</div><div class="check__detail">${c.ok === null ? "Nelze posoudit (chybí data nebo neplatí pro odvětví)." : c.detail}</div></div></li>`;
          })
          .join("")}
      </ul>
    </section>`;
}

/* -------------------------------------------------------- statements */

function statementsCard(d) {
  const rows = d.annual;
  if (!rows.length) return "";
  const c = (v) => F.compactAuto(v);
  const lines = [
    ["Tržby", (r) => c(r.revenue)],
    ["Hrubý zisk", (r) => c(r.grossProfit)],
    ["Provozní zisk", (r) => c(r.operatingIncome)],
    ["EBITDA", (r) => c(r.ebitda)],
    ["Čistý zisk", (r) => c(r.netIncome)],
    ["EPS (zředěný)", (r) => F.number(r.eps, 2)],
    ["Provozní cash flow", (r) => c(r.operatingCashFlow)],
    ["Investice (capex)", (r) => c(r.capex)],
    ["Volný cash flow", (r) => c(r.freeCashFlow)],
    ["Hotovost", (r) => c(r.cash)],
    ["Dluh", (r) => c(r.totalDebt)],
    ["Vlastní kapitál", (r) => c(r.equity)],
    ["Počet akcií", (r) => c(r.dilutedShares ?? r.sharesOutstanding)],
    ["Vyplacené dividendy", (r) => c(r.dividendsPaid != null ? -r.dividendsPaid : null)],
    ["Zpětné odkupy", (r) => c(r.buybacks != null ? -r.buybacks : null)],
  ].filter(([, fn]) => rows.some((r) => fn(r) !== F.DASH));
  return `
    <section class="card">
      <div class="card__head"><div><h2 class="card__title">Výkazy</h2><p class="card__sub">roční data v ${F.esc(d.financialCurrency)}</p></div></div>
      <div class="table-wrap">
        <table class="fin-table">
          <thead><tr><th>Položka</th>${rows.map((r) => `<th>${r.year}</th>`).join("")}</tr></thead>
          <tbody>${lines.map(([label, fn]) => `<tr><td>${label}</td>${rows.map((r) => `<td>${fn(r)}</td>`).join("")}</tr>`).join("")}</tbody>
        </table>
      </div>
    </section>`;
}

/* ------------------------------------------------------------ charts */

function annualWithTtm(d, field) {
  const rows = d.annual.map((r) => ({ label: String(r.year), v: r[field] }));
  const last = d.annual[d.annual.length - 1];
  const t = d.ttm?.[field];
  if (isNum(t) && d.ttm.date && last && d.ttm.date > last.date) rows.push({ label: "TTM", v: t });
  return rows;
}

function drawPrice(d, range) {
  const now = Date.now() / 1000;
  const spans = { "1M": 31, "6M": 183, "1R": 366, "5L": 365 * 5 + 2, "10L": 365 * 10 + 3 };
  const src = range === "5L" || range === "10L" ? d.prices.weekly : d.prices.daily;
  const from = now - spans[range] * 86400;
  const pts = src.filter(([t]) => t >= from);
  if (pts.length && d.price && (range === "5L" || range === "10L")) {
    // poslední týdenní bod nahradíme aktuální cenou
    pts[pts.length - 1] = [pts[pts.length - 1][0], d.price];
  }
  const first = pts[0]?.[1];
  const lastP = pts[pts.length - 1]?.[1];
  const chg = first && lastP ? lastP / first - 1 : null;
  const yearLabel = range === "5L" || range === "10L";
  $("#price-stat").innerHTML = isNum(chg)
    ? `Změna za období: <b class="${chg >= 0 ? "up" : "down"}">${chg >= 0 ? "▲" : "▼"} ${F.pct(chg, 1, true)}</b>`
    : "";
  lineChart($("#chart-price"), {
    label: `Vývoj ceny ${d.symbol}`,
    series: [{ name: "Cena", color: "var(--series-1)", points: pts.map(([t, c]) => [t * 1000, c]) }],
    height: 230,
    yFormat: (v, tip, step) => (tip ? F.money(v, d.currency) : F.axis(v, step)),
    xFormat: (x) => (yearLabel ? String(new Date(x).getFullYear()) : F.month(x)),
    tipX: (x) => F.date(x),
  });
}

function drawRevenue(d, mode) {
  const ff = finFmt(d);
  if (mode === "q") {
    const q = d.quarterly;
    barChart($("#chart-revenue"), {
      label: "Kvartální tržby a čistý zisk",
      categories: q.map((x) => F.quarter(x.date)),
      series: [
        { name: "Tržby", color: "var(--series-1)", values: q.map((x) => x.revenue) },
        { name: "Čistý zisk", color: "var(--series-2)", values: q.map((x) => x.netIncome) },
      ],
      yFormat: ff,
    });
    return;
  }
  const rev = annualWithTtm(d, "revenue");
  const ni = annualWithTtm(d, "netIncome");
  barChart($("#chart-revenue"), {
    label: "Roční tržby a čistý zisk",
    categories: rev.map((r) => r.label),
    series: [
      { name: "Tržby", color: "var(--series-1)", values: rev.map((r) => r.v) },
      { name: "Čistý zisk", color: "var(--series-2)", values: rev.map((r) => ni.find((n) => n.label === r.label)?.v ?? null) },
    ],
    yFormat: ff,
  });
}

function drawMargins(d) {
  const rows = d.annual.map((r) => ({ ...r, label: String(r.year) }));
  const last = d.annual[d.annual.length - 1];
  if (d.ttm?.revenue && last && d.ttm.date > last.date) rows.push({ ...d.ttm, label: "TTM" });
  const m = (field) => rows.map((r, i) => [i, isNum(r[field]) && r.revenue ? r[field] / r.revenue : null]).filter(([, v]) => isNum(v));
  const series = [
    { name: "Hrubá", color: "var(--series-1)", points: m("grossProfit") },
    { name: "Provozní", color: "var(--series-2)", points: m("operatingIncome") },
    { name: "Čistá", color: "var(--series-3)", points: m("netIncome") },
    { name: "FCF", color: "var(--series-4)", points: m("freeCashFlow") },
  ].filter((s) => s.points.length > 1);
  lineChart($("#chart-margins"), {
    label: "Vývoj marží",
    series,
    height: 220,
    area: false,
    zero: true,
    yFormat: (v) => F.pct(v, Math.abs(v) < 0.1 && v !== 0 ? 1 : 0),
    xFormat: (x) => rows[Math.round(x)]?.label ?? "",
    xCategories: rows.map((r) => r.label),
  });
}

function drawCashflow(d) {
  const ocf = annualWithTtm(d, "operatingCashFlow");
  const fcf = annualWithTtm(d, "freeCashFlow");
  barChart($("#chart-cf"), {
    label: "Provozní a volný cash flow",
    categories: ocf.map((r) => r.label),
    series: [
      { name: "Provozní CF", color: "var(--series-1)", values: ocf.map((r) => r.v) },
      { name: "Volný CF", color: "var(--series-3)", values: ocf.map((r) => fcf.find((x) => x.label === r.label)?.v ?? null) },
    ],
    yFormat: finFmt(d),
  });
}

function drawEps(d) {
  const rows = d.annual.filter((r) => isNum(r.eps));
  barChart($("#chart-eps"), {
    label: "Zisk na akcii",
    categories: rows.map((r) => String(r.year)),
    series: [{ name: "EPS", color: "var(--series-1)", values: rows.map((r) => r.eps) }],
    yFormat: (v, tip, step, label) => (tip || label ? F.money(v, d.financialCurrency, 2) : F.axis(v, step)),
    valueLabels: true,
    height: 200,
  });
}

function drawDebt(d) {
  const rows = d.annual.map((r) => ({ label: String(r.year), cash: r.cash, debt: r.totalDebt }));
  const last = d.annual[d.annual.length - 1];
  if (d.balance?.date && last && d.balance.date > last.date) {
    rows.push({ label: F.quarter(d.balance.date), cash: d.balance.cash, debt: d.balance.totalDebt });
  }
  barChart($("#chart-debt"), {
    label: "Hotovost a dluh",
    categories: rows.map((r) => r.label),
    series: [
      { name: "Hotovost", color: "var(--series-1)", values: rows.map((r) => r.cash) },
      { name: "Dluh", color: "var(--series-2)", values: rows.map((r) => r.debt) },
    ],
    yFormat: finFmt(d),
  });
}

function drawDividends(d) {
  const byYear = new Map();
  for (const x of d.dividends) {
    const y = new Date(x.date * 1000).getFullYear();
    byYear.set(y, (byYear.get(y) ?? 0) + x.amount);
  }
  const thisYear = new Date().getFullYear();
  const years = [...byYear.keys()].sort();
  const el = $("#chart-div");
  if (!years.length) {
    el.innerHTML = '<p class="chart-empty">Firma v posledních 10 letech nevyplácela dividendy.</p>';
    return;
  }
  barChart(el, {
    label: "Dividendy na akcii",
    categories: years.map((y) => (y === thisYear ? `${String(y).slice(2)}*` : `'${String(y).slice(2)}`)),
    series: [{ name: "Dividenda", color: "var(--series-3)", values: years.map((y) => byYear.get(y)) }],
    yFormat: (v, tip, step) => (tip ? F.money(v, d.currency, 2) : F.axis(v, step)),
    height: 200,
  });
  if (years.includes(thisYear)) {
    el.insertAdjacentHTML("beforeend", '<p class="card__sub" style="margin-top:8px">* letošní rok zatím neúplný</p>');
  }
}

/* ------------------------------------------------------------- router */

function route() {
  const sym = decodeURIComponent(location.hash.slice(1)).trim();
  window.scrollTo({ top: 0 });
  if (sym) loadStock(sym);
  else {
    current = null;
    renderHome();
  }
}
window.addEventListener("hashchange", route);
route();

/* ---------------------------------------------------- install hint / SW */

(function installHint() {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
  if (!ios || standalone || store.get("installDismissed", false)) return;
  const box = $("#install");
  setTimeout(() => (box.hidden = false), 1500);
  $("#install-close").addEventListener("click", () => {
    box.hidden = true;
    store.set("installDismissed", true);
  });
})();

if ("serviceWorker" in navigator && location.protocol === "https:") {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
