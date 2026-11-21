import { LEVELS, describe, generateStack, inventory, pieceOf, pieces, speedStars } from "./game.js";

/* ================= nastavení a uložený stav ================= */

const STORE_SETTINGS = "vozik:settings:v2";
const STORE_GAME = "vozik:game:v2";

/** Souboj: hráč 1 = červený vozík (01), hráč 2 = žlutý vozík (02). */
const DUEL_COLORS = ["#e3342f", "#f5a400"];
const DUEL_INK = ["#ffffff", "#3d2800"];
const TURN_COLORS = ["#2563eb", "#db2777", "#059669", "#7c3aed"];

const MODES = [
  { id: "solo", icon: "⭐", title: "Sám", sub: "hvězdy za rychlost" },
  { id: "duel", icon: "🏁", title: "Souboj", sub: "2 vozíky, kdo dřív" },
  { id: "turns", icon: "🔁", title: "Střídání", sub: "2–4 hráči" },
];
const TIMER_OPTIONS = [0, 30, 45, 60, 90, 120];
const MEMORY_OPTIONS = [0, 5, 10, 15];
const TARGET_OPTIONS = [3, 5, 10, 15];

const DEFAULTS = {
  mode: "duel",
  level: 3,
  shapes: true,
  noAdjacent: true,
  timer: 0,
  memory: 0,
  countdown: true,
  check: true,
  target: 5,
  duelNames: ["Červený", "Žlutý"],
  players: ["Hráč 1", "Hráč 2"],
  numbers: true,
  sound: true,
  speak: false,
};

function load(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* soukromé okno apod. – hra funguje i bez ukládání */
  }
}

function loadSettings() {
  const s = { ...structuredClone(DEFAULTS), ...(load(STORE_SETTINGS) || {}) };
  if (!MODES.some((m) => m.id === s.mode)) s.mode = DEFAULTS.mode;
  s.level = Math.min(LEVELS.length, Math.max(1, s.level | 0 || DEFAULTS.level));
  const names = (list, fallback, max) =>
    (Array.isArray(list) && list.length ? list : fallback).slice(0, max).map((p, i) => String(p || fallback[i] || `Hráč ${i + 1}`).slice(0, 16));
  s.duelNames = names(s.duelNames, DEFAULTS.duelNames, 2);
  while (s.duelNames.length < 2) s.duelNames.push(DEFAULTS.duelNames[s.duelNames.length]);
  s.players = names(s.players, DEFAULTS.players, 4);
  if (s.players.length < 2) s.players.push("Hráč 2");
  return s;
}

const settings = loadSettings();
const saved = load(STORE_GAME) || {};
const game = {
  duel: [0, 0],
  turns: settings.players.map(() => 0),
  solo: { cards: 0, stars: 0 },
  best: saved.best || {}, // nejlepší čas na úroveň (hra pro jednoho), ms – zůstává
  turn: 0,
};

const state = {
  phase: "intro", // intro | countdown | build | check | done
  stack: null,
  cardNo: 0,
  startedAt: 0,
  frozen: null, // změřený čas při pozastavení / dokončení
  lastAward: null,
  checking: null, // hráč, jehož věž se kontroluje
  hidden: false, // paměťová výzva: karta je zakrytá
  advance: false, // střídání: další karta patří dalšímu hráči
};

const persistSettings = () => save(STORE_SETTINGS, settings);
const persistGame = () => save(STORE_GAME, { best: game.best });

/* ================= hráči ================= */

function players() {
  if (settings.mode === "duel") return settings.duelNames.map((name, i) => ({ name, color: DUEL_COLORS[i], ink: DUEL_INK[i] }));
  if (settings.mode === "turns") return settings.players.map((name, i) => ({ name, color: TURN_COLORS[i], ink: "#fff" }));
  return [{ name: "Ty", color: "#2563eb", ink: "#fff" }];
}

const scores = () => (settings.mode === "duel" ? game.duel : game.turns);
const builders = () => (settings.mode === "duel" ? 2 : 1);
const level = () => LEVELS[settings.level - 1];

/* ================= DOM ================= */

