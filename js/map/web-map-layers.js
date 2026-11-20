// =====================================================================
// WEB MAP LAYERS
// The Map Explorer's layer list, in the same style as the other layer
// lists the app used to have: a group heading for each
// group in the web map, then one row per layer with a switch. The Open
// River Network row carries the "Animate flow direction" option. A
// layer out of its zoom range says so and can't be switched on until
// the map is zoomed in.
// =====================================================================

import { el } from "../dom.js";
import { RIVER_NETWORK } from "../config.js";
import { WFD_VIEWS, wfdRenderer } from "./wfd-classes.js";

const ZOOM_IN = "Zoom in to view";
const FLOW_LABEL = "Animate flow direction";
const FLOW_ZOOM_IN = "Zoom in further to animate flow direction";
const RECENT_LABEL = "Only discharging or in the last 48 hours";

// The river waterbody layer gets a "Colour by" choice of every classification.
function colourByOptions(layer) {
  const options = el("div", "layerOptions");
  options.slot = "content-bottom";
  const label = document.createElement("calcite-label");
  label.layout = "inline-space-between";
  label.scale = "s";
  label.append("Colour by");
  const select = document.createElement("calcite-select");
  select.scale = "s";
  select.label = "Classification to colour by";
  for (const group of [...new Set(WFD_VIEWS.map((view) => view.group))]) {
    const optionGroup = document.createElement("calcite-option-group");
    optionGroup.label = group;
    WFD_VIEWS.filter((view) => view.group === group).forEach((view) => {
      const option = document.createElement("calcite-option");
      option.value = view.field;
      option.label = view.label;
      option.textContent = view.label;
      optionGroup.append(option);
    });
    select.append(optionGroup);
  }
  const baseTitle = layer.title;
  const apply = () => {
    const view = WFD_VIEWS.find((candidate) => candidate.field === select.value) ?? WFD_VIEWS[0];
    layer.renderer = wfdRenderer(view);
    layer.title = `${baseTitle} (${view.label})`; // the legend names the view
  };
  select.addEventListener("calciteSelectChange", apply);
  select.value = WFD_VIEWS[1].field; // ecological, as the web map starts
  apply();
  label.append(select);
  options.append(label);
  return options;
}

// listEl: a <calcite-list>. isListed(layer) says whether a layer is
// offered at all. wfdLayer: the river waterbody layer, if there is one.
// Returns { refresh }, to call when that changes.
export async function buildLayerList(listEl, mapEl, { isListed, riverNetwork, riverFlow, wfdLayer, storm }) {
  const [reactiveUtils] = await $arcgis.import(["@arcgis/core/core/reactiveUtils.js"]);
  const view = mapEl.view;
  const rows = []; // { layer, item, toggle, group }
  const groups = []; // { element, rows }

  function addLayerRow(layer, container, group) {
    const item = document.createElement("calcite-list-item");
    item.label = layer.title;
    const toggle = document.createElement("calcite-switch");
    toggle.slot = "content-end";
    toggle.scale = "s";
    toggle.label = layer.title;
    toggle.addEventListener("calciteSwitchChange", () => {
      layer.visible = toggle.checked;
      // A layer in a switched-off group would stay hidden.
      if (toggle.checked && layer.parent?.type === "group") layer.parent.visible = true;
    });
    item.append(toggle);

    const row = { layer, item, toggle, group };
    if (layer === riverNetwork && riverFlow) {
      const options = el("div", "layerOptions");
      options.slot = "content-bottom";
      const label = document.createElement("calcite-label");
      label.layout = "inline";
      label.scale = "s";
      const checkbox = document.createElement("calcite-checkbox");
      checkbox.scale = "s";
      checkbox.addEventListener("calciteCheckboxChange", () => { riverFlow.visible = checkbox.checked; });
      const text = el("span", null, FLOW_LABEL);
      label.append(checkbox, text);
      options.append(label);
      item.append(options);
      Object.assign(row, { options, checkbox, text });
    }
    if (storm?.liveLayer && layer === storm.liveLayer) {
      // As on the NRS and AQuA dashboards: only the outfalls that need attention.
      const options = el("div", "layerOptions");
      options.slot = "content-bottom";
      const label = document.createElement("calcite-label");
      label.layout = "inline";
      label.scale = "s";
      const checkbox = document.createElement("calcite-checkbox");
      checkbox.scale = "s";
      checkbox.addEventListener("calciteCheckboxChange", () => storm.live.setRecentOnly(checkbox.checked));
      label.append(checkbox, el("span", null, RECENT_LABEL));
      options.append(label);
      item.append(options);
      row.options = options;
    }
    if (layer === wfdLayer) {
      row.options = colourByOptions(layer);
      item.append(row.options);
    }
    rows.push(row);
    group.rows.push(row);
    container.append(item);
  }

  // Top to bottom, as the web map lists them.
  const topLevel = mapEl.map.layers.toArray().reverse();
  for (const entry of topLevel) {
    const members = entry.type === "group" ? entry.layers.toArray().reverse() : [entry];
    const element = document.createElement("calcite-list-item-group");
    element.heading = entry.type === "group" ? entry.title : "Other layers";
    const group = { element, rows: [] };
    members.filter((layer) => layer.type !== "group" && layer !== riverFlow).forEach((layer) => addLayerRow(layer, element, group));
    if (group.rows.length) {
      groups.push(group);
      listEl.append(element);
    }
  }

  const outOfRange = (layer) => layer.minScale > 0 && view.scale > layer.minScale;

  // Only rows with a zoom limit, or the flow option, depend on the map's scale.
  const scaleRows = rows.filter((row) => row.layer.minScale > 0 || row.checkbox);

  function sync(only = rows) {
    for (const row of only) {
      const { layer, item, toggle } = row;
      const far = outOfRange(layer);
      toggle.checked = layer.visible;
      toggle.disabled = far && !layer.visible;
      item.description = far ? ZOOM_IN : "";
      if (row.options) row.options.hidden = !layer.visible;
      if (row.checkbox) {
        const close = view.scale <= RIVER_NETWORK.flowMinScale;
        row.checkbox.checked = riverFlow.visible;
        row.checkbox.disabled = !close && !riverFlow.visible;
        row.text.textContent = close || riverFlow.visible ? FLOW_LABEL : FLOW_ZOOM_IN;
      }
    }
  }

  // Layers with nothing in the selected area are left out, and a group
  // with nothing left goes too.
  function refresh() {
    for (const row of rows) row.item.hidden = !isListed(row.layer);
    for (const group of groups) group.element.hidden = group.rows.every((row) => row.item.hidden);
  }

  for (const row of rows) reactiveUtils.watch(() => row.layer.visible, () => sync());
  if (riverFlow) reactiveUtils.watch(() => riverFlow.visible, () => sync());
  if (riverNetwork) reactiveUtils.watch(() => riverNetwork.minScale, () => sync()); // its zoom limit comes and goes with the partnership
  reactiveUtils.watch(() => view.scale, () => sync(scaleRows)); // not every row, on every frame of a zoom
  sync();
  refresh();
  return { refresh };
}
