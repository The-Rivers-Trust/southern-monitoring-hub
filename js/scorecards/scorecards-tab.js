// =====================================================================
// SCORECARDS TAB
// Ported from the National River Survey dashboard. The hub's waterbodies
// and the NRS survey sites in them. Click a waterbody for its Catchment
// Health scorecard (right-hand panel, built by waterbody-data.js, with a
// PDF download): the 8-theme wheel; click a theme's inner wedge for
// what's behind its score. While a waterbody is selected it's filled with
// its overall rating, sites outside it are greyed, and its Riverfly
// samples, storm overflow outfalls, delivered NBS interventions and river
// network (clipped to the boundary) are drawn. The scorecard follows the
// date range in its panel; the header's partnership only affects which
// waterbodies and sites are shown.
//
// Differences from the NRS dashboard: the organisation filter is the
// hub's partnership filter, the date range lives in the panel, and the
// waterbodies are the hub's own exact local shapes (the same EA layer),
// so no generalised-then-exact geometry swap is needed.
// =====================================================================

import { NRS, MAP, SCORECARD_SOURCES, SCORECARD_COLORS, HUB_SOURCE_SYMBOLS, RIVER_NETWORK, STORM_OVERFLOW_GLYPH } from "./config.js";
import { getMetric, useCatalog } from "./metrics.js";
import { getTheme, onThemeChange } from "../theme.js";
import { dateRangeDescription, initDateRange, onDateRangeChange } from "./date-range.js";
import { fetchEquipment, getLayer } from "./nrs-service.js";
import { computeScorecard, RIVERFLY_ASSESSED, riverflyWhere } from "./waterbody-data.js";
import { bandForRank, catchmentHealthRanks, catchmentHealthOverallRank } from "./ratings.js";
import { BREAKDOWNS, breakdownRows, isSignsLine, subDetailLines, subSourceLines } from "./scorecard-text.js";
import { renderCatchmentHealthWheel, renderRatingLegend } from "./charts/wheels.js";
import { renderBarChart, bucketGranularity } from "./charts/bar-chart.js";
import { loadJsPdf, safeFileName } from "./pdf-common.js";
import { buildCatchmentHealthPdf } from "./pdf-catchment-health.js";
import { escapeHtml, escapeSql, hexToRgbArray } from "./format.js";
import { areaExtent } from "../map/extents.js";
import { ensureYearLoaded, loadReadings } from "../data/readings-store.js";
import { checkSources, hubSites, loadScorecardSources, siteGroupDistance, useHubSources, usesSource } from "./hub-sources.js";
import { renderSourcesPanel } from "./sources-panel.js";
import { renderGuide } from "./guide.js";
import { hubCatalog, scorecardFile } from "./hub-sources.js";
import { useRules } from "./rules.js";
import { METRICS } from "./config.js";

const WATERBODY_OUTLINE = { dark: [230, 229, 220, 0.75], light: [35, 33, 28, 0.7] };

const state = {
  els: null,
  mapEl: null,
  layers: {},
  modules: {},
  waterbodies: new Map(), // id -> { id, name, partnership, geometry }
  partnership: null,
  equipmentRanges: {},
  selected: null, // { attrs, geometry } of the selected waterbody
  scorecard: null,
  requests: { scorecard: 0, riverfly: 0, rivers: 0, nbs: 0, hubSites: 0 },
  healthSelectedPath: null,
  // What's drawn for the selected waterbody, for the map key.
  shown: { sites: 0, riverfly: 0, outfalls: 0, nbs: 0, hub: [] },
};

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function waterbodyRenderer(theme = getTheme()) {
  return {
    type: "simple",
    symbol: { type: "simple-fill", color: [0, 0, 0, 0], outline: { color: WATERBODY_OUTLINE[theme], width: 0.8 } },
  };
}

