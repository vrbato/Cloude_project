import test from "node:test";
import assert from "node:assert/strict";
import { generateStack, maxNoAdjacentLength, pieces, describe, COLOR_BY_ID } from "../public/js/game.js";

const six = { red: 1, yellow: 1, blue: 1, green: 1, orange: 1, purple: 1 };

function usage(stack) {
  const u = {};
  for (const id of stack) u[id] = (u[id] || 0) + 1;
  return u;
}

test("výška věže je v rozsahu a nepoužije víc kusů, než je v sadě", () => {
  for (let i = 0; i < 2000; i++) {
    const s = generateStack({ counts: six, min: 3, max: 5 });
    assert.ok(s.length >= 3 && s.length <= 5, `délka ${s.length}`);
    for (const [id, n] of Object.entries(usage(s))) assert.ok(n <= six[id], `${id} ×${n}`);
  }
});

test("žádné dvě stejné barvy nad sebou", () => {
  const counts = { red: 3, blue: 3, yellow: 2 };
  for (let i = 0; i < 2000; i++) {
    const s = generateStack({ counts, min: 4, max: 8, noAdjacent: true });
    for (let k = 1; k < s.length; k++) assert.notEqual(s[k], s[k - 1], s.join(","));
    for (const [id, n] of Object.entries(usage(s))) assert.ok(n <= counts[id]);
  }
});

test("nová karta se neshoduje s předchozí", () => {
  let prev = null;
  for (let i = 0; i < 500; i++) {
    const s = generateStack({ counts: six, min: 3, max: 3, previous: prev });
    if (prev) assert.notDeepEqual(s, prev);
    prev = s;
  }
});

test("max větší než sada se zkrátí, prázdná sada vrací prázdnou kartu", () => {
  const s = generateStack({ counts: { red: 1, blue: 1 }, min: 5, max: 6 });
  assert.equal(s.length, 2);
  assert.deepEqual(generateStack({ counts: {}, min: 3, max: 5 }), []);
  assert.deepEqual(generateStack({ counts: { unknown: 3 }, min: 3, max: 5 }), []);
});

test("jedna barva s víc kusy a zákazem opakování → 1 kus", () => {
  assert.equal(maxNoAdjacentLength({ red: 4 }), 1);
  assert.deepEqual(generateStack({ counts: { red: 4 }, min: 3, max: 5 }), ["red"]);
  assert.equal(generateStack({ counts: { red: 4 }, min: 3, max: 3, noAdjacent: false }).length, 3);
});

test("maxNoAdjacentLength", () => {
  assert.equal(maxNoAdjacentLength(six), 6);
  assert.equal(maxNoAdjacentLength({ red: 3, blue: 1 }), 3); // r b r
  assert.equal(maxNoAdjacentLength({ red: 2, blue: 2 }), 4);
});

test("všechny barvy se objevují zhruba stejně často", () => {
  const hits = {};
  const N = 6000;
  for (let i = 0; i < N; i++) for (const id of generateStack({ counts: six, min: 3, max: 3 })) hits[id] = (hits[id] || 0) + 1;
  for (const id of Object.keys(six)) {
    const share = hits[id] / (N * 3);
    assert.ok(Math.abs(share - 1 / 6) < 0.02, `${id}: ${share.toFixed(3)}`);
  }
});

test("texty", () => {
  assert.equal(pieces(1), "1 kus");
  assert.equal(pieces(3), "3 kusy");
  assert.equal(pieces(5), "5 kusů");
  assert.equal(describe(["red", "yellow"]), "Odspodu: červená, žlutá.");
  assert.equal(COLOR_BY_ID.blue.name, "modrá");
});
