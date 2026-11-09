// =====================================================================
// MAIN
// Start-up: load the catalogue and the clipped readings, build the
// filters, draw the first metric.
// =====================================================================

import { loadCatalog, loadClipArea, loadWaterbodies, sourcesFor } from "./catalog.js";
import { getTheme, initTheme, onThemeChange } from "./theme.js";
import { availableYears, ensureYearLoaded, loadReadings, readingsFor } from "./data/readings-store.js";
import { renderMetricPicker } from "./ui/metric-picker.js";
import { renderYearFilter } from "./ui/year-filter.js";
import { renderPartnershipFilter, shortPartnershipName } from "./ui/partnership-filter.js";
import { openDataSources } from "./ui/data-sources-panel.js";
import { renderDetails } from "./ui/details-panel.js";
import { countInView, showMetric, syncDetailLayers } from "./map/metric-layers.js";
import { areaExtent, partnershipExtent } from "./map/extents.js";
import { fillVisibleHexagons } from "./map/summary-layers.js";
import { setupLayersPanel } from "./map/layers-panel.js";
import { el } from "./dom.js";

const BASEMAP = { dark: "dark-gray-vector", light: "gray-vector" };
const DEFAULT_YEAR = 2026;

const mapEl = document.getElementById("map");
const detailsEl = document.getElementById("details");
const listEl = document.getElementById("metricList");

let catalog;
let area;
let waterbodies;
let loaded;
let counts;
let anyYearCounts;
let selectedId;
let selectedYear; // null means all years
let selectedPartnership = null; // null means all partnerships
const disabledDatasets = new Set(); // ids of datasets switched off
let updateSourcesPanel = null; // set while the data sources view is open
let latestRequest = 0;
let setCounts;
let viewTimer;
let levelTimer;
let updatePicker;

const yearText = () => (selectedYear === null ? "across all years" : `in ${selectedYear}`);

function clipNote() {
  if (selectedPartnership === null) return `Only readings inside the ${area.partnerships.length} CaBA partnerships are shown.`;
  return `Showing ${shortPartnershipName(selectedPartnership)} only. A waterbody belongs to the partnership its centre falls in, and its readings go with it.`;
}

const isEnabled = ({ dataset }) => !disabledDatasets.has(dataset.id);
const currentFilters = () => ({ year: selectedYear, partnership: selectedPartnership });
const readingCount = (source, filters) => readingsFor(loaded, source, catalog.conventions, filters).length;

function countReadings(filters) {
  return new Map(catalog.metrics.map((metric) => [
    metric.id,
    sourcesFor(catalog, metric.id).filter(isEnabled).reduce((sum, source) => sum + readingCount(source, filters), 0),
  ]));
}

// Every dataset with this metric in the area, switched on or off.
const sourcesInArea = (metricId) => sourcesFor(catalog, metricId).filter((source) => readingCount(source) > 0);

// Whether a dataset has this metric in the selected partnership, in any year.
const isInPartnership = (source) =>
  selectedPartnership === null || readingCount(source, { partnership: selectedPartnership }) > 0;

// The datasets to draw this metric from.
const activeSources = (metricId) => sourcesInArea(metricId).filter(isEnabled).filter(isInPartnership);

const noDataHere = (metric) => `No data sources hold ${metric.label} in ${shortPartnershipName(selectedPartnership)}.`;

function noSourcesNote(metric) {
  return sourcesInArea(metric.id).some(isInPartnership)
    ? "All data sources for this determinand are switched off."
    : noDataHere(metric);
}

function sourceRows(metricId) {
  return sourcesInArea(metricId).map((source) => {
    const count = readingCount(source, currentFilters());
    return {
      id: source.dataset.id,
      label: source.dataset.label,
      description: count ? `${count.toLocaleString("en-GB")} reading${count === 1 ? "" : "s"}` : `No readings ${yearText()}`,
      enabled: isEnabled(source),
      available: isInPartnership(source),
    };
  });
}

function openMetric(id) {
  if (updateSourcesPanel) return; // already moved on to a data sources view
  const changed = id !== selectedId;
  selectedId = id;
  const metric = catalog.metrics.find((candidate) => candidate.id === id);
  updateSourcesPanel = openDataSources(document.getElementById("pickerFlow"), {
    metric,
    rows: sourceRows(id),
    emptyText: () => noDataHere(metric),
    onToggle: (datasetId, enabled) => {
      if (enabled) disabledDatasets.delete(datasetId);
      else disabledDatasets.add(datasetId);
      applyFilters();
    },
    onClose: () => { updateSourcesPanel = null; },
  });
  if (changed) draw();
}

async function draw() {
  const request = ++latestRequest;
  const metric = catalog.metrics.find((candidate) => candidate.id === selectedId);
  const sources = activeSources(metric.id);
  const theme = getTheme();
  const summaries = await showMetric(mapEl, {
    catalog,
    loaded,
    metric,
    sources,
    theme,
    year: selectedYear,
    partnership: selectedPartnership,
    waterbodies,
  });
  if (request !== latestRequest) return;
  setCounts = renderDetails(detailsEl, {
    metric,
    sources,
    theme,
    conventions: catalog.conventions,
    clipNote: clipNote(),
    noSourcesNote: noSourcesNote(metric),
    yearText: yearText(),
    summaries,
  });
  await refreshCounts(request);
}