export async function initScorecardsTab(els, { catalog, area, waterbodies, partnership }) {
  state.els = els;
  state.mapEl = els.mapEl;
  state.partnership = partnership;
  useCatalog(catalog);
  // The hub's readings, for the datasets data/scorecard.json
  // lists. Shared with the Monitoring explorer, so only loaded once.
  const hubData = prepareHubSources(catalog, area, waterbodies);
  state.hubData = hubData.catch((error) => console.error("Scorecards: the hub's own datasets couldn't be loaded:", error));
  renderRatingLegend(els.health.keyEl);
  renderHealthWheel();
  initDateRange(els.dates);
  // Ready before the map is, so an early click isn't lost.
  els.guide.openEls.forEach((button) => button.addEventListener("click", openGuide));

  const { mapEl } = els;
  mapEl.basemap = MAP.basemap[getTheme()];
  mapEl.extent = areaExtent(area);
  mapEl.addEventListener("pointerdown", () => mapEl.classList.add("pointerFocus"));
  mapEl.addEventListener("keydown", (event) => {
    if (event.key === "Tab") mapEl.classList.remove("pointerFocus");
  });
  await mapEl.viewOnReady();

  const [FeatureLayer, GraphicsLayer, Graphic, Polygon, intersectionOperator, reactiveUtils] = await $arcgis.import([
    "@arcgis/core/layers/FeatureLayer.js",
    "@arcgis/core/layers/GraphicsLayer.js",
    "@arcgis/core/Graphic.js",
    "@arcgis/core/geometry/Polygon.js",
    "@arcgis/core/geometry/operators/intersectionOperator.js",
    "@arcgis/core/core/reactiveUtils.js",
  ]);
  state.modules = { Graphic, intersectionOperator, reactiveUtils };

  // The hub's waterbodies, exactly as supplied.
  const source = waterbodies.map((waterbody, index) => {
    const geometry = new Polygon({ rings: waterbody.rings, spatialReference: { wkid: 4326 } });
    state.waterbodies.set(waterbody.id, { ...waterbody, geometry });
    return new Graphic({
      geometry,
      attributes: { ObjectID: index + 1, water_body_id: waterbody.id, water_body_name: waterbody.name, partnership: waterbody.partnership },
    });
  });

  const marker = (color, size) => ({ type: "simple-marker", style: "circle", color, size, outline: { color: "#ffffff", width: 1 } });
  const L = state.layers;
  L.waterbodies = new FeatureLayer({
    source,
    objectIdField: "ObjectID",
    fields: [
      { name: "ObjectID", type: "oid" },
      { name: "water_body_id", type: "string" },
      { name: "water_body_name", type: "string" },
      { name: "partnership", type: "string" },
    ],
    geometryType: "polygon",
    spatialReference: { wkid: 4326 },
    outFields: ["*"],
    popupEnabled: false,
    renderer: waterbodyRenderer(),
    title: "WFD waterbodies",
  });
  L.highlight = new GraphicsLayer({ listMode: "hide" });
  L.rivers = new GraphicsLayer({ title: RIVER_NETWORK.title });
  L.pollution = new FeatureLayer({
    url: SCORECARD_SOURCES.pollutionUrl,
    outFields: ["siteNameEA", "siteNameWASC", "waterCompanyName", "totalDurationAllSpillsHrs", "countedSpills"],
    definitionExpression: "1 = 0",
    visible: false,
    renderer: { type: "simple", symbol: glyphSymbol(STORM_OVERFLOW_GLYPH, 20) },
    popupTemplate: {
      title: "{siteNameEA}",
      content: "{waterCompanyName}<br>{totalDurationAllSpillsHrs} hours spilled in 2025 ({countedSpills} spills)",
    },
    title: "Storm overflow outfalls (2025)",
  });
  L.riverfly = new FeatureLayer({
    url: SCORECARD_SOURCES.riverflyUrl,
    outFields: ["breachType", "breach", "timestamp", "river", "site"],
    definitionExpression: "1 = 0",
    visible: false,
    renderer: { type: "simple", symbol: marker(SCORECARD_COLORS.riverfly, 7) },
    popupTemplate: { title: "Riverfly: {site}", content: "{river}<br>Breach: {breachType}" },
    title: "Riverfly monitoring (2026)",
  });
  L.nbs = new GraphicsLayer({ title: "Nature-Based Solutions (delivered)" });
  L.hubSites = new GraphicsLayer({ title: "Monitoring sites (data/scorecard.json)" });
  L.sites = new FeatureLayer({
    url: NRS.locationsUrl,
    outFields: ["GlobalID", "location_name", "water_body_id"],
    definitionExpression: "1 = 0",
    popupEnabled: false,
    renderer: sitesRenderer(null),
    title: "Survey sites",
  });
  // Sites always on top - they're the point of the map.
  mapEl.map.addMany([L.waterbodies, L.highlight, L.rivers, L.pollution, L.riverfly, L.nbs, L.hubSites, L.sites]);

  mapEl.addEventListener("arcgisViewClick", (event) => handleMapClick(event.detail));
  els.deselectEl.addEventListener("click", deselect);
  els.health.panelEl.addEventListener("calcitePanelClose", deselect);
  els.health.pdfEl.addEventListener("click", downloadPdf);

  onDateRangeChange(() => {
    if (!state.selected) return;
    applyRiverflyFilter();
    applyHubSites();
    refreshScorecard();
  });
  onThemeChange(handleThemeChange);
  fetchEquipment().then(({ rangeByMetric }) => { state.equipmentRanges = rangeByMetric; });

  applyPartnership();
  await hubData;
}

