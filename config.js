/*
 * Ukraine Time Map: configuration
 * ---------------------------------
 * The browser app and the data build script both read this file.
 * After changing anything in `datasets`, re-run:   node build-data.js
 * Changes to the other settings show up on a page reload.
 */
window.CONFIG = {
  title: "BUREAUCRATIC PIPELINES",
  subtitle: "Dispossession of property in occupied Ukraine",

  /* ---------- Data ----------
   * Each dataset is a folder holding the CSVs exported from the spreadsheet:
   *   events        (EXPORT_EVENTS sheet)        required
   *   associations  (EXPORT_ASSOCIATIONS sheet)  optional, gives titles/groups
   *   sources       (EXPORT_SOURCES sheet)       optional
   * File names are matched loosely: "events.csv", "EXPORT_EVENTS.csv" and Numbers'
   * "EXPORT_EVENTS-Table 1.csv" all work. Other CSVs in the folder are ignored.
   * In events.csv, every column whose name starts with "association" is read as an
   * association, and every column starting with "source" is read as a source id.
   * Any other column (e.g. "comments") is shown in the event popup automatically.
   *
   * areas (optional): a GeoJSON file in the dataset folder with one polygon per court.
   *   key       the property holding the court name, spelled exactly as in the
   *             events' `location` column
   *   label     name of the toggle in the Layers panel
   *   unit      what one event is called in the area tooltip and legend
   *   matchHint the build warns about locations matching this text that have no area
   * Events whose location matches a court can then be drawn as shaded areas instead
   * of dots (toggle in the Layers panel). Courts with identical geometry are merged
   * into one area and their cases add up.
   */
  dateFormat: "MM/DD/YYYY", // also understands YYYY-MM-DD; a time column ("time", hh:mm) is optional.
  // A dataset can override it, e.g. { ..., dateFormat: "DD.MM.YYYY" } if Numbers exports German-style dates.
  datasets: [
    {
      id: "dispossession",
      label: "Property dispossession",
      folder: "data-source/dispossession",
      areas: { file: "court_areas.geojson", key: "court", label: "Court cases", unit: "case", matchHint: "court" },
    },
    { id: "damage", label: "Mariupol damage", folder: "data-source/damage" },
  ],

  /* ---------- Colours ----------
   * Keyed by association id. Associations with mode CATEGORY colour the dots and
   * histogram bars; others (FILTER) only appear as filters.
   */
  colors: {
    suspected_ownerless_property: "#e63946",
    court_case: "#1f5fa8", // deeper, more saturated version of the old #457b9d so it reads against the map and the red
    detention: "#f4a261",

    "damage:destroyed": "#c60010",
    "damage:severe_damage": "#f3404f",
    "damage:moderate_damage": "#f88a93",
    "damage:possible_damage": "#f9c4c9",
    "damage:impact_crater_(damage_to_field)": "#d18f7b",
    "damage:impact_crater_(damage_to_road)": "#d18f7b",

    default: "#999999",
  },

  // Categories drawn above all others (with a thin white edge), e.g. court cases over notices.
  drawOnTop: ["court_case"],

  /* ---------- Court areas ----------
   * areaView: start in area view (true) or point view (false). A view below can
   * override it with its own areaView setting.
   * areaColor: the blue of the areas; its opacity grows in proportion to the number
   * of cases shown, from areaOpacity[0] (one case) to areaOpacity[1] (the top of the scale).
   */
  areaView: true,
  areaColor: "#1f5fa8", // same blue as the court-case dots
  areaOpacity: [0.06, 0.85],

  /* ---------- Size and shading scale ----------
   * Dot sizes and area shading share one rule. "fixed" (default): the top of the scale is
   * the most events any dot (or area) has in any period as long as the time window, so
   * sliding the window changes sizes and shading with the counts. "window": the biggest
   * dot / busiest area in the current window always gets the top of the scale.
   */
  scale: "fixed",
  minScaleTop: 25, // the biggest dot never stands for fewer events than this, so sparse data stays small

  /* ---------- Views ----------
   * The buttons at the top of the map. A view sets the camera, the base map and
   * which datasets are switched on, plus the time window. Users can still turn
   * any other dataset on afterwards from the Layers panel.
   * center is [longitude, latitude]; window is [start, end] as YYYY-MM-DD.
   * Optional: areaView: true/false to switch between court areas and points.
   */
  views: [
    {
      id: "dispossession",
      label: "Court Pipeline",
      datasets: ["dispossession"],
      center: [37.8, 47.62],
      zoom: 8,
      bearing: 0,
      pitch: 0,
      basemap: "map",
      window: ["2026-02-01", "2026-08-31"],
    },
    {
      id: "damage",
      label: "Condemnation Pipeline",
      datasets: ["damage"],
      center: [37.6, 47.105],
      zoom: 12.3,
      bearing: 0,
      pitch: 0,
      basemap: "map",
      window: ["2022-03-01", "2022-05-31"],
    },
  ],

  /* ---------- Base maps ---------- */
  basemaps: {
    map: {
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      attribution: "© OpenStreetMap contributors",
      maxzoom: 19,
    },
    satellite: {
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
      attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
      maxzoom: 19,
    },
  },

  /* ---------- Look ---------- */
  eventRadius: 4, // radius of a dot with one event, px
  maxEventRadius: 28, // radius of the biggest dot; a dot's area is proportional to its events, the same scale for every category
  defaultBin: "auto", // histogram bin size: "auto" | "day" | "week" | "month"
};

if (typeof module !== "undefined") module.exports = window.CONFIG;
