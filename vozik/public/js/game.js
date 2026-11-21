/**
 * Herní logika: dílky ze sady a náhodné generování karet.
 * Bez závislosti na DOM, takže jde testovat v Node (vozik/test).
 *
 * Sada (podle obsahu krabice): 3 barvy × 3 tvary × 2 kusy = 18 dílků,
 * 2 vozíky a 2 podstavce. Díky dvěma kusům od každého dílku můžou dva hráči
 * stavět stejnou kartu proti sobě.
 */

export const COLORS = [
  { id: "red", name: "červená", adj: { m: "červený", n: "červené" }, hex: "#e3342f", dark: "#a8201c", ink: "#ffffff" },
  { id: "yellow", name: "žlutá", adj: { m: "žlutý", n: "žluté" }, hex: "#ffb400", dark: "#c47f00", ink: "#4a3000" },
  { id: "green", name: "zelená", adj: { m: "zelený", n: "zelené" }, hex: "#8cc63f", dark: "#5b8f1f", ink: "#1f3608" },
];

/** Tvar dílku (obrys) a symbol uprostřed, jak jsou na dílcích i kartách. */
export const SHAPES = [
  { id: "circle", name: "kolečko", g: "n", inner: "triangle" },
  { id: "octagon", name: "osmiúhelník", g: "m", inner: "square" },
  { id: "squircle", name: "čtverec", g: "m", inner: "ring" },
];

/** Od každého dílku (barva + tvar) jsou v krabici 2 kusy. */
export const COPIES = 2;

/** Obtížnost jako na originálních kartách (hvězdičky). */
export const LEVELS = [
  { stars: 1, min: 1, max: 1, name: "Začátečník" },
  { stars: 2, min: 2, max: 3, name: "Snadná" },
  { stars: 3, min: 4, max: 5, name: "Střední" },
  { stars: 4, min: 6, max: 7, name: "Těžká" },
  { stars: 5, min: 8, max: 9, name: "Mistr" },
];

export const COLOR_BY_ID = Object.fromEntries(COLORS.map((c) => [c.id, c]));
export const SHAPE_BY_ID = Object.fromEntries(SHAPES.map((s) => [s.id, s]));

/** Klíč dílku: "red:circle" (barva i tvar) nebo jen "red" (hraje se jen na barvy). */
export function pieceOf(key) {
  const [color, shape] = key.split(":");
  return { color: COLOR_BY_ID[color], shape: shape ? SHAPE_BY_ID[shape] : null };
}

export const colorOf = (key) => key.split(":")[0];

/**
 * Kolik kusů od každého dílku smí být na jedné kartě.
 * @param {{ shapes: boolean, builders: number }} o  builders = kolik hráčů staví stejnou kartu najednou
 */
export function inventory({ shapes = true, builders = 1 } = {}) {
  const counts = {};
  const b = Math.max(1, builders);
  for (const c of COLORS) {
    if (shapes) for (const s of SHAPES) counts[`${c.id}:${s.id}`] = Math.floor(COPIES / b);
    else counts[c.id] = Math.floor((COPIES * SHAPES.length) / b);
  }
  return counts;
}

/** Náhodné číslo 0 ≤ x < 1 z kryptografického generátoru (fér pro všechny hráče). */
export function secureRandom() {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / 4294967296;
}

export function randInt(min, max, rnd = secureRandom) {
  return min + Math.floor(rnd() * (max - min + 1));
}

export function poolSize(counts) {
  return Object.values(counts).reduce((s, q) => s + Math.max(0, q | 0), 0);
}

/** Nejdelší věž bez dvou stejných skupin (barev) nad sebou, kterou jde ze sady postavit. */
export function maxNoAdjacentLength(counts, group = colorOf) {
  const totals = {};
  for (const [k, q] of Object.entries(counts)) totals[group(k)] = (totals[group(k)] || 0) + Math.max(0, q | 0);
  const qs = Object.values(totals);
  const total = qs.reduce((a, b) => a + b, 0);
  const top = Math.max(0, ...qs);
  const rest = total - top;
  return Math.min(total, rest + Math.min(top, rest + 1));
}