// The data and thresholds guide, built fresh each time from the files,
// so it reflects the current rules and period.
async function openGuide() {
  const { dialogEl, bodyEl } = state.els.guide;
  bodyEl.innerHTML = `<p class="summary">Loading…</p>`;
  dialogEl.open = true;
  await state.hubData;
  const file = scorecardFile();
  if (!file) {
    bodyEl.innerHTML = `<p class="summary isError">The scorecard settings couldn't be loaded.</p>`;
    return;
  }
  renderGuide(bodyEl, { file, catalog: hubCatalog() });
}

// The sources panel, redrawn only when what's available changes, so
// ticking a box doesn't jump its scroll position.
function updateSourcesPanel() {
  const { sourcesEl } = state.els;
  const available = `${dateRangeDescription()}|${JSON.stringify(state.scorecard.available)}`;
  if (sourcesEl.dataset.available === available && sourcesEl.dataset.waterbody === state.selected.attrs.water_body_id) return;
  sourcesEl.dataset.available = available;
  sourcesEl.dataset.waterbody = state.selected.attrs.water_body_id;
  renderSourcesPanel(sourcesEl, {
    available: state.scorecard.available,
    waterbodyName: state.selected.attrs.water_body_name || "this waterbody",
    periodText: dateRangeDescription(),
    onChange: handleSourcesChange,
  });
}

// A tick box in the sources panel changed: redraw what it feeds.
function handleSourcesChange() {
  applySitesVisibility();
  if (!state.selected) return;
  applyRiverflyFilter();
  applyHubSites();
  applyNbsPoints();
  refreshScorecard();
}

// NRS sites are shown while NRS feeds any measure.
function applySitesVisibility() {
  const measures = ["phosphate", "nitrate", "nitrite", "ammonia", "turbidity", "conductivity", "wildlife", "invasives"];
  state.layers.sites.visible = measures.some((key) => usesSource(key, "national_river_survey"));
  if (state.selected) applyPollutionFilter(); // recounts sites for the key
}

async function prepareHubSources(catalog, area, waterbodies) {
  const [sources, loaded] = await Promise.all([loadScorecardSources(), loadReadings(catalog, area, waterbodies)]);
  const metricIds = Object.fromEntries(METRICS.map((metric) => [metric.key, metric.catalogId]));
  [...useRules(sources), ...checkSources(sources, catalog, metricIds)]
    .forEach((problem) => console.warn(`data/scorecard.json: ${problem}`));
  // A dataset kept in yearly files needs every year for the date range.
  const listed = new Set(Object.values(sources.measures).flatMap((measure) => measure.sources.map((source) => source.dataset)));
  if (catalog.datasets.some((dataset) => listed.has(dataset.id) && dataset.source)) await ensureYearLoaded(catalog, loaded, null);
  useHubSources(catalog, loaded, sources);
}

