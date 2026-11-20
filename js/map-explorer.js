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
// The layer list, basemap gallery and legend sit behind buttons on the
// map, as on the AQuA dashboard (map/tool-panels.js).
//
// The river network is too dense to show for the whole region, so it's
// off to start with (and only draws once zoomed in). Picking a partnership
// switches it and its flow direction on.
// =====================================================================

import { getTheme, onThemeChange } from "./theme.js";
import { areaExtent } from "./map/extents.js";
import { setupToolPanels } from "./map/tool-panels.js";
import { buildLayerList } from "./map/web-map-layers.js";
import { styleStormOverflows } from "./map/storm-overflows.js";
import { attachFlow, riverRenderer } from "./map/river-network.js";
import { RIVER_NETWORK } from "./config.js";

export const WEB_MAP_ID = "140a38bca4364ced9dd49b8c677346d8";
const BASEMAP = { dark: "dark-gray-vector", light: "gray-vector" };
// The gallery's choices: Esri basemaps that need no API key.
const BASEMAPS = ["gray-vector", "dark-gray-vector", "streets-vector", "topo-vector", "terrain", "satellite", "hybrid", "osm"];

let mapEl = null;
let area = null;
let Polygon = null;
let geodesicBufferOperator = null;
let filterGeometry = null;
let filterIds = []; // the CaBA IDs of the partnerships in view
let partnership = null; // null means the whole region
let layerListEl = null;
let layerList = null; // the built layer list, { refresh }
let emptyLayers = new Set(); // layers with nothing in the selected area
const countsByArea = new Map(); // area name -> Map(layer -> count or null)
let latestCheck = 0;
let riverNetwork = null;
let riverFlow = null; // the animated flow direction overlay for it

const RIVER_NETWORK_SERVICE = "/OpenRiverNetwork";

const isListed = (layer) => !emptyLayers.has(layer);

// Off for the whole region, though still in the list (it only draws once
// zoomed in, as the whole region is too dense). Picking a partnership
// switches the network and its flow direction on and lets the network show
// at any scale; either can be switched off or on by hand after that.
function applyRiverNetwork() {
  if (!riverNetwork) return;
  if (partnership === null) {
    riverNetwork.minScale = RIVER_NETWORK.minScale;
    riverNetwork.visible = false;
  } else {
    riverNetwork.minScale = 0;
    riverNetwork.visible = true;
    if (riverFlow) riverFlow.visible = true;
  }
}

// The shapes are pulled in by this much, so a neighbouring partnership's
// features that only touch the edge, or sit on it, are left out. Anything
// with a real part inside is still found.
const EDGE_INSET_METRES = 50;

// The southern region, or one partnership in it.
function regionPolygon() {
  const shapes = area.partnerships.filter((candidate) => partnership === null || candidate.name === partnership);
  const polygon = new Polygon({ rings: shapes.flatMap((shape) => shape.rings), spatialReference: { wkid: 4326 } });
  filterIds = shapes.map((shape) => shape.cabaId);
  return geodesicBufferOperator.execute(polygon, -EDGE_INSET_METRES, { unit: "meters" }) ?? polygon;
}

// Waterbody layers carry their catchment's CaBA ID, so they're cut by that
// attribute: exactly the waterbodies of the partnership, none of the
// neighbours that touch it. Any other layer is cut by the partnership's shape.
const CATCHMENT_ID_FIELD = "caba_catchment_id";
const hasCatchmentId = (layer) => layer.fields?.some((field) => field.name === CATCHMENT_ID_FIELD);
const catchmentWhere = () => `${CATCHMENT_ID_FIELD} IN (${filterIds.join(",")})`;

function filterLayerView(layerView) {
  if (!("filter" in layerView)) return; // tiles, basemaps and the like
  layerView.filter = hasCatchmentId(layerView.layer)
    ? { where: catchmentWhere() }
    : { geometry: filterGeometry, spatialRelationship: "intersects" };
}

// Layers that already have a view. One switched on later gets its view then,
// and is filtered by the arcgisViewLayerviewCreate listener below, so there is
// nothing to wait for here (waiting on every switched-off layer left a pending
// promise behind each time a partnership was picked). The view's own list holds
// only the web map's groups; the layers are in each group's views.
function filterViews(layerViews) {
  layerViews.forEach((layerView) => {
    if (layerView.layerViews) filterViews(layerView.layerViews);
    else filterLayerView(layerView);
  });
}

