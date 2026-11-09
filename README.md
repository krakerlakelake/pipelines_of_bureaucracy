# Ukraine Time Map (rewrite)

A lighter rebuild of the Forensic Architecture timemap for this project. It needs no
datasheet-server and no npm install: the spreadsheet exports are turned into one data
file, and the page draws everything with WebGL, so tens of thousands of events stay smooth.

## Running it

**Mac:** double-click `start.command`. (The first time, right-click → Open to get past
Gatekeeper.) It rebuilds the data and opens http://localhost:8080.

**Any system:**
```
node build-data.js     # after changing the CSVs or the datasets in config.js
node serve.js          # then open http://localhost:8080
```
Node is the only requirement, the same Node you used for the old timemap. Map tiles
are fetched from the internet; everything else is local.

## Updating the data

1. In Numbers, export the spreadsheet as CSV (File → Export To → CSV…).
2. Put the export's `EXPORT_EVENTS`, `EXPORT_ASSOCIATIONS` and (optionally) `EXPORT_SOURCES`
   CSVs into the dataset's folder, e.g. `data-source/dispossession/`. Numbers' file names such as
   `EXPORT_EVENTS-Table 1.csv` are fine. Other CSVs in the folder are ignored.
3. Run `node build-data.js` (or double-click `start.command`).

The build prints a short report: the date range it read (to catch day/month swaps), and any
rows skipped for unreadable dates or missing coordinates, with their spreadsheet row numbers.

**Event columns:** `description`, `date`, `location`, `latitude`, `longitude`, then any number of
`association…` columns and `source…` columns. An optional `time` column (hh:mm) is also read.
**Any other column you add (e.g. `comments`) appears in the event popup automatically.**

## Where things are

| To change… | Edit |
|---|---|
| Title, colours, views (camera, base map, time window), dataset folders | `config.js` |
| Fonts, colours of the interface, sizes | `css/style.css` (variables at the top) |
| How data is loaded and filtered | `js/store.js` |
| The map and dots | `js/map.js` |
| The histogram / time window | `js/histogram.js` |
| Panels, popups, buttons, keyboard shortcuts | `js/panels.js` |
| CSV → data conversion | `build-data.js` |

`lib/` holds MapLibre GL and deck.gl (open source, MIT/BSD licences included); you don't need
to touch it.

## Filter rules

* **Categories** (associations with mode `CATEGORY`) colour the dots and bars. An event stays
  visible while *any* of its categories is ticked, so events in several categories behave as you'd expect.
* **Other associations** (mode `FILTER`) are grouped by `filter_path0`. An event is hidden only when
  all of its associations in a group are unticked.
* Events with no category are listed as **Uncategorised**, so nothing silently disappears.

