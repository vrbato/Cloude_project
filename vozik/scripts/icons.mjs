/**
 * Vyrenderuje PNG ikony z public/icons/icon.svg (potřebuje Playwright/Chromium).
 *   node scripts/icons.mjs
 * Ikony jsou v repozitáři už vygenerované – spouštět jen po změně icon.svg.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");
const svg = readFileSync(join(dir, "icon.svg"), "utf8");
// PNG ikony bez zaoblení – iPhone/Android si rohy zaoblí samy
const square = svg.replace('rx="112"', 'rx="0"');
// maskable: obsah zmenšený do bezpečné zóny (80 %)
const maskable = square.replace('<g id="art">', '<g id="art" transform="translate(256 256) scale(.78) translate(-256 -270)">');

const jobs = [
  ["apple-touch-icon.png", 180, square],
  ["icon-192.png", 192, square],
  ["icon-512.png", 512, square],
  ["icon-maskable-512.png", 512, maskable],
];

const browser = await chromium.launch();
for (const [name, size, src] of jobs) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(`<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${src}`);
  await page.screenshot({ path: join(dir, name), omitBackground: false });
  await page.close();
  console.log("  " + name);
}
await browser.close();
