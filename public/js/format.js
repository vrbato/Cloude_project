/** Formátování čísel a dat v české lokalizaci. */

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const nf = new Map();
function fmt(min, max) {
  const key = min + ":" + max;
  if (!nf.has(key)) nf.set(key, new Intl.NumberFormat("cs-CZ", { minimumFractionDigits: min, maximumFractionDigits: max }));
  return nf.get(key);
}

const CURRENCY_SYMBOL = { USD: "$", EUR: "€", GBP: "£", CZK: "Kč", JPY: "¥", CHF: "CHF", PLN: "zł", SEK: "kr", NOK: "kr", DKK: "kr", CNY: "¥", HKD: "HK$", CAD: "C$", AUD: "A$", TWD: "NT$", KRW: "₩", INR: "₹" };
const SUFFIX_CURRENCY = new Set(["CZK", "PLN", "SEK", "NOK", "DKK", "CHF", "EUR"]);

export const DASH = "–";

export function number(v, decimals = 2) {
  if (!isNum(v)) return DASH;
  return fmt(decimals, decimals).format(v);
}

/** Cena s měnou: 1 234,56 $ / 1 340 Kč */
export function money(v, currency, decimals) {
  if (!isNum(v)) return DASH;
  const d = decimals ?? (Math.abs(v) >= 1000 ? 0 : 2);
  const sym = CURRENCY_SYMBOL[currency] ?? currency ?? "";
  const n = fmt(d, d).format(v);
  if (!sym) return n;
  if (SUFFIX_CURRENCY.has(currency) || sym.length > 1) return `${n} ${sym}`;
  return `${sym}${n}`.replace(/^(\$|£|¥|₩|₹)-/, "-$1");
}

/** Velká čísla zkráceně: 1,23 bil. / 456,7 mld. / 12,3 mil. / 4,5 tis. */
export function compact(v, decimals = 1) {
  if (!isNum(v)) return DASH;
  const a = Math.abs(v);
  const units = [
    [1e12, "bil."],
    [1e9, "mld."],
    [1e6, "mil."],
    [1e3, "tis."],
  ];
  for (const [base, label] of units) {
    if (a >= base) return `${fmt(0, decimals).format(v / base)} ${label}`;
  }
  return fmt(0, decimals).format(v);
}

/** Zkrácené číslo s počtem desetinných míst podle velikosti: 383 mld. / 93,7 mld. / 6,1 mld. */
export function compactAuto(v) {
  if (!isNum(v)) return DASH;
  const a = Math.abs(v);
  const scaled = a >= 1e12 ? a / 1e12 : a >= 1e9 ? a / 1e9 : a >= 1e6 ? a / 1e6 : a >= 1e3 ? a / 1e3 : a;
  return compact(v, scaled >= 100 ? 0 : 1);
}

/** Popisek osy: počet desetinných míst podle kroku mřížky. */
export function axis(v, step) {
  if (!isNum(v)) return DASH;
  const s = Math.abs(step || v || 1);
  const d = s >= 1 ? 0 : s >= 0.1 ? 1 : 2;
  return fmt(d, d).format(v);
}

export function compactMoney(v, currency, decimals = 1) {
  if (!isNum(v)) return DASH;
  const sym = CURRENCY_SYMBOL[currency] ?? currency ?? "";
  return `${compact(v, decimals)} ${sym}`.trim();
}

/** Procenta z desetinného čísla: 0.123 → 12,3 % */
export function pct(v, decimals = 1, signed = false) {
  if (!isNum(v)) return DASH;
  const s = fmt(decimals, decimals).format(v * 100);
  return `${signed && v > 0 ? "+" : ""}${s} %`;
}

export function multiple(v, decimals = 1) {
  if (!isNum(v)) return DASH;
  return `${fmt(decimals, decimals).format(v)}×`;
}

const dateFmt = new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "numeric", year: "numeric" });
const monthFmt = new Intl.DateTimeFormat("cs-CZ", { month: "short", year: "numeric" });
const timeFmt = new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });

export const date = (t) => (t ? dateFmt.format(new Date(t)) : DASH);
export const month = (t) => (t ? monthFmt.format(new Date(t)) : DASH);
export const dateTime = (t) => (t ? timeFmt.format(new Date(t)) : DASH);

/** Kvartál z ISO data konce období: 2026-09-30 → Q3 2026 */
export function quarter(iso) {
  const d = new Date(iso);
  return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${String(d.getUTCFullYear()).slice(2)}`;
}

export function currencySymbol(c) {
  return CURRENCY_SYMBOL[c] ?? c;
}

/** Bezpečné vložení textu do HTML šablony. */
export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
