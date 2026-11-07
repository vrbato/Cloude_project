/**
 * Sestaví aplikaci pro ruční nahrání na Cloudflare Pages (Direct Upload).
 *
 *   npm run build:zip
 *
 * Výsledek:
 *   dist/pages/                 – složka pro nahrání (drag & drop)
 *   dist/valuace-akcii.zip      – totéž jako ZIP (soubory jsou v kořeni archivu)
 *
 * Obsah: statické soubory z /public + _worker.js (API z /src, „advanced mode“
 * Pages Functions) + _routes.json (Worker se spouští jen pro /api/*).
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

// 3) Worker jen pro /api/*, ostatní soubory servíruje Cloudflare přímo
writeFileSync(join(out, "_routes.json"), JSON.stringify({ version: 1, include: ["/api/*"], exclude: [] }, null, 2) + "\n");

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

console.log(`Hotovo: ${files.length} souborů`);
for (const f of files) console.log("  " + relative(out, f).split(sep).join("/"));
console.log(`\nSložka: ${relative(root, out)}\nZIP:    ${relative(root, zipPath)} (${(statSync(zipPath).size / 1024).toFixed(0)} kB)`);
