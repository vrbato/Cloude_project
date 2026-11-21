import test from "node:test";
import assert from "node:assert/strict";
import {
  COPIES,
  LEVELS,
  colorOf,
  describe,
  generateStack,
  inventory,
  maxNoAdjacentLength,
  pieceName,
  pieces,
  speedStars,
} from "../public/js/game.js";

function usage(stack) {
  const u = {};
  for (const id of stack) u[id] = (u[id] || 0) + 1;
  return u;
}

const noRepeatedColors = (s) => s.every((k, i) => i === 0 || colorOf(k) !== colorOf(s[i - 1]));

test("sada odpovídá krabici: 3 barvy × 3 tvary × 2 kusy = 18 dílků", () => {
  const inv = inventory({ shapes: true, builders: 1 });
  assert.equal(Object.keys(inv).length, 9);
  assert.equal(Object.values(inv).reduce((a, b) => a + b, 0), 18);
  assert.deepEqual(inventory({ shapes: false, builders: 1 }), { red: 6, yellow: 6, green: 6 });
});

test("souboj: každý dílek nejvýš jednou, aby oba hráči postavili stejnou kartu", () => {
  const counts = inventory({ shapes: true, builders: 2 });
  for (const lv of LEVELS) {
    for (let i = 0; i < 500; i++) {
      const s = generateStack({ counts, min: lv.min, max: lv.max });
      assert.ok(s.length >= lv.min && s.length <= lv.max, `úroveň ${lv.stars}: délka ${s.length}`);
      for (const [k, n] of Object.entries(usage(s))) assert.ok(n * 2 <= COPIES, `${k} ×${n}`);
      assert.ok(noRepeatedColors(s), s.join(","));
    }
  }
});

test("souboj jen na barvy: každá barva nejvýš 3× (6 kusů ÷ 2 hráči)", () => {
  const counts = inventory({ shapes: false, builders: 2 });
  for (let i = 0; i < 1000; i++) {
    const s = generateStack({ counts, min: 8, max: 9 });
    for (const [k, n] of Object.entries(usage(s))) assert.ok(n <= 3, `${k} ×${n}`);
  }
});

test("hra pro jednoho nepoužije víc kusů, než je v krabici", () => {
  const counts = inventory({ shapes: true, builders: 1 });
  for (let i = 0; i < 1000; i++) {
    const s = generateStack({ counts, min: 8, max: 9, noAdjacent: false });
    for (const [k, n] of Object.entries(usage(s))) assert.ok(n <= COPIES, `${k} ×${n}`);
  }
});

test("nová karta se neshoduje s předchozí (i u jednoho dílku)", () => {
  const counts = inventory({ shapes: true, builders: 2 });
  let prev = null;
  for (let i = 0; i < 300; i++) {
    const s = generateStack({ counts, min: 1, max: 1, previous: prev });
    if (prev) assert.notDeepEqual(s, prev);
    prev = s;
  }
});

test("všechny dílky se objevují zhruba stejně často", () => {
  const counts = inventory({ shapes: true, builders: 2 });
  const hits = {};
  const N = 6000;
  for (let i = 0; i < N; i++) for (const k of generateStack({ counts, min: 3, max: 3, noAdjacent: false })) hits[k] = (hits[k] || 0) + 1;
  for (const k of Object.keys(counts)) {
    const share = hits[k] / (N * 3);
    assert.ok(Math.abs(share - 1 / 9) < 0.015, `${k}: ${share.toFixed(3)}`);
  }
});

test("okrajové případy", () => {
  assert.deepEqual(generateStack({ counts: {}, min: 3, max: 5 }), []);
  assert.equal(generateStack({ counts: { "red:circle": 1, "red:octagon": 1 }, min: 5, max: 6, noAdjacent: false }).length, 2);
  assert.equal(maxNoAdjacentLength({ "red:circle": 2, "red:octagon": 2 }), 1);
  assert.equal(maxNoAdjacentLength(inventory({ shapes: true, builders: 2 })), 9);
  assert.equal(maxNoAdjacentLength({ red: 3, blue: 1 }), 3);
});

test("texty a hvězdičky", () => {
  assert.equal(pieces(1), "1 dílek");
  assert.equal(pieces(3), "3 dílky");
  assert.equal(pieces(7), "7 dílků");
  assert.equal(pieceName("red:circle"), "červené kolečko");
  assert.equal(pieceName("yellow:octagon"), "žlutý osmiúhelník");
  assert.equal(pieceName("green:squircle"), "zelený čtverec");
  assert.equal(pieceName("green"), "zelená");
  assert.equal(describe(["red:circle", "yellow"]), "Odspodu: červené kolečko, žlutá.");
  assert.equal(speedStars(15000, 5), 3);
  assert.equal(speedStars(50000, 5), 2);
  assert.equal(speedStars(90000, 5), 1);
});