const $ = (id) => document.getElementById(id);
const el = {
  home: $("btn-home"),
  intro: $("intro"),
  levels: $("levels"),
  modes: $("modes"),
  summary: $("summary"),
  card: $("card"),
  cardNo: $("card-no"),
  cardStars: $("card-stars"),
  cardCount: $("card-count"),
  stack: $("stack"),
  overlay: $("overlay"),
  scores: $("scores"),
  timer: $("timer"),
  timerFill: $("timer-fill"),
  timerText: $("timer-text"),
  hint: $("hint"),
  actions: $("actions"),
  sheet: $("sheet"),
  settings: $("settings"),
  winner: $("winner"),
  winnerTitle: $("winner-title"),
  winnerText: $("winner-text"),
  confetti: $("confetti"),
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const starRow = (n, of = 5) => "★".repeat(n) + "☆".repeat(of - n);

const ICON_SPEAK =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
const ICON_SKIP =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 5l9 7-9 7V5z"/><path d="M19 5v14"/></svg>';
const ICON_EYE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';

function fmtTime(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/* ================= kreslení dílků ================= */

const OCTAGON = Array.from({ length: 8 }, (_, k) => {
  const a = ((22.5 + 45 * k) * Math.PI) / 180;
  return `${(50 + 45 * Math.cos(a)).toFixed(1)},${(50 + 45 * Math.sin(a)).toFixed(1)}`;
}).join(" ");

const OUTER = {
  circle: '<circle cx="50" cy="50" r="43"/>',
  octagon: `<polygon points="${OCTAGON}"/>`,
  squircle: '<rect x="8" y="8" width="84" height="84" rx="24"/>',
};
const INNER = {
  triangle: '<polygon points="50,27 72,67 28,67"/>',
  square: '<rect x="33" y="33" width="34" height="34" rx="2"/>',
  ring: '<circle cx="50" cy="50" r="18"/>',
};

/** Pohled shora na dílek – stejné tvary jako na dílcích a originálních kartách. */
function shapeSVG(shape, cls = "piece__icon") {
  return `<svg class="${cls}" viewBox="0 0 100 100" aria-hidden="true"><g stroke="currentColor" stroke-width="7" stroke-linejoin="round">
    <g fill="rgba(255,255,255,.22)">${OUTER[shape.id]}</g><g fill="none">${INNER[shape.inner]}</g></g></svg>`;
}

function pieceHTML(key, i) {
  const { color, shape } = pieceOf(key);
  return `<div class="piece shape-${shape ? shape.id : "plain"}" style="--c:${color.hex};--d:${color.dark};--k:${color.ink};--i:${i}">
    <span class="piece__n">${i + 1}</span><span class="piece__bar">${shape ? shapeSVG(shape) : ""}</span></div>`;
}

/* ================= zvuk ================= */

let audio = null;

function unlockAudio() {
  if (!settings.sound) return;
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === "suspended") audio.resume();
  } catch {
    audio = null;
  }
}

function tone(freq, dur, { type = "sine", vol = 0.18, at = 0, slide = 0 } = {}) {
  if (!settings.sound || !audio) return;
  const t = audio.currentTime + at;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slide) osc.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(audio.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

const sfx = {
  drop: (i) => tone(260 + i * 45, 0.12, { type: "triangle", at: 0.25 + i * 0.12, slide: 0.6, vol: 0.22 }),
  count: () => tone(520, 0.15, { type: "square", vol: 0.1 }),
  go: () => tone(880, 0.35, { type: "square", vol: 0.12 }),
  tick: () => tone(1100, 0.05, { type: "square", vol: 0.06 }),
  timeUp: () => {
    tone(220, 0.35, { type: "sawtooth", vol: 0.12, slide: 0.7 });
    tone(165, 0.45, { type: "sawtooth", vol: 0.12, at: 0.3, slide: 0.7 });
  },
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, { type: "triangle", at: i * 0.11, vol: 0.2 })),
  nope: () => tone(300, 0.2, { type: "triangle", vol: 0.15, slide: 0.8 }),
  click: () => tone(700, 0.04, { vol: 0.08 }),
};

/* ================= předčítání ================= */

const canSpeak = "speechSynthesis" in window;