function sameStack(a, b) {
  return !!b && a.length === b.length && a.every((x, i) => x === b[i]);
}

/** Jeden pokus: postupně vybírá kusy ze zbývajících (vážně podle počtu). */
function tryBuild(counts, n, noAdjacent, group, rnd) {
  const left = { ...counts };
  const seq = [];
  for (let i = 0; i < n; i++) {
    const last = seq.length ? group(seq[seq.length - 1]) : null;
    const options = Object.entries(left).filter(([k, q]) => q > 0 && !(noAdjacent && group(k) === last));
    const total = options.reduce((s, [, q]) => s + q, 0);
    if (total === 0) return null;
    let r = rnd() * total;
    let pick = options[options.length - 1][0];
    for (const [k, q] of options) {
      r -= q;
      if (r < 0) {
        pick = k;
        break;
      }
    }
    seq.push(pick);
    left[pick] -= 1;
  }
  return seq;
}

/**
 * Vygeneruje kartu – pořadí dílků odspodu nahoru (index 0 = první dílek na podstavci).
 *
 * @param {object} o
 * @param {Record<string, number>} o.counts  kolik kusů kterého dílku smí být na kartě
 * @param {number} o.min                     nejmenší výška věže
 * @param {number} o.max                     největší výška věže
 * @param {boolean} [o.noAdjacent]           žádné dvě stejné barvy nad sebou
 * @param {string[]} [o.previous]            předchozí karta (nová se nebude shodovat)
 * @param {(key: string) => string} [o.group] co se nesmí opakovat nad sebou (výchozí: barva)
 * @param {() => number} [o.rnd]             zdroj náhody (pro testy)
 * @returns {string[]} klíče dílků
 */
export function generateStack({ counts, min, max, noAdjacent = true, previous = null, group = colorOf, rnd = secureRandom }) {
  const clean = {};
  for (const [k, q] of Object.entries(counts || {})) if (q > 0) clean[k] = q | 0;
  const total = poolSize(clean);
  if (total === 0) return [];

  const limit = noAdjacent ? maxNoAdjacentLength(clean, group) : total;
  const hi = Math.max(1, Math.min(max, limit));
  const lo = Math.max(1, Math.min(min, hi));

  let fallback = null;
  for (let attempt = 0; attempt < 120; attempt++) {
    const n = randInt(lo, hi, rnd);
    const seq = tryBuild(clean, n, noAdjacent, group, rnd);
    if (!seq) continue;
    if (!sameStack(seq, previous)) return seq;
    fallback = seq; // jiná karta nejde – vrátíme stejnou
  }
  return fallback || tryBuild(clean, lo, false, group, rnd) || [];
}

/** „1 dílek“, „3 dílky“, „5 dílků“ */
export function pieces(n) {
  if (n === 1) return "1 dílek";
  if (n >= 2 && n <= 4) return `${n} dílky`;
  return `${n} dílků`;
}

/** Název dílku: „červené kolečko“, „žlutý osmiúhelník“, nebo jen „zelená“. */
export function pieceName(key) {
  const { color, shape } = pieceOf(key);
  if (!color) return key;
  return shape ? `${color.adj[shape.g]} ${shape.name}` : color.name;
}

/** Text pro předčítání: „Odspodu: červené kolečko, žlutý čtverec.“ */
export function describe(stack) {
  return "Odspodu: " + stack.map(pieceName).join(", ") + ".";
}

/** Hvězdičky za rychlost (hra pro jednoho): podle času na jeden dílek. */
export function speedStars(ms, count) {
  const perPiece = ms / 1000 / Math.max(1, count);
  if (perPiece <= 6) return 3;
  if (perPiece <= 12) return 2;
  return 1;
}
