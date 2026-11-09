// =====================================================================
// DATA SOURCES PANEL
// The second step of the left panel: the datasets holding the chosen
// determinand, each with a switch to take it off the map. A dataset
// with no data in the selected partnership isn't offered.
// =====================================================================

import { el } from "../dom.js";

const BACK_SLIDE_MS = 400;

// rows: { id, label, description, enabled, available }. Returns a
// function to refresh the rows; onClose runs when the user goes back.
export function openDataSources(flowEl, { metric, rows, emptyText, onToggle, onClose }) {
  const flowItem = document.createElement("calcite-flow-item");
  flowItem.heading = metric.label;
  flowItem.description = "Data sources";

  const list = document.createElement("calcite-list");
  list.label = `${metric.label} data sources`;
  list.selectionMode = "none";
  list.scale = "s";

  const controls = new Map(rows.map((row) => {
    const item = document.createElement("calcite-list-item");
    item.label = row.label;
    const toggle = document.createElement("calcite-switch");
    toggle.slot = "content-end";
    toggle.scale = "s";
    toggle.label = `Show ${row.label} on the map`;
    toggle.addEventListener("calciteSwitchChange", () => onToggle(row.id, toggle.checked));
    item.append(toggle);
    list.append(item);
    return [row.id, { item, toggle }];
  }));

  const hint = el("p", "sourcesHint", "Switch a dataset off to remove it from the map. This applies to every determinand.");
  const empty = el("p", "sourcesHint");
  flowItem.append(hint, empty, list);
  flowItem.addEventListener("calciteFlowItemBack", () => {
    onClose();
    // The flow only hides it. Removed once the slide has finished.
    setTimeout(() => flowItem.remove(), BACK_SLIDE_MS);
  });
  // The flow shows whichever item is marked selected, not the newest.
  flowEl.querySelectorAll("calcite-flow-item").forEach((existing) => { existing.selected = false; });
  flowItem.selected = true;
  flowEl.append(flowItem);

  const update = (latest) => {
    for (const row of latest) {
      const { item, toggle } = controls.get(row.id);
      item.hidden = !row.available;
      item.description = row.description;
      toggle.checked = row.enabled;
    }
    const anyAvailable = latest.some((row) => row.available);
    hint.hidden = !anyAvailable;
    empty.hidden = anyAvailable;
    empty.textContent = anyAvailable ? "" : emptyText();
  };
  update(rows);
  return update;
}
