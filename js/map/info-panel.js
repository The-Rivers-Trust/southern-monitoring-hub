// =====================================================================
// INFO PANEL
// Opens along the bottom of the map when a waterbody, hexagon or
// reading is clicked, in place of a pop-up. What it shows comes from
// the popupTemplate each layer or graphic already carries.
// =====================================================================

import { el } from "../dom.js";
import { getTheme } from "../theme.js";

let map = null;
let panel = null;
let body = null;
let previous = null;
let next = null;
let selectionLayer = null;
let Graphic = null;
let items = [];
let selection = null; // the summary clicked, to find again after a redraw
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

function showCurrent() {
  const graphic = items[position];
  const template = templateOf(graphic);
  const content = template.content({ graphic });
  panel.heading = template.title ?? "";
  panel.description = items.length > 1 ? `Reading ${position + 1} of ${items.length} here` : "";
  previous.hidden = items.length < 2;
  next.hidden = items.length < 2;
  previous.disabled = position === 0;
  next.disabled = position === items.length - 1;
  body.replaceChildren(content);
  showSelection(graphic);
}

// A summary can be found again when the map is redrawn; a reading can't.
function summarySelection(graphic) {
  const { waterbodyId, cellKey, widthMetres } = graphic.attributes ?? {};
  return graphic.popupTemplate && waterbodyId ? { waterbodyId, cellKey, widthMetres } : null;
}

function open(hits) {
  items = hits;
  selection = summarySelection(hits[0]);
  position = 0;
  panel.closed = false;
  showCurrent();
}

function clearSelection() {
  selectionLayer?.removeAll();
  items = [];
  selection = null;
}

// After the map is redrawn for another determinand, year or partnership:
// the panel stays open and is worked out again for the same place. find
// (selection) returns that place's graphic in the new drawing, or null.
export function refreshInfoPanel(find) {
  if (!panel || panel.closed) return;
  if (!selection) {
    closeInfoPanel();
    return;
  }
  const graphic = find(selection);
  if (graphic) {
    items = [graphic];
    position = 0;
    showCurrent();
    return;
  }
  // No readings there now: say so, and keep the place outlined.
  items = [];
  panel.heading = "";
  panel.description = "";
  previous.hidden = true;
  next.hidden = true;
  body.replaceChildren(el("p", "readingNote", "This place has no readings for the determinand, year and partnership now selected."));
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