function glyphSymbol(glyph, size) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><text x="16" y="23" font-size="24" `
    + `font-family="Arial, &apos;Segoe UI Emoji&apos;, &apos;Noto Color Emoji&apos;, sans-serif" text-anchor="middle">${glyph}</text></svg>`;
  return { type: "picture-marker", url: `data:image/svg+xml,${encodeURIComponent(svg)}`, width: size, height: size };
}

// ---------------------------------------------------------------------
// Partnership: which waterbodies, and so which survey sites, are shown
// ---------------------------------------------------------------------

export function setScorecardsPartnership(name) {
  state.partnership = name;
  if (!state.layers.waterbodies) return; // picked up when the tab starts
  if (state.selected && name !== null && state.selected.attrs.partnership !== name) deselect();
  applyPartnership();
}

function applyPartnership() {
  const { waterbodies, sites } = state.layers;
  const name = state.partnership;
  waterbodies.definitionExpression = name === null ? null : `partnership = '${escapeSql(name)}'`;
  const ids = [...state.waterbodies.values()]
    .filter((waterbody) => name === null || waterbody.partnership === name)
    .map((waterbody) => `'${escapeSql(waterbody.id)}'`);
  sites.definitionExpression = ids.length ? `water_body_id IN (${ids.join(", ")})` : "1 = 0";
}

function sitesRenderer(waterBodyId) {
  const inside = { type: "simple-marker", style: "circle", color: SCORECARD_COLORS.site, size: 11, outline: { color: "#ffffff", width: 1 } };
  if (!waterBodyId) return { type: "simple", symbol: inside };
  return {
    type: "unique-value",
    valueExpression: `IIf($feature.water_body_id == '${String(waterBodyId).replace(/'/g, "\\'")}', "in", "out")`,
    uniqueValueInfos: [{ value: "in", label: "In selected waterbody", symbol: inside }],
    defaultSymbol: { ...inside, color: SCORECARD_COLORS.siteMuted, size: 9 },
    defaultLabel: "Other waterbodies",
  };
}

// ---------------------------------------------------------------------
// Selecting a waterbody
// ---------------------------------------------------------------------

async function handleMapClick(clickEvent) {
  const response = await state.mapEl.hitTest(clickEvent, { include: [state.layers.waterbodies] });
  const graphic = response.results.find((r) => r.graphic?.layer === state.layers.waterbodies)?.graphic;
  // A click on a point inside the selected waterbody opens its pop-up only.
  if (graphic && graphic.attributes.water_body_id !== state.selected?.attrs.water_body_id) selectWaterbody(graphic.attributes);
}

function selectWaterbody(attrs) {
  const { els } = state;
  const waterbody = state.waterbodies.get(attrs.water_body_id);
  state.selected = { attrs, geometry: waterbody.geometry };
  state.scorecard = null;
  state.shown = { sites: 0, riverfly: 0, outfalls: 0, nbs: 0, hub: [] };
  els.health.panelEl.hidden = false;
  els.health.panelEl.closed = false;
  els.sourcesEl.hidden = false;
  els.sourcesEl.dataset.available = "";
  els.sourcesEl.innerHTML = `<p class="summary">Finding the data for this waterbody…</p>`;
  els.deselectEl.hidden = false;
  els.hintEl.hidden = true;
  els.health.panelEl.description = attrs.water_body_name || "Unnamed waterbody";
  state.mapEl.goTo(waterbody.geometry).catch(() => {});

  state.layers.sites.renderer = sitesRenderer(attrs.water_body_id);
  applyPollutionFilter();
  applyGeometryLayers();
  updateHighlight();
  refreshScorecard();
}

function deselect() {
  const { els, layers } = state;
  state.selected = null;
  state.scorecard = null;
  state.shown = { sites: 0, riverfly: 0, outfalls: 0, nbs: 0, hub: [] };
  renderKey();
  Object.keys(state.requests).forEach((k) => { state.requests[k]++; });
  els.health.panelEl.hidden = true;
  els.sourcesEl.hidden = true;
  els.deselectEl.hidden = true;
  els.hintEl.hidden = false;
  layers.sites.renderer = sitesRenderer(null);
  layers.highlight.removeAll();
  applyPollutionFilter();
  applyGeometryLayers();
  renderHealthWheel();
}

// The selected waterbody filled with its overall rating (an outline only
// while there's no rating to show).
function updateHighlight() {
  const { highlight } = state.layers;
  highlight.removeAll();
  if (!state.selected) return;
  const band = bandForRank(catchmentHealthOverallRank(state.scorecard));
  const symbol = band
    ? { type: "simple-fill", color: hexToRgbArray(band.color, 0.55), outline: { color: band.color, width: 2.5 } }
    : { type: "simple-fill", color: [0, 0, 0, 0], outline: { color: cssVar("--calcite-color-text-2"), width: 3.5 } };
  highlight.add(new state.modules.Graphic({ geometry: state.selected.geometry, symbol }));
}

// ---------------------------------------------------------------------
// Layers scoped to the selected waterbody
// ---------------------------------------------------------------------

