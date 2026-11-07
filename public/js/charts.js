/**
 * Lehké SVG grafy bez závislostí: čárový (s crosshairem), sloupcový,
 * rozpětí valuace a sparkline. Barvy se berou z CSS proměnných, takže
 * fungují ve světlém i tmavém režimu.
 */

const NS = "http://www.w3.org/2000/svg";
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/* ------------------------------------------------------------ resize */

const renderers = new WeakMap();
const ro =
  typeof ResizeObserver !== "undefined"
    ? new ResizeObserver((entries) => {
        for (const e of entries) {
          const r = renderers.get(e.target);
          if (!r) continue;
          const w = Math.round(e.contentRect.width);
          if (w && w !== r.width) {
            r.width = w;
            r.fn(w);
          }
        }
      })
    : null;

function mount(container, fn) {
  const width = Math.round(container.clientWidth) || 320;
  renderers.set(container, { fn, width });
  ro?.observe(container);
  fn(width);
}

/* ----------------------------------------------------------- helpers */

function el(tag, attrs = {}, parent) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  parent?.appendChild(n);
  return n;
}

export function niceTicks(min, max, count = 4) {
  if (!isNum(min) || !isNum(max)) return [0, 1];
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    min -= pad;
    max += pad;
  }
  const span = max - min;
  const step0 = span / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(step0));
  const norm = step0 / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toPrecision(12)));
  return ticks;
}

function makeTooltip(container) {
  let tip = container.querySelector(".chart-tip");
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "chart-tip";
    tip.setAttribute("role", "status");
    container.appendChild(tip);
  }
  return tip;
}

/** Naplní tooltip řádky {name, value, color} – vždy přes textContent. */
function fillTip(tip, title, rows) {
  tip.replaceChildren();
  const h = document.createElement("div");
  h.className = "chart-tip__title";
  h.textContent = title;
  tip.appendChild(h);
  for (const r of rows) {
    const row = document.createElement("div");
    row.className = "chart-tip__row";
    const key = document.createElement("span");
    key.className = "chart-tip__key";
    key.style.background = r.color;
    const val = document.createElement("strong");
    val.textContent = r.value;
    const name = document.createElement("span");
    name.className = "chart-tip__name";
    name.textContent = r.name;
    row.append(key, val, name);
    tip.appendChild(row);
  }
}

function placeTip(tip, container, x, y) {
  tip.classList.add("is-visible");
  const cw = container.clientWidth;
  const tw = tip.offsetWidth;
  let left = x + 12;
  if (left + tw > cw - 4) left = x - tw - 12;
  tip.style.left = `${Math.max(4, left)}px`;
  tip.style.top = `${Math.max(0, y - 10)}px`;
}

function hideTip(tip) {
  tip.classList.remove("is-visible");
}

function legend(container, series) {
  if (series.length < 2) return;
  const lg = document.createElement("div");
  lg.className = "chart-legend";
  for (const s of series) {
    const item = document.createElement("span");
    item.className = "chart-legend__item";
    const key = document.createElement("span");
    key.className = s.type === "bar" ? "chart-legend__swatch" : "chart-legend__line";
    key.style.background = s.color;
    const label = document.createElement("span");
    label.textContent = s.name;
    item.append(key, label);
    lg.appendChild(item);
  }
  container.prepend(lg);
}

/* -------------------------------------------------------- line chart */

/**
 * @param {HTMLElement} container
 * @param {{series: {name:string,color:string,points:[number,number][]}[], height?:number,
 *   yFormat:(v:number)=>string, xFormat:(x:number)=>string, tipX?:(x:number)=>string,
 *   area?:boolean, zero?:boolean, endLabels?:boolean}} opts
 */
