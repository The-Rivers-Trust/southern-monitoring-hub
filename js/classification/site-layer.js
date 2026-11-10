// =====================================================================
// SITE LAYER
// One point per monitoring site. Changing the item or question only
// rewrites each site's category, so the map restyles without a reload.
// A site with no category (never classified for that item) isn't drawn.
// =====================================================================

import { markerRing } from "../palette.js";

const CATEGORY_FIELD = "category";
const ORDER_FIELD = "drawOrder";

let layer = null;
let selection = null;
let Graphic = null;

export async function addSiteLayer(mapEl, sites) {
  const [FeatureLayer, GraphicsLayer, GraphicClass] = await $arcgis.import([
    "@arcgis/core/layers/FeatureLayer.js",
    "@arcgis/core/layers/GraphicsLayer.js",
    "@arcgis/core/Graphic.js",
  ]);
  Graphic = GraphicClass;
  layer = new FeatureLayer({
    title: "WFD monitoring sites",
    source: sites.map((site) => new Graphic({
      geometry: { type: "point", x: site.lon, y: site.lat, spatialReference: { wkid: 4326 } },
      attributes: { ObjectID: site.objectId, partnership: site.partnership, [CATEGORY_FIELD]: null, [ORDER_FIELD]: 0 },
    })),
    objectIdField: "ObjectID",
    fields: [
      { name: "ObjectID", type: "oid" },
      { name: "partnership", type: "string" },
      { name: CATEGORY_FIELD, type: "string" },
      { name: ORDER_FIELD, type: "integer" },
    ],
    geometryType: "point",
    spatialReference: { wkid: 4326 },
    outFields: ["*"],
    orderBy: [{ field: ORDER_FIELD, order: "ascending" }],
  });
  selection = new GraphicsLayer({ title: "Selected site" });
  mapEl.map.layers.addMany([layer, selection]);
  return layer;
}

function symbolFor(entry, theme) {
  if (entry.hollow) {
    return {
      type: "simple-marker",
      style: "circle",
      color: [0, 0, 0, 0],
      size: entry.small ? 6 : 9,
      outline: { color: entry.colour, width: entry.small ? 1.25 : 2.25 },
    };
  }
  return { type: "simple-marker", style: "circle", color: entry.colour, size: 9, outline: { color: markerRing(theme), width: 0.75 } };
}

// entries: [{ id, label, colour (resolved hex), hollow, small, drawOrder }],
// categoryOf(site) gives an entry id or null.
export async function restyleSites(sites, { entries, categoryOf, hidden, partnership, theme }) {
  const order = new Map(entries.map((entry, index) => [entry.id, entry.drawOrder ?? entries.length - index]));
  const updates = sites.map((site) => {
    const category = categoryOf(site);
    return { attributes: { ObjectID: site.objectId, [CATEGORY_FIELD]: category, [ORDER_FIELD]: order.get(category) ?? 0 } };
  });
  await layer.applyEdits({ updateFeatures: updates });
  layer.definitionExpression = partnership === null ? null : `partnership = '${partnership.replace(/'/g, "''")}'`;
  layer.renderer = {
    type: "unique-value",
    field: CATEGORY_FIELD,
    uniqueValueInfos: entries
      .filter((entry) => !hidden.has(entry.id))
      .map((entry) => ({ value: entry.id, label: entry.label, symbol: symbolFor(entry, theme) })),
  };
}

// The site clicked, as its objectId, or null.
export async function siteAt(mapEl, screenPoint) {
  const { results } = await mapEl.hitTest(screenPoint, { include: [layer] });
  const hit = results.find((result) => result.type === "graphic" && result.graphic.layer === layer);
  return hit ? hit.graphic.attributes.ObjectID : null;
}

export function showSelectedSite(site, theme) {
  selection.removeAll();
  if (!site) return;
  const colour = theme === "light" ? "#111111" : "#ffffff";
  selection.add(new Graphic({
    geometry: { type: "point", x: site.lon, y: site.lat, spatialReference: { wkid: 4326 } },
    symbol: { type: "simple-marker", style: "circle", color: [0, 0, 0, 0], size: 18, outline: { color: colour, width: 2 } },
  }));
}
