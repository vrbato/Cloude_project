import { COLORS, COLOR_BY_ID, describe, generateStack, maxNoAdjacentLength, pieces, poolSize } from "./game.js";

/* ================= nastavení a uložený stav ================= */

const STORE_SETTINGS = "vozik:settings";
const STORE_GAME = "vozik:game";
const PLAYER_COLORS = ["#2563eb", "#db2777", "#059669", "#7c3aed"];
const TIMER_OPTIONS = [0, 30, 45, 60, 90, 120];
const TARGET_OPTIONS = [5, 10, 15, 20];
const PRESETS = [
  { label: "Lehká", min: 2, max: 3 },
  { label: "Střední", min: 3, max: 4 },
  { label: "Těžká", min: 4, max: 6 },
];

const DEFAULTS = {
  counts: { red: 1, yellow: 1, blue: 1, green: 1, orange: 1, purple: 1 },
  min: 3,
  max: 5,
  noAdjacent: true,
  timer: 0,
  scoring: false,
  players: ["Hráč 1", "Hráč 2"],
  target: 10,
  names: true,
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
  if (!s.counts || typeof s.counts !== "object") s.counts = { ...DEFAULTS.counts };
  if (!Array.isArray(s.players) || s.players.length === 0) s.players = [...DEFAULTS.players];
  s.players = s.players.slice(0, 4).map((p, i) => String(p || `Hráč ${i + 1}`).slice(0, 20));
  return s;
}

const settings = loadSettings();
const savedGame = load(STORE_GAME) || {};

const state = {
  phase: "intro", // intro | build | done
  stack: null,
  cardNo: savedGame.cardNo || 0,
  scores: settings.players.map((_, i) => savedGame.scores?.[i] || 0),
  best: savedGame.best || null, // nejlepší čas (1 hráč), ms
  startedAt: 0,
  pausedLeft: null,
  lastAward: null, // index hráče, který dostal poslední bod
  timeUp: false,
};

const persistSettings = () => save(STORE_SETTINGS, settings);
const persistGame = () => save(STORE_GAME, { scores: state.scores, cardNo: state.cardNo, best: state.best });

/* ================= DOM ================= */

const $ = (id) => document.getElementById(id);
const el = {
  intro: $("intro"),
  summary: $("summary"),
  card: $("card"),
  cardNo: $("card-no"),
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

const ICON_SPEAK =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>';

function fmtTime(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
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
  drop: (i) => tone(260 + i * 55, 0.12, { type: "triangle", at: 0.3 + i * 0.14, slide: 0.6, vol: 0.22 }),
  tick: () => tone(1100, 0.05, { type: "square", vol: 0.06 }),
  timeUp: () => {
    tone(220, 0.35, { type: "sawtooth", vol: 0.12, slide: 0.7 });
    tone(165, 0.45, { type: "sawtooth", vol: 0.12, at: 0.3, slide: 0.7 });
  },
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, { type: "triangle", at: i * 0.11, vol: 0.2 })),
  click: () => tone(700, 0.04, { type: "sine", vol: 0.08 }),
};

/* ================= předčítání ================= */

const canSpeak = "speechSynthesis" in window;