function applyPollutionFilter() {
  const id = state.selected?.attrs.water_body_id;
  state.layers.pollution.definitionExpression = id ? `wfdWaterbodyID = '${escapeSql(id)}'` : "1 = 0";
  state.layers.pollution.visible = !!id;
  countForKey("outfalls", id ? state.layers.pollution.queryFeatureCount({ where: `wfdWaterbodyID = '${escapeSql(id)}'` }) : 0);
  countForKey("sites", id && state.layers.sites.visible ? state.layers.sites.queryFeatureCount({ where: `water_body_id = '${escapeSql(id)}'` }) : 0);
}

// ---------------------------------------------------------------------
// Map key: one row per kind of mark drawn for the selected waterbody
// ---------------------------------------------------------------------

async function countForKey(name, count) {
  const id = state.selected?.attrs.water_body_id;
  const value = await Promise.resolve(count).catch(() => 0);
  if (state.selected?.attrs.water_body_id !== id) return;
  state.shown[name] = value;
  renderKey();
}

function markerSvg({ style, color, outline, size }) {
  const half = 7;
  const r = size / 2;
  const shape = {
    circle: `<circle cx="${half}" cy="${half}" r="${r}"/>`,
    square: `<rect x="${half - r}" y="${half - r}" width="${size}" height="${size}"/>`,
    diamond: `<rect x="${half - r * 0.75}" y="${half - r * 0.75}" width="${size * 0.75}" height="${size * 0.75}" transform="rotate(45 ${half} ${half})"/>`,
    triangle: `<polygon points="${half},${half - r} ${half + r},${half + r} ${half - r},${half + r}"/>`,
    x: `<path d="M${half - r} ${half - r}L${half + r} ${half + r}M${half + r} ${half - r}L${half - r} ${half + r}" stroke-width="2.5"/>`,
  }[style];
  return `<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><g fill="${color}" stroke="${outline}" stroke-width="1">${shape}</g></svg>`;
}

function renderKey() {
  const { keyEl } = state.els;
  if (!state.selected) {
    keyEl.hidden = true;
    return;
  }
  const { shown } = state;
  const rows = [];
  const row = (swatch, label) => rows.push(`<li>${swatch}<span>${escapeHtml(label)}</span></li>`);
  if (shown.sites) row(markerSvg({ style: "circle", color: SCORECARD_COLORS.site, outline: "#ffffff", size: 10 }), "National River Survey sites");
  for (const source of shown.hub) row(markerSvg(HUB_SOURCE_SYMBOLS[source.dataset] ?? HUB_SOURCE_SYMBOLS.fallback), `${source.name} sites`);
  if (shown.riverfly) row(markerSvg({ style: "circle", color: SCORECARD_COLORS.riverfly, outline: "#ffffff", size: 7 }), "Riverfly samples");
  if (shown.nbs) row(markerSvg({ style: "circle", color: SCORECARD_COLORS.nbs, outline: "#ffffff", size: 8 }), "Delivered NBS interventions");
  if (shown.outfalls) row(`<span class="mapKeyGlyph" aria-hidden="true">${STORM_OVERFLOW_GLYPH}</span>`, "Storm overflow outfalls (2025)");
  keyEl.innerHTML = rows.length ? `<ul>${rows.join("")}</ul>` : "";
  keyEl.hidden = !rows.length;
}

function applyGeometryLayers() {
  applyRiverflyFilter();
  applyHubSites();
  applyClippedRivers();
  applyNbsPoints();
}

// Confirmed breaches and clean samples inside the polygon, in range. No
// join key, so the matching ids are looked up spatially first.
async function applyRiverflyFilter() {
  const layer = state.layers.riverfly;
  const request = ++state.requests.riverfly;
  if (!state.selected) {
    layer.visible = false;
    layer.definitionExpression = "1 = 0";
    return;
  }
  await state.hubData; // the Riverfly start date is in data/scorecard.json
  if (request !== state.requests.riverfly || !state.selected) return;
  if (!usesSource("invertebrates", "riverfly")) {
    layer.visible = false;
    layer.definitionExpression = "1 = 0";
    countForKey("riverfly", 0);
    return;
  }
  const where = riverflyWhere(RIVERFLY_ASSESSED);
  try {
    const ids = await layer.queryObjectIds({ where, geometry: state.selected.geometry, spatialRelationship: "intersects" });
    if (request !== state.requests.riverfly) return;
    layer.definitionExpression = ids.length ? `${where} AND ${layer.objectIdField} IN (${ids.join(",")})` : "1 = 0";
    layer.visible = true;
    countForKey("riverfly", ids.length);
  } catch (error) {
    if (request !== state.requests.riverfly) return;
    console.error("Scorecards: Riverfly samples couldn't be scoped to the waterbody:", error);
    layer.visible = false;
  }
}

