// =====================================================================
// SUMMARY LAYERS
// Zoomed out, each waterbody is shaded by its median. Zoomed in, each
// waterbody splits into hexagons cut to its boundary, getting smaller
// with each zoom step. Each layer has its own scale range, so the map
// swaps them as you zoom. A hexagon level is only prepared once it's
// on screen, because cutting hexagons to shape is the slow part.
// =====================================================================

import {
  HEXAGON_LEVELS,
  WATERBODY_MAX_SCALE,
  hexagonMayCrossBoundary,
  hexagonWidthLabel,
  summariseHexagons,
  summariseWaterbodies,
  toMercator,
} from "../aggregation.js";
import { PLACED_LAT_FIELD, PLACED_LON_FIELD, readingsFor, WATERBODY_FIELD, YEAR_FIELD } from "../data/readings-store.js";
import { bandFor, isOnScale, mappedValue, stepIndex } from "../readings.js";
import { BAND_COLOURS, NEUTRAL, markerRing } from "../palette.js";
import { summaryPopupContent } from "./popup.js";

const MERCATOR = { wkid: 3857 };
const FILL_OPACITY = 0.85;

let fillLayer = null;
let hexagonLayers = [];
let outlineGraphics = [];
let waterbodiesById = new Map();
let sdk = null;
let drawn = null; // what the hexagons are showing, and which levels are ready
const mercatorRings = new Map();
const mercatorPolygons = new Map();

function colourWithAlpha(hex, alpha) {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255, alpha];
}

async function ensureLayers(mapEl, waterbodies) {
  if (fillLayer) return;
  const [GraphicsLayer, Graphic, Polygon, intersectionOperator] = await $arcgis.import([
    "@arcgis/core/layers/GraphicsLayer.js",
    "@arcgis/core/Graphic.js",
    "@arcgis/core/geometry/Polygon.js",
    "@arcgis/core/geometry/operators/intersectionOperator.js",
  ]);
  sdk = { Graphic, Polygon, intersectionOperator };
  waterbodiesById = new Map(waterbodies.map((waterbody) => [waterbody.id, waterbody]));

  fillLayer = new GraphicsLayer({ title: "Waterbody summaries", maxScale: WATERBODY_MAX_SCALE });
  hexagonLayers = HEXAGON_LEVELS.map((level) => new GraphicsLayer({
    title: `Hexagons ${hexagonWidthLabel(level.widthMetres)}`,
    minScale: level.minScale,
    maxScale: level.maxScale,
  }));
  outlineGraphics = waterbodies.map((waterbody) => new Graphic({
    geometry: { type: "polygon", rings: waterbody.rings, spatialReference: { wkid: 4326 } },
    attributes: { partnership: waterbody.partnership },
    symbol: { type: "simple-fill", color: [0, 0, 0, 0], outline: { color: colourWithAlpha(NEUTRAL, 0.6), width: 0.5 } },
  }));
  const outlineLayer = new GraphicsLayer({ title: "Waterbody outlines", graphics: outlineGraphics });
  mapEl.map.layers.addMany([fillLayer, ...hexagonLayers, outlineLayer], 0);
}

// Every usable reading of this metric, pooled across datasets.
function summaryRows(loaded, sources, conventions, filters) {
  return sources.flatMap((source) =>
    readingsFor(loaded, source, conventions, filters).flatMap((graphic) => {
      const value = mappedValue(graphic.attributes[source.mapping.field], source.mapping);
      if (value === null) return [];
      const placedLon = graphic.attributes[PLACED_LON_FIELD];
      return [{
        lon: placedLon ?? graphic.geometry.x,
        lat: graphic.attributes[PLACED_LAT_FIELD] ?? graphic.geometry.y,
        value,
        year: graphic.attributes[YEAR_FIELD],
        isEstimate: Boolean(bandFor(graphic.attributes[source.mapping.field], source.mapping)),
        isBeside: placedLon !== null,
        waterbodyId: graphic.attributes[WATERBODY_FIELD],
      }];
    }));
}

