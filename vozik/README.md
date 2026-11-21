# Barevný vozík

Aplikace do mobilu místo kartiček k dětské hře s vysokozdvižnými vozíky. Každá karta
je **náhodná věž z barevných dílků**, kterou mají děti vozíkem postavit na podstavec
(odspodu nahoru, 1 = první dílek na podstavci).

## Obsah krabice (podle toho aplikace generuje karty)

- 2 vozíky (červený 01, žlutý 02) a 2 podstavce,
- 18 dílků = 3 barvy (červená, žlutá, zelená) × 3 tvary × 2 kusy:
  **kolečko** (s trojúhelníkem), **osmiúhelník** (se čtvercem), **čtverec** (s kroužkem).

Karta nikdy nechce víc kusů, než je v krabici. V souboji staví oba hráči **stejnou kartu**,
proto je na ní každý dílek nejvýš jednou (každý si vezme jeden ze dvou kusů).

## Jak se hraje

**Obtížnost** jako na originálních kartách: ★ 1 dílek · ★★ 2–3 · ★★★ 4–5 · ★★★★ 6–7 · ★★★★★ 8–9.

**Režimy**

| Režim | Pravidla |
| --- | --- |
| **Sám** | Za každou postavenou kartu 1–3 hvězdy podle rychlosti (≤ 6 s na dílek = ★★★), rekord pro každou obtížnost. |
| **Souboj** | Oba vozíky staví stejnou kartu. Kdo je hotový, klepne na svou barvu, dospělý potvrdí „Sedí!“ (nebo „Ještě ne“ a staví se dál). Hraje se do 3/5/10/15 bodů. |
| **Střídání** | 2–4 hráči se střídají, každý staví svou kartu (s časovačem: kdo nestihne, nedostane bod). |

**Další možnosti** (Nastavení ⚙):

- **Musí sedět i tvar** – jako originál; pro nejmenší vypnout, pak stačí barva,
- **odpočet 3‑2‑1** – karta se ukáže všem najednou (fér start),
- **časovač** 30 s – 2 min, posledních 5 s pípá,
- **paměťová výzva** – karta po 5/10/15 s zmizí, staví se zpaměti, oko ji na 2 s ukáže,
- předčítání česky („Odspodu: červené kolečko, žlutý osmiúhelník…“), zvuky, konfety,
- vrácení omylem přiděleného bodu, jména hráčů, displej během hry nezhasne,
- funguje bez internetu, tmavý režim, na výšku i na šířku.

Náhoda je z `crypto.getRandomValues`, nastavení se ukládá jen v telefonu.

## Soubory

| Soubor | Co dělá |
| --- | --- |
| `public/` | celá aplikace (HTML/CSS/JS bez build kroku) |
| `public/js/game.js` | dílky ze sady, obtížnosti a generování karet (testované) |
| `public/js/app.js` | obrazovky, režimy, odpočet, časovač, body, nastavení |
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