// The river network cut exactly at the waterbody boundary (an intersects
// filter alone would leave ends sticking out), Strahler-width lines.
async function applyClippedRivers() {
  const layer = state.layers.rivers;
  const request = ++state.requests.rivers;
  layer.removeAll();
  if (!state.selected) return;
  const boundary = state.selected.geometry;
  try {
    const network = await getLayer(RIVER_NETWORK.url);
    const result = await network.queryFeatures({
      where: "1=1",
      geometry: boundary,
      spatialRelationship: "intersects",
      outFields: ["Strahler"],
      returnGeometry: true,
      outSpatialReference: boundary.spatialReference,
    });
    if (request !== state.requests.rivers) return;
    const { Graphic, intersectionOperator } = state.modules;
    const graphics = result.features.map((f) => {
      const clipped = intersectionOperator.execute(f.geometry, boundary);
      return clipped ? new Graphic({
        geometry: clipped,
        symbol: { type: "simple-line", color: RIVER_NETWORK.color, width: strahlerWidth(f.attributes.Strahler), cap: "round", join: "round" },
      }) : null;
    }).filter(Boolean);
    if (request === state.requests.rivers) layer.addMany(graphics);
  } catch (error) {
    if (request === state.requests.rivers) console.error("Scorecards: river network couldn't be clipped to the waterbody:", error);
  }
}

function strahlerWidth(strahler) {
  const stops = RIVER_NETWORK.widthByStrahler;
  if (typeof strahler !== "number" || strahler <= stops[0].value) return stops[0].size;
  for (let i = 0; i < stops.length - 1; i++) {
    if (strahler <= stops[i + 1].value) {
      const t = (strahler - stops[i].value) / (stops[i + 1].value - stops[i].value);
      return stops[i].size + t * (stops[i + 1].size - stops[i].size);
    }
  }
  return stops[stops.length - 1].size;
}

// Sites of the hub's own datasets (data/scorecard.json) with a
// reading in the waterbody in the period: white squares, so they read
// as neither a rating nor another dataset. Waits for the hub's data.
async function applyHubSites() {
  const layer = state.layers.hubSites;
  const request = ++state.requests.hubSites;
  layer.removeAll();
  if (!state.selected) return;
  await state.hubData;
  if (request !== state.requests.hubSites || !state.selected) return;
  const metricIds = Object.fromEntries(METRICS.map((metric) => [metric.key, metric.catalogId]));
  const { Graphic } = state.modules;
  const sites = hubSites(state.selected.attrs.water_body_id, metricIds);
  const datasets = new Map(sites.map((site) => [site.dataset, { dataset: site.dataset, name: site.name }]));
  countForKey("hub", [...datasets.values()]);
  const symbolFor = (dataset) => {
    const { style, color, outline, size } = HUB_SOURCE_SYMBOLS[dataset] ?? HUB_SOURCE_SYMBOLS.fallback;
    return { type: "simple-marker", style, color, size, outline: { color: style === "x" ? color : outline, width: style === "x" ? 2.5 : 1 } };
  };
  layer.addMany(sites.map((site) => new Graphic({
    geometry: { type: "point", x: site.lon, y: site.lat, spatialReference: { wkid: 4326 } },
    symbol: symbolFor(site.dataset),
    popupTemplate: {
      title: `${site.name}: ${site.site}`,
      content: `${site.samples} sample${site.samples === 1 ? "" : "s"} in ${escapeHtml(dateRangeDescription())}<br>Measures: ${escapeHtml(site.measures.join(", "))}`
        + `<br><small>Samples within ${siteGroupDistance()} m of each other count as one site.</small>`,
    },
  })));
}