function speakStack() {
  if (!canSpeak || !state.stack) return;
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
let lastTickSecond = null;

function elapsed() {
  return Date.now() - state.startedAt;
}

function startTimer() {
  cancelAnimationFrame(raf);
  lastTickSecond = null;
  state.startedAt = Date.now();
  loop();
}

function stopTimer() {
  cancelAnimationFrame(raf);
}

function loop() {
  renderTimer();
  if (state.phase !== "build") return;
  if (settings.timer > 0) {
    const left = settings.timer * 1000 - elapsed();
    const sec = Math.ceil(left / 1000);
    if (sec <= 5 && sec > 0 && sec !== lastTickSecond) {
      lastTickSecond = sec;
      sfx.tick();
    }
    if (left <= 0) {
      timeUp();
      return;
    }
  }
  raf = requestAnimationFrame(loop);
}

function renderTimer() {
  const soloStopwatch = settings.scoring && settings.players.length === 1;
  const show = state.phase !== "intro" && (settings.timer > 0 || soloStopwatch);
  el.timer.hidden = !show;
  if (!show) return;
  const bar = el.timer.querySelector(".timer__bar");
  if (settings.timer > 0) {
    const total = settings.timer * 1000;
    const left = state.phase === "build" ? total - elapsed() : (state.pausedLeft ?? 0);
    const frac = Math.max(0, Math.min(1, left / total));
    bar.hidden = false;
    el.timerFill.style.transform = `scaleX(${frac})`;
    el.timerText.textContent = fmtTime(Math.ceil(Math.max(0, left) / 1000) * 1000);
    el.timer.classList.toggle("is-low", left <= 10000);
  } else {
    bar.hidden = true;
    el.timer.classList.remove("is-low");
    const t = state.phase === "build" ? elapsed() : (state.pausedLeft ?? 0);
    el.timerText.textContent = fmtTime(t);
  }
}

/* ================= herní průběh ================= */

function newCard() {
  unlockAudio();
  keepAwake();
  const stack = generateStack({
    counts: settings.counts,
    min: settings.min,
    max: settings.max,
    noAdjacent: settings.noAdjacent,
    previous: state.stack,
  });
  if (stack.length === 0) {
    openSettings();
    return;
  }
  state.stack = stack;
  state.cardNo += 1;
  state.phase = "build";
  state.lastAward = null;
  state.timeUp = false;
  state.pausedLeft = null;
  persistGame();
  renderCard();
  stack.forEach((_, i) => sfx.drop(i));
  if (settings.speak) setTimeout(speakStack, 250 + stack.length * 140);
  startTimer();
  render();
}

function finishBuild() {
  stopTimer();
  const t = elapsed();
  state.pausedLeft = settings.timer > 0 ? Math.max(0, settings.timer * 1000 - t) : t;
  state.phase = "done";
  return t;
}

function award(i) {
  const t = finishBuild();
  state.lastAward = i;
  state.scores[i] += 1;
  let extra = `+1 bod · ${fmtTime(t)}`;
  let title = `⭐ ${esc(settings.players[i])}`;
  if (settings.players.length === 1) {
    title = "Hotovo! ✓";
    const record = state.best == null || t < state.best;
    if (record) state.best = t;
    extra = `za ${fmtTime(t)}${record && state.scores[0] > 1 ? " · nový rekord!" : ""}`;
  }
  persistGame();
  showOverlay(`${title}<small>${esc(extra)}</small>`);
  sfx.win();
  confetti(28);
  render();
  bumpScore(i);
  if (state.scores[i] >= settings.target) setTimeout(() => showWinner(i), 900);
}

function undoAward() {
  if (state.lastAward == null) return;
  state.scores[state.lastAward] = Math.max(0, state.scores[state.lastAward] - 1);
  state.lastAward = null;
  persistGame();
  // zpět do stavění stejné karty – čas pokračuje od okamžiku pozastavení
  state.phase = "build";
  const used = settings.timer > 0 ? settings.timer * 1000 - (state.pausedLeft ?? 0) : (state.pausedLeft ?? 0);
  state.startedAt = Date.now() - used;
  hideOverlay();
  loop();
  render();
}

function timeUp() {
  finishBuild();
  state.timeUp = true;
  sfx.timeUp();
  showOverlay("Čas vypršel!<small>Zkuste další kartu</small>");
  render();
}

function skip() {
  stopTimer();
  newCard();
}

function resetGame() {
  stopTimer();
  state.scores = settings.players.map(() => 0);
  state.cardNo = 0;
  state.stack = null;
  state.phase = "intro";
  state.lastAward = null;
  persistGame();
  hideOverlay();
  render();
}

function showWinner(i) {
  el.winnerTitle.textContent = settings.players.length === 1 ? "Skvělá práce!" : `Vítěz: ${settings.players[i]}`;
  el.winnerText.textContent =
    settings.players.length === 1
      ? `Postaveno ${state.scores[0]} karet. Nejlepší čas ${fmtTime(state.best ?? 0)}.`
      : settings.players.map((p, j) => `${p} ${state.scores[j]}`).join(" · ");
  el.winner.hidden = false;
  sfx.win();
  confetti(90);
}

/* ================= vykreslení ================= */

function renderCard() {
  const s = state.stack;
  el.cardNo.textContent = `Karta ${state.cardNo}`;
  el.cardCount.textContent = pieces(s.length);
  el.stack.setAttribute("aria-label", describe(s));
  el.stack.innerHTML = s
    .map((id, i) => {
      const c = COLOR_BY_ID[id];
      return `<div class="crate${id === "white" ? " is-white" : ""}" style="--c:${c.hex};--ink-c:${c.ink};--i:${i}">
        <span class="crate__n">${i + 1}</span><span class="crate__name">${c.name}</span></div>`;
    })
    .join("");
  hideOverlay();
  sizeCrates();
}

function sizeCrates() {
  if (!state.stack || el.card.hidden) return;
  const n = state.stack.length;
  const avail = el.stack.clientHeight - 10;
  const gap = n > 5 ? 4 : 6;
  const h = Math.max(16, Math.min(96, (avail - gap * (n - 1)) / n));
  el.stack.style.setProperty("--h", `${Math.floor(h)}px`);
  el.stack.style.setProperty("--gap", `${gap}px`);
}

function showOverlay(html) {
  el.overlay.innerHTML = `<div>${html}</div>`;
  el.overlay.hidden = false;
}

function hideOverlay() {
  el.overlay.hidden = true;
}

function renderScores() {
  el.scores.hidden = !settings.scoring;
  if (!settings.scoring) return;
  el.scores.classList.toggle("is-many", settings.players.length > 2);
  const top = Math.max(...state.scores);
  el.scores.innerHTML = settings.players
    .map(
      (p, i) => `<div class="score${top > 0 && state.scores[i] === top && settings.players.length > 1 ? " is-lead" : ""}" style="--p:${PLAYER_COLORS[i]}" data-i="${i}">
        <span class="score__name">${esc(p)}</span><span class="score__pts">${state.scores[i]}</span></div>`,
    )
    .join("");
}

function bumpScore(i) {
  const node = el.scores.querySelector(`[data-i="${i}"]`);
  if (!node) return;
  node.classList.remove("bump");
  void node.offsetWidth;
  node.classList.add("bump");
}

function summaryText() {
  const colors = Object.values(settings.counts).filter((q) => q > 0).length;
  const total = poolSize(settings.counts);
  const parts = [`${colors} ${colors === 1 ? "barva" : colors <= 4 ? "barvy" : "barev"}`, `věž ${settings.min}–${settings.max} kusů`];
  if (settings.timer) parts.push(`časovač ${settings.timer} s`);
  if (settings.scoring) parts.push(settings.players.length === 1 ? "1 hráč" : `${settings.players.length} hráči`);
  let text = parts.join(" · ");
  if (total === 0) text = "Nejdřív v nastavení vyberte barvy nákladu.";
  return text;
}

function button(label, cls, onClick, attrs = "") {
  return { html: `<button type="button" class="btn ${cls}" ${attrs}>${label}</button>`, onClick };
}

function renderActions() {
  const list = [];
  let hint = "";
  const speakBtn = canSpeak ? button(ICON_SPEAK, "btn--icon", speakStack, 'aria-label="Přečíst barvy"') : null;

  if (state.phase === "intro") {
    list.push(button("Nová karta", "btn--primary", newCard));
  } else if (state.phase === "build") {
    if (!settings.scoring) {
      if (speakBtn) list.push(speakBtn);
      list.push(button("Další karta ▶", "btn--primary", newCard));
    } else if (settings.players.length === 1) {
      if (speakBtn) list.push(speakBtn);
      list.push(button("Přeskočit", "btn--small", skip));
      list.push(button("Hotovo ✓", "btn--primary", () => award(0)));
    } else {
      hint = "Kdo to postavil první?";
      settings.players.forEach((p, i) =>
        list.push(button(esc(p), "btn--player", () => award(i), `style="--p:${PLAYER_COLORS[i]}"`)),
      );
      list.push({ html: '<span class="row-break"></span>' });
      if (speakBtn) list.push(speakBtn);
      list.push(button("Přeskočit kartu", "", skip));
    }
  } else if (state.phase === "done") {
    if (state.lastAward != null) list.push(button("Vrátit", "btn--small", undoAward));
    else if (speakBtn) list.push(speakBtn);
    list.push(button("Další karta ▶", "btn--primary", newCard));
  }

  el.actions.classList.toggle("is-many", settings.scoring && settings.players.length > 2 && state.phase === "build");
  el.hint.hidden = !hint;
  el.hint.textContent = hint;
  el.actions.innerHTML = list.map((b) => b.html).join("");
  const nodes = el.actions.querySelectorAll("button");
  list.filter((b) => b.onClick).forEach((b, i) => nodes[i].addEventListener("click", b.onClick));
}

function render() {
  const intro = state.phase === "intro" || !state.stack;
  el.intro.hidden = !intro;
  el.card.hidden = intro;
  el.card.classList.toggle("hide-names", !settings.names);
  el.summary.textContent = summaryText();
  renderScores();
  renderActions();
  renderTimer();
  sizeCrates();
}

/* ================= konfety ================= */

function confetti(count) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < count; i++) {
    const p = document.createElement("i");
    const c = COLORS[i % 8].hex;
    p.style.cssText = `left:${Math.random() * 100}%;--c:${c};--x:${(Math.random() - 0.5) * 160}px;--r:${Math.random() * 720 - 360}deg;--d:${1.3 + Math.random() * 1.2}s;animation-delay:${Math.random() * 0.25}s`;
    frag.appendChild(p);
  }
  el.confetti.appendChild(frag);
  setTimeout(() => {
    for (let k = 0; k < count && el.confetti.firstChild; k++) el.confetti.firstChild.remove();
  }, 2800);
}

