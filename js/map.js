/*
 * map.js: base map (MapLibre) + event dots and court areas (deck.gl, WebGL)
 * --------------------------------------------------------------------------
 * Events at identical coordinates are drawn as one dot whose size grows with
 * the number of shown events there. Click a dot to open its event cards.
 *
 * Area view (toggle in the Layers panel): events whose location is a court listed
 * in the dataset's area file are not drawn as dots; instead each court's area is
 * shaded blue, more opaque the more of its cases are shown. Courts that share a
 * geometry share one area. Click an area to open its cases.
 */
(function () {
  const TM = window.TM;
  const CONFIG = window.CONFIG;
  const D = TM.data;
  const S = TM.state;

  const TIMELINE_H = () => document.getElementById("timeline").offsetHeight;

  /* ---------- base map ---------- */
  const sources = {}, layers = [{ id: "bg", type: "background", paint: { "background-color": "#111" } }];
  for (const [name, b] of Object.entries(CONFIG.basemaps)) {
    sources[name] = { type: "raster", tiles: b.tiles, tileSize: 256, maxzoom: b.maxzoom || 19, attribution: b.attribution };
    layers.push({ id: name, type: "raster", source: name, layout: { visibility: name === S.basemap ? "visible" : "none" } });
  }

  const v0 = CONFIG.views[0];
  const map = (TM.map = new maplibregl.Map({
    container: "map",
    style: { version: 8, sources, layers },
    center: v0.center,
    zoom: v0.zoom,
    bearing: v0.bearing || 0,
    pitch: v0.pitch || 0,
    attributionControl: false,
    maxPitch: 60,
  }));
  map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
  map.addControl(new maplibregl.ScaleControl({ maxWidth: 100 }), "bottom-right");

  function setPadding() { map.setPadding({ top: 0, left: 0, right: 0, bottom: TIMELINE_H() }); }
  setPadding();
  window.addEventListener("resize", setPadding);

  TM.setBasemap = function (name) {
    S.basemap = name;
    for (const n of Object.keys(CONFIG.basemaps)) {
      if (map.getLayer(n)) map.setLayoutProperty(n, "visibility", n === name ? "visible" : "none");
    }
    TM.emit("basemap", name);
  };

  TM.on("view", (v) => {
    TM.setBasemap(v.basemap || S.basemap);
    map.flyTo({ center: v.center, zoom: v.zoom, bearing: v.bearing || 0, pitch: v.pitch || 0, duration: 1600, essential: true });
  });

  /* ---------- per-location aggregation ---------- */
  const N = D.nLocs;
  const catIndex = new Int32Array(D.assocs.length).fill(-1);
  const catList = [];
  D.assocs.forEach((a, i) => { if (a.mode === "CATEGORY") { catIndex[i] = catList.length; catList.push(i); } });
  const K = catList.length;

  const cnt = new Int32Array(N);
  const hlCnt = new Int32Array(N);
  const tally = new Int32Array(N * K);
  const firstEvent = new Int32Array(N);

  const pos = new Float64Array(N * 2);
  const radius = new Float32Array(N);
  const fill = new Uint8Array(N * 4);
  const line = new Uint8Array(N * 4);
  const lineW = new Float32Array(N);
  let visLocs = new Int32Array(N);
  let nVis = 0;

  const rMin = CONFIG.eventRadius || 5, rMax = CONFIG.maxEventRadius || 22;
  const DIM = [130, 130, 130];

  /* ---------- per-area aggregation ---------- */
  const NA = D.nAreas;
  const aCnt = new Int32Array(NA);
  const aHl = new Int32Array(NA);
  const aFill = [], aLine = [], aLineW = new Float32Array(NA);
  for (let a = 0; a < NA; a++) { aFill.push([0, 0, 0, 0]); aLine.push([0, 0, 0, 0]); }
  const AREA_RGB = TM.hexToRgb(CONFIG.areaColor || "#1f6fd1");
  const [opMin, opMax] = CONFIG.areaOpacity || [0.06, 0.85];
  const areaFeatures = D.areas.map((a, i) => ({ type: "Feature", geometry: a.geometry, properties: { i } }));
  let areaMax = 0;

  /*
   * Fixed shading scale (CONFIG.areaScale = "fixed", the default): the darkest blue is the
   * most cases any area has in ANY period as long as the current window (or highlighted bar),
   * so sliding the window changes the shading with the counts. It is recomputed only when the
   * window length or the filters change. "window" instead scales to the busiest area in view.
   */
  const fixedScale = (CONFIG.areaScale || "fixed") !== "window";
  let scaleKey = "", scaleMax = 0;
  const areaDays = []; // per area: sorted days of its events that pass the filters
  function fixedMax(len, filtersChanged) {
    if (filtersChanged || !areaDays.length) {
      areaDays.length = 0;
      const pass = TM.derived.pass;
      for (let a = 0; a < NA; a++) {
        const days = [];
        for (let k = D.areaEvStart[a]; k < D.areaEvStart[a + 1]; k++) { const i = D.areaEvents[k]; if (pass[i]) days.push(D.evDay[i]); }
        days.sort((x, y) => x - y);
        areaDays.push(days);
      }
      scaleKey = "";
    }
    if (scaleKey === String(len)) return scaleMax;
    let best = 0;
    for (const days of areaDays) {
      // most events inside any `len`-day stretch (two pointers over sorted days)
      for (let lo = 0, hi = 0; hi < days.length; hi++) {
        while (days[hi] - days[lo] >= len) lo++;
        if (hi - lo + 1 > best) best = hi - lo + 1;
      }
    }
    scaleKey = String(len);
    scaleMax = best;
    return best;
  }

  function aggregate(filtersChanged) {
    cnt.fill(0); hlCnt.fill(0); tally.fill(0);
    aCnt.fill(0); aHl.fill(0);
    const shown = TM.derived.shown, inHl = TM.derived.inHighlight, col = TM.derived.evColor;
    const areaView = S.areaView;
    for (let i = 0; i < D.nEvents; i++) {
      if (!shown[i]) continue;
      if (areaView) {
        const a = D.evArea[i];
        if (a >= 0) { aCnt[a]++; if (inHl[i]) aHl[a]++; continue; }
      }
      const l = D.evLoc[i];
      if (cnt[l] === 0) firstEvent[l] = i;
      cnt[l]++;
      if (inHl[i]) hlCnt[l]++;
      const c = catIndex[col[i]];
      if (c >= 0) tally[l * K + c]++;
    }
    const hlOn = S.highlight !== null;
    // order: dimmed, normal, highlighted, selected (later = drawn on top)
    const buckets = [[], [], [], []];
    for (let l = 0; l < N; l++) {
      if (!cnt[l]) continue;
      const b = l === S.selectedLoc ? 3 : hlOn ? (hlCnt[l] ? 2 : 0) : 1;
      buckets[b].push(l);
    }
    nVis = 0;
    for (const b of buckets) for (const l of b) visLocs[nVis++] = l;

    for (let j = 0; j < nVis; j++) {
      const l = visLocs[j];
      pos[j * 2] = D.locLon[l];
      pos[j * 2 + 1] = D.locLat[l];
      const n = hlOn && hlCnt[l] ? hlCnt[l] : cnt[l];
      radius[j] = Math.min(rMax, rMin + 2.2 * Math.log2(n));
      let best = -1, bestN = 0;
      for (let c = 0; c < K; c++) { const t = tally[l * K + c]; if (t > bestN) { bestN = t; best = c; } }
      const rgb = best >= 0 ? D.assocs[catList[best]].rgb : DIM;
      const dim = hlOn && !hlCnt[l] && l !== S.selectedLoc;
      fill[j * 4] = dim ? DIM[0] : rgb[0];
      fill[j * 4 + 1] = dim ? DIM[1] : rgb[1];
      fill[j * 4 + 2] = dim ? DIM[2] : rgb[2];
      fill[j * 4 + 3] = dim ? 70 : 215;
      const sel = l === S.selectedLoc;
      line[j * 4] = line[j * 4 + 1] = line[j * 4 + 2] = sel ? 255 : 0;
      line[j * 4 + 3] = sel ? 255 : dim ? 60 : 150;
      lineW[j] = sel ? 2.5 : 1;
    }

    // areas: opacity in proportion to the number of shown cases (highlighted cases while a bar is highlighted)
    areaMax = 0;
    for (let a = 0; a < NA; a++) areaMax = Math.max(areaMax, hlOn ? aHl[a] : aCnt[a]);
    if (fixedScale && NA && areaView) {
      const len = hlOn ? S.highlight.end - S.highlight.start : S.window[1] - S.window[0] + 1;
      areaMax = Math.max(areaMax, fixedMax(len, filtersChanged));
    }
    for (let a = 0; a < NA; a++) {
      const n = hlOn ? aHl[a] : aCnt[a];
      const on = areaView && S.datasetOn[D.areas[a].ds];
      const sel = a === S.selectedArea;
      const f = aFill[a], ln = aLine[a];
      f[0] = AREA_RGB[0]; f[1] = AREA_RGB[1]; f[2] = AREA_RGB[2];
      f[3] = on && n > 0 ? Math.round(255 * (opMin + (opMax - opMin) * (n / areaMax))) : 0;
      if (sel) { ln[0] = ln[1] = ln[2] = 255; ln[3] = 255; }
      else if (on && n > 0) { ln[0] = AREA_RGB[0]; ln[1] = AREA_RGB[1]; ln[2] = AREA_RGB[2]; ln[3] = 220; }
      else { ln[0] = ln[1] = ln[2] = 120; ln[3] = on ? (aCnt[a] ? 110 : 70) : 0; }
      aLineW[a] = sel ? 3 : 1.2;
    }
  }

  /* ---------- deck.gl overlay ---------- */
  const overlay = new deck.MapboxOverlay({ interleaved: false, layers: [] });
  map.addControl(overlay);
  let version = 0;

  function selectLoc(l) { TM.update({ selectedLoc: S.selectedLoc === l ? -1 : l, selectedArea: -1 }); }
  function selectArea(a) { TM.update({ selectedArea: S.selectedArea === a ? -1 : a, selectedLoc: -1 }); }

  function render(info) {
    aggregate(!info || info.filters);
    version++;
    const out = [];
    if (NA) {
      out.push(
        new deck.GeoJsonLayer({
          id: "areas",
          data: areaFeatures,
          visible: S.areaView && D.areas.some((a) => S.datasetOn[a.ds]),
          filled: true,
          stroked: true,
          getFillColor: (f) => aFill[f.properties.i],
          getLineColor: (f) => aLine[f.properties.i],
          getLineWidth: (f) => aLineW[f.properties.i],
          lineWidthUnits: "pixels",
          lineJointRounded: true,
          pickable: true,
          autoHighlight: true,
          highlightColor: [255, 255, 255, 45],
          updateTriggers: { getFillColor: version, getLineColor: version, getLineWidth: version },
          onClick: (info) => {
            if (!info.object) return;
            const a = info.object.properties.i;
            if (!S.datasetOn[D.areas[a].ds]) return;
            selectArea(a);
            return true;
          },
          onHover: onAreaHover,
        })
      );
    }
    out.push(
      new deck.ScatterplotLayer({
        id: "events",
        data: {
          length: nVis,
          attributes: {
            getPosition: { value: pos, size: 2 },
            getRadius: { value: radius, size: 1 },
            getFillColor: { value: fill, size: 4, normalized: true },
            getLineColor: { value: line, size: 4, normalized: true },
            getLineWidth: { value: lineW, size: 1 },
          },
        },
        radiusUnits: "pixels",
        lineWidthUnits: "pixels",
        stroked: false,
        filled: true,
        pickable: true,
        autoHighlight: true,
        highlightColor: [255, 255, 255, 90],
        updateTriggers: { all: version },
        onClick: (info) => {
          if (info.index < 0) return;
          selectLoc(visLocs[info.index]);
          return true;
        },
        onHover: onHover,
      })
    );
    overlay.setProps({ layers: out });
    renderLegend();
  }

  /* ---------- area legend ---------- */
  const legend = document.getElementById("area-legend");
  function areaUnit(n) {
    const ds = D.datasets[D.areas[0] ? D.areas[0].ds : 0] || {};
    const u = ((ds.areaConf || {}).unit) || "case";
    return n === 1 ? u : u + "s";
  }
  function periodName() {
    const len = S.highlight ? S.highlight.end - S.highlight.start : S.window[1] - S.window[0] + 1;
    if (len === 1) return "single day";
    if (len === 7) return "week";
    if (len >= 28 && len <= 31 && S.highlight) return "month";
    return `${len.toLocaleString()}-day period`;
  }
  function renderLegend() {
    if (!legend) return;
    const anyOn = NA && S.areaView && D.areas.some((a) => S.datasetOn[a.ds]);
    if (!anyOn) { legend.hidden = true; return; }
    const hlOn = S.highlight !== null;
    const [r, g, b] = AREA_RGB;
    const ds = D.datasets[D.areas[0].ds];
    const title = ((ds.areaConf || {}).label || "Cases") + " per court area" + (hlOn ? " · highlighted period" : "");
    legend.innerHTML =
      `<div class="lg-t">${TM.escapeHTML(title)}</div>` +
      `<div class="lg-bar" style="background-image:linear-gradient(to right, rgba(${r},${g},${b},${opMin}), rgba(${r},${g},${b},${opMax}))"></div>` +
      `<div class="lg-s"><span>1</span><span>${areaMax ? areaMax.toLocaleString() : "–"} ${areaUnit(areaMax)}</span></div>` +
      (fixedScale ? `<div class="lg-n">Darkest = the most any court area has in any ${periodName()}</div>` : "");
    legend.hidden = false;
  }

  /* ---------- hover tooltip ---------- */
  const tip = document.getElementById("maptip");
  function placeTip(info) {
    tip.style.display = "block";
    tip.style.left = info.x + 14 + "px";
    tip.style.top = info.y + 14 + "px";
    map.getCanvas().style.cursor = "pointer";
  }
  function hideHover() { tip.style.display = "none"; map.getCanvas().style.cursor = ""; }

  function onHover(info) {
    if (info.index < 0 || !info.picked) { hideHover(); return; }
    const l = visLocs[info.index];
    const ev = TM.eventInfo(firstEvent[l]);
    const n = cnt[l];
    tip.innerHTML = `<b>${n.toLocaleString()} event${n === 1 ? "" : "s"}</b>${S.highlight && hlCnt[l] ? ` · ${hlCnt[l]} in highlighted period` : ""}<br>${escapeHTML(ev.location || "")}`;
    placeTip(info);
  }

  function onAreaHover(info) {
    if (!info.object || !info.picked) { hideHover(); return; }
    const a = info.object.properties.i;
    if (!S.datasetOn[D.areas[a].ds]) { hideHover(); return; }
    const n = aCnt[a];
    const courts = D.areas[a].courts.map((c) => escapeHTML(c)).join("<br>");
    tip.innerHTML = `<b>${n.toLocaleString()} ${areaUnit(n)}</b>${S.highlight && aHl[a] ? ` · ${aHl[a]} in highlighted period` : ""}<br>${courts}`;
    placeTip(info);
  }

  // click on empty map closes the cards
  map.on("click", (e) => {
    const picked = overlay.pickObject({ x: e.point.x, y: e.point.y, radius: 2 });
    if (!picked && (S.selectedLoc >= 0 || S.selectedArea >= 0)) TM.update({ selectedLoc: -1, selectedArea: -1 });
  });

  function escapeHTML(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]); }
  TM.escapeHTML = escapeHTML;

  const hideTip = () => { tip.style.display = "none"; };
  map.on("movestart", hideTip);
  TM.on("view", hideTip);
  TM.on("change", render);
})();