function filterAll() {
  filterViews(mapEl.view.layerViews);
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
      if (hasCatchmentId(layer)) {
        query.where = query.where && query.where !== "1=1" ? `(${query.where}) AND ${catchmentWhere()}` : catchmentWhere();
      } else {
        query.geometry = geometry;
        query.spatialRelationship = "intersects";
      }
      return await layer.queryFeatureCount(query);
    } catch (error) {
      console.warn(`Couldn't count ${layer.title}`, error);
      return null;
    }
  }));
  return new Map(layers.map((layer, index) => [layer, counts[index]]));
}

// Counting asks every layer's service how much it holds in the area, which
// is dozens of requests, so it waits until the layer list is first opened.
let countingWanted = false;

async function updateLayerList() {
  if (!countingWanted) return;
  const check = ++latestCheck;
  const key = areaKey();
  if (!countsByArea.has(key)) countsByArea.set(key, await countLayers(filterGeometry));
  if (check !== latestCheck) return; // a newer partnership was picked
  const counts = countsByArea.get(key);
  emptyLayers = new Set([...counts].filter(([, count]) => count === 0).map(([layer]) => layer));
  refreshList();
}

function refreshList() {
  layerList?.refresh();
}

export async function initMapExplorer(element, listElement, clipArea) {
  mapEl = element;
  layerListEl = listElement;
  area = clipArea;
  [Polygon, geodesicBufferOperator] = await $arcgis.import([
    "@arcgis/core/geometry/Polygon.js",
    "@arcgis/core/geometry/operators/geodesicBufferOperator.js",
  ]);
  await geodesicBufferOperator.load(); // the operator needs its engine ready
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
  setupToolPanels(mapEl);
  setupBasemapGallery();
  // A basemap picked from the gallery is kept; only the light and dark
  // gray pair, the theme's own, swap with the theme.
  onThemeChange((theme) => {
    const shown = mapEl.map.basemap?.id;
    if (!shown || Object.values(BASEMAP).includes(shown) || !BASEMAPS.includes(shown)) mapEl.basemap = BASEMAP[theme];
  });
  riverNetwork = mapEl.map.allLayers.find((layer) => layer.url?.includes(RIVER_NETWORK_SERVICE)) ?? null;
  if (riverNetwork) {
    // The same soft look as the other maps, with flow direction beside it.
    riverNetwork.renderer = riverRenderer();
    riverNetwork.effect = null;
    riverNetwork.minScale = RIVER_NETWORK.minScale; // only drawn once zoomed in, as on the other maps
    const container = riverNetwork.parent;
    riverFlow = await attachFlow(mapEl, riverNetwork, container.layers.indexOf(riverNetwork) + 1, container);
  }
  applyRiverNetwork();
  // Found by its address: a layer's fields aren't known until it has loaded,
  // and the web map's layers load as they're needed.
  const wfdLayer = mapEl.map.allLayers.find((layer) => /WFD_River_Water_Body_Catchments/.test(layer.url ?? "")) ?? null;
  // The storm overflow layers get the NRS and AQuA symbols and pop-ups.
  const storm = styleStormOverflows(mapEl.map);
  layerList = await buildLayerList(layerListEl, mapEl, { isListed, riverNetwork, riverFlow, wfdLayer, storm });

  // Layers switched on later get their view then, so filter each as it
  // arrives as well as those already there.
  mapEl.addEventListener("arcgisViewLayerviewCreate", (event) => filterLayerView(event.detail.layerView));
  filterAll();
  mapEl.querySelector(".layersAction")?.addEventListener("click", () => {
    if (countingWanted) return;
    countingWanted = true;
    updateLayerList();
  }, { once: true });
}

async function setupBasemapGallery() {
  const gallery = mapEl.closest(".view")?.querySelector("arcgis-basemap-gallery");
  if (!gallery) return;
  const [Basemap, LocalBasemapsSource] = await $arcgis.import([
    "@arcgis/core/Basemap.js",
    "@arcgis/core/widgets/BasemapGallery/support/LocalBasemapsSource.js",
  ]);
  gallery.source = new LocalBasemapsSource({
    basemaps: BASEMAPS.map((id) => {
      const basemap = Basemap.fromId(id);
      basemap.id = id; // the gallery and the theme switch go by this
      return basemap;
    }),
  });
}

// Narrows the filter to one partnership, or back to the whole region.
export function setMapExplorerPartnership(name) {
  partnership = name;
  if (!filterGeometry) return; // picked up when the tab starts
  filterGeometry = regionPolygon();
  if (mapEl.ready) {
    applyRiverNetwork();
    refreshList();
    filterAll();
    updateLayerList();
  }
}
