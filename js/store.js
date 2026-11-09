/*
 * store.js: data + state
 * ----------------------
 * Loads window.TIMEMAP_DATA into flat typed arrays, holds the UI state, and
 * runs the filter pass. Everything else (map, histogram, panels) reads
 * from here and listens for the "change" event.
 *
 * Rule for what is visible on the map:
 *   an event PASSES if its dataset is on and the category/filter checkboxes allow it;
 *   a passing event is SHOWN if it falls inside the time window, or inside the
 *   highlighted histogram bar.
 */
(function () {
  const TM = (window.TM = window.TM || {});
  const CONFIG = window.CONFIG;
  const DATA = window.TIMEMAP_DATA;
  const DAY_MS = 86400000;

  /* ---------- tiny event bus ---------- */
  const listeners = {};
  TM.on = (name, fn) => (listeners[name] = listeners[name] || []).push(fn);
  TM.emit = (name, arg) => (listeners[name] || []).forEach((fn) => fn(arg));

  /* ---------- helpers ---------- */
  TM.hexToRgb = function (hex) {
    const h = hex.replace("#", "");
    const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6);
    return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
  };
  const fmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  TM.fmtDay = (d) => fmt.format(new Date(d * DAY_MS));
  TM.dayFromISO = (s) => Math.round(Date.parse(s + "T00:00:00Z") / DAY_MS);
  TM.DAY_MS = DAY_MS;

  /* ---------- flatten datasets into global arrays ---------- */
  const datasets = []; // {id, label, index, assocIds:[global], locStart, locEnd, minDay, maxDay, sources, names}
  const assocs = []; // global association list
  const groups = ["Categories"]; // group 0 = categories
  let nEvents = 0, nLocs = 0;
  DATA.datasets.forEach((d) => { nEvents += d.events.length; nLocs += d.locations.length; });

  const evDay = new Int32Array(nEvents);
  const evDs = new Uint8Array(nEvents);
  const evLoc = new Int32Array(nEvents);
  const evLocal = new Int32Array(nEvents); // index inside its dataset's events array
  const evAssocStart = new Int32Array(nEvents + 1);
  const evAssocList = [];
  const locLon = new Float64Array(nLocs);
  const locLat = new Float64Array(nLocs);
  const locDs = new Uint8Array(nLocs);

  let e = 0, l = 0;
  DATA.datasets.forEach((d, di) => {
    const conf = CONFIG.datasets.find((c) => c.id === d.id) || {};
    const ds = { id: d.id, label: conf.label || d.label, index: di, raw: d, assocIds: [], locStart: l, minDay: Infinity, maxDay: -Infinity };
    datasets.push(ds);

    const localToGlobal = d.associations.map((a) => {
      let group = 0;
      if (a.mode !== "CATEGORY") {
        group = groups.indexOf(a.group);
        if (group < 0) { group = groups.length; groups.push(a.group); }
      }
      const g = { id: a.id, title: a.title, desc: a.desc, mode: a.mode, group, ds: di, color: CONFIG.colors[a.id] || null, unlisted: !!a.unlisted };
      ds.assocIds.push(assocs.length);
      assocs.push(g);
      return assocs.length - 1;
    });
    // pseudo-category for events without one
    const uncat = assocs.length;
    assocs.push({ id: "__uncategorised", title: "Uncategorised", desc: "Events without a category association", mode: "CATEGORY", group: 0, ds: di, color: CONFIG.colors.default || "#999999", pseudo: true });
    let uncatUsed = 0;

    d.locations.forEach((p) => { locLon[l] = p[0]; locLat[l] = p[1]; locDs[l] = di; l++; });
    ds.locEnd = l;

    d.events.forEach((row, ri) => {
      evDay[e] = row[0];
      evDs[e] = di;
      evLoc[e] = ds.locStart + row[1];
      evLocal[e] = ri;
      evAssocStart[e] = evAssocList.length;
      let hasCat = false;
      for (const a of row[2]) {
        const g = localToGlobal[a];
        evAssocList.push(g);
        if (assocs[g].mode === "CATEGORY") hasCat = true;
      }
      if (!hasCat) { evAssocList.push(uncat); uncatUsed++; }
      if (row[0] < ds.minDay) ds.minDay = row[0];
      if (row[0] > ds.maxDay) ds.maxDay = row[0];
      e++;
    });
    if (uncatUsed) ds.assocIds.push(uncat);
    else assocs[uncat].unused = true;
  });
  evAssocStart[nEvents] = evAssocList.length;
  const evAssoc = Int32Array.from(evAssocList);

  // Category colours: CATEGORY associations get the configured colour or a fallback palette.
  const fallback = ["#e9c46a", "#2a9d8f", "#8ab17d", "#b56576", "#6d597a", "#f4a261", "#90be6d", "#577590"];
  let fb = 0;
  assocs.forEach((a) => {
    if (a.mode === "CATEGORY" && !a.color) a.color = fallback[fb++ % fallback.length];
    a.rgb = a.color ? TM.hexToRgb(a.color) : null;
  });

  // Month index per event (for monthly bins)
  const evMonth = new Int32Array(nEvents);
  for (let i = 0; i < nEvents; i++) {
    const dt = new Date(evDay[i] * DAY_MS);
    evMonth[i] = dt.getUTCFullYear() * 12 + dt.getUTCMonth();
  }

  // location -> events (CSR)
  const locStart = new Int32Array(nLocs + 1);
  for (let i = 0; i < nEvents; i++) locStart[evLoc[i] + 1]++;
  for (let i = 0; i < nLocs; i++) locStart[i + 1] += locStart[i];
  const locEvents = new Int32Array(nEvents);
  const fill = locStart.slice(0, nLocs);
  for (let i = 0; i < nEvents; i++) locEvents[fill[evLoc[i]]++] = i;

  TM.data = { datasets, assocs, groups, nEvents, nLocs, evDay, evDs, evLoc, evLocal, evAssocStart, evAssoc, evMonth, locLon, locLat, locDs, locStart, locEvents };

  /* ---------- state ---------- */
  const firstView = CONFIG.views[0];
  const state = (TM.state = {
    view: firstView.id,
    datasetOn: datasets.map((d) => firstView.datasets.includes(d.id)),
    assocOn: new Uint8Array(assocs.length).fill(1),
    window: [TM.dayFromISO(firstView.window[0]), TM.dayFromISO(firstView.window[1])], // inclusive days
    highlight: null, // {start, end} day range (end exclusive) of a clicked histogram bar
    selectedLoc: -1,
    hoverDay: null,
    basemap: firstView.basemap || "map",
  });

  /* ---------- derived arrays (recomputed by TM.update) ---------- */
  const pass = new Uint8Array(nEvents); // passes dataset + filter checks
  const evColor = new Int32Array(nEvents); // global assoc index used for colour
  const derived = (TM.derived = {
    pass, evColor,
    shown: new Uint8Array(nEvents),
    inHighlight: new Uint8Array(nEvents),
    assocCountWindow: new Int32Array(assocs.length), // for filter panel counts
    shownTotal: 0,
    windowTotal: 0,
    highlightTotal: 0,
    selectedEvents: [],
  });

  function computePass() {
    const { assocOn, datasetOn } = state;
    const nGroups = groups.length;
    for (let i = 0; i < nEvents; i++) {
      if (!datasetOn[evDs[i]]) { pass[i] = 0; continue; }
      let has = 0, on = 0, color = -1;
      for (let k = evAssocStart[i], end = evAssocStart[i + 1]; k < end; k++) {
        const a = evAssoc[k];
        const bit = 1 << assocs[a].group;
        has |= bit;
        if (assocOn[a]) {
          on |= bit;
          if (color < 0 && assocs[a].group === 0) color = a;
        }
      }
      // every group the event belongs to must have at least one active association
      pass[i] = (has & ~on) === 0 ? 1 : 0;
      if (color < 0) for (let k = evAssocStart[i]; k < evAssocStart[i + 1]; k++) if (assocs[evAssoc[k]].group === 0) { color = evAssoc[k]; break; }
      evColor[i] = color;
    }
    void nGroups;
  }

  function computeShown() {
    const [w0, w1] = state.window;
    const hl = state.highlight;
    const { shown, inHighlight, assocCountWindow } = derived;
    assocCountWindow.fill(0);
    let total = 0, hlTotal = 0, winTotal = 0;
    for (let i = 0; i < nEvents; i++) {
      const d = evDay[i];
      const inWin = d >= w0 && d <= w1;
      const inHl = hl !== null && d >= hl.start && d < hl.end;
      if (inWin && state.datasetOn[evDs[i]]) for (let k = evAssocStart[i]; k < evAssocStart[i + 1]; k++) assocCountWindow[evAssoc[k]]++;
      if (pass[i] && (inWin || inHl)) { shown[i] = 1; total++; if (inWin) winTotal++; } else shown[i] = 0;
      inHighlight[i] = pass[i] && inHl ? 1 : 0;
      if (inHighlight[i]) hlTotal++;
    }
    derived.shownTotal = total;
    derived.windowTotal = winTotal;
    derived.highlightTotal = hlTotal;
  }

  function computeSelection() {
    const sel = [];
    const loc = state.selectedLoc;
    if (loc >= 0) {
      for (let k = locStart[loc]; k < locStart[loc + 1]; k++) {
        const i = locEvents[k];
        if (derived.shown[i]) sel.push(i);
      }
      sel.sort((a, b) => evDay[a] - evDay[b]);
    }
    derived.selectedEvents = sel;
  }

  /*
   * TM.update(patch, what): merge patch into state and recompute.
   *   what: "filters" (dataset/category change, the full pass), otherwise only the
   *   window/highlight/selection pass runs. Cheap enough to call on every drag frame.
   */
  let scheduled = null, pendingFilters = false;
  TM.update = function (patch, what) {
    Object.assign(state, patch || {});
    if (what === "filters") pendingFilters = true;
    if (scheduled) return;
    scheduled = requestAnimationFrame(() => {
      scheduled = null;
      if (pendingFilters) computePass();
      computeShown();
      computeSelection();
      TM.emit("change", { filters: pendingFilters });
      pendingFilters = false;
    });
  };

  TM.updateNow = function () {
    computePass();
    computeShown();
    computeSelection();
    TM.emit("change", { filters: true });
  };

  /* ---------- event accessors for popups ---------- */
  TM.eventInfo = function (i) {
    const ds = datasets[evDs[i]];
    const row = ds.raw.events[evLocal[i]];
    const cats = [];
    for (let k = evAssocStart[i]; k < evAssocStart[i + 1]; k++) cats.push(assocs[evAssoc[k]]);
    return {
      day: row[0],
      time: row[4],
      description: row[3],
      location: ds.raw.names[row[5]],
      sources: (row[6] || []).map((s) => ds.raw.sources[s]),
      extra: row[7] || null,
      assocs: cats,
      dataset: ds,
    };
  };

  TM.applyView = function (viewId) {
    const v = CONFIG.views.find((x) => x.id === viewId);
    if (!v) return;
    TM.update(
      {
        view: v.id,
        datasetOn: datasets.map((d) => v.datasets.includes(d.id)),
        window: v.window ? [TM.dayFromISO(v.window[0]), TM.dayFromISO(v.window[1])] : state.window,
        basemap: v.basemap || state.basemap,
        highlight: null,
        selectedLoc: -1,
      },
      "filters"
    );
    TM.emit("view", v);
  };
})();