/* ================= nastavení – UI ================= */

function stepper(name, value, min, max) {
  return `<span class="stepper" data-step="${name}">
    <button type="button" data-d="-1" ${value <= min ? "disabled" : ""} aria-label="Méně">−</button>
    <output>${value}</output>
    <button type="button" data-d="1" ${value >= max ? "disabled" : ""} aria-label="Více">+</button></span>`;
}

function toggle(name, checked, label, sub = "") {
  return `<label class="field"><span>${label}${sub ? `<small>${sub}</small>` : ""}</span>
    <span class="switch"><input type="checkbox" data-toggle="${name}" ${checked ? "checked" : ""}/><span></span></span></label>`;
}

function seg(name, options, current, fmt) {
  return `<div class="seg" data-seg="${name}">${options
    .map((o) => `<button type="button" data-v="${o}" class="${o === current ? "is-on" : ""}">${fmt(o)}</button>`)
    .join("")}</div>`;
}

function renderSettings() {
  const total = poolSize(settings.counts);
  const limit = settings.noAdjacent ? maxNoAdjacentLength(settings.counts) : total;
  const preset = PRESETS.findIndex((p) => p.min === settings.min && p.max === settings.max);

  el.settings.innerHTML = `
    <section class="group">
      <h3>Barvy nákladu</h3>
      <p class="note">Nastavte barvy, které máte v krabici, a kolik kusů od každé barvy je.</p>
      <div class="colors">${COLORS.map((c) => {
        const q = settings.counts[c.id] || 0;
        return `<div class="color${q > 0 ? " is-on" : ""}" style="--c:${c.hex}">
          <div class="color__swatch"></div><span class="color__name">${c.name}</span>${stepper(`count:${c.id}`, q, 0, 6)}</div>`;
      }).join("")}</div>
      <p class="note" style="margin:12px 0 0">Celkem v sadě: <b>${pieces(total)}</b></p>
    </section>

    <section class="group">
      <h3>Výška věže</h3>
      <p class="note">Kolik kusů má být na jedné kartě. Při každé kartě se výška náhodně vybere z rozsahu.</p>
      ${seg("preset", PRESETS.map((_, i) => i), preset, (i) => `${PRESETS[i].label} ${PRESETS[i].min}–${PRESETS[i].max}`)}
      <div class="field" style="margin-top:8px"><span>Nejméně kusů</span>${stepper("min", settings.min, 1, settings.max)}</div>
      <div class="field"><span>Nejvíce kusů</span>${stepper("max", settings.max, settings.min, 12)}</div>
      ${toggle("noAdjacent", settings.noAdjacent, "Stejné barvy ne nad sebou", "Platí, když máte od barvy víc kusů")}
      ${total > 0 && settings.max > limit ? `<p class="warn">Ze sady jde postavit nejvýš ${pieces(limit)} – vyšší karty se zkrátí.</p>` : ""}
      ${total === 0 ? `<p class="warn">Vyberte alespoň jednu barvu.</p>` : ""}
    </section>

    <section class="group">
      <h3>Časovač</h3>
      <p class="note">Na postavění každé karty. Posledních 5 sekund pípá.</p>
      ${seg("timer", TIMER_OPTIONS, settings.timer, (t) => (t ? (t >= 120 ? `${t / 60} min` : `${t} s`) : "Vypnuto"))}
    </section>

    <section class="group">
      <h3>Hráči a body</h3>
      ${toggle("scoring", settings.scoring, "Počítat body", "Kdo první postaví věž, získá kartu")}
      ${
        settings.scoring
          ? `<div class="players">${settings.players
              .map(
                (p, i) => `<div class="player-row" style="--p:${PLAYER_COLORS[i]}"><i></i>
                  <input type="text" maxlength="20" value="${esc(p)}" data-player="${i}" aria-label="Jméno hráče ${i + 1}" enterkeyhint="done" autocomplete="off"/>
                  ${settings.players.length > 1 ? `<button type="button" data-remove="${i}" aria-label="Odebrat hráče">×</button>` : ""}</div>`,
              )
              .join("")}</div>
            ${settings.players.length < 4 ? `<button type="button" class="link-btn" data-add-player>+ Přidat hráče</button>` : ""}
            <div class="field" style="margin-top:6px"><span>Hraje se do</span>${seg("target", TARGET_OPTIONS, settings.target, (t) => `${t}`)}</div>`
          : ""
      }
    </section>

    <section class="group">
      <h3>Zobrazení a zvuk</h3>
      ${toggle("names", settings.names, "Názvy barev na bednách")}
      ${toggle("sound", settings.sound, "Zvuky", "Na iPhonu nehrají při ztlumeném zvonění")}
      ${canSpeak ? toggle("speak", settings.speak, "Předčítat barvy", "Po zobrazení karty řekne pořadí odspodu") : ""}
    </section>

    ${settings.scoring ? `<button type="button" class="danger" data-reset-game>Vynulovat body</button><div style="height:10px"></div>` : ""}
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

  const step = t.closest("[data-step]");
  if (step && t.dataset.d) {
    const d = Number(t.dataset.d);
    const name = step.dataset.step;
    if (name.startsWith("count:")) {
      const id = name.slice(6);
      settings.counts[id] = Math.max(0, Math.min(6, (settings.counts[id] || 0) + d));
      if (!settings.counts[id]) delete settings.counts[id];
    } else if (name === "min") {
      settings.min = Math.max(1, Math.min(settings.max, settings.min + d));
    } else if (name === "max") {
      settings.max = Math.max(settings.min, Math.min(12, settings.max + d));
    }
    return changed();
  }

  const sg = t.closest("[data-seg]");
  if (sg) {
    const v = Number(t.dataset.v);
    if (sg.dataset.seg === "preset") Object.assign(settings, { min: PRESETS[v].min, max: PRESETS[v].max });
    else settings[sg.dataset.seg] = v;
    return changed();
  }

  if (t.dataset.remove != null) {
    const i = Number(t.dataset.remove);
    settings.players.splice(i, 1);
    state.scores.splice(i, 1);
    persistGame();
    return changed();
  }
  if (t.hasAttribute("data-add-player")) {
    settings.players.push(`Hráč ${settings.players.length + 1}`);
    state.scores.push(0);
    persistGame();
    return changed();
  }
  if (t.hasAttribute("data-reset-game")) {
    if (confirm("Vynulovat body všech hráčů?")) {
      resetGame();
      closeSettings();
    }
    return;
  }
  if (t.hasAttribute("data-reset-settings")) {
    if (confirm("Obnovit výchozí nastavení?")) {
      const keepPlayers = settings.players.length;
      Object.assign(settings, structuredClone(DEFAULTS));
      state.scores = state.scores.slice(0, settings.players.length);
      while (state.scores.length < settings.players.length) state.scores.push(0);
      if (keepPlayers !== settings.players.length) persistGame();
      changed();
    }
  }
});

el.settings.addEventListener("change", (e) => {
  const t = e.target;
  if (t.dataset.toggle) {
    settings[t.dataset.toggle] = t.checked;
    if (t.dataset.toggle === "sound" && t.checked) unlockAudio();
    changed();
  }
});

el.settings.addEventListener("input", (e) => {
  const t = e.target;
  if (t.dataset.player != null) {
    settings.players[Number(t.dataset.player)] = t.value.slice(0, 20) || `Hráč ${Number(t.dataset.player) + 1}`;
    persistSettings();
    render(); // bez překreslení nastavení, aby zůstala klávesnice
  }
});

let pausedForSettings = false;

function openSettings() {
  renderSettings();
  el.sheet.hidden = false;
  el.settings.scrollTop = 0;
  // během nastavení se čas zastaví
  if (state.phase === "build") {
    stopTimer();
    state.pausedLeft = elapsed();
    pausedForSettings = true;
  }
}

function closeSettings() {
  document.activeElement?.blur?.();
  el.sheet.hidden = true;
  if (pausedForSettings && state.phase === "build") {
    state.startedAt = Date.now() - state.pausedLeft;
    state.pausedLeft = null;
    loop();
  }
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
$("btn-again").addEventListener("click", () => {
  el.winner.hidden = true;
  resetGame();
});

// velikost beden podle skutečného místa (otočení, lišty, počet hráčů)
if ("ResizeObserver" in window) new ResizeObserver(() => sizeCrates()).observe(el.stack);
else window.addEventListener("resize", sizeCrates);
document.addEventListener("pointerdown", unlockAudio, { once: true });

/* ================= start ================= */

render();

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
