/*
 * map.js: base map (MapLibre) + event dots (deck.gl, WebGL)
 * ----------------------------------------------------------
 * Events at identical coordinates are drawn as one dot whose size grows with
 * the number of shown events there. Click a dot to open its event cards.
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

  function aggregate() {
    cnt.fill(0); hlCnt.fill(0); tally.fill(0);
    const shown = TM.derived.shown, inHl = TM.derived.inHighlight, col = TM.derived.evColor;
    for (let i = 0; i < D.nEvents; i++) {
      if (!shown[i]) continue;
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
  }

  /* ---------- deck.gl overlay ---------- */
  const overlay = new deck.MapboxOverlay({ interleaved: false, layers: [] });
  map.addControl(overlay);
  let version = 0;

  function render() {
    aggregate();
    version++;
    overlay.setProps({
      layers: [
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
            const l = visLocs[info.index];
            TM.update({ selectedLoc: S.selectedLoc === l ? -1 : l });
            return true;
          },
          onHover: onHover,
        }),
      ],
    });
  }

  /* ---------- hover tooltip ---------- */
  const tip = document.getElementById("maptip");
  function onHover(info) {
    if (info.index < 0 || !info.picked) { tip.style.display = "none"; map.getCanvas().style.cursor = ""; return; }
    const l = visLocs[info.index];
    const ev = TM.eventInfo(firstEvent[l]);
    const n = cnt[l];
    tip.innerHTML = `<b>${n.toLocaleString()} event${n === 1 ? "" : "s"}</b>${S.highlight && hlCnt[l] ? ` · ${hlCnt[l]} in highlighted period` : ""}<br>${escapeHTML(ev.location || "")}`;
    tip.style.display = "block";
    tip.style.left = info.x + 14 + "px";
    tip.style.top = info.y + 14 + "px";
    map.getCanvas().style.cursor = "pointer";
  }

  // click on empty map closes the cards
  map.on("click", (e) => {
    const picked = overlay.pickObject({ x: e.point.x, y: e.point.y, radius: 2 });
    if (!picked && S.selectedLoc >= 0) TM.update({ selectedLoc: -1 });
  });

  function escapeHTML(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]); }
  TM.escapeHTML = escapeHTML;

  const hideTip = () => { tip.style.display = "none"; };
  map.on("movestart", hideTip);
  TM.on("view", hideTip);
  TM.on("change", render);
})();