function speakStack() {
  if (!canSpeak || !state.stack || state.hidden) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(describe(state.stack));
  u.lang = "cs-CZ";
  u.rate = 0.9;
  const voice = speechSynthesis.getVoices().find((v) => v.lang?.toLowerCase().startsWith("cs"));
  if (voice) u.voice = voice;
  speechSynthesis.speak(u);
}

/* ================= displej nezhasne ================= */

let wakeLock = null;

async function keepAwake() {
  try {
    if ("wakeLock" in navigator && !wakeLock && document.visibilityState === "visible") {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => (wakeLock = null));
    }
  } catch {
    /* nepodporováno nebo zamítnuto */
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.phase !== "intro") keepAwake();
});

/* ================= časovač ================= */

let raf = 0;
let lastTick = null;
let pending = []; // odpočet, paměťová výzva, nápověda

function later(fn, ms) {
  pending.push(setTimeout(fn, ms));
}

function clearPending() {
  pending.forEach(clearTimeout);
  pending = [];
}

const elapsed = () => (state.frozen != null ? state.frozen : Date.now() - state.startedAt);
const running = () => state.phase === "build" || state.phase === "check";

function startTimer() {
  cancelAnimationFrame(raf);
  lastTick = null;
  state.frozen = null;
  state.startedAt = Date.now();
  loop();
}

function freeze() {
  cancelAnimationFrame(raf);
  if (state.frozen == null) state.frozen = Date.now() - state.startedAt;
  return state.frozen;
}

function resume() {
  if (state.frozen == null) return;
  state.startedAt = Date.now() - state.frozen;
  state.frozen = null;
  loop();
}

function loop() {
  cancelAnimationFrame(raf);
  renderTimer();
  if (!running() || state.frozen != null) return;
  if (settings.timer > 0 && state.phase === "build") {
    const left = settings.timer * 1000 - elapsed();
    const sec = Math.ceil(left / 1000);
    if (sec <= 5 && sec > 0 && sec !== lastTick) {
      lastTick = sec;
      sfx.tick();
    }
    if (left <= 0) return timeUp();
  }
  raf = requestAnimationFrame(loop);
}

function renderTimer() {
  const show = ["build", "check", "done"].includes(state.phase);
  el.timer.hidden = !show;
  if (!show) return;
  const bar = el.timer.querySelector(".timer__bar");
  if (settings.timer > 0) {
    const total = settings.timer * 1000;
    const left = Math.max(0, total - elapsed());
    bar.hidden = false;
    el.timerFill.style.transform = `scaleX(${left / total})`;
    el.timerText.textContent = fmtTime(Math.ceil(left / 1000) * 1000);
    el.timer.classList.toggle("is-low", left <= 10000);
  } else {
    bar.hidden = true;
    el.timer.classList.remove("is-low");
    el.timerText.textContent = fmtTime(elapsed());
  }
}

/* ================= průběh hry ================= */

function newCard() {
  unlockAudio();
  keepAwake();
  clearPending();
  cancelAnimationFrame(raf);
  if (state.advance) {
    game.turn = (game.turn + 1) % settings.players.length;
    state.advance = false;
  }
  const lv = level();
  state.stack = generateStack({
    counts: inventory({ shapes: settings.shapes, builders: builders() }),
    min: lv.min,
    max: lv.max,
    noAdjacent: settings.noAdjacent,
    previous: state.stack,
  });
  state.cardNo += 1;
  state.lastAward = null;
  state.checking = null;
  state.hidden = false;
  state.frozen = 0;

  el.cardNo.textContent = `Karta ${state.cardNo}`;
  el.cardStars.textContent = starRow(lv.stars);
  el.cardCount.textContent = pieces(state.stack.length);
  el.stack.innerHTML = "";
  el.stack.setAttribute("aria-label", describe(state.stack));

  if (settings.countdown) {
    state.phase = "countdown";
    const steps = ["3", "2", "1"];
    showOverlay(`<span class="count">${steps[0]}</span>`, "is-count");
    sfx.count();
    steps.slice(1).forEach((n, k) =>
      later(() => {
        showOverlay(`<span class="count">${n}</span>`, "is-count");
        sfx.count();
      }, (k + 1) * 750),
    );
    later(() => {
      sfx.go();
      startBuild();
    }, steps.length * 750);
  } else {
    startBuild();
  }
  render();
}

