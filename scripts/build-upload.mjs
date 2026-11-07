/**
 * Sestaví aplikaci pro ruční nasazení na Cloudflare bez GitHubu.
 *
 *   npm run build:upload
 *
 * Výsledek:
 *   dist/pages/                    – složka pro Cloudflare Pages (drag & drop)
 *   dist/valuace-akcii.zip         – totéž jako ZIP (soubory v kořeni archivu):
 *                                    statické soubory z /public + _worker.js (API)
 *   dist/valuace-akcii-worker.js   – celá aplikace v jednom souboru pro vložení
 *                                    do editoru Workeru v dashboardu Cloudflare
 */
import { build } from "esbuild";
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const out = join(dist, "pages");
const zipPath = join(dist, "valuace-akcii.zip");
const standalonePath = join(dist, "valuace-akcii-worker.js");

rmSync(dist, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// 1) statická aplikace
cpSync(join(root, "public"), out, { recursive: true });

// 2) API jako _worker.js
await build({
  entryPoints: [join(root, "src/index.ts")],
  outfile: join(out, "_worker.js"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  legalComments: "none",
  logLevel: "warning",
});

// Pozn.: _routes.json záměrně chybí – nahrávání přes dashboard ho odmítá
// („Pages _routes.json is not supported“). _worker.js sám předává statické
// soubory přes env.ASSETS.

// 4) ZIP (bez externích nástrojů, funguje i na Windows)
function listFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? listFiles(p) : [p];
  });
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function dosTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

function makeZip(files, baseDir) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const { time, date } = dosTime(new Date());
  for (const file of files) {
    const name = Buffer.from(relative(baseDir, file).split(sep).join("/"), "utf8");
    const data = readFileSync(file);
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 názvy
    local.writeUInt16LE(useDeflate ? 8 : 0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(useDeflate ? 8 : 0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + body.length;
  }
  const centralSize = centrals.reduce((s, b) => s + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

const files = listFiles(out).sort();
writeFileSync(zipPath, makeZip(files, out));

// 5) Vše v jednom souboru – statické soubory vložené do Workeru
const TEXT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
};
const BINARY_TYPES = { ".png": "image/png", ".ico": "image/x-icon", ".webp": "image/webp" };
const publicDir = join(root, "public");
const embedded = {};
for (const file of listFiles(publicDir).sort()) {
  const path = "/" + relative(publicDir, file).split(sep).join("/");
  const ext = path.slice(path.lastIndexOf("."));
  if (TEXT_TYPES[ext]) embedded[path] = { type: TEXT_TYPES[ext], body: readFileSync(file, "utf8") };
  else if (BINARY_TYPES[ext]) embedded[path] = { type: BINARY_TYPES[ext], body: readFileSync(file).toString("base64"), base64: true };
  else throw new Error(`Neznámý typ souboru: ${path}`);
}
await build({
  entryPoints: [join(root, "src/standalone.ts")],
  outfile: standalonePath,
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  legalComments: "none",
  logLevel: "warning",
  banner: {
    js: [
      "// Valuace akcií – celá aplikace v jednom souboru pro Cloudflare Workers.",
      "// Vložte celý obsah tohoto souboru do editoru Workeru (Edit code) místo",
      "// původního kódu a klikněte na Deploy. Vygenerováno: npm run build:upload",
    ].join("\n"),
  },
  plugins: [
    {
      name: "virtual-assets",
      setup(b) {
        b.onResolve({ filter: /^virtual:assets$/ }, () => ({ path: "assets", namespace: "virtual" }));
        b.onLoad({ filter: /.*/, namespace: "virtual" }, () => ({ contents: JSON.stringify(embedded), loader: "json" }));
      },
    },
  ],
});

console.log(`Hotovo: ${files.length} souborů`);
for (const f of files) console.log("  " + relative(out, f).split(sep).join("/"));
const kb = (p) => `${(statSync(p).size / 1024).toFixed(0)} kB`;
console.log(`\nSložka:  ${relative(root, out)}\nZIP:     ${relative(root, zipPath)} (${kb(zipPath)})\nWorker:  ${relative(root, standalonePath)} (${kb(standalonePath)})`);