// Delivered interventions as pink points at each footprint's centroid.
async function applyNbsPoints() {
  const layer = state.layers.nbs;
  const request = ++state.requests.nbs;
  layer.removeAll();
  if (!state.selected) return;
  if (!usesSource("action", "nbs_interventions")) {
    countForKey("nbs", 0);
    return;
  }
  try {
    const source = await getLayer(SCORECARD_SOURCES.nbsUrl);
    const result = await source.queryFeatures({
      where: "Status = 'Delivered'",
      geometry: state.selected.geometry,
      spatialRelationship: "intersects",
      outFields: ["projectname", "programmename", "leadpartner", "Intervention", "DateInstalled"],
      returnGeometry: true,
    });
    if (request !== state.requests.nbs) return;
    countForKey("nbs", result.features.filter((f) => f.geometry?.centroid).length);
    const { Graphic } = state.modules;
    layer.addMany(result.features.filter((f) => f.geometry?.centroid).map((f) => {
      const a = f.attributes;
      return new Graphic({
        geometry: f.geometry.centroid,
        attributes: a,
        symbol: { type: "simple-marker", style: "circle", color: SCORECARD_COLORS.nbs, size: 8, outline: { color: "#ffffff", width: 1 } },
        popupTemplate: {
          title: a.projectname || a.programmename || "Nature-Based Solutions intervention",
          content: `Programme: ${escapeHtml(a.programmename || "-")}<br>Intervention: ${escapeHtml(a.Intervention || "-")}`
            + `<br>Lead partner: ${escapeHtml(a.leadpartner || "-")}`
            + (a.DateInstalled ? `<br>Installed: ${new Date(a.DateInstalled).toLocaleDateString()}` : ""),
        },
      });
    }));
  } catch (error) {
    if (request === state.requests.nbs) console.error("Scorecards: NBS interventions couldn't be loaded:", error);
  }
}

// ---------------------------------------------------------------------
// The scorecard panel
// ---------------------------------------------------------------------

async function refreshScorecard() {
  const { health } = state.els;
  const request = ++state.requests.scorecard;
  health.coverageEl.textContent = `Readings from ${dateRangeDescription()}`;
  health.pdfEl.disabled = true;

  await state.hubData;
  const scorecard = await computeScorecard(state.selected.attrs.water_body_id, state.selected.geometry);
  if (request !== state.requests.scorecard) return;
  state.scorecard = scorecard;
  updateSourcesPanel();
  renderHealthWheel();
  updateHighlight();
  health.pdfEl.disabled = false;
}

function wheelPalette() {
  return {
    placeholderFill: cssVar("--calcite-color-foreground-3"),
    placeholderText: cssVar("--calcite-color-text-3"),
    stroke: cssVar("--calcite-color-foreground-1"),
    theme: getTheme(),
  };
}

function renderHealthWheel() {
  const { health } = state.els;
  state.healthSelectedPath = null;
  renderCatchmentHealthWheel(health.wheelSvg, state.scorecard, wheelPalette(), showThemeDetail);
  health.detailEl.innerHTML = `<p class="muted hint">Click a theme's inner wedge to see what's behind its score.</p>`;
}