function startBuild() {
  state.phase = "build";
  hideOverlay();
  el.stack.innerHTML = state.stack.map(pieceHTML).join("");
  sizePieces();
  state.stack.forEach((_, i) => sfx.drop(i));
  if (settings.speak) later(speakStack, 300 + state.stack.length * 120);
  if (settings.memory > 0) later(hideCard, settings.memory * 1000 + state.stack.length * 120);
  startTimer();
  render();
}

function hideCard() {
  if (state.phase !== "build") return;
  state.hidden = true;
  showOverlay("🤔<br/>Pamatuješ si to?<small>Postav věž zpaměti</small>", "is-memory");
  render();
}

function peek() {
  if (!state.hidden) return;
  state.hidden = false;
  hideOverlay();
  render();
  later(hideCard, 2000);
}

function reveal() {
  state.hidden = false;
  hideOverlay();
}

/** Klepnutí na „Hotovo“. */
function finished(i) {
  if (!running()) return;
  sfx.click();
  if (settings.mode === "duel" && settings.check) {
    clearPending();
    reveal();
    state.checking = i;
    state.phase = "check";
    render();
    return;
  }
  award(i);
}

function checkNo() {
  sfx.nope();
  state.checking = null;
  state.phase = "build";
  if (settings.memory > 0) later(hideCard, 3000);
  render();
  loop();
}

function award(i) {
  clearPending();
  reveal();
  const t = freeze();
  state.phase = "done";
  state.checking = null;
  const p = players()[i];
  let title;
  let extra;

  if (settings.mode === "solo") {
    const stars = speedStars(t, state.stack.length);
    const prevBest = game.best[settings.level] ?? null;
    const record = prevBest == null || t < prevBest;
    if (record) game.best[settings.level] = t;
    game.solo.cards += 1;
    game.solo.stars += stars;
    state.lastAward = { type: "solo", stars, prevBest };
    title = `<span class="earned">${"★".repeat(stars)}<i>${"★".repeat(3 - stars)}</i></span>`;
    extra = `za ${fmtTime(t)}${record && prevBest != null ? " · nový rekord!" : ""}`;
  } else {
    scores()[i] += 1;
    state.lastAward = { type: settings.mode, i };
    if (settings.mode === "turns") state.advance = true;
    title = `⭐ ${esc(p.name)}`;
    extra = `+1 bod · ${fmtTime(t)}`;
  }

  persistGame();
  showOverlay(`${title}<small>${esc(extra)}</small>`);
  sfx.win();
  confetti(28);
  render();
  bumpScore(settings.mode === "solo" ? 0 : i);
  if (settings.mode !== "solo" && scores()[i] >= settings.target) later(() => showWinner(i), 1000);
}

function undoAward() {
  const a = state.lastAward;
  if (!a) return;
  clearPending(); // zruší i případné vyhlášení vítěze
  if (a.type === "solo") {
    game.solo.cards -= 1;
    game.solo.stars -= a.stars;
    if (a.prevBest == null) delete game.best[settings.level];
    else game.best[settings.level] = a.prevBest;
  } else {
    scores()[a.i] = Math.max(0, scores()[a.i] - 1);
    state.advance = false;
  }
  state.lastAward = null;
  persistGame();
  hideOverlay();
  state.phase = "build";
  render();
  resume();
}

function timeUp() {
  clearPending();
  reveal();
  freeze();
  state.phase = "done";
  sfx.timeUp();
  let sub = "Zkuste další kartu";
  if (settings.mode === "turns") {
    state.advance = true;
    sub = `Teď hraje ${settings.players[(game.turn + 1) % settings.players.length]}`;
  }
  showOverlay(`⏰ Čas vypršel!<small>${esc(sub)}</small>`);
  render();
}

function skip() {
  sfx.click();
  newCard();
}

function resetScores() {
  game.duel = [0, 0];
  game.turns = settings.players.map(() => 0);
  game.solo = { cards: 0, stars: 0 };
  game.turn = 0;
  state.advance = false;
}

function toMenu() {
  clearPending();
  cancelAnimationFrame(raf);
  resetScores();
  state.stack = null;
  state.cardNo = 0;
  state.phase = "intro";
  state.lastAward = null;
  state.hidden = false;
  hideOverlay();
  render();
}

