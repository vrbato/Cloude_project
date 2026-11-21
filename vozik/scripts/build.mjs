/**
 * Sestaví celou aplikaci do JEDNOHO souboru pro Cloudflare Workers:
 *
 *   node scripts/build.mjs        (nebo: npm run build)
 *
 * Výsledek: cloudflare/barevny-vozik-worker.js – obsah vložte v dashboardu
 * Cloudflare do editoru Workeru (Edit code) a dejte Deploy.
 * Bez závislostí – stačí Node 18+.
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = join(root, "public");
const outFile = join(root, "cloudflare", "barevny-vozik-worker.js");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};
const BINARY = new Set([".png"]);

function listFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? listFiles(p) : [p];
  });
}

export function buildWorker() {
  const files = {};
  for (const file of listFiles(publicDir).sort()) {
    const path = "/" + relative(publicDir, file).split(sep).join("/");
    const ext = path.slice(path.lastIndexOf("."));
    if (!TYPES[ext]) throw new Error(`Neznámý typ souboru: ${path}`);
    // HTML, JS, CSS a manifest se vždy ověří (aktualizace hned), ikony se cachují
    const cache = BINARY.has(ext) || ext === ".svg" ? "public, max-age=604800" : "no-cache";
    files[path] = BINARY.has(ext)
      ? { type: TYPES[ext], cache, b64: readFileSync(file).toString("base64") }
      : { type: TYPES[ext], cache, text: readFileSync(file, "utf8") };
  }

  return `// Barevný vozík – celá aplikace v jednom souboru pro Cloudflare Workers.
// Vložte celý obsah tohoto souboru do editoru Workeru (Edit code) místo
// původního kódu a klikněte na Deploy.
// Soubor je vygenerovaný příkazem: node vozik/scripts/build.mjs – needitujte ručně.

const FILES = ${JSON.stringify(files, null, 1)};

const decoded = new Map();
function body(path, f) {
  if (!f.b64) return f.text;
  let b = decoded.get(path);
  if (!b) {
    const bin = atob(f.b64);
    b = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
    decoded.set(path, b);
  }
  return b;
}

export default {
  async fetch(request) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    }
    const url = new URL(request.url);
    let path;
    try {
      path = decodeURIComponent(url.pathname);
    } catch {
      return new Response("Bad Request", { status: 400 });
    }
    if (path.endsWith("/")) path += "index.html";
    let file = FILES[path];
    // neznámá cesta bez přípony → aplikace (index.html)
    if (!file && !path.split("/").pop().includes(".")) file = FILES[(path = "/index.html")];
    if (!file) return new Response("Nenalezeno", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    return new Response(request.method === "HEAD" ? null : body(path, file), {
      headers: {
        "Content-Type": file.type,
        "Cache-Control": file.cache,
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      },
    });
  },
};
`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  mkdirSync(dirname(outFile), { recursive: true });
  const code = buildWorker();
  writeFileSync(outFile, code);
  console.log(`Hotovo: ${relative(root, outFile)} (${(Buffer.byteLength(code) / 1024).toFixed(0)} kB)`);
}
