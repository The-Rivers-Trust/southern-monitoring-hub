// =====================================================================
// LAYERS PANEL
// The Map layers button and panel, as on the AQuA dashboard. For now it
// holds the Open River Network and its animated flow direction.
//
// Both only draw once zoomed in, so their controls say so and stay off
// until then. Switching flow on needs the network; switching the network
// off also stops flow.
// =====================================================================

import { RIVER_NETWORK } from "../config.js";
import { addRiverNetwork } from "./river-network.js";

const NETWORK_DESCRIPTION = "Width by stream order";
const ZOOM_IN = "Zoom in to view";
const FLOW_LABEL = "Animate flow direction";
const FLOW_ZOOM_IN = "Zoom in further to animate flow direction";

const PANEL_BODY = `
  <div class="sidePanelBody">
    <calcite-list class="layerList" label="Map layers" selection-mode="none" scale="s">
      <calcite-list-item-group heading="Overlays">
        <calcite-list-item data-network-item label="${RIVER_NETWORK.title}" description="${NETWORK_DESCRIPTION}">
          <calcite-switch slot="content-end" data-network scale="s" label="${RIVER_NETWORK.title}"></calcite-switch>
          <div slot="content-bottom" class="layerOptions" data-flow-options hidden>
            <calcite-label layout="inline" scale="s">
              <calcite-checkbox data-flow scale="s"></calcite-checkbox>
              <span data-flow-label>${FLOW_LABEL}</span>
            </calcite-label>
          </div>
        </calcite-list-item>
      </calcite-list-item-group>
    </calcite-list>
  </div>`;

// Adds the layers at `index` in the map's layers and wires up the panel.
export async function setupLayersPanel(mapEl, panel, action, index) {
  const [reactiveUtils] = await $arcgis.import(["@arcgis/core/core/reactiveUtils.js"]);
  const { network, flow } = await addRiverNetwork(mapEl, index);

  panel.innerHTML = PANEL_BODY;
  const networkSwitch = panel.querySelector("[data-network]");
  const networkItem = panel.querySelector("[data-network-item]");
  const flowOptions = panel.querySelector("[data-flow-options]");
  const flowCheckbox = panel.querySelector("[data-flow]");
  const flowLabel = panel.querySelector("[data-flow-label]");

  const state = { network: false, flow: false };

  function applyScaleGating() {
    const { scale } = mapEl.view;
    const drawing = scale <= RIVER_NETWORK.minScale;
    const close = scale <= RIVER_NETWORK.flowMinScale;
    // Once on, either can always be switched off.
    networkSwitch.disabled = !drawing && !state.network;
    networkItem.description = drawing ? NETWORK_DESCRIPTION : ZOOM_IN;
    flowOptions.hidden = !(state.network && flow);
    flowCheckbox.disabled = !close && !state.flow;
    flowLabel.textContent = close || state.flow ? FLOW_LABEL : FLOW_ZOOM_IN;
  }

  function apply() {
    if (flow) flow.visible = state.flow && state.network; // off before the network goes
    network.visible = state.network;
    networkSwitch.checked = state.network;
    flowCheckbox.checked = state.flow;
    applyScaleGating();
  }

  function change(patch) {
    Object.assign(state, patch);
    if (patch.network === false) state.flow = false;
    apply();
  }

  networkSwitch.addEventListener("calciteSwitchChange", () => change({ network: networkSwitch.checked }));
  flowCheckbox.addEventListener("calciteCheckboxChange", () => change({ flow: flowCheckbox.checked }));

  action.addEventListener("click", () => {
    panel.closed = !panel.closed;
    action.active = !panel.closed;
  });
  panel.addEventListener("calcitePanelClose", () => { action.active = false; });

  reactiveUtils.watch(() => mapEl.view.scale, applyScaleGating);
  apply();
}