function showWinner(i) {
  const ps = players();
  el.winnerTitle.textContent = `Vítěz: ${ps[i].name}`;
  el.winnerText.textContent = ps.map((p, j) => `${p.name} ${scores()[j]}`).join(" · ");
  el.winner.hidden = false;
  sfx.win();
  confetti(90);
}

/* ================= vykreslení ================= */

function sizePieces() {
  if (!state.stack || el.card.hidden || !el.stack.firstChild) return;
  const n = state.stack.length;
  const avail = el.stack.clientHeight - 8;
  const gap = n > 6 ? 3 : 5;
  const h = Math.max(16, Math.min(78, (avail - gap * (n - 1)) / n));
  el.stack.style.setProperty("--h", `${Math.floor(h)}px`);
  el.stack.style.setProperty("--gap", `${gap}px`);
}

function showOverlay(html, cls = "") {
  el.overlay.className = `card__overlay ${cls}`;
  el.overlay.innerHTML = `<div>${html}</div>`;
  el.overlay.hidden = false;
}

function hideOverlay() {
  el.overlay.hidden = true;
}

function renderIntro() {
  el.levels.innerHTML = LEVELS.map(
    (l, i) => `<button type="button" class="level${settings.level === i + 1 ? " is-on" : ""}" data-level="${i + 1}" role="radio" aria-checked="${settings.level === i + 1}" aria-label="${l.name}, ${pieces(l.max)}">
      <span class="level__stars">${"★".repeat(l.stars)}</span><span class="level__n">${l.min === l.max ? l.min : `${l.min}–${l.max}`}</span></button>`,
  ).join("");
  el.modes.innerHTML = MODES.map(
    (m) => `<button type="button" class="mode${settings.mode === m.id ? " is-on" : ""}" data-mode="${m.id}" role="radio" aria-checked="${settings.mode === m.id}">
      <span class="mode__icon" aria-hidden="true">${m.icon}</span><b>${m.title}</b><small>${m.sub}</small></button>`,
  ).join("");
  const parts = [settings.shapes ? "barva + tvar" : "jen barvy"];
  parts.push(settings.timer ? `časovač ${settings.timer} s` : "bez časovače");
  if (settings.memory) parts.push(`paměť ${settings.memory} s`);
  if (settings.mode !== "solo") parts.push(`do ${settings.target} bodů`);
  el.summary.innerHTML = `${parts.join(" · ")} · <b>Upravit ›</b>`;
}

el.levels.addEventListener("click", (e) => {
  const b = e.target.closest("[data-level]");
  if (!b) return;
  unlockAudio();
  settings.level = Number(b.dataset.level);
  sfx.click();
  persistSettings();
  render();
});

el.modes.addEventListener("click", (e) => {
  const b = e.target.closest("[data-mode]");
  if (!b) return;
  unlockAudio();
  settings.mode = b.dataset.mode;
  sfx.click();
  persistSettings();
  render();
});

el.summary.addEventListener("click", () => openSettings());

function renderScores() {
  const show = state.phase !== "intro";
  el.scores.hidden = !show;
  if (!show) return;
  if (settings.mode === "solo") {
    const best = game.best[settings.level];
    el.scores.className = "scores is-many";
    el.scores.innerHTML = `
      <div class="score" style="--p:#e6a100" data-i="0"><span class="score__name">Hvězdy</span><span class="score__pts">★ ${game.solo.stars}</span></div>
      <div class="score" style="--p:#2563eb"><span class="score__name">Karty</span><span class="score__pts">${game.solo.cards}</span></div>
      <div class="score" style="--p:#059669"><span class="score__name">Rekord</span><span class="score__pts">${best ? fmtTime(best) : "–"}</span></div>`;
    return;
  }
  const ps = players();
  const sc = scores();
  const top = Math.max(...sc);
  el.scores.className = `scores${ps.length > 2 ? " is-many" : ""}`;
  el.scores.innerHTML = ps
    .map((p, i) => {
      const cls = [
        "score",
        top > 0 && sc[i] === top ? "is-lead" : "",
        settings.mode === "turns" && i === game.turn ? "is-turn" : "",
      ].join(" ");
      return `<div class="${cls}" style="--p:${p.color}" data-i="${i}"><span class="score__name">${esc(p.name)}</span><span class="score__pts">${sc[i]}</span></div>`;
    })
    .join("");
}

