// =====================================================================
// MAIN
// Start-up: the shared header and tabs, then each tab on first opening.
// The Monitoring explorer loads the clipped readings and draws a metric.
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
import { initInfoPanel } from "./map/info-panel.js";
import { initClassificationExplorer } from "./classification/explorer.js";
import { initMapExplorer, setMapExplorerPartnership } from "./map-explorer.js";
import { initScorecardsTab, setScorecardsPartnership } from "./scorecards/scorecards-tab.js";
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
let classificationExplorer = null;

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

const classificationMapEl = document.getElementById("clsMap");
const webMapEl = document.getElementById("webMap");
const scorecardsMapEl = document.getElementById("scorecardsMap");
const maps = { map: webMapEl, monitoring: mapEl, classification: classificationMapEl, scorecards: scorecardsMapEl };

async function zoomToSelection() {
  const [Extent] = await $arcgis.import(["@arcgis/core/geometry/Extent.js"]);
  const extent = new Extent(selectedPartnership === null ? areaExtent(area) : partnershipExtent(area, selectedPartnership)).expand(1.1);
  // Rejected if another zoom interrupts it, which is fine.
  for (const map of Object.values(maps)) {
    if (map.ready) map.goTo(extent).catch(() => {});
  }
}

function showError(container, text) {
  const message = el("p", "summary isError", text);
  message.setAttribute("role", "alert");
  container.replaceChildren(message);
}

// Each tab starts the first time it's opened, so a map that's never
// looked at never loads.
const started = new Map();
const TAB_STARTS = {
  map: () => initMapExplorer(webMapEl, document.getElementById("webLayerList"), area).catch((error) => {
    console.error(error);
    document.getElementById("webMapNote").textContent = "The Southern Data Hub map couldn't be loaded. Please refresh the page.";
  }),
  monitoring: () => startMonitoring().catch((error) => {
    console.error(error);
    showError(detailsEl, "The monitoring data couldn't be loaded. Please refresh the page.");
  }),
  scorecards: () => initScorecardsTab({
    mapEl: scorecardsMapEl,
    hintEl: document.getElementById("scorecardsHint"),
    keyEl: document.getElementById("scorecardsKey"),
    sourcesEl: document.getElementById("scorecardSources"),
    deselectEl: document.getElementById("deselectWaterbody"),
    errorAlertEl: document.getElementById("pdfErrorAlert"),
    dates: { periodEl: document.getElementById("scorecardPeriod") },
    health: {
      panelEl: document.getElementById("healthPanel"),
      pdfEl: document.getElementById("healthPdf"),
      coverageEl: document.getElementById("healthCoverage"),
      wheelSvg: document.getElementById("healthWheel"),
      keyEl: document.getElementById("healthKey"),
      detailEl: document.getElementById("healthDetail"),
    },
  }, { catalog, area, waterbodies, partnership: selectedPartnership }).catch((error) => {
    console.error(error);
    document.getElementById("scorecardsHint").textContent = "The scorecards couldn't be loaded. Please refresh the page.";
  }),
  classification: () => {
    classificationExplorer = initClassificationExplorer({
      area,
      elements: {
        mapEl: classificationMapEl,
        modeEl: document.getElementById("clsMode"),
        hintEl: document.getElementById("clsModeHint"),
        optionsEl: document.getElementById("clsModeOptions"),
        listEl: document.getElementById("clsItemList"),
        detailsEl: document.getElementById("clsDetails"),
        infoPanel: document.getElementById("clsInfoPanel"),
        infoBody: document.getElementById("clsInfoBody"),
        layersPanel: document.getElementById("clsLayersPanel"),
        layersAction: document.getElementById("clsLayersAction"),
      },
    });
    classificationExplorer.setPartnership(selectedPartnership);
    return classificationExplorer.show();
  },
};

function startTab(view) {
  if (!started.has(view)) started.set(view, TAB_STARTS[view]());
  return started.get(view);
}