export function lineChart(container, opts) {
  const { series, height = 220, yFormat, xFormat, tipX = xFormat, area = true, zero = false, endLabels = false } = opts;
  container.classList.add("chart");
  container.replaceChildren();
  const valid = series.filter((s) => s.points.length > 1);
  if (!valid.length) {
    container.innerHTML = '<p class="chart-empty">Data nejsou k dispozici</p>';
    return;
  }
  legend(container, valid);
  const plot = document.createElement("div");
  plot.className = "chart-plot";
  container.appendChild(plot);

  mount(plot, (width) => {
    plot.replaceChildren();
    const cats = opts.xCategories;
    const xs = valid.flatMap((s) => s.points.map((p) => p[0]));
    const ys = valid.flatMap((s) => s.points.map((p) => p[1]).filter(isNum));
    const xMin = cats ? -0.3 : Math.min(...xs);
    const xMax = cats ? cats.length - 0.7 : Math.max(...xs);
    let yMin = Math.min(...ys);
    let yMax = Math.max(...ys);
    if (zero) {
      yMin = Math.min(0, yMin);
      yMax = Math.max(0, yMax);
    } else {
      const pad = (yMax - yMin) * 0.08;
      yMin -= pad;
      yMax += pad;
    }
    const ticks = niceTicks(yMin, yMax, height < 180 ? 3 : 4);
    const y0 = ticks[0];
    const y1 = ticks[ticks.length - 1];
    const tStep = ticks[1] - ticks[0];

    const labelW = Math.max(...ticks.map((t) => yFormat(t, false, tStep).length)) * 6.4 + 10;
    const endW = endLabels ? 46 : 0;
    const m = { l: labelW, r: 10 + endW, t: 10, b: 24 };
    const w = width;
    const h = height;
    const iw = Math.max(10, w - m.l - m.r);
    const ih = h - m.t - m.b;
    const sx = (x) => m.l + ((x - xMin) / (xMax - xMin || 1)) * iw;
    const sy = (y) => m.t + (1 - (y - y0) / (y1 - y0 || 1)) * ih;

    const svg = el("svg", { width: w, height: h, viewBox: `0 0 ${w} ${h}`, class: "chart-svg", role: "img" });
    if (opts.label) el("title", {}, svg).textContent = opts.label;

    // mřížka + osa Y
    const grid = el("g", { class: "chart-grid" }, svg);
    for (const t of ticks) {
      el("line", { x1: m.l, x2: w - m.r, y1: sy(t), y2: sy(t), class: t === 0 && y0 < 0 ? "chart-zero" : null }, grid);
      el("text", { x: m.l - 8, y: sy(t) + 4, "text-anchor": "end", class: "chart-axis" }, svg).textContent = yFormat(t, false, tStep);
    }
    // osa X – štítky
    if (cats) {
      const step = Math.ceil(cats.length / Math.max(1, Math.floor(iw / 48)));
      cats.forEach((c, i) => {
        if (i % step === 0 || i === cats.length - 1) {
          el("text", { x: sx(i), y: h - 6, "text-anchor": "middle", class: "chart-axis" }, svg).textContent = c;
        }
      });
    } else {
      const nX = Math.max(2, Math.min(6, Math.floor(iw / 80)));
      for (let i = 0; i < nX; i++) {
        const x = xMin + ((xMax - xMin) * i) / (nX - 1);
        const anchor = i === 0 ? "start" : i === nX - 1 ? "end" : "middle";
        el("text", { x: sx(x), y: h - 6, "text-anchor": anchor, class: "chart-axis" }, svg).textContent = xFormat(x);
      }
    }

    const defs = el("defs", {}, svg);
    valid.forEach((s, si) => {
      const pts = s.points.filter((p) => isNum(p[1]));
      const d = pts.map((p, i) => `${i ? "L" : "M"}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join("");
      if (area && valid.length === 1) {
        const gid = `g${Math.random().toString(36).slice(2, 8)}`;
        const grad = el("linearGradient", { id: gid, x1: 0, x2: 0, y1: 0, y2: 1 }, defs);
        el("stop", { offset: "0%", style: `stop-color:${s.color};stop-opacity:.22` }, grad);
        el("stop", { offset: "100%", style: `stop-color:${s.color};stop-opacity:0` }, grad);
        const base = sy(Math.max(y0, Math.min(0, y1)) === 0 && y0 < 0 ? 0 : y0);
        el(
          "path",
          { d: `${d}L${sx(pts[pts.length - 1][0]).toFixed(1)},${base}L${sx(pts[0][0]).toFixed(1)},${base}Z`, fill: `url(#${gid})` },
          svg,
        );
      }
      el("path", { d, class: "chart-line", style: `stroke:${s.color}` }, svg);
      const lp = pts[pts.length - 1];
      el("circle", { cx: sx(lp[0]), cy: sy(lp[1]), r: 4, class: "chart-dot", style: `fill:${s.color}` }, svg);
      if (endLabels) {
        el("text", { x: sx(lp[0]) + 8, y: sy(lp[1]) + 4, class: "chart-endlabel" }, svg).textContent = yFormat(lp[1]);
      }
      s._pts = pts;
      s._i = si;
    });

    // crosshair
    const cross = el("g", { class: "chart-cross", style: "display:none" }, svg);
    const vline = el("line", { y1: m.t, y2: m.t + ih }, cross);
    const dots = valid.map((s) => el("circle", { r: 4.5, class: "chart-dot", style: `fill:${s.color}` }, cross));
    plot.appendChild(svg);
    const tip = makeTooltip(plot);
    const ref = valid[0]._pts;

    const nearest = (pts, x) => {
      let lo = 0;
      let hi = pts.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (pts[mid][0] < x) lo = mid;
        else hi = mid;
      }
      return Math.abs(pts[lo][0] - x) <= Math.abs(pts[hi][0] - x) ? pts[lo] : pts[hi];
    };

    const move = (ev) => {
      const rect = svg.getBoundingClientRect();
      const px = ev.clientX - rect.left;
      if (px < m.l - 6 || px > w - m.r + 6) return;
      const x = xMin + ((px - m.l) / iw) * (xMax - xMin);
      const p = nearest(ref, x);
      const cx = sx(p[0]);
      cross.style.display = "";
      vline.setAttribute("x1", cx);
      vline.setAttribute("x2", cx);
      const rows = [];
      valid.forEach((s, i) => {
        const q = nearest(s._pts, p[0]);
        dots[i].setAttribute("cx", sx(q[0]));
        dots[i].setAttribute("cy", sy(q[1]));
        rows.push({ name: s.name, value: yFormat(q[1], true), color: s.color });
      });
      fillTip(tip, tipX(p[0]), rows);
      placeTip(tip, plot, cx, sy(p[1]));
    };
    const leave = () => {
      cross.style.display = "none";
      hideTip(tip);
    };
    svg.addEventListener("pointermove", move);
    svg.addEventListener("pointerdown", move);
    svg.addEventListener("pointerleave", leave);
    svg.addEventListener("pointercancel", leave);
  });
}

