/*
 * panels.js: everything that is plain HTML
 * -----------------------------------------
 * toolbar + side panels (layers, filters, about), view buttons, event cards,
 * timeline header, basemap toggle and keyboard shortcuts.
 */
(function () {
  const TM = window.TM;
  const CONFIG = window.CONFIG;
  const D = TM.data;
  const S = TM.state;
  const esc = (s) => TM.escapeHTML(s == null ? "" : s);
  const $ = (id) => document.getElementById(id);

  document.title = CONFIG.title;
  $("title").textContent = CONFIG.title;
  $("subtitle").textContent = CONFIG.subtitle || "";

  /* ---------- toolbar tabs ---------- */
  let openPanel = null;
  document.querySelectorAll("#toolbar .tab").forEach((btn) => {
    btn.addEventListener("click", () => setPanel(openPanel === btn.dataset.panel ? null : btn.dataset.panel));
  });
  function setPanel(name) {
    openPanel = name;
    document.querySelectorAll("#toolbar .tab").forEach((b) => b.classList.toggle("active", b.dataset.panel === name));
    document.querySelectorAll(".panel-inner").forEach((p) => (p.hidden = p.id !== "panel-" + name));
    $("panel").classList.toggle("open", !!name);
  }
  $("panel-close").addEventListener("click", () => setPanel(null));

  /* ---------- views ---------- */
  const viewsEl = $("views");
  viewsEl.innerHTML = CONFIG.views.map((v) => `<button data-view="${esc(v.id)}">${esc(v.label)}</button>`).join("");
  viewsEl.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-view]");
    if (b) TM.applyView(b.dataset.view);
  });
  function renderViews() {
    // a view is "active" while the datasets on match it exactly
    viewsEl.querySelectorAll("button").forEach((b) => {
      const v = CONFIG.views.find((x) => x.id === b.dataset.view);
      const match = D.datasets.every((d, i) => S.datasetOn[i] === v.datasets.includes(d.id));
      b.classList.toggle("active", b.dataset.view === S.view && match);
    });
  }

  /* ---------- layers panel ---------- */
  function renderLayers() {
    const counts = D.datasets.map(() => 0);
    for (let i = 0; i < D.nEvents; i++) counts[D.evDs[i]]++;
    $("layers-list").innerHTML = D.datasets
      .map((d, i) => `<label class="row"><input type="checkbox" data-ds="${i}" ${S.datasetOn[i] ? "checked" : ""}><span class="box"></span><span class="lbl">${esc(d.label)}</span><span class="cnt">${counts[i].toLocaleString()}</span></label>`)
      .join("");
    $("basemap-list").innerHTML = Object.keys(CONFIG.basemaps)
      .map((n) => `<label class="row"><input type="radio" name="basemap" value="${esc(n)}" ${S.basemap === n ? "checked" : ""}><span class="box round"></span><span class="lbl">${esc(n[0].toUpperCase() + n.slice(1))}</span></label>`)
      .join("");
  }
  $("layers-list").addEventListener("change", (e) => {
    const i = +e.target.dataset.ds;
    const on = S.datasetOn.slice();
    on[i] = e.target.checked;
    TM.update({ datasetOn: on, selectedLoc: -1 }, "filters");
  });
  $("basemap-list").addEventListener("change", (e) => TM.setBasemap(e.target.value));
  TM.on("basemap", () => { renderLayers(); renderBasemapToggle(); });

  /* ---------- filters panel ---------- */
  function renderFilters() {
    const cnt = TM.derived.assocCountWindow;
    let html = "";
    D.datasets.forEach((ds, di) => {
      const off = !S.datasetOn[di];
      const byGroup = new Map();
      for (const a of ds.assocIds) {
        const g = D.assocs[a].group;
        if (!byGroup.has(g)) byGroup.set(g, []);
        byGroup.get(g).push(a);
      }
      html += `<section class="ds ${off ? "off" : ""}"><h3>${esc(ds.label)}${off ? ' <span class="muted">(layer off)</span>' : ""}</h3>`;
      [...byGroup.keys()].sort((a, b) => a - b).forEach((g) => {
        const ids = byGroup.get(g);
        html += `<div class="group"><div class="group-head"><span>${esc(D.groups[g])}</span><span class="links"><a data-all="${ids.join(",")}">all</a> / <a data-none="${ids.join(",")}">none</a></span></div>`;
        for (const a of ids) {
          const A = D.assocs[a];
          const sw = A.mode === "CATEGORY" ? `<span class="sw" style="background:${A.color}"></span>` : "";
          html += `<label class="row" title="${esc(A.desc || A.title)}"><input type="checkbox" data-a="${a}" ${S.assocOn[a] ? "checked" : ""}><span class="box"></span>${sw}<span class="lbl">${esc(A.title)}</span><span class="cnt">${cnt[a].toLocaleString()}</span></label>`;
        }
        html += `</div>`;
      });
      html += `</section>`;
    });
    $("filters-list").innerHTML = html;
  }
  $("filters-list").addEventListener("change", (e) => {
    const a = e.target.dataset.a;
    if (a === undefined) return;
    S.assocOn[+a] = e.target.checked ? 1 : 0;
    TM.update({}, "filters");
  });
  $("filters-list").addEventListener("click", (e) => {
    const t = e.target;
    const ids = t.dataset.all || t.dataset.none;
    if (!ids) return;
    const v = t.dataset.all ? 1 : 0;
    ids.split(",").forEach((a) => (S.assocOn[+a] = v));
    TM.update({}, "filters");
  });
  // counts in the open filters panel are refreshed lazily (they change while dragging the window)
  let filtersDirty = true;
  function maybeRenderFilters() {
    if (openPanel === "filters" && filtersDirty) { renderFilters(); filtersDirty = false; }
  }
  document.querySelector('[data-panel="filters"]').addEventListener("click", () => { filtersDirty = true; maybeRenderFilters(); });

  /* ---------- timeline header ---------- */
  function renderHeader() {
    const t = TM.derived.windowTotal;
    $("tl-range").innerHTML = `<b>${t.toLocaleString()}</b> events in window · ${TM.fmtDay(S.window[0])} – ${TM.fmtDay(S.window[1])}`;
    const hl = S.highlight;
    const hlEl = $("tl-highlight");
    if (hl) {
      const range = hl.end - hl.start === 1 ? TM.fmtDay(hl.start) : `${TM.fmtDay(hl.start)} – ${TM.fmtDay(hl.end - 1)}`;
      hlEl.innerHTML = `<span class="dot"></span>Highlighted ${range} · ${TM.derived.highlightTotal.toLocaleString()} events <button title="Clear (Esc)">×</button>`;
      hlEl.hidden = false;
    } else hlEl.hidden = true;
  }
  $("tl-highlight").addEventListener("click", (e) => { if (e.target.tagName === "BUTTON") TM.update({ highlight: null }); });
  $("tl-bins").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-bin]");
    if (b) TM.histogram.setBin(b.dataset.bin);
  });
  TM.on("bin", ({ mode, effective }) => {
    $("tl-bins").querySelectorAll("button").forEach((b) => {
      b.classList.toggle("active", b.dataset.bin === mode);
      if (b.dataset.bin === "auto") b.textContent = mode === "auto" ? `auto (${effective})` : "auto";
    });
  });
  $("tl-fit").addEventListener("click", () => TM.histogram.fitWindow());
  $("tl-all").addEventListener("click", () => TM.histogram.fitAll());
  $("tl-prev").addEventListener("click", () => TM.histogram.stepWindow(-1));
  $("tl-next").addEventListener("click", () => TM.histogram.stepWindow(1));

  /* ---------- basemap toggle (bottom right, like the original) ---------- */
  const names = Object.keys(CONFIG.basemaps);
  function renderBasemapToggle() {
    const next = names[(names.indexOf(S.basemap) + 1) % names.length];
    const el = $("basemap-toggle");
    el.className = "bm-" + next;
    el.querySelector("span").textContent = next;
    el.title = "Switch to " + next;
  }
  $("basemap-toggle").addEventListener("click", () => TM.setBasemap(names[(names.indexOf(S.basemap) + 1) % names.length]));

  /* ---------- event cards ---------- */
  const cardsEl = $("cards");
  const PAGE = 100;
  let shownCount = PAGE, lastKey = "";

  function renderCards() {
    const sel = TM.derived.selectedEvents;
    const key = S.selectedLoc + ":" + sel.length + ":" + (sel[0] || 0) + ":" + (sel[sel.length - 1] || 0) + ":" + (S.highlight ? S.highlight.start : "");
    if (key === lastKey) return;
    const sameLoc = lastKey.split(":")[0] === String(S.selectedLoc);
    lastKey = key;
    if (S.selectedLoc < 0 || !sel.length) {
      cardsEl.hidden = true;
      cardsEl.innerHTML = "";
      if (S.selectedLoc >= 0 && !sel.length) TM.update({ selectedLoc: -1 });
      return;
    }
    if (!sameLoc) shownCount = PAGE;
    const scroll = sameLoc ? (cardsEl.querySelector(".card-list") || {}).scrollTop || 0 : 0;

    const first = TM.eventInfo(sel[0]);
    const names = new Set();
    for (let k = 0; k < Math.min(sel.length, 400); k++) names.add(TM.eventInfo(sel[k]).location);
    const place = names.size === 1 ? first.location : `${names.size}${sel.length > 400 ? "+" : ""} addresses at this point`;
    const span = D.evDay[sel[0]] !== D.evDay[sel[sel.length - 1]] ? `${TM.fmtDay(D.evDay[sel[0]])} – ${TM.fmtDay(D.evDay[sel[sel.length - 1]])}` : TM.fmtDay(D.evDay[sel[0]]);

    let html = `<div class="card-head"><div><div class="ch-count">${sel.length.toLocaleString()} event${sel.length === 1 ? "" : "s"}</div><div class="ch-place">${esc(place)}</div><div class="ch-span">${span}</div></div><button class="close" title="Close (Esc)">×</button></div><ul class="card-list">`;
    const hl = S.highlight;
    for (let k = 0; k < Math.min(sel.length, shownCount); k++) html += cardHTML(sel[k], hl, names.size > 1);
    if (sel.length > shownCount) html += `<li class="more"><button>Show ${Math.min(PAGE, sel.length - shownCount)} more of ${(sel.length - shownCount).toLocaleString()}</button></li>`;
    html += `</ul>`;
    cardsEl.innerHTML = html;
    cardsEl.hidden = false;
    cardsEl.querySelector(".card-list").scrollTop = scroll;
  }

  function cardHTML(i, hl, showPlace) {
    const ev = TM.eventInfo(i);
    const inHl = hl && ev.day >= hl.start && ev.day < hl.end;
    const chips = ev.assocs
      .filter((a) => !a.pseudo || ev.assocs.length === 1)
      .map((a) => `<span class="chip">${a.mode === "CATEGORY" ? `<i style="background:${a.color}"></i>` : ""}${esc(a.title)}</span>`)
      .join("");
    let extra = "";
    if (ev.extra) for (const [k, v] of Object.entries(ev.extra)) extra += `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`;
    const src = ev.sources
      .map((s) => `<div class="src"><span class="src-type">${esc(s.type || "Source")}</span> ${esc(s.title)}${s.desc ? `<div class="src-desc">${esc(s.desc)}</div>` : ""}${s.paths.map((p) => `<a href="${esc(p)}" target="_blank" rel="noopener">${esc(p.replace(/^https?:\/\//, "").slice(0, 60))}</a>`).join("")}</div>`)
      .join("");
    return `<li class="card${inHl ? " in-hl" : ""}" data-ev="${i}">
      <div class="card-top"><span class="date">${TM.fmtDay(ev.day)}${ev.time ? " · " + esc(ev.time) : ""}</span><span class="ds">${esc(ev.dataset.label)}</span></div>
      ${chips ? `<div class="chips">${chips}</div>` : ""}
      ${showPlace && ev.location ? `<div class="place">${esc(ev.location)}</div>` : ""}
      <p class="desc">${esc(ev.description)}</p>
      ${extra ? `<dl>${extra}</dl>` : ""}
      ${src ? `<div class="sources">${src}</div>` : ""}
    </li>`;
  }

  cardsEl.addEventListener("click", (e) => {
    if (e.target.closest(".close")) TM.update({ selectedLoc: -1 });
    else if (e.target.closest(".more button")) { shownCount += PAGE; lastKey = ""; renderCards(); }
  });
  cardsEl.addEventListener("mouseover", (e) => {
    const c = e.target.closest(".card");
    const d = c ? D.evDay[+c.dataset.ev] : null;
    if (d !== S.hoverDay) { S.hoverDay = d; TM.emit("hoverday"); }
  });
  cardsEl.addEventListener("mouseleave", () => { S.hoverDay = null; TM.emit("hoverday"); });

  /* ---------- keyboard ---------- */
  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT") return;
    if (e.key === "Escape") {
      if (S.highlight || S.selectedLoc >= 0) TM.update({ highlight: null, selectedLoc: -1 });
      else setPanel(null);
    } else if (e.key === "ArrowLeft") TM.histogram.stepWindow(-1);
    else if (e.key === "ArrowRight") TM.histogram.stepWindow(1);
  });

  /* ---------- wire up ---------- */
  TM.on("change", (info) => {
    renderHeader();
    renderCards();
    renderViews();
    if (info.filters) renderLayers();
    filtersDirty = true;
    if (info.filters || !throttleFilters()) maybeRenderFilters();
  });
  // while the window is being dragged, refresh filter counts at most ~4× a second
  let lastFilterRender = 0;
  function throttleFilters() {
    const now = performance.now();
    if (now - lastFilterRender < 250) { clearTimeout(throttleFilters.t); throttleFilters.t = setTimeout(maybeRenderFilters, 260); return true; }
    lastFilterRender = now;
    return false;
  }

  renderLayers();
  renderBasemapToggle();
})();
