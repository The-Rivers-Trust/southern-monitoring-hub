// =====================================================================
// METRIC PICKER
// The determinand list, built from the catalogue. Clicking one selects
// it and moves the panel on to its data sources (data-sources-panel.js).
// A determinand with no readings in any year stays listed but can't be
// picked; one that only lacks readings for the current filters can.
// =====================================================================

import { sourcesFor } from "../catalog.js";

// The count shows at the right of the row; when there isn't one, the
// reason sits under the name instead.
function describe(count, anyYearCount, hasSources, yearText) {
  if (!hasSources) return { note: "No data yet", count: "" };
  if (!anyYearCount) return { note: "No readings in this area", count: "" };
  if (!count) return { note: `No readings ${yearText}`, count: "" };
  return { note: "", count: count.toLocaleString("en-GB") };
}

function countLabel() {
  const node = document.createElement("span");
  node.slot = "content-end";
  node.className = "metricCount";
  return node;
}

function chevron() {
  const node = document.createElement("calcite-icon");
  node.slot = "content-end";
  node.icon = "chevron-right";
  node.scale = "s";
  return node;
}

// onOpen(id) runs whenever a determinand is opened, including the one
// already selected. Returns a function to refresh the counts.
export function renderMetricPicker(listEl, catalog, selectedId, onOpen) {
  const items = catalog.metrics.map((metric) => {
    const item = document.createElement("calcite-list-item");
    item.label = metric.label;
    item.value = metric.id;
    item.selected = metric.id === selectedId;
    item.append(countLabel(), chevron());
    return item;
  });
  listEl.append(...items);

  // A click on the row already selected doesn't count as a list change,
  // and the keyboard doesn't produce a click, so both are needed.
  listEl.addEventListener("calciteListChange", () => {
    const id = listEl.selectedItems[0]?.value;
    if (id) onOpen(id);
  });
  items.forEach((item) => item.addEventListener("click", () => {
    if (!item.disabled) onOpen(item.value);
  }));

  return (counts, anyYearCounts, yearText) => {
    for (const item of items) {
      const hasSources = sourcesFor(catalog, item.value).length > 0;
      const { note, count } = describe(counts.get(item.value), anyYearCounts.get(item.value), hasSources, yearText);
      item.description = note;
      item.querySelector(".metricCount").textContent = count;
      item.title = count ? `${count} reading${count === "1" ? "" : "s"} ${yearText}` : "";
      item.disabled = anyYearCounts.get(item.value) === 0;
    }
  };
}