// One theme's breakdown: its rating, then a card per sub-category
// (rating, what it's based on, a trend chart for nutrients, data source).
function showThemeDetail(spoke, band, path) {
  if (state.healthSelectedPath) {
    state.healthSelectedPath.setAttribute("stroke", cssVar("--calcite-color-foreground-1"));
    state.healthSelectedPath.setAttribute("stroke-width", 2);
  }
  path.setAttribute("stroke", cssVar("--calcite-color-text-1"));
  path.setAttribute("stroke-width", 3);
  state.healthSelectedPath = path;

  const { detailEl } = state.els.health;
  const badge = (b) => (b
    ? `<span class="ratingBadge" style="--band-color:${b.color}">${escapeHtml(b.label)}</span>`
    : `<span class="ratingBadge isNoData">no data</span>`);
  const title = `<div class="healthDetailTitle"><span>${escapeHtml(spoke.label)}</span>${band !== undefined ? badge(band) : ""}</div>`;

  // No data behind this theme yet: just name its measures.
  if (!spoke.wired) {
    detailEl.innerHTML = title + spoke.subs.map((sub) => `
      <section class="healthSection">
        <div class="healthSectionHeader"><span>${escapeHtml(sub.label)}</span>${badge(null)}</div>
      </section>`).join("");
    return;
  }
  if (!state.scorecard) {
    detailEl.innerHTML = `${title}<p class="muted hint">Select a waterbody on the map to see data.</p>`;
    return;
  }
  detailEl.innerHTML = title;

  const ranks = catchmentHealthRanks(state.scorecard);
  const granularity = bucketGranularity();
  let width = null;
  for (const sub of spoke.subs) {
    const section = document.createElement("section");
    section.className = "healthSection";
    detailEl.append(section); // attached first, so its chart can measure itself
    section.innerHTML = `
      <div class="healthSectionHeader"><span>${escapeHtml(sub.label)}</span>${badge(bandForRank(ranks[sub.key]))}</div>
      ${subDetailLines(sub.key, state.scorecard).filter((line) => !isSignsLine(line)).map((line) => `<p class="healthLine">${escapeHtml(line)}</p>`).join("")}`;
    if (BREAKDOWNS[sub.key]) section.insertAdjacentHTML("beforeend", signsTable(breakdownRows(state.scorecard, sub.key), BREAKDOWNS[sub.key]));
    const metric = getMetric(sub.key);
    if (metric) {
      width = renderBarChart(section, {
        metric, points: state.scorecard[`${sub.key}Series`] ?? [], granularity,
        equipMax: state.equipmentRanges[sub.key]?.max, knownWidth: width,
      }) ?? width;
    }
    const meta = subSourceLines(sub.key, state.scorecard);
    if (meta.length) section.insertAdjacentHTML("beforeend", `<div class="healthMeta">${meta.map((l) => `<div>${escapeHtml(l)}</div>`).join("")}</div>`);
  }
}

// A survey-counted measure's breakdown (pollution signs, wildlife
// species), with how many surveys showed each.
function signsTable(rows, { column, note }) {
  if (!rows.length) return "";
  return `<table class="signsTable">
    <thead><tr><th scope="col">${escapeHtml(column)}</th><th scope="col">Surveys</th><th scope="col">Share of surveys</th></tr></thead>
    <tbody>${rows.map((r) => `<tr${r.surveys ? "" : ' class="isNone"'}><th scope="row">${escapeHtml(r.label)}</th><td>${r.surveys.toLocaleString("en-GB")}</td><td>${r.share}</td></tr>`).join("")}</tbody>
  </table>
  <p class="healthLine signsNote">${escapeHtml(note)}</p>`;
}

function handleThemeChange(theme) {
  state.mapEl.basemap = MAP.basemap[theme];
  state.layers.waterbodies.renderer = waterbodyRenderer(theme);
  updateHighlight();
  renderHealthWheel();
}

// ---------------------------------------------------------------------
// PDF report
// ---------------------------------------------------------------------

// Map screenshot for print: always the light basemap and boundaries,
// framed on the waterbody; whatever was on screen is restored after.
async function printScreenshot() {
  const { mapEl, layers, modules } = state;
  const basemap = mapEl.basemap;
  const renderer = layers.waterbodies.renderer;
  mapEl.basemap = MAP.basemap.light;
  layers.waterbodies.renderer = waterbodyRenderer("light");
  try {
    await mapEl.goTo(state.selected.geometry);
    await modules.reactiveUtils.whenOnce(() => !mapEl.view.updating);
    return await mapEl.takeScreenshot({ format: "png" });
  } finally {
    mapEl.basemap = basemap;
    layers.waterbodies.renderer = renderer;
  }
}

async function downloadPdf() {
  if (!state.selected || !state.scorecard) return;
  const button = state.els.health.pdfEl;
  button.disabled = true;
  button.loading = true;
  try {
    const [JsPDF, screenshot] = await Promise.all([loadJsPdf(), printScreenshot()]);
    const options = {
      waterbodyName: state.selected.attrs.water_body_name || "Unnamed waterbody",
      waterBodyId: state.selected.attrs.water_body_id,
      scorecard: state.scorecard,
      screenshot,
      dateRangeText: dateRangeDescription(),
      granularity: bucketGranularity(),
      equipmentRanges: state.equipmentRanges,
    };
    buildCatchmentHealthPdf(JsPDF, options).save(safeFileName(options.waterbodyName, "catchment_health"));
  } catch (error) {
    console.error("Scorecards: PDF report failed:", error);
    state.els.errorAlertEl.open = true;
  } finally {
    button.disabled = false;
    button.loading = false;
  }
}