function waterbodyInMercator(id) {
  if (!mercatorRings.has(id)) {
    mercatorRings.set(id, waterbodiesById.get(id).rings.map((ring) => ring.map(([lon, lat]) => toMercator(lon, lat))));
  }
  return mercatorRings.get(id);
}

function waterbodyPolygon(id) {
  if (!mercatorPolygons.has(id)) {
    mercatorPolygons.set(id, new sdk.Polygon({ rings: waterbodyInMercator(id), spatialReference: MERCATOR }));
  }
  return mercatorPolygons.get(id);
}

function hexagonShape(summary) {
  const hexagon = new sdk.Polygon({ rings: [summary.ring], spatialReference: MERCATOR });
  if (!hexagonMayCrossBoundary(summary.ring, waterbodyInMercator(summary.waterbodyId))) return hexagon;
  return sdk.intersectionOperator.execute(hexagon, waterbodyPolygon(summary.waterbodyId));
}

function fillHexagonLevel(index) {
  if (!drawn || drawn.ready.has(index)) return;
  drawn.ready.add(index);
  const { widthMetres } = HEXAGON_LEVELS[index];
  const place = `this ${hexagonWidthLabel(widthMetres)} hexagon of the waterbody`;
  hexagonLayers[index].graphics.addMany(summariseHexagons(drawn.rows, widthMetres).map((summary) =>
    drawn.graphicFor(summary, hexagonShape(summary), place)));
}

// Prepares the hexagon level for a map scale, if there is one.
export function fillVisibleHexagons(scale) {
  const index = HEXAGON_LEVELS.findIndex((level) => scale <= level.minScale && scale > level.maxScale);
  if (index !== -1) fillHexagonLevel(index);
}

// Redraws the summaries for a metric, year and partnership.
export async function showSummaries(mapEl, { loaded, metric, sources, conventions, theme, year, partnership, waterbodies }) {
  await ensureLayers(mapEl, waterbodies);

  outlineGraphics.forEach((graphic) => { graphic.visible = partnership === null || graphic.attributes.partnership === partnership; });
  fillLayer.graphics.removeAll();
  hexagonLayers.forEach((layer) => layer.graphics.removeAll());
  drawn = null;
  if (!sources.every(({ mapping }) => isOnScale(mapping, metric))) return { active: false, outsideCount: 0, besideCount: 0 };

  const rows = summaryRows(loaded, sources, conventions, { year, partnership });
  const inWaterbody = rows.filter((row) => row.waterbodyId !== null);

  const graphicFor = (summary, geometry, place) => {
    const waterbody = waterbodiesById.get(summary.waterbodyId);
    const { ring, ...attributes } = summary;
    return new sdk.Graphic({
      geometry,
      attributes: { ...attributes, place, waterbodyName: waterbody.name },
      symbol: {
        type: "simple-fill",
        color: colourWithAlpha(BAND_COLOURS[stepIndex(summary.median, metric.scale.breaks)], FILL_OPACITY),
        outline: { color: markerRing(theme), width: 0.5 },
      },
      popupTemplate: {
        title: metric.label,
        content: ({ graphic }) => summaryPopupContent(graphic.attributes, metric),
      },
    });
  };

  fillLayer.graphics.addMany(summariseWaterbodies(inWaterbody).map((summary) => graphicFor(
    summary,
    { type: "polygon", rings: waterbodiesById.get(summary.waterbodyId).rings, spatialReference: { wkid: 4326 } },
    "this waterbody",
  )));

  drawn = { rows: inWaterbody, graphicFor, ready: new Set() };
  fillVisibleHexagons(mapEl.scale);

  return {
    active: true,
    outsideCount: rows.length - inWaterbody.length,
    besideCount: inWaterbody.filter((row) => row.isBeside).length,
  };
}
