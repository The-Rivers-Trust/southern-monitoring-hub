// =====================================================================
// SOURCES PANEL
// The Scorecards tab's left-hand panel, open while a waterbody is
// selected: every rated theme and measure with data there, and a tick box
// for each dataset with readings in it in the period. Unticking one
// leaves it out of that measure's rating, chart and map marks, for every
// waterbody, until it's ticked again.
// =====================================================================

import { el } from "../dom.js";
import { CATCHMENT_HEALTH_SPOKES } from "./config.js";
import { allSources, isSourceOn, setSourceOn } from "./hub-sources.js";

function sourceToggle(measureKey, source, onChange) {
  const label = document.createElement("calcite-label");
  label.layout = "inline";
  label.scale = "s";
  label.className = "sourceToggle";
  const checkbox = document.createElement("calcite-checkbox");
  checkbox.scale = "s";
  checkbox.checked = isSourceOn(measureKey, source.dataset);
  checkbox.addEventListener("calciteCheckboxChange", () => {
    setSourceOn(measureKey, source.dataset, checkbox.checked);
    onChange();
  });
  label.append(checkbox, source.name);
  return label;
}

// available: measure key -> the datasets with readings in the waterbody
// in the period. onChange runs after any tick box changes.
export function renderSourcesPanel(container, { available, waterbodyName, periodText, onChange }) {
  const parts = [
    el("h2", null, "Data sources"),
    el("p", "summary", `Datasets with readings in ${waterbodyName} in ${periodText}. Untick one to leave it out of a measure; this applies to every waterbody's scorecard, map and PDF.`),
  ];
  for (const spoke of CATCHMENT_HEALTH_SPOKES.filter((candidate) => candidate.wired)) {
    const measures = spoke.subs.map((sub) => {
      const sources = allSources(sub.key).filter((source) => available[sub.key]?.includes(source.dataset));
      if (!sources.length) return null;
      const measure = el("div", "sourceMeasure");
      measure.append(el("div", "sourceMeasureLabel", sub.label));
      sources.forEach((source) => measure.append(sourceToggle(sub.key, source, onChange)));
      return measure;
    }).filter(Boolean);
    if (!measures.length) continue;
    const section = el("section", "sourceTheme");
    section.append(el("h3", null, spoke.label), ...measures);
    parts.push(section);
  }
  if (parts.length === 2) parts.push(el("p", "note", `No dataset has readings in this waterbody in ${periodText}.`));
  container.replaceChildren(...parts);
}
