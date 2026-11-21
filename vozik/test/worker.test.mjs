import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildWorker } from "../scripts/build.mjs";

const file = new URL("../cloudflare/barevny-vozik-worker.js", import.meta.url);

test("cloudflare/barevny-vozik-worker.js je aktuální (spusťte npm run build)", () => {
  assert.equal(readFileSync(file, "utf8"), buildWorker());
});

test("Worker servíruje aplikaci", async () => {
  const { default: worker } = await import(file);
  const get = (p, method = "GET") => worker.fetch(new Request("https://vozik.example" + p, { method }));

  let r = await get("/");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /text\/html/);
  assert.match(await r.text(), /Barevný vozík/);

  r = await get("/js/game.js");
  assert.match(r.headers.get("content-type"), /javascript/);
  assert.match(await r.text(), /generateStack/);

  r = await get("/icons/apple-touch-icon.png");
  assert.equal(r.headers.get("content-type"), "image/png");
  const png = new Uint8Array(await r.arrayBuffer());
  assert.deepEqual([...png.slice(1, 4)], [80, 78, 71]); // "PNG"

  assert.equal((await get("/nejaka-stranka")).status, 200); // SPA → index.html
  assert.equal((await get("/neexistuje.js")).status, 404);
  assert.equal((await get("/", "POST")).status, 405);
  assert.equal((await get("/%E0%A4%A")).status, 400);
});