function bumpScore(i) {
  const node = el.scores.querySelector(`[data-i="${i}"]`);
  if (!node) return;
  node.classList.remove("bump");
  void node.offsetWidth;
  node.classList.add("bump");
}

function button(label, cls, onClick, attrs = "") {
  return { html: `<button type="button" class="btn ${cls}" ${attrs}>${label}</button>`, onClick };
}

function renderActions() {
  const list = [];
  let hint = "";
  const ps = players();
  const helper = state.hidden
    ? button(ICON_EYE, "btn--icon", peek, 'aria-label="Nápověda – ukázat kartu"')
    : canSpeak
      ? button(ICON_SPEAK, "btn--icon", speakStack, 'aria-label="Přečíst kartu"')
      : null;
  const playerBtn = (i) =>
    button(`<b>${esc(ps[i].name)}</b><small>hotovo!</small>`, "btn--player btn--tall", () => finished(i), `style="--p:${ps[i].color};--pi:${ps[i].ink}"`);

  switch (state.phase) {
    case "intro":
      list.push(button("Hrát ▶", "btn--primary", newCard));
      break;
    case "countdown":
      hint = settings.mode === "turns" ? `Připrav se: <b style="color:${ps[game.turn].color}">${esc(ps[game.turn].name)}</b>` : "Připravit…";
      list.push(button("Připravit…", "", null, "disabled"));
      break;
    case "build":
      if (settings.mode === "duel") {
        list.push(playerBtn(0), playerBtn(1));
        list.push({ html: '<span class="row-break"></span>' });
        if (helper) list.push(helper);
        list.push(button("Přeskočit kartu", "", skip));
      } else {
        if (settings.mode === "turns") hint = `Na řadě: <b style="color:${ps[game.turn].color}">${esc(ps[game.turn].name)}</b>`;
        if (helper) list.push(helper);
        list.push(button(ICON_SKIP, "btn--icon", skip, 'aria-label="Přeskočit kartu"'));
        list.push(button("Hotovo ✓", "btn--primary", () => finished(settings.mode === "turns" ? game.turn : 0)));
      }
      break;
    case "check": {
      const p = ps[state.checking];
      hint = `Sedí věž – <b style="color:${p.color}">${esc(p.name)}</b>? Porovnejte ji s kartou.`;
      list.push(button("✗ Ještě ne", "", checkNo));
      list.push(button("✓ Sedí!", "btn--player", () => award(state.checking), `style="--p:${p.color};--pi:${p.ink}"`));
      break;
    }
    case "done": {
      if (state.lastAward) list.push(button("Vrátit", "btn--small", undoAward));
      else if (helper) list.push(helper);
      const next = state.advance ? settings.players[(game.turn + 1) % settings.players.length] : null;
      list.push(button(next ? `Hraje ${esc(next)} ▶` : "Další karta ▶", "btn--primary", newCard));
      break;
    }
  }

  el.hint.hidden = !hint;
  el.hint.innerHTML = hint;
  el.actions.innerHTML = list.map((b) => b.html).join("");
  const nodes = el.actions.querySelectorAll("button");
  let k = 0;
  for (const b of list) {
    if (!b.html.startsWith("<button")) continue;
    if (b.onClick) nodes[k].addEventListener("click", b.onClick);
    k++;
  }
}

function render() {
  const intro = state.phase === "intro";
  el.intro.hidden = !intro;
  el.card.hidden = intro;
  el.home.hidden = intro;
  el.card.classList.toggle("hide-numbers", !settings.numbers);
  el.card.classList.toggle("is-hidden", state.hidden);
  el.card.dataset.level = settings.level;
  if (intro) renderIntro();
  renderScores();
  renderActions();
  renderTimer();
  sizePieces();
}

/* ================= konfety ================= */

