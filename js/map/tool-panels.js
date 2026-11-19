// =====================================================================
// TOOL PANELS
// A map's Map layers, Basemap and Legend panels, as on the AQuA
// dashboard. Each has a button on the map (top right) and a panel that
// opens over the map, closed until its button is pressed. Only one is
// open at a time: opening one closes the others. Pressing an open
// panel's button, or its close icon, closes it.
//
// Markup, in the map's tab <section>: a <calcite-action> per tool inside
// the <arcgis-map> (.layersAction, .basemapAction, .legendAction) and,
// after the map, a <calcite-panel> each (.layersPanel, .basemapPanel,
// .legendPanel).
// =====================================================================

const TOOLS = [
  { panel: ".layersPanel", action: ".layersAction" },
  { panel: ".basemapPanel", action: ".basemapAction" },
  { panel: ".legendPanel", action: ".legendAction" },
];

export function setupToolPanels(mapEl) {
  const view = mapEl.closest(".view");
  if (!view) return;
  const tools = TOOLS
    .map((tool) => ({ panel: view.querySelector(tool.panel), action: mapEl.querySelector(tool.action) }))
    .filter((tool) => tool.panel && tool.action);

  const sync = () => tools.forEach((tool) => { tool.action.active = !tool.panel.closed; });

  for (const tool of tools) {
    tool.action.addEventListener("click", () => {
      const open = tool.panel.closed;
      tools.forEach((other) => { other.panel.closed = !(open && other === tool); });
      sync();
    });
    tool.panel.addEventListener("calcitePanelClose", sync);
  }
}
