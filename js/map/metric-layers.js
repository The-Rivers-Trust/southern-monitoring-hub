// =====================================================================
// METRIC LAYERS
// Draws a metric from every dataset that holds it: one layer per
// dataset, all using the metric's shared colour scale, so together they
// read as a single layer. Layers are built from the loaded readings
// and kept, so returning to a metric costs nothing.
// =====================================================================

import { categoryExpression, category, isOnScale, stepLabels, FLAGGED, UNSCALED } from "../readings.js";
import { PARTNERSHIP_FIELD, readingsFor, WATERBODY_FIELD } from "../data/readings-store.js";
import { HEXAGON_MAX_SCALE, fromMercator } from "../aggregation.js";
import { BAND_COLOURS, NEUTRAL, markerRing } from "../palette.js";
import { popupContent, reportTitle } from "./popup.js";
import { showSummaries } from "./summary-layers.js";
import { closeInfoPanel } from "./info-panel.js";

// How far around the view individual readings are prepared, so small
// pans don't need rebuilding.
const DETAIL_AREA_FACTOR = 3;

const outsideLayers = new Map();
let builtYear;
let current = [];
let shown = []; // per source, the readings passing the current filters
let drawing = null; // what's currently on the map
let detailLayers = [];
let detailBounds = null;

function symbol(style, colour, theme) {
  return { type: "simple-marker", style, color: colour, size: 8, outline: { color: markerRing(theme), width: 0.75 } };
}

function buildRenderer(mapping, metric, theme) {
  const infos = [];
  if (isOnScale(mapping, metric)) {
    const labels = stepLabels(metric.scale.breaks);
    labels.forEach((label, step) => {
      infos.push({ value: category(step, false), label, symbol: symbol("circle", BAND_COLOURS[step], theme) });
      infos.push({ value: category(step, true), label: `${label} (estimated)`, symbol: symbol("diamond", BAND_COLOURS[step], theme) });
    });
  }
  infos.push({ value: UNSCALED, label: "No common unit", symbol: symbol("circle", NEUTRAL, theme) });
  infos.push({
    value: FLAGGED,
    label: "Suspect value",
    symbol: { type: "simple-marker", style: "circle", color: [0, 0, 0, 0], size: 8, outline: { color: NEUTRAL, width: 1.5 } },
  });
  return {
    type: "unique-value",
    valueExpression: categoryExpression(mapping, metric),
    uniqueValueInfos: infos,
    // Markers grow as you zoom in, so dense areas stay readable.
    visualVariables: [{
      type: "size",
      valueExpression: "$view.scale",
      stops: [{ value: 250000, size: 11 }, { value: 2000000, size: 8 }, { value: 8000000, size: 5 }],
    }],
  };
}

function buildLayer({ FeatureLayer, Graphic }, source, metric, catalog, loaded, records, titleSuffix, year) {
  const { dataset, mapping } = source;
  const { conventions } = catalog;
  const layer = new FeatureLayer({
    title: `${metric.label}: ${dataset.label}${titleSuffix}`,
    source: records.map(({ attributes, geometry }) => new Graphic({
      attributes,
      geometry: { type: "point", x: geometry.x, y: geometry.y, spatialReference: { wkid: 4326 } },
    })),
    fields: loaded.get(dataset.id).fields.map((field) => field.clone()),
    objectIdField: dataset.fields.objectId,
    geometryType: "point",
    spatialReference: { wkid: 4326 },
    outFields: ["*"],
    orderBy: [{ field: dataset.fields.date, order: "descending" }],
    popupTemplate: {
      title: reportTitle(metric, year),
      outFields: ["*"],
      content: ({ graphic }) => popupContent(graphic.attributes, { dataset, mapping, metric, conventions }),
    },
  });
  return layer;
}

function viewBounds(mapEl, expandBy = 1) {
  const { xmin, ymin, xmax, ymax } = mapEl.extent.clone().expand(expandBy);
  const [west, south] = fromMercator(xmin, ymin);
  const [east, north] = fromMercator(xmax, ymax);
  return { west, south, east, north };
}