async function refreshCounts(request) {
  const inView = await countInView(mapEl).catch((error) => {
    console.error("Could not count readings in view", error);
    return null;
  });
  // A slow count must not overwrite the panel of a newer pick.
  if (request === latestRequest) setCounts(counts.get(selectedId), inView);
}

// A filter or data source changed: recount, then redraw.
function applyFilters() {
  anyYearCounts = countReadings();
  counts = countReadings(currentFilters());
  updatePicker(counts, anyYearCounts, yearText());
  updateSourcesPanel?.(sourceRows(selectedId));
  draw();
}

// A year's files are only fetched when it's first chosen.
async function selectYear(year) {
  selectedYear = year;
  const summary = detailsEl.querySelector(".summary");
  if (summary) summary.textContent = "Loading readings…";
  try {
    await ensureYearLoaded(catalog, loaded, year);
  } catch (error) {
    console.error(error);
    if (summary) summary.textContent = "Couldn't load that year's Environment Agency data. Please try again.";
    return;
  }
  if (year === selectedYear) applyFilters(); // a newer choice replaces this one
}

async function zoomToSelection() {
  const [Extent] = await $arcgis.import(["@arcgis/core/geometry/Extent.js"]);
  const extent = new Extent(selectedPartnership === null ? areaExtent(area) : partnershipExtent(area, selectedPartnership));
  // Rejected if another zoom interrupts it, which is fine.
  mapEl.goTo(extent.expand(1.1)).catch(() => {});
}

async function start() {
  initTheme(document.getElementById("themeToggle"));
  mapEl.basemap = BASEMAP[getTheme()];
  mapEl.addEventListener("pointerdown", () => mapEl.classList.add("pointerFocus"));
  mapEl.addEventListener("keydown", (event) => {
    if (event.key === "Tab") mapEl.classList.remove("pointerFocus");
  });

  catalog = await loadCatalog();
  [area, waterbodies] = await Promise.all([loadClipArea(catalog), loadWaterbodies(catalog)]);
  // Starts before the map is ready, so the two load side by side.
  const reading = loadReadings(catalog, area, waterbodies);

  mapEl.extent = areaExtent(area);
  await mapEl.viewOnReady();
  // Dock the pop-up when the map is narrow or short, so it isn't cut off.
  mapEl.popup.dockOptions = { ...mapEl.popup.dockOptions, breakpoint: { width: 544, height: 480 } };

  loaded = await reading;
  const years = availableYears(loaded);
  selectedYear = years.includes(DEFAULT_YEAR) ? DEFAULT_YEAR : null;
  await ensureYearLoaded(catalog, loaded, selectedYear);
  anyYearCounts = countReadings();
  counts = countReadings({ year: selectedYear });
  selectedId = catalog.metrics.find((metric) => counts.get(metric.id) > 0)?.id
    ?? catalog.metrics.find((metric) => anyYearCounts.get(metric.id) > 0)?.id;
  if (!selectedId) throw new Error("No metric has readings in the clip area.");

  updatePicker = renderMetricPicker(listEl, catalog, selectedId, openMetric);
  updatePicker(counts, anyYearCounts, yearText());

  renderYearFilter(document.getElementById("yearSelect"), years, selectedYear, selectYear);
  renderPartnershipFilter(document.getElementById("partnershipSelect"), area.partnerships.map((partnership) => partnership.name), (name) => {
    selectedPartnership = name;
    applyFilters();
    zoomToSelection();
  });

  onThemeChange((theme) => {
    mapEl.basemap = BASEMAP[theme];
    draw();
  });
  await draw();

  // Rivers go at the bottom, behind all the metric layers. A failure
  // here shouldn't take the monitoring data down with it.
  setupLayersPanel(
    mapEl,
    document.getElementById("layersPanel"),
    document.getElementById("layersAction"),
    0,
  ).catch((error) => console.error("Could not set up map layers", error));

  mapEl.addEventListener("arcgisViewChange", () => {
    // Short wait, so a fast zoom doesn't prepare every level it passes.
    clearTimeout(levelTimer);
    levelTimer = setTimeout(() => {
      fillVisibleHexagons(mapEl.scale);
      syncDetailLayers(mapEl);
    }, 100);
    // Recount once the map has settled after a pan or zoom.
    clearTimeout(viewTimer);
    viewTimer = setTimeout(() => refreshCounts(latestRequest), 400);
  });
}

start().catch((error) => {
  console.error(error);
  const message = el("p", "summary isError", "The monitoring data couldn't be loaded. Please refresh the page.");
  message.setAttribute("role", "alert");
  detailsEl.replaceChildren(message);
});
