// =====================================================================
// MAP EXPLORER
// The first tab: the Southern Data Hub web map from ArcGIS Online, as
// it's set up there, with every feature layer cut to the southern
// region. The cut is a spatial filter on each layer's view, using the
// exact CaBA partnership shapes, so it works for any layer added to the
// web map later, whatever its fields.
//
// The layer list only offers layers with something inside the selected
// area, checked by asking each layer's service for a count.
//
// The river network is too dense to show for the whole region, so it's
// off and out of the list until a partnership is picked.
// =====================================================================

import { getTheme, onThemeChange } from "./theme.js";
import { areaExtent } from "./map/extents.js";

export const WEB_MAP_ID = "140a38bca4364ced9dd49b8c677346d8";
const BASEMAP = { dark: "dark-gray-vector", light: "gray-vector" };

let mapEl = null;
let area = null;
let Polygon = null;
let filterGeometry = null;
let partnership = null; // null means the whole region
let layerListEl = null;
let emptyLayers = new Set(); // layers with nothing in the selected area
const countsByArea = new Map(); // area name -> Map(layer -> count or null)
let latestCheck = 0;
let riverNetwork = null;
let riverNetworkWanted = false; // its on/off state while a partnership is picked

const RIVER_NETWORK_SERVICE = "/OpenRiverNetwork";

const isListed = (layer) => !emptyLayers.has(layer) && !(layer === riverNetwork && partnership === null);

// Off for the whole region; back as it was once a partnership is picked.
// leaving is true when moving from a partnership back to the region.
function applyRiverNetwork(leaving = false) {
  if (!riverNetwork) return;
  if (partnership === null) {
    if (leaving) riverNetworkWanted = riverNetwork.visible;
    riverNetwork.visible = false;
  } else {
    riverNetwork.visible = riverNetworkWanted;
  }
}

// The southern region, or one partnership in it.
function regionPolygon() {
  const shapes = area.partnerships.filter((candidate) => partnership === null || candidate.name === partnership);
  return new Polygon({ rings: shapes.flatMap((shape) => shape.rings), spatialReference: { wkid: 4326 } });
}

function filterLayerView(layerView) {
  if (!("filter" in layerView)) return; // tiles, basemaps and the like
  layerView.filter = { geometry: filterGeometry, spatialRelationship: "intersects" };
}

function filterAll() {
  for (const layer of mapEl.map.allLayers) {
    if (layer.type === "group") continue;
    mapEl.view.whenLayerView(layer).then(filterLayerView).catch(() => {});
  }
}

const areaKey = () => partnership ?? "all";

// How many features each layer has inside the area. A layer that can't
// be counted gets null, and stays in the list.
async function countLayers(geometry) {
  const layers = mapEl.map.allLayers.filter((layer) => layer.type === "feature").toArray();
  const counts = await Promise.all(layers.map(async (layer) => {
    try {
      await layer.load();
      const query = layer.createQuery(); // keeps the web map's own filter
      query.geometry = geometry;
      query.spatialRelationship = "intersects";
      return await layer.queryFeatureCount(query);
    } catch (error) {
      console.warn(`Couldn't count ${layer.title}`, error);
      return null;
    }
  }));
  return new Map(layers.map((layer, index) => [layer, counts[index]]));
}

// A group is hidden when everything in it is.
function applyToItem(item) {
  if (item.children?.length) {
    item.children.forEach(applyToItem);
    item.hidden = item.children.every((child) => child.hidden);
  } else {
    item.hidden = !isListed(item.layer);
  }
}

async function updateLayerList() {
  const check = ++latestCheck;
  const key = areaKey();
  if (!countsByArea.has(key)) countsByArea.set(key, await countLayers(filterGeometry));
  if (check !== latestCheck) return; // a newer partnership was picked
  const counts = countsByArea.get(key);
  emptyLayers = new Set([...counts].filter(([, count]) => count === 0).map(([layer]) => layer));
  refreshList();
}

function refreshList() {
  layerListEl.operationalItems?.forEach(applyToItem);
}

export async function initMapExplorer(element, listElement, clipArea) {
  mapEl = element;
  layerListEl = listElement;
  // Items made later, such as when the list redraws, start hidden too.
  layerListEl.listItemCreatedFunction = ({ item }) => {
    if (!item.layer || item.layer.type === "group") return;
    item.hidden = !isListed(item.layer);
  };
  area = clipArea;
  [Polygon] = await $arcgis.import(["@arcgis/core/geometry/Polygon.js"]);
  filterGeometry = regionPolygon();

  mapEl.itemId = WEB_MAP_ID;
  mapEl.addEventListener("pointerdown", () => mapEl.classList.add("pointerFocus"));
  mapEl.addEventListener("keydown", (event) => {
    if (event.key === "Tab") mapEl.classList.remove("pointerFocus");
  });
  await mapEl.viewOnReady();
  // The web map's own starting view is all of England.
  mapEl.extent = areaExtent(area);
  mapEl.basemap = BASEMAP[getTheme()];
  onThemeChange((theme) => { mapEl.basemap = BASEMAP[theme]; });
  riverNetwork = mapEl.map.allLayers.find((layer) => layer.url?.includes(RIVER_NETWORK_SERVICE)) ?? null;
  riverNetworkWanted = riverNetwork?.visible ?? false;
  applyRiverNetwork();

  // Layers switched on later get their view then, so filter each as it
  // arrives as well as those already there.
  mapEl.addEventListener("arcgisViewLayerviewCreate", (event) => filterLayerView(event.detail.layerView));
  filterAll();
  await layerListEl.componentOnReady?.();
  refreshList();
  updateLayerList();
}

// Narrows the filter to one partnership, or back to the whole region.
export function setMapExplorerPartnership(name) {
  const leaving = partnership !== null && name === null;
  partnership = name;
  if (!filterGeometry) return; // picked up when the tab starts
  filterGeometry = regionPolygon();
  if (mapEl.ready) {
    applyRiverNetwork(leaving);
    refreshList();
    filterAll();
    updateLayerList();
  }
}
