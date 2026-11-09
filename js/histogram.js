/*
 * histogram.js: the timeline at the bottom (canvas)
 * --------------------------------------------------
 *  • stacked bars = number of events per day/week/month, coloured by category
 *  • the bright box is the time window shown on the map:
 *      drag inside it to move it, drag its edges to resize, drag elsewhere to draw a new one
 *  • click a bar to highlight where those events are on the map (click again / Esc to clear)
 *  • events in the open popup are marked in white
 *  • mouse wheel zooms the time axis, horizontal scroll or dragging the date axis pans it,
 *    double-click resets the zoom
 */
(function () {
  const TM = window.TM;
  const CONFIG = window.CONFIG;
  const D = TM.data;
  const S = TM.state;
  const DAY = TM.DAY_MS;

  const wrap = document.getElementById("hist-wrap");
  const canvas = document.getElementById("hist");
  const ctx = canvas.getContext("2d");
  const tip = document.getElementById("histtip");
  const M = { l: 48, r: 18, t: 18, b: 22 };

  const COLORS = { grid: "rgba(199,199,199,0.35)", text: "#a0a0a0", offwhite: "#efefef", accent: "#eb443e" };
  const FONT = '10px "GT-Zirkon", Lato, Helvetica, sans-serif';

  /* ---------- category stacking order ---------- */
  const cats = [];
  const catIndex = new Int32Array(D.assocs.length).fill(-1);
  D.assocs.forEach((a, i) => { if (a.mode === "CATEGORY" && !a.unused) { catIndex[i] = cats.length; cats.push(i); } });
  const K = cats.length;

  /* ---------- binning ---------- */
  const BIN = {
    day: { id: (i) => D.evDay[i], start: (b) => b, label: "day" },
    week: { id: (i) => Math.floor((D.evDay[i] + 3) / 7), start: (b) => b * 7 - 3, label: "week" },
    month: { id: (i) => D.evMonth[i], start: (b) => Date.UTC(Math.floor(b / 12), b % 12, 1) / DAY, label: "month" },
  };
  const dayToBin = {
    day: (d) => Math.floor(d),
    week: (d) => Math.floor((Math.floor(d) + 3) / 7),
    month: (d) => { const t = new Date(Math.floor(d) * DAY); return t.getUTCFullYear() * 12 + t.getUTCMonth(); },
  };

  let binMode = CONFIG.defaultBin || "auto";
  let bin = "week"; // effective
  const evBin = new Int32Array(D.nEvents);
  let binMin = 0, binMax = -1, counts = new Int32Array(0), totals = new Int32Array(0), selCounts = new Int32Array(0);
  let extent = [0, 1], domain = [0, 1];
  let datasetKey = "";

  function computeExtent() {
    let a = Infinity, b = -Infinity;
    D.datasets.forEach((ds, i) => { if (S.datasetOn[i]) { a = Math.min(a, ds.minDay); b = Math.max(b, ds.maxDay + 1); } });
    if (!isFinite(a)) { a = S.window[0]; b = S.window[1] + 1; }
    const pad = Math.max(3, (b - a) * 0.03);
    extent = [a - pad, b + pad];
  }

  function assignBins() {
    const f = BIN[bin].id;
    for (let i = 0; i < D.nEvents; i++) evBin[i] = f(i);
  }

  function computeCounts() {
    binMin = dayToBin[bin](extent[0]);
    binMax = dayToBin[bin](extent[1]);
    const n = binMax - binMin + 1;
    counts = new Int32Array(n * K);
    totals = new Int32Array(n);
    const pass = TM.derived.pass, col = TM.derived.evColor;
    for (let i = 0; i < D.nEvents; i++) {
      if (!pass[i]) continue;
      const b = evBin[i] - binMin;
      if (b < 0 || b >= n) continue;
      const c = catIndex[col[i]];
      if (c >= 0) counts[b * K + c]++;
      totals[b]++;
    }
    computeSelCounts();
  }

  function computeSelCounts() {
    const n = binMax - binMin + 1;
    selCounts = new Int32Array(Math.max(0, n));
    for (const i of TM.derived.selectedEvents) {
      const b = evBin[i] - binMin;
      if (b >= 0 && b < n) selCounts[b]++;
    }
  }

  function effectiveBin() {
    if (binMode !== "auto") return binMode;
    const ppd = plotW() / (domain[1] - domain[0]);
    if (ppd >= 3) return "day";
    if (ppd * 7 >= 3) return "week";
    return "month";
  }

  function refreshBinning(force) {
    const b = effectiveBin();
    if (b !== bin || force) {
      bin = b;
      assignBins();
      computeCounts();
    }
  }

  /* ---------- geometry ---------- */
  let W = 0, H = 0;
  const plotW = () => Math.max(10, W - M.l - M.r);
  const plotH = () => Math.max(10, H - M.t - M.b);
  const x = (d) => M.l + ((d - domain[0]) / (domain[1] - domain[0])) * plotW();
  const dayAt = (px) => domain[0] + ((px - M.l) / plotW()) * (domain[1] - domain[0]);

  function resize() {
    const r = wrap.getBoundingClientRect();
    W = r.width; H = r.height;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    refreshBinning();
    draw();
  }
  new ResizeObserver(resize).observe(wrap);

  /* ---------- axis ticks ---------- */
  function ticks() {
    const span = domain[1] - domain[0];
    const pxPerDay = plotW() / span;
    const steps = [
      ["day", 1], ["day", 2], ["day", 7], ["day", 14], ["month", 1], ["month", 2], ["month", 3], ["month", 6], ["month", 12], ["month", 24],
    ];
    const approxDays = { day: 1, month: 30.44 };
    const [unit, step] = steps.find(([u, s]) => approxDays[u] * s * pxPerDay >= 72) || steps[steps.length - 1];
    const out = [];
    if (unit === "day") {
      let d = Math.ceil(domain[0]);
      if (step === 7 || step === 14) d = Math.ceil((d + 3) / 7) * 7 - 3; // Mondays
      for (; d <= domain[1]; d += step) out.push({ d, label: fmtTick(d, "day") });
    } else {
      const t0 = new Date(Math.floor(domain[0]) * DAY);
      let m = t0.getUTCFullYear() * 12 + t0.getUTCMonth() + 1;
      m = Math.ceil(m / step) * step;
      for (;; m += step) {
        const d = Date.UTC(Math.floor(m / 12), m % 12, 1) / DAY;
        if (d > domain[1]) break;
        out.push({ d, label: fmtTick(d, step >= 12 ? "year" : "month") });
      }
    }
    return out;
  }
  const fDay = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  const fMonth = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
  const fYear = new Intl.DateTimeFormat("en-GB", { year: "numeric", timeZone: "UTC" });
  function fmtTick(d, kind) {
    const t = new Date(d * DAY);
    if (kind === "year") return fYear.format(t);
    if (kind === "month") return t.getUTCMonth() === 0 ? fYear.format(t) : fMonth.format(t).replace(/ \d{4}$/, "");
    return fDay.format(t);
  }

  /* ---------- draw ---------- */
  function draw() {
    if (!W) return;
    ctx.clearRect(0, 0, W, H);
    ctx.font = FONT;
    const pw = plotW(), ph = plotH(), base = M.t + ph;

    // visible bin range & y max
    const bStart = Math.max(binMin, dayToBin[bin](domain[0]));
    const bEnd = Math.min(binMax, dayToBin[bin](domain[1]));
    let yMax = 1;
    for (let b = bStart; b <= bEnd; b++) yMax = Math.max(yMax, totals[b - binMin]);
    const yNice = niceMax(yMax);
    const y = (v) => base - (v / yNice) * ph;

    // grid + y labels
    ctx.strokeStyle = COLORS.grid;
    ctx.fillStyle = COLORS.text;
    ctx.lineWidth = 1;
    ctx.setLineDash([1, 4]);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let k = 0; k <= 2; k++) {
      const v = (yNice * k) / 2;
      const yy = Math.round(y(v)) + 0.5;
      ctx.beginPath(); ctx.moveTo(M.l, yy); ctx.lineTo(M.l + pw, yy); ctx.stroke();
      ctx.fillText(v.toLocaleString(), M.l - 8, yy);
    }
    // x ticks
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const t of ticks()) {
      const xx = Math.round(x(t.d)) + 0.5;
      if (xx < M.l || xx > M.l + pw) continue;
      ctx.beginPath(); ctx.moveTo(xx, M.t); ctx.lineTo(xx, base); ctx.stroke();
      ctx.fillText(t.label, xx, base + 6);
    }
    ctx.setLineDash([]);

    ctx.save();
    ctx.beginPath(); ctx.rect(M.l, 0, pw, H); ctx.clip();

    // bars
    const hl = S.highlight;
    const hlBin = hl ? hl.bin : null;
    const selAny = TM.derived.selectedEvents.length > 0;
    const startOf = BIN[bin].start;
    for (let b = bStart; b <= bEnd; b++) {
      const bi = b - binMin;
      if (!totals[bi]) continue;
      const x0 = x(startOf(b)), x1 = x(startOf(b + 1));
      const gap = x1 - x0 > 4 ? 1 : 0;
      const bx = x0, bw = Math.max(1, x1 - x0 - gap);
      const faded = (hl && !(hl.mode === bin && b === hlBin)) || (selAny && !selCounts[bi]);
      ctx.globalAlpha = faded ? 0.45 : 1;
      let acc = 0;
      for (let c = 0; c < K; c++) {
        const v = counts[bi * K + c];
        if (!v) continue;
        const yTop = y(acc + v), yBot = y(acc);
        ctx.fillStyle = D.assocs[cats[c]].color;
        ctx.fillRect(bx, yTop, bw, Math.max(1, yBot - yTop));
        acc += v;
      }
      ctx.globalAlpha = 1;
      // selected events (open popup)
      const sc = selCounts[bi];
      if (sc) {
        const yTop = y(sc);
        ctx.fillStyle = COLORS.offwhite;
        ctx.fillRect(bx, Math.min(yTop, base - 2), bw, Math.max(2, base - yTop));
        tri(bx + bw / 2, y(totals[bi]) - 3, COLORS.offwhite);
      }
    }

    // highlighted bar outline
    if (hl && hl.mode === bin) {
      const bi = hl.bin - binMin;
      if (bi >= 0 && bi < totals.length) {
        const x0 = x(hl.start), x1 = x(hl.end);
        const top = y(totals[bi]);
        ctx.strokeStyle = COLORS.offwhite;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x0 - 1, top - 1, Math.max(2, x1 - x0) + 1, base - top + 1);
      }
    }

    // window shading outside the brush
    const wx0 = x(S.window[0]), wx1 = x(S.window[1] + 1);
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(M.l, M.t - 6, Math.max(0, wx0 - M.l), ph + 6);
    ctx.fillRect(wx1, M.t - 6, Math.max(0, M.l + pw - wx1), ph + 6);
    // brush
    ctx.fillStyle = "rgba(239,239,239,0.06)";
    ctx.fillRect(wx0, M.t - 6, wx1 - wx0, ph + 6);
    ctx.strokeStyle = COLORS.offwhite;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(wx0) + 0.5, M.t - 6); ctx.lineTo(Math.round(wx0) + 0.5, base);
    ctx.moveTo(Math.round(wx1) - 0.5, M.t - 6); ctx.lineTo(Math.round(wx1) - 0.5, base);
    ctx.stroke();
    // grips
    ctx.fillStyle = COLORS.offwhite;
    for (const gx of [wx0, wx1]) roundRect(gx - 3, M.t + ph / 2 - 11, 6, 22, 3);

    // hover marker from cards
    if (S.hoverDay !== null) {
      const hx = Math.round(x(S.hoverDay + 0.5)) + 0.5;
      ctx.strokeStyle = COLORS.accent;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(hx, M.t - 6); ctx.lineTo(hx, base); ctx.stroke();
    }
    ctx.restore();

    // brush edge labels
    ctx.fillStyle = COLORS.offwhite;
    ctx.textBaseline = "bottom";
    const l0 = TM.fmtDay(S.window[0]), l1 = TM.fmtDay(S.window[1]);
    ctx.textAlign = "left";
    const w0w = ctx.measureText(l0).width;
    ctx.fillText(l0, clamp(wx0 + 4, M.l, M.l + pw - w0w), M.t - 7);
    ctx.textAlign = "right";
    const w1w = ctx.measureText(l1).width;
    if (wx1 - 4 - w1w > wx0 + 4 + w0w + 8) ctx.fillText(l1, clamp(wx1 - 4, M.l + w1w, M.l + pw), M.t - 7);

    // baseline
    ctx.strokeStyle = COLORS.text;
    ctx.beginPath(); ctx.moveTo(M.l, base + 0.5); ctx.lineTo(M.l + pw, base + 0.5); ctx.stroke();
  }

  function tri(cx, cy, color) {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(cx - 4, cy - 6); ctx.lineTo(cx + 4, cy - 6); ctx.lineTo(cx, cy); ctx.closePath(); ctx.fill();
  }
  function roundRect(x0, y0, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x0 + r, y0); ctx.arcTo(x0 + w, y0, x0 + w, y0 + h, r); ctx.arcTo(x0 + w, y0 + h, x0, y0 + h, r);
    ctx.arcTo(x0, y0 + h, x0, y0, r); ctx.arcTo(x0, y0, x0 + w, y0, r); ctx.fill();
  }
  function niceMax(v) {
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
    return 10 * p;
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* ---------- interaction ---------- */
  let drag = null;
  const EDGE = 7;

  canvas.addEventListener("pointerdown", (e) => {
    const px = e.offsetX, py = e.offsetY;
    canvas.setPointerCapture(e.pointerId);
    const wx0 = x(S.window[0]), wx1 = x(S.window[1] + 1);
    let mode;
    if (py > M.t + plotH()) mode = "pan";
    else if (Math.abs(px - wx0) <= EDGE) mode = "resize-l";
    else if (Math.abs(px - wx1) <= EDGE) mode = "resize-r";
    else if (px > wx0 && px < wx1) mode = "move";
    else mode = "create";
    drag = { mode, startX: px, startDay: dayAt(px), win: S.window.slice(), dom: domain.slice(), moved: false };
  });

  canvas.addEventListener("pointermove", (e) => {
    const px = e.offsetX, py = e.offsetY;
    if (!drag) { hover(px, py, e); return; }
    if (!drag.moved && Math.abs(px - drag.startX) < 4) return;
    drag.moved = true;
    tip.style.display = "none";
    const d = dayAt(px);
    let [w0, w1] = drag.win;
    switch (drag.mode) {
      case "move": {
        const delta = Math.round(d - drag.startDay);
        w0 = drag.win[0] + delta; w1 = drag.win[1] + delta; break;
      }
      case "resize-l": w0 = Math.min(Math.round(d), w1); break;
      case "resize-r": w1 = Math.max(Math.round(d) - 1, w0); break;
      case "create": {
        const a = Math.floor(drag.startDay), b = Math.floor(d);
        w0 = Math.min(a, b); w1 = Math.max(a, b); break;
      }
      case "pan": {
        const span = drag.dom[1] - drag.dom[0];
        const shift = ((px - drag.startX) / plotW()) * span;
        domain = [drag.dom[0] - shift, drag.dom[1] - shift];
        refreshBinning(); draw();
        return;
      }
    }
    if (w0 !== S.window[0] || w1 !== S.window[1]) TM.update({ window: [w0, w1] });
  });

  canvas.addEventListener("pointerup", (e) => {
    if (drag && !drag.moved && drag.mode !== "pan") clickBar(e.offsetX, e.offsetY);
    drag = null;
  });
  canvas.addEventListener("pointerleave", () => { if (!drag) tip.style.display = "none"; });

  function binAtPx(px) {
    const b = dayToBin[bin](dayAt(px));
    const bi = b - binMin;
    if (bi < 0 || bi >= totals.length) return null;
    const start = BIN[bin].start(b), end = BIN[bin].start(b + 1);
    return { b, bi, start, end };
  }

  function clickBar(px, py) {
    const hit = binAtPx(px);
    if (!hit || !totals[hit.bi] || py > M.t + plotH()) { if (S.highlight) TM.update({ highlight: null }); return; }
    const same = S.highlight && S.highlight.mode === bin && S.highlight.bin === hit.b;
    TM.update({ highlight: same ? null : { mode: bin, bin: hit.b, start: hit.start, end: hit.end } });
  }

  function hover(px, py, e) {
    const wx0 = x(S.window[0]), wx1 = x(S.window[1] + 1);
    const nearEdge = Math.abs(px - wx0) <= EDGE || Math.abs(px - wx1) <= EDGE;
    canvas.style.cursor = py > M.t + plotH() ? "grab" : nearEdge ? "ew-resize" : px > wx0 && px < wx1 ? "move" : "crosshair";
    const hit = binAtPx(px);
    if (!hit || py > M.t + plotH() || !totals[hit.bi]) { tip.style.display = "none"; return; }
    let rows = "";
    for (let c = 0; c < K; c++) {
      const v = counts[hit.bi * K + c];
      if (v) rows += `<div><span class="sw" style="background:${D.assocs[cats[c]].color}"></span>${TM.escapeHTML(D.assocs[cats[c]].title)} <b>${v.toLocaleString()}</b></div>`;
    }
    const range = bin === "day" ? TM.fmtDay(hit.start) : `${TM.fmtDay(hit.start)} – ${TM.fmtDay(hit.end - 1)}`;
    const sel = selCounts[hit.bi] ? `<div class="sel">${selCounts[hit.bi]} in open popup</div>` : "";
    tip.innerHTML = `<div class="t">${range}</div><div class="n">${totals[hit.bi].toLocaleString()} events</div>${rows}${sel}<div class="hint">Click to highlight on the map</div>`;
    tip.style.display = "block";
    const r = wrap.getBoundingClientRect();
    const tw = tip.offsetWidth;
    tip.style.left = clamp(e.clientX - r.left + 12, 0, r.width - tw - 4) + "px";
    tip.style.bottom = r.height - py + 12 + "px";
  }

  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const span = domain[1] - domain[0];
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) {
      const dx = (e.shiftKey ? e.deltaY : e.deltaX) / plotW() * span;
      domain = [domain[0] + dx, domain[1] + dx];
    } else {
      const f = Math.exp(e.deltaY * 0.0015);
      const full = extent[1] - extent[0];
      const newSpan = clamp(span * f, 10, Math.max(full * 1.2, 30));
      const anchor = dayAt(e.offsetX);
      const t = (anchor - domain[0]) / span;
      domain = [anchor - t * newSpan, anchor + (1 - t) * newSpan];
    }
    refreshBinning();
    draw();
  }, { passive: false });

  canvas.addEventListener("dblclick", () => { TM.histogram.fitAll(); });

  /* ---------- public API for the header buttons ---------- */
  TM.histogram = {
    setBin(mode) { binMode = mode; refreshBinning(true); draw(); TM.emit("bin", { mode: binMode, effective: bin }); },
    getBin: () => ({ mode: binMode, effective: bin }),
    fitAll() { computeExtent(); domain = extent.slice(); refreshBinning(); draw(); TM.emit("bin", { mode: binMode, effective: bin }); },
    fitWindow() {
      const pad = Math.max(2, (S.window[1] - S.window[0]) * 0.08);
      domain = [S.window[0] - pad, S.window[1] + 1 + pad];
      refreshBinning(); draw(); TM.emit("bin", { mode: binMode, effective: bin });
    },
    stepWindow(dir) {
      const len = S.window[1] - S.window[0] + 1;
      TM.update({ window: [S.window[0] + dir * len, S.window[1] + dir * len] });
    },
  };

  TM.on("change", (info) => {
    const key = S.datasetOn.join("");
    if (key !== datasetKey) {
      datasetKey = key;
      computeExtent();
      domain = extent.slice();
      refreshBinning(true);
      TM.emit("bin", { mode: binMode, effective: bin });
    } else if (info.filters) computeCounts();
    else computeSelCounts();
    draw();
  });
  TM.on("hoverday", draw);
  TM.on("view", () => { datasetKey = ""; });

  // first layout
  computeExtent();
  domain = extent.slice();
})();