/* --------------------------------------------------------- bar chart */

function barPath(x, yBase, yTop, w) {
  const h = Math.abs(yBase - yTop);
  const r = Math.min(4, w / 2, h);
  if (h < 0.5) return `M${x},${yBase}h${w}v-0.5h${-w}Z`;
  if (yTop < yBase) {
    return `M${x},${yBase}V${yTop + r}Q${x},${yTop} ${x + r},${yTop}H${x + w - r}Q${x + w},${yTop} ${x + w},${yTop + r}V${yBase}Z`;
  }
  return `M${x},${yBase}V${yTop - r}Q${x},${yTop} ${x + r},${yTop}H${x + w - r}Q${x + w},${yTop} ${x + w},${yTop - r}V${yBase}Z`;
}

/**
 * Seskupený sloupcový graf.
 * @param {{categories:string[], series:{name:string,color:string,values:(number|null)[]}[],
 *   height?:number, yFormat:(v:number)=>string, highlightLast?:boolean, valueLabels?:boolean}} opts
 */
export function barChart(container, opts) {
  const { categories, series, height = 220, yFormat, valueLabels = false } = opts;
  container.classList.add("chart");
  container.replaceChildren();
  const all = series.flatMap((s) => s.values).filter(isNum);
  if (!all.length) {
    container.innerHTML = '<p class="chart-empty">Data nejsou k dispozici</p>';
    return;
  }
  legend(
    container,
    series.map((s) => ({ ...s, type: "bar" })),
  );
  const plot = document.createElement("div");
  plot.className = "chart-plot";
  container.appendChild(plot);

  mount(plot, (width) => {
    plot.replaceChildren();
    const ticks = niceTicks(Math.min(0, ...all), Math.max(0, ...all), height < 180 ? 3 : 4);
    const y0 = ticks[0];
    const y1 = ticks[ticks.length - 1];
    const tStep = ticks[1] - ticks[0];
    const labelW = Math.max(...ticks.map((t) => yFormat(t, false, tStep).length)) * 6.4 + 10;
    const m = { l: labelW, r: 8, t: valueLabels ? 18 : 10, b: 24 };
    const w = width;
    const h = height;
    const iw = Math.max(10, w - m.l - m.r);
    const ih = h - m.t - m.b;
    const sy = (y) => m.t + (1 - (y - y0) / (y1 - y0 || 1)) * ih;
    const band = iw / categories.length;
    const gap = 2;
    const nS = series.length;
    const barW = Math.min(24, (band * 0.72 - gap * (nS - 1)) / nS);
    const groupW = barW * nS + gap * (nS - 1);

    const svg = el("svg", { width: w, height: h, viewBox: `0 0 ${w} ${h}`, class: "chart-svg", role: "img" });
    if (opts.label) el("title", {}, svg).textContent = opts.label;
    const grid = el("g", { class: "chart-grid" }, svg);
    for (const t of ticks) {
      el("line", { x1: m.l, x2: w - m.r, y1: sy(t), y2: sy(t), class: t === 0 ? "chart-zero" : null }, grid);
      el("text", { x: m.l - 8, y: sy(t) + 4, "text-anchor": "end", class: "chart-axis" }, svg).textContent = yFormat(t, false, tStep);
    }
    const hitLayer = el("g", {}, svg);
    const tip = makeTooltip(plot);
    const step = Math.ceil(categories.length / Math.max(1, Math.floor(iw / 44)));

    categories.forEach((cat, ci) => {
      const gx = m.l + band * ci + (band - groupW) / 2;
      if (ci % step === 0 || ci === categories.length - 1) {
        el("text", { x: m.l + band * ci + band / 2, y: h - 6, "text-anchor": "middle", class: "chart-axis" }, svg).textContent = cat;
      }
      series.forEach((s, si) => {
        const v = s.values[ci];
        if (!isNum(v)) return;
        const x = gx + si * (barW + gap);
        el("path", { d: barPath(x, sy(0), sy(v), barW), class: "chart-bar", style: `fill:${s.color}` }, svg);
        if (valueLabels && nS === 1) {
          const ty = v >= 0 ? sy(v) - 5 : sy(v) + 12;
          el("text", { x: x + barW / 2, y: ty, "text-anchor": "middle", class: "chart-value" }, svg).textContent = yFormat(v, false, null, true);
        }
      });
      // zásah = celé pásmo kategorie
      const hit = el("rect", { x: m.l + band * ci, y: m.t, width: band, height: ih, class: "chart-hit" }, hitLayer);
      const show = () => {
        hitLayer.querySelectorAll(".is-active").forEach((n) => n.classList.remove("is-active"));
        hit.classList.add("is-active");
        fillTip(
          tip,
          cat,
          series.filter((s) => isNum(s.values[ci])).map((s) => ({ name: s.name, value: yFormat(s.values[ci], true), color: s.color })),
        );
        const top = Math.min(...series.map((s) => (isNum(s.values[ci]) ? sy(Math.max(0, s.values[ci])) : h)));
        placeTip(tip, plot, m.l + band * ci + band / 2, top);
      };
      hit.addEventListener("pointerenter", show);
      hit.addEventListener("pointerdown", show);
    });
    svg.addEventListener("pointerleave", () => {
      hideTip(tip);
      hitLayer.querySelectorAll(".is-active").forEach((n) => n.classList.remove("is-active"));
    });
    svg.appendChild(hitLayer);
    plot.appendChild(svg);
  });
}