function confetti(count) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const colors = ["#e3342f", "#ffb400", "#8cc63f", "#2f7fd8", "#22b8b0"];
  const frag = document.createDocumentFragment();
  for (let i = 0; i < count; i++) {
    const p = document.createElement("i");
    p.style.cssText = `left:${Math.random() * 100}%;--c:${colors[i % colors.length]};--x:${(Math.random() - 0.5) * 160}px;--r:${Math.random() * 720 - 360}deg;--d:${1.3 + Math.random() * 1.2}s;animation-delay:${Math.random() * 0.25}s`;
    frag.appendChild(p);
  }
  el.confetti.appendChild(frag);
  setTimeout(() => {
    for (let k = 0; k < count && el.confetti.firstChild; k++) el.confetti.firstChild.remove();
  }, 2800);
}

/* ================= nastavení – UI ================= */

function toggle(name, checked, label, sub = "") {
  return `<label class="field"><span>${label}${sub ? `<small>${sub}</small>` : ""}</span>
    <span class="switch"><input type="checkbox" data-toggle="${name}" ${checked ? "checked" : ""}/><span></span></span></label>`;
}

function seg(name, options, current, fmt) {
  return `<div class="seg" data-seg="${name}">${options
    .map((o) => `<button type="button" data-v="${o}" class="${o === current ? "is-on" : ""}">${fmt(o)}</button>`)
    .join("")}</div>`;
}

const fmtSeconds = (t) => (t ? (t >= 120 ? `${t / 60} min` : `${t} s`) : "Vypnuto");

function nameInput(group, i, value, color, removable) {
  return `<div class="player-row" style="--p:${color}"><i></i>
    <input type="text" maxlength="16" value="${esc(value)}" data-name="${group}:${i}" aria-label="Jméno hráče ${i + 1}" enterkeyhint="done" autocomplete="off"/>
    ${removable ? `<button type="button" data-remove="${i}" aria-label="Odebrat hráče">×</button>` : ""}</div>`;
}

function renderSettings() {
  el.settings.innerHTML = `
    <section class="group">
      <h3>Dílky</h3>
      <div class="legend">${["circle", "octagon", "squircle"]
        .map((id) => {
          const { shape } = pieceOf(`red:${id}`);
          return `<span>${shapeSVG(shape, "legend__icon")}${shape.name}</span>`;
        })
        .join("")}</div>
      ${toggle("shapes", settings.shapes, "Musí sedět i tvar", "Jako na originálních kartách. Pro nejmenší vypněte – pak stačí barva.")}
      ${toggle("noAdjacent", settings.noAdjacent, "Stejné barvy ne nad sebou")}
      <p class="note">V krabici jsou 3 barvy × 3 tvary × 2 kusy. V souboji staví oba hráči stejnou kartu, proto je na ní každý dílek nejvýš jednou – každý si vezme svůj.</p>
    </section>

    <section class="group">
      <h3>Pravidla</h3>
      <div class="field field--col"><span>Časovač na kartu<small>Posledních 5 sekund pípá. Ve střídání pak hraje další hráč.</small></span>
        ${seg("timer", TIMER_OPTIONS, settings.timer, fmtSeconds)}</div>
      <div class="field field--col"><span>Paměťová výzva<small>Karta po chvíli zmizí a staví se zpaměti. Tlačítko s okem ji na 2 s ukáže.</small></span>
        ${seg("memory", MEMORY_OPTIONS, settings.memory, fmtSeconds)}</div>
      ${toggle("countdown", settings.countdown, "Odpočet 3 – 2 – 1", "Karta se ukáže všem najednou")}
      ${toggle("check", settings.check, "Kontrola věže v souboji", "Po „hotovo!“ dospělý potvrdí, že věž sedí")}
      <div class="field field--col"><span>Hraje se do</span>
        ${seg("target", TARGET_OPTIONS, settings.target, (t) => `${t} bodů`)}</div>
    </section>

    <section class="group">
      <h3>Souboj – kdo řídí který vozík</h3>
      <div class="players">${settings.duelNames.map((n, i) => nameInput("duel", i, n, DUEL_COLORS[i], false)).join("")}</div>
    </section>

    <section class="group">
      <h3>Střídání – hráči</h3>
      <div class="players">${settings.players.map((n, i) => nameInput("turns", i, n, TURN_COLORS[i], settings.players.length > 2)).join("")}</div>
      ${settings.players.length < 4 ? `<button type="button" class="link-btn" data-add-player>+ Přidat hráče</button>` : ""}
    </section>

    <section class="group">
      <h3>Zobrazení a zvuk</h3>
      ${toggle("numbers", settings.numbers, "Čísla pořadí u dílků", "1 = první dílek na podstavec")}
      ${toggle("sound", settings.sound, "Zvuky", "Na iPhonu nehrají při ztlumeném zvonění")}
      ${canSpeak ? toggle("speak", settings.speak, "Předčítat kartu", "Řekne pořadí odspodu, např. „červené kolečko…“") : ""}
    </section>

    <button type="button" class="danger" data-reset-settings>Obnovit výchozí nastavení</button>

    <p class="about">Karty se generují náhodně přímo v telefonu, aplikace funguje i bez internetu.<br/>
    iPhone: Safari → Sdílet → <b>Přidat na plochu</b>.</p>`;
}

