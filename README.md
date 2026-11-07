# Valuace akcií

Webová aplikace (PWA) pro rychlé ohodnocení akcie. Zadáte ticker z burzy a aplikace:

- dohledá firmu a stáhne data (cena, výkazy za 4 roky + posledních 12 měsíců, kvartály, dividendy),
- spočítá **vnitřní hodnotu akcie ve třech scénářích** (pesimistický / základní / optimistický) pomocí DCF modelu na 10 let a vážený průměr,
- zobrazí **dashboard**: P/E, forward P/E, PEG, P/S, P/B, EV/EBITDA, P/FCF, marže, ROE, ROIC, zadlužení, likviditu, betu, dividendy, vývoj ceny, tržeb, zisku, cash flow, EPS, hotovosti a dluhu, trendy a „zdraví firmy“.

Běží na **Cloudflare Workers** (zdarma) a na iPhonu se dá přidat na plochu jako aplikace.

## Jak to funguje

| Část | Co dělá |
| --- | --- |
| `src/` | Cloudflare Worker – API `/api/stock/:ticker` a `/api/search`. Stahuje data z veřejných endpointů Yahoo Finance (bez API klíče), sjednocuje měny (např. pence → libry, ADR jako TSM) a počítá betu. |
| `public/` | Aplikace v prohlížeči (HTML/CSS/JS bez build kroku). Valuace se počítá přímo v telefonu, takže změny předpokladů se projeví okamžitě. |
| `public/js/valuation.js` | DCF model, scénáře, reverzní DCF, citlivostní analýza, Grahamovo číslo. |
| `public/js/metrics.js` | Ukazatele, trendy a kontrolní seznam kvality. |
| `public/sw.js` | Service worker – aplikace se otevře okamžitě a poslední zobrazená data jsou dostupná i offline. |

### Model vnitřní hodnoty

1. Výchozí tržby = posledních 12 měsíců (TTM).
2. Tržby rostou v letech 1–5 zvoleným tempem, v letech 6–10 růst lineárně zpomalí na terminální růst.
3. Marže peněžního toku se během 5 let přesune z aktuální úrovně na cílovou.
4. **Báze FCF** (běžné firmy): volný cash flow diskontovaný WACC, od hodnoty firmy se odečte čistý dluh.
   **Báze čistého zisku** (banky, pojišťovny, firmy bez údajů o investicích): zisk po reinvesticích (1 − g/ROE) diskontovaný náklady vlastního kapitálu.
5. Terminální hodnota Gordonovým modelem, výsledek ÷ počet akcií (+ přepočet měny).
6. Vnitřní hodnota = vážený průměr scénářů (výchozí váhy 25 / 50 / 25 %).

Výchozí předpoklady se odvozují z historie firmy (růst tržeb, průměrná marže, beta → CAPM). V aplikaci je lze upravit posuvníky; úpravy se ukládají jen ve vašem zařízení.

## Nasazení na Cloudflare (jednorázově, ~5 minut)

### Varianta A – přes web Cloudflare (doporučeno, bez instalace)

1. Zaregistrujte se / přihlaste na <https://dash.cloudflare.com> (stačí bezplatný účet).
2. **Workers & Pages → Create → Import a repository** (Připojit Git).
3. Propojte GitHub a vyberte repozitář `vrbato/Cloude_project`.
4. Nastavení:
   - **Project name:** `valuace-akcii` (bude součástí adresy),
   - **Build command:** nechte prázdné,
   - **Deploy command:** `npx wrangler deploy` (výchozí),
   - **Production branch:** větev, ze které chcete nasazovat (např. `main`).
5. Klikněte na **Deploy**. Po chvíli dostanete adresu typu
   `https://valuace-akcii.<vas-ucet>.workers.dev`.

Každý další `git push` do produkční větve aplikaci automaticky znovu nasadí.

### Varianta B – z příkazové řádky

```bash
npm install
npx wrangler login      # otevře prohlížeč a přihlásí vás ke Cloudflare
npm run deploy          # nasadí a vypíše URL
```

### Lokální vývoj

```bash
npm install
npm run dev             # http://localhost:8787
npm test                # testy valuačního modelu
npm run typecheck       # kontrola TypeScriptu ve Workeru
```

## Na iPhonu jako aplikace

1. Otevřete svou adresu `https://valuace-akcii.<vas-ucet>.workers.dev` v **Safari**.
2. Klepněte na **Sdílet** (čtvereček se šipkou) → **Přidat na plochu** → **Přidat**.
3. Na ploše se objeví ikona **Valuace** – spouští se na celou obrazovku bez lišty prohlížeče, podporuje tmavý i světlý režim.

## Tipy k tickerům

| Burza | Přípona | Příklad |
| --- | --- | --- |
| USA (NYSE, Nasdaq) | – | `AAPL`, `MSFT`, `KO` |
| Praha | `.PR` | `CEZ.PR`, `KOMB.PR` |
| Xetra / Frankfurt | `.DE` / `.F` | `SAP.DE` |
| Londýn | `.L` | `AZN.L` |
| Paříž / Amsterdam | `.PA` / `.AS` | `MC.PA`, `ASML.AS` |

Do vyhledávání lze psát i název firmy – aplikace nabídne odpovídající tituly.

## Omezení

- Data pochází z neoficiálních veřejných endpointů Yahoo Finance; mohou se občas změnit nebo být dočasně nedostupná. Worker zkouší dva servery a výsledky cachuje 10 minut.
- Yahoo poskytuje roční výkazy za poslední 4 roky; trendy jsou tedy krátkodobé.
- DCF je citlivý na předpoklady – berte výsledek jako výchozí bod pro vlastní úvahu, ne jako doporučení.
- Bezrizikové sazby podle měny jsou v `public/js/valuation.js` (`RISK_FREE`) – můžete je upravit podle aktuálních výnosů dluhopisů.

> Aplikace slouží ke vzdělávacím účelům a nejde o investiční doporučení.