/* ------------------------------------------- rozpětí valuace (football field) */

/**
 * Vodorovné pruhy: hodnoty scénářů vs. aktuální cena.
 * @param {{items:{label:string,value:number,color:string,sub?:string}[], price:number, format:(v:number)=>string}} opts
 */
export function rangeChart(container, opts) {
  const { items, price, format } = opts;
  container.classList.add("chart");
  container.replaceChildren();
  const vals = items.map((i) => i.value).filter(isNum);
  if (!vals.length) return;
  const plot = document.createElement("div");
  plot.className = "chart-plot";
  container.appendChild(plot);

  mount(plot, (width) => {
    plot.replaceChildren();
    const rowH = 34;
    const m = { l: 96, r: 64, t: 22, b: 8 };
    const h = m.t + m.b + rowH * items.length;
    const w = width;
    const iw = Math.max(10, w - m.l - m.r);
    const max = Math.max(...vals, price || 0) * 1.08;
    const sx = (v) => m.l + (v / (max || 1)) * iw;
    const svg = el("svg", { width: w, height: h, viewBox: `0 0 ${w} ${h}`, class: "chart-svg", role: "img" });
    el("title", {}, svg).textContent = "Vnitřní hodnota ve scénářích ve srovnání s aktuální cenou";
    if (isNum(price)) {
      const px = sx(price);
      el("line", { x1: px, x2: px, y1: m.t - 6, y2: h - m.b, class: "chart-price" }, svg);
      const lbl = el("text", { x: Math.min(Math.max(px, m.l + 40), w - 40), y: 11, "text-anchor": "middle", class: "chart-price-label" }, svg);
      lbl.textContent = `Cena ${format(price)}`;
    }
    items.forEach((it, i) => {
      const cy = m.t + rowH * i + rowH / 2;
      el("text", { x: 0, y: cy + 4, class: "chart-label" }, svg).textContent = it.label;
      el("rect", { x: m.l, y: cy - 5, width: iw, height: 10, rx: 5, class: "chart-track" }, svg);
      if (isNum(it.value)) {
        const bw = Math.max(4, sx(it.value) - m.l);
        el("rect", { x: m.l, y: cy - 5, width: bw, height: 10, rx: 5, style: `fill:${it.color}` }, svg);
        el("text", { x: m.l + bw + 8, y: cy + 4, class: "chart-value-strong" }, svg).textContent = format(it.value);
      }
    });
    plot.appendChild(svg);
  });
}

/* --------------------------------------------------------- sparkline */

export function sparkline(container, values, color = "var(--series-1)", height = 28) {
  container.replaceChildren();
  const pts = values.filter(isNum);
  if (pts.length < 2) return;
  mount(container, (width) => {
    container.replaceChildren();
    const min = Math.min(...pts);
    const max = Math.max(...pts);
    const sx = (i) => 2 + (i / (pts.length - 1)) * (width - 6);
    const sy = (v) => 3 + (1 - (v - min) / (max - min || 1)) * (height - 6);
    const svg = el("svg", { width, height, viewBox: `0 0 ${width} ${height}`, class: "spark", "aria-hidden": "true" });
    el("path", { d: pts.map((v, i) => `${i ? "L" : "M"}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(""), class: "chart-line spark-line", style: `stroke:${color}` }, svg);
    el("circle", { cx: sx(pts.length - 1), cy: sy(pts[pts.length - 1]), r: 2.5, style: `fill:${color}` }, svg);
    container.appendChild(svg);
  });
}
