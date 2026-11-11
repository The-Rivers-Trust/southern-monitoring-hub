// =====================================================================
// INFO PANEL
// Opens along the bottom of the map when a waterbody, hexagon or
// reading is clicked, in place of a pop-up. What it shows comes from
// the popupTemplate each layer or graphic already carries.
// =====================================================================

import { getTheme } from "../theme.js";

let map = null;
let panel = null;
let body = null;
let previous = null;
let next = null;
let selectionLayer = null;
let Graphic = null;
let items = [];
let position = 0;
let latestClick = 0;

const templateOf = (graphic) => graphic.popupTemplate ?? graphic.layer?.popupTemplate;

function selectionSymbol(geometry) {
  const colour = getTheme() === "light" ? "#111111" : "#ffffff";
  return geometry.type === "point"
    ? { type: "simple-marker", style: "circle", color: [0, 0, 0, 0], size: 18, outline: { color: colour, width: 2 } }
    : { type: "simple-fill", color: [0, 0, 0, 0], outline: { color: colour, width: 2.5 } };
}

function showSelection(graphic) {
  selectionLayer.removeAll();
  selectionLayer.add(new Graphic({ geometry: graphic.geometry, symbol: selectionSymbol(graphic.geometry) }));
  // Layers added since may have ended up on top of it.
  map.map.layers.reorder(selectionLayer, map.map.layers.length - 1);
}

function closeAction() {
  const action = document.createElement("calcite-action");
  action.icon = "x";
  action.text = "Close";
  action.title = "Close";
  action.scale = "s";
  action.addEventListener("click", closeInfoPanel);
  return action;
}

function showCurrent() {
  const graphic = items[position];
  const template = templateOf(graphic);
  const content = template.content({ graphic });
  const tabsActions = content.querySelector?.(".detailTabsActions");
  // Summaries carry their own tab bar, so the panel header isn't needed.
  const headerless = Boolean(tabsActions);
  panel.heading = headerless ? "" : template.title;
  panel.description = items.length > 1 ? `Reading ${position + 1} of ${items.length} here` : "";
  panel.closable = !headerless;
  panel.classList.toggle("isHeaderless", headerless);
  previous.hidden = items.length < 2;
  next.hidden = items.length < 2;
  previous.disabled = position === 0;
  next.disabled = position === items.length - 1;
  tabsActions?.append(closeAction());
  body.replaceChildren(content);
  showSelection(graphic);
}

function open(hits) {
  items = hits;
  position = 0;
  panel.closed = false;
  showCurrent();
}

function clearSelection() {
  selectionLayer?.removeAll();
  items = [];
}

export function closeInfoPanel() {
  if (panel) panel.closed = true;
  clearSelection();
}

// Escape closes it, as the header's close button would.
function closeOnEscape(event) {
  if (event.key === "Escape" && !panel.closed) closeInfoPanel();
}

export async function initInfoPanel(mapEl, panelEl, bodyEl, previousEl, nextEl) {
  const [GraphicsLayer, GraphicClass] = await $arcgis.import([
    "@arcgis/core/layers/GraphicsLayer.js",
    "@arcgis/core/Graphic.js",
  ]);
  Graphic = GraphicClass;
  map = mapEl;
  panel = panelEl;
  body = bodyEl;
  previous = previousEl;
  next = nextEl;
  selectionLayer = new GraphicsLayer({ title: "Selection" });
  mapEl.map.layers.add(selectionLayer);

  panel.addEventListener("calcitePanelClose", clearSelection);
  panel.addEventListener("keydown", closeOnEscape);
  previous.addEventListener("click", () => { position -= 1; showCurrent(); });
  next.addEventListener("click", () => { position += 1; showCurrent(); });

  mapEl.addEventListener("arcgisViewClick", async (event) => {
    const click = ++latestClick;
    const { results } = await mapEl.hitTest(event.detail);
    if (click !== latestClick) return; // a newer click replaces this one
    const hits = results
      .filter((result) => result.type === "graphic" && templateOf(result.graphic))
      .map((result) => result.graphic);
    if (!hits.length) {
      closeInfoPanel();
      return;
    }
    // Readings can stack at one spot, so they can be stepped through.
    open(hits[0].popupTemplate ? [hits[0]] : hits.filter((graphic) => !graphic.popupTemplate));
  });
}