// The tab being left hands its view to the one being opened, so
// switching tabs keeps the same place on the map.
function initViewSwitching() {
  const nav = document.getElementById("viewTabs");
  const views = document.querySelectorAll(".view[data-view]");
  let current = nav.querySelector("calcite-tab-title[selected]").dataset.view;

  nav.addEventListener("calciteTabChange", async () => {
    const selectedTitle = nav.selectedTitle;
    const selected = selectedTitle?.dataset.view;
    if (!selected || selected === current) return;
    // A tab nav on its own never updates each title's selected state.
    nav.querySelectorAll("calcite-tab-title").forEach((title) => { title.selected = title === selectedTitle; });
    views.forEach((view) => { view.hidden = view.dataset.view !== selected; });
    const viewpoint = maps[current].ready ? maps[current].viewpoint?.clone() : null;
    current = selected;
    const target = maps[selected];
    const starting = startTab(selected);
    // A map that's still starting would set its own view on load, so it
    // takes this one after its tab has started.
    if (!target.ready) await starting;
    if (viewpoint && target.ready && current === selected) target.viewpoint = viewpoint;
  });
  nav.addEventListener("pointerdown", () => nav.classList.add("pointerFocus"));
  nav.addEventListener("keydown", () => nav.classList.remove("pointerFocus"));
}

async function startMonitoring() {
  mapEl.basemap = BASEMAP[getTheme()];
  mapEl.addEventListener("pointerdown", () => mapEl.classList.add("pointerFocus"));
  mapEl.addEventListener("keydown", (event) => {
    if (event.key === "Tab") mapEl.classList.remove("pointerFocus");
  });

  // Starts before the map is ready, so the two load side by side.
  const reading = loadReadings(catalog, area, waterbodies);
  mapEl.extent = areaExtent(area);
  mapEl.popupDisabled = true; // clicks open the bottom panel instead
  await mapEl.viewOnReady();
  await initInfoPanel(
    mapEl,
    document.getElementById("infoPanel"),
    document.getElementById("infoBody"),
    document.getElementById("infoPrevious"),
    document.getElementById("infoNext"),
  );

  loaded = await reading;
  const years = availableYears(loaded);
  selectedYear = years.includes(DEFAULT_YEAR) ? DEFAULT_YEAR : null;
  await ensureYearLoaded(catalog, loaded, selectedYear);
  anyYearCounts = countReadings();
  counts = countReadings(currentFilters());
  selectedId = catalog.metrics.find((metric) => counts.get(metric.id) > 0)?.id
    ?? catalog.metrics.find((metric) => anyYearCounts.get(metric.id) > 0)?.id;
  if (!selectedId) throw new Error("No metric has readings in the clip area.");

  updatePicker = renderMetricPicker(listEl, catalog, selectedId, openMetric);
  updatePicker(counts, anyYearCounts, yearText());
  renderYearFilter(document.getElementById("yearSelect"), years, selectedYear, selectYear);

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

// Shared by every tab: theme, the catalogue and clip area, the header's
// partnership filter and tab switching. Then the first tab starts.
async function start() {
  initTheme(document.getElementById("themeToggle"));
  catalog = await loadCatalog();
  [area, waterbodies] = await Promise.all([loadClipArea(catalog), loadWaterbodies(catalog)]);

  renderPartnershipFilter(document.getElementById("partnershipSelect"), area.partnerships.map((partnership) => partnership.name), (name) => {
    selectedPartnership = name;
    if (updatePicker) applyFilters(); // the monitoring explorer, once started
    classificationExplorer?.setPartnership(name);
    setMapExplorerPartnership(name);
    setScorecardsPartnership(name);
    zoomToSelection();
  });
  initViewSwitching();
  startTab(document.querySelector("#viewTabs calcite-tab-title[selected]").dataset.view);
}

start().catch((error) => {
  console.error(error);
  showError(detailsEl, "The hub couldn't be loaded. Please refresh the page.");
  document.getElementById("webMapNote").textContent = "The hub couldn't be loaded. Please refresh the page.";
});
