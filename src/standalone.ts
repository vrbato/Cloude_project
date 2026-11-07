/**
 * Varianta „vše v jednom souboru“: statické soubory aplikace jsou vložené přímo
 * do Workeru, takže stačí jeden soubor vložit do editoru v dashboardu Cloudflare
 * (bez nahrávání složky, bez GitHubu). Sestavuje `npm run build:upload`.
 */
import handler, { type Env } from "./index";
import EMBEDDED from "virtual:assets";

const cache = new Map<string, Uint8Array | string>();

function bodyOf(path: string): Uint8Array | string {
  let b = cache.get(path);
  if (b === undefined) {
    const a = EMBEDDED[path];
    if (a.base64) {
      const bin = atob(a.body);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      b = bytes;
    } else {
      b = a.body;
    }
    cache.set(path, b);
  }
  return b;
}

const ASSETS = {
  async fetch(input: Request | string): Promise<Response> {
    const url = new URL(typeof input === "string" ? input : input.url);
    let path = decodeURIComponent(url.pathname);
    if (path.endsWith("/")) path += "index.html";
    // jednostránková aplikace: neznámé cesty bez přípony → index.html
    if (!EMBEDDED[path] && !path.split("/").pop()!.includes(".")) path = "/index.html";
    const asset = EMBEDDED[path];
    if (!asset) return new Response("Soubor nenalezen", { status: 404 });
    const revalidate = /\.(html|webmanifest)$|\/sw\.js$|\/js\/|\/css\//.test(path);
    return new Response(bodyOf(path), {
      headers: {
        "Content-Type": asset.type,
        "Cache-Control": revalidate ? "no-cache" : "public, max-age=86400",
      },
    });
  },
} as unknown as Fetcher;

export default {
  fetch(request: Request, env: Record<string, unknown>) {
    return handler.fetch(request, { ...env, ASSETS } as Env);
  },
} satisfies ExportedHandler<Record<string, unknown>>;
