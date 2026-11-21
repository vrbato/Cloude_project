/**
 * Herní logika: barvy nákladu a náhodné generování pořadí (karty).
 * Bez závislosti na DOM, takže jde testovat v Node (vozik/test).
 */

/** Barvy, ze kterých si rodič vybere ty, které jsou v krabici. */
export const COLORS = [
  { id: "red", name: "červená", hex: "#e53935", ink: "#fff" },
  { id: "yellow", name: "žlutá", hex: "#fdd835", ink: "#3b2f00" },
  { id: "blue", name: "modrá", hex: "#1e6fe0", ink: "#fff" },
  { id: "green", name: "zelená", hex: "#2e9d47", ink: "#fff" },
  { id: "orange", name: "oranžová", hex: "#fb8c00", ink: "#fff" },
  { id: "purple", name: "fialová", hex: "#8e44ad", ink: "#fff" },
  { id: "pink", name: "růžová", hex: "#ec4f9b", ink: "#fff" },
  { id: "sky", name: "světle modrá", hex: "#4fc3f7", ink: "#06324a" },
  { id: "lime", name: "světle zelená", hex: "#9ccc3c", ink: "#22330a" },
  { id: "brown", name: "hnědá", hex: "#8d5b3f", ink: "#fff" },
  { id: "black", name: "černá", hex: "#263238", ink: "#fff" },
  { id: "white", name: "bílá", hex: "#f7f7f2", ink: "#333" },
];

export const COLOR_BY_ID = Object.fromEntries(COLORS.map((c) => [c.id, c]));

/** Náhodné číslo 0 ≤ x < 1 z kryptografického generátoru (fér pro všechny hráče). */
export function secureRandom() {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / 4294967296;
}

export function randInt(min, max, rnd = secureRandom) {
  return min + Math.floor(rnd() * (max - min + 1));
}

/** Celkový počet kusů v sadě. */
export function poolSize(counts) {
  return Object.entries(counts).reduce((s, [id, q]) => s + (COLOR_BY_ID[id] ? Math.max(0, q | 0) : 0), 0);
}

/** Nejdelší věž bez dvou stejných barev nad sebou, kterou jde ze sady postavit. */
export function maxNoAdjacentLength(counts) {
  const qs = Object.entries(counts)
    .filter(([id]) => COLOR_BY_ID[id])
    .map(([, q]) => Math.max(0, q | 0));
  const total = qs.reduce((a, b) => a + b, 0);
  const top = Math.max(0, ...qs);
  const rest = total - top;
  return Math.min(total, rest + Math.min(top, rest + 1));
}

function sameStack(a, b) {
  return !!b && a.length === b.length && a.every((x, i) => x === b[i]);
}

/** Jeden pokus: postupně vybírá kusy ze zbývajících (vážně podle počtu). */
function tryBuild(counts, n, noAdjacent, rnd) {
  const left = { ...counts };
  const seq = [];
  for (let i = 0; i < n; i++) {
    const last = seq[seq.length - 1];
    const options = Object.entries(left).filter(([id, q]) => q > 0 && !(noAdjacent && id === last));
    const total = options.reduce((s, [, q]) => s + q, 0);
    if (total === 0) return null;
    let r = rnd() * total;
    let pick = options[options.length - 1][0];
    for (const [id, q] of options) {
      r -= q;
      if (r < 0) {
        pick = id;
        break;
      }
    }
    seq.push(pick);
    left[pick] -= 1;
  }
  return seq;
}

/**
 * Vygeneruje pořadí nákladu odspodu nahoru (index 0 = první kus na paletě).
 *
 * @param {object} o
 * @param {Record<string, number>} o.counts  kolik kusů které barvy je v sadě
 * @param {number} o.min                     nejmenší výška věže
 * @param {number} o.max                     největší výška věže
 * @param {boolean} [o.noAdjacent]           žádné dvě stejné barvy nad sebou
 * @param {string[]} [o.previous]            předchozí karta (nová se nebude shodovat)
 * @param {() => number} [o.rnd]             zdroj náhody (pro testy)
 * @returns {string[]} id barev
 */
export function generateStack({ counts, min, max, noAdjacent = true, previous = null, rnd = secureRandom }) {
  const clean = {};
  for (const [id, q] of Object.entries(counts || {})) if (COLOR_BY_ID[id] && q > 0) clean[id] = q | 0;
  const total = poolSize(clean);
  if (total === 0) return [];

  const limit = noAdjacent ? maxNoAdjacentLength(clean) : total;
  const hi = Math.max(1, Math.min(max, limit));
  const lo = Math.max(1, Math.min(min, hi));

  let fallback = null;
  for (let attempt = 0; attempt < 80; attempt++) {
    const n = randInt(lo, hi, rnd);
    const seq = tryBuild(clean, n, noAdjacent, rnd);
    if (!seq) continue;
    if (!sameStack(seq, previous)) return seq;
    fallback = seq; // jiná karta nejde (např. jen 1 barva) – vrátíme stejnou
  }
  return fallback || tryBuild(clean, lo, false, rnd) || [];
}

/** „1 kus“, „3 kusy“, „5 kusů“ */
export function pieces(n) {
  if (n === 1) return "1 kus";
  if (n >= 2 && n <= 4) return `${n} kusy`;
  return `${n} kusů`;
}

/** Text pro předčítání: „Odspodu: červená, žlutá, modrá.“ */
export function describe(stack) {
  return "Odspodu: " + stack.map((id) => COLOR_BY_ID[id]?.name ?? id).join(", ") + ".";
}
