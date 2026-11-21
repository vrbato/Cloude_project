# Barevný vozík

Aplikace do mobilu místo karet k dětské hře s vysokozdvižným vozíkem. Na každé
kartě je **náhodné barevné pořadí nákladu**, které mají děti vozíkem postavit na sebe
(odspodu nahoru, 1 = první kus na paletě).

- barvy a počty kusů se nastaví podle vaší krabice (12 barev, 0–6 kusů od každé),
- výška věže: rozsah (např. 3–5 kusů) nebo předvolby Lehká / Střední / Těžká,
- volitelně žádné dvě stejné barvy nad sebou, nová karta se nikdy neopakuje hned po sobě,
- **časovač** (30 s – 2 min, posledních 5 s pípá),
- **počítání bodů** pro 1–4 hráče („Kdo to postavil první?“), hra do 5/10/15/20 karet,
  vrácení omylem přiděleného bodu; pro jednoho hráče stopky a rekord,
- předčítání barev česky (iPhone: hlas Zuzana), zvuky, konfety,
- displej během hry nezhasne, funguje bez internetu, tmavý režim, na výšku i na šířku.

Vše běží v telefonu, nastavení se ukládá jen v zařízení. Náhoda je z `crypto.getRandomValues`.

## Soubory

| Soubor | Co dělá |
| --- | --- |
| `public/` | celá aplikace (HTML/CSS/JS bez build kroku) |
| `public/js/game.js` | barvy a generování karet (testované) |
| `public/js/app.js` | obrazovky, časovač, body, nastavení |
| `cloudflare/barevny-vozik-worker.js` | **celá aplikace v jednom souboru** pro Cloudflare (vygenerováno) |
| `scripts/build.mjs` | vytvoří soubor výše (`npm run build`) |
| `scripts/icons.mjs` | PNG ikony z `public/icons/icon.svg` (potřebuje Playwright) |

## Nasazení na Cloudflare (stejně jako Valuace akcií)

### Varianta A – jeden soubor vložený do editoru (doporučeno, bez instalace)

1. Na <https://dash.cloudflare.com> otevřete **Workers & Pages → Create application**
   a zvolte šablonu **Hello World** (Worker).
2. Pojmenujte ho např. `barevny-vozik` a dejte **Deploy**.
3. Klikněte na **Edit code**, smažte celý ukázkový kód.
4. Otevřete na GitHubu soubor
   [`vozik/cloudflare/barevny-vozik-worker.js`](cloudflare/barevny-vozik-worker.js),
   klikněte na **Raw** (nebo ikonu „Copy raw file“), zkopírujte vše a vložte do editoru.
5. **Deploy**. Aplikace poběží na `https://barevny-vozik.<vas-ucet>.workers.dev`.

**Aktualizace:** znovu Edit code → nahradit celý obsah → Deploy.

### Varianta B – nahrání složky

**Workers & Pages → Create application → Drag and drop your files** a přetáhněte
složku `vozik/public`. Aplikace je čistě statická, takže tohle funguje také.

### Varianta C – z příkazové řádky / z GitHubu

```bash
cd vozik
npx wrangler login
npm run deploy          # použije vozik/wrangler.jsonc
```

Při propojení repozitáře v Cloudflare (**Import a repository**) nastavte
**Root directory** na `vozik` a Deploy command `npx wrangler deploy`.

## Na iPhonu jako aplikace

1. Otevřete adresu v **Safari**.
2. **Sdílet** (čtvereček se šipkou) → **Přidat na plochu** → **Přidat**.
3. Ikona **Vozík** spouští hru přes celou obrazovku a funguje i offline.

Zvuky na iPhonu nehrají, když je zapnutý tichý režim (přepínač na boku).

## Vývoj

```bash
cd vozik
npm test                # testy generování karet + Workeru
npm run build           # po každé změně v public/ (test hlídá, že je soubor aktuální)
npm run dev             # http://localhost:8787 (wrangler)
```

Po větší změně zvyšte `VERSION` v `public/sw.js`, aby si telefony stáhly novou verzi
hned (jinak se aktualizují při dalším spuštění).