const isWithin = ({ geometry: { x, y } }, bounds) =>
  x >= bounds.west && x <= bounds.east && y >= bounds.south && y <= bounds.north;

// How many of the current metric's readings are in the map view.
export async function countInView(mapEl) {
  const bounds = viewBounds(mapEl);
  return shown.reduce((sum, records) => sum + records.filter((record) => isWithin(record, bounds)).length, 0);
}

function partnershipFilter(partnership) {
  return partnership === null ? null : `${PARTNERSHIP_FIELD} = '${partnership.replace(/'/g, "''")}'`;
}

function removeDetailLayers(mapEl) {
  if (detailLayers.length) mapEl.map.layers.removeMany(detailLayers);
  detailLayers = [];
  detailBounds = null;
}

// The individual readings. There can be hundreds of thousands across
// all years and each is costly to draw, so they're only built once
// zoomed in that far, and only for the area around the view.
export function syncDetailLayers(mapEl) {
  if (!drawing) return;
  const { summaries, sdk, metric, catalog, loaded, sources, theme } = drawing;
  if (summaries.active && mapEl.scale > HEXAGON_MAX_SCALE) {
    removeDetailLayers(mapEl);
    return;
  }
  const view = viewBounds(mapEl);
  const stillCovered = detailBounds && view.west >= detailBounds.west && view.east <= detailBounds.east
    && view.south >= detailBounds.south && view.north <= detailBounds.north;
  if (stillCovered) return;

  removeDetailLayers(mapEl);
  detailBounds = viewBounds(mapEl, DETAIL_AREA_FACTOR);
  detailLayers = sources.map((source, index) => {
    const records = shown[index].filter((record) => isWithin(record, detailBounds));
    const layer = buildLayer(sdk, source, metric, catalog, loaded, records, "", drawing.year);
    layer.renderer = buildRenderer(source.mapping, metric, theme);
    return layer;
  });
  mapEl.map.layers.addMany(detailLayers);
}

// Swaps the map over to a metric, year and partnership. Returns what the
// summaries cover.
export async function showMetric(mapEl, { catalog, loaded, metric, sources, theme, year, partnership, waterbodies }) {
  const [FeatureLayer, Graphic] = await $arcgis.import([
    "@arcgis/core/layers/FeatureLayer.js",
    "@arcgis/core/Graphic.js",
  ]);
  const sdk = { FeatureLayer, Graphic };
  const summaries = await showSummaries(mapEl, { catalog, loaded, metric, sources, theme, year, partnership, waterbodies });
  shown = sources.map((source) => readingsFor(loaded, source, catalog.conventions, { year, partnership }));

  // Readings no waterbody can summarise stay on the map as points until
  // the individual readings take over. These hold one year's readings.
  if (year !== builtYear) {
    outsideLayers.clear();
    builtYear = year;
  }
  const outsideReadings = summaries.active ? sources.map((source) => {
    const key = `${metric.id}|${source.dataset.id}`;
    if (!outsideLayers.has(key)) {
      const records = readingsFor(loaded, source, catalog.conventions, { year }).filter((record) => record.attributes[WATERBODY_FIELD] === null);
      outsideLayers.set(key, buildLayer(sdk, source, metric, catalog, loaded, records, " (outside waterbodies)", year));
    }
    const layer = outsideLayers.get(key);
    layer.renderer = buildRenderer(source.mapping, metric, theme);
    layer.definitionExpression = partnershipFilter(partnership);
    layer.maxScale = HEXAGON_MAX_SCALE;
    return layer;
  }) : [];

  closeInfoPanel();
  removeDetailLayers(mapEl);
  mapEl.map.layers.removeMany(current);
  current = outsideReadings;
  mapEl.map.layers.addMany(current);
  drawing = { summaries, sdk, metric, catalog, loaded, sources, theme, year };
  syncDetailLayers(mapEl);
  return summaries;
}