function changed() {
  persistSettings();
  renderSettings();
  render();
}

el.settings.addEventListener("click", (e) => {
  const t = e.target.closest("button");
  if (!t) return;
  sfx.click();

  const sg = t.closest("[data-seg]");
  if (sg) {
    settings[sg.dataset.seg] = Number(t.dataset.v);
    return changed();
  }
  if (t.dataset.remove != null) {
    const i = Number(t.dataset.remove);
    settings.players.splice(i, 1);
    game.turns.splice(i, 1);
    if (game.turn >= settings.players.length) game.turn = 0;
    return changed();
  }
  if (t.hasAttribute("data-add-player")) {
    settings.players.push(`Hráč ${settings.players.length + 1}`);
    game.turns.push(0);
    return changed();
  }
  if (t.hasAttribute("data-reset-settings") && confirm("Obnovit výchozí nastavení?")) {
    const { mode, level } = settings;
    Object.assign(settings, structuredClone(DEFAULTS), { mode, level });
    game.turns = settings.players.map((_, i) => game.turns[i] || 0);
    game.turn = Math.min(game.turn, settings.players.length - 1);
    changed();
  }
});

el.settings.addEventListener("change", (e) => {
  const t = e.target;
  if (!t.dataset.toggle) return;
  settings[t.dataset.toggle] = t.checked;
  if (t.dataset.toggle === "sound" && t.checked) unlockAudio();
  changed();
});

el.settings.addEventListener("input", (e) => {
  const t = e.target;
  if (!t.dataset.name) return;
  const [group, idx] = t.dataset.name.split(":");
  const i = Number(idx);
  const list = group === "duel" ? settings.duelNames : settings.players;
  list[i] = t.value.trim().slice(0, 16) || (group === "duel" ? DEFAULTS.duelNames[i] : `Hráč ${i + 1}`);
  persistSettings();
  render(); // bez překreslení nastavení, aby zůstala klávesnice
});

let pausedForSettings = false;

function openSettings() {
  renderSettings();
  el.sheet.hidden = false;
  el.settings.scrollTop = 0;
  // během nastavení se čas zastaví
  if (running() && state.frozen == null) {
    freeze();
    pausedForSettings = true;
  }
}

function closeSettings() {
  document.activeElement?.blur?.();
  el.sheet.hidden = true;
  if (pausedForSettings && running()) resume();
  pausedForSettings = false;
  render();
}

$("btn-settings").addEventListener("click", () => {
  unlockAudio();
  openSettings();
});
$("btn-close").addEventListener("click", closeSettings);
el.sheet.addEventListener("click", (e) => {
  if (e.target === el.sheet) closeSettings();
});
el.home.addEventListener("click", () => {
  const anyScore = game.duel.some(Boolean) || game.turns.some(Boolean) || game.solo.cards > 0;
  if (!anyScore || confirm("Ukončit hru? Body se vynulují.")) toMenu();
});
$("btn-again").addEventListener("click", () => {
  el.winner.hidden = true;
  resetScores();
  state.cardNo = 0;
  newCard();
});
$("btn-menu").addEventListener("click", () => {
  el.winner.hidden = true;
  toMenu();
});

// velikost dílků podle skutečného místa (otočení, lišty, počet hráčů)
if ("ResizeObserver" in window) new ResizeObserver(() => sizePieces()).observe(el.stack);
else window.addEventListener("resize", sizePieces);
document.addEventListener("pointerdown", unlockAudio, { once: true });

/* ================= start ================= */

render();

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
