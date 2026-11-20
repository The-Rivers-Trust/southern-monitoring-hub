// =====================================================================
// DETERMINAND PANELS
// The two panels behind the buttons on the Determinand explorer's map:
//   Legend - the determinand, how many readings are drawn, and the
//     bands that colour them.
//   Dataset information - for each dataset its equipment and unit,
//     including a plain statement wherever those aren't known.
// =====================================================================

import { el } from "../dom.js";
import { provenanceText } from "../catalog.js";
import { isOnScale, stepLabels } from "../readings.js";
import { BANDS } from "../palette.js";

function marker(shape, colour) {
  const node = el("span", `marker marker--${shape}`);
  if (colour) node.style.setProperty("--marker-colour", colour);
  return node;
}

function legendRow(markerNode, label) {
  const row = el("li", "legendRow");
  row.append(markerNode, el("span", null, label));
  return row;
}

// The bands, highest value first so the list reads top-down like a scale.
function bandLegend(metric, sources) {
  const list = el("ul", "legend");
  const scaled = sources.filter(({ mapping }) => isOnScale(mapping, metric));
  const hasEstimated = scaled.some(({ mapping }) => (mapping.bands || mapping.limits) && !mapping.limitsAreExact);
  const hasExact = scaled.some(({ mapping }) => mapping.valueType !== "banded");
  // With no sources to draw, the bands are still worth showing.
  if (metric.scale && (scaled.length || !sources.length)) {
    const shape = hasEstimated && !hasExact ? "diamond" : "circle";
    stepLabels(metric.scale.breaks).forEach((label, step) => {
      list.prepend(legendRow(marker(shape, BANDS[step].colour), `${BANDS[step].label}: ${label} ${metric.unit}`));
    });
  }
  return list;
}

function datasetCard({ dataset, mapping }, unknownText) {
  const card = el("div", "datasetCard");
  card.append(el("h3", null, dataset.label));
  const facts = el("dl");
  const add = (term, value) => facts.append(el("dt", null, term), el("dd", null, value));
  add("Equipment", provenanceText(mapping.equipment, mapping.equipment.name, unknownText.equipment));
  add("Unit", provenanceText(mapping.unit, mapping.unit.value, unknownText.unit));
  if (mapping.basis) add("Recorded as", provenanceText(mapping.basis, mapping.basis.value, unknownText.basis));
  card.append(facts);
  return card;
}

// The Legend panel. Returns a function to call with the reading counts
// once they're known.
export function renderLegend(container, { metric, sources, yearText }) {
  const summary = el("p", "summary", "Counting readings…");
  summary.setAttribute("aria-live", "polite");
  container.replaceChildren(el("h2", null, metric.label), summary, bandLegend(metric, sources));

  const datasetWord = `${sources.length} dataset${sources.length === 1 ? "" : "s"}`;
  return (total, inView) => {
    const totalText = `${total.toLocaleString("en-GB")} reading${total === 1 ? "" : "s"} ${yearText} from ${datasetWord}`;
    summary.textContent = inView === null ? totalText : `${totalText}, ${inView.toLocaleString("en-GB")} in this map view`;
  };
}

// The Dataset information panel: each dataset's equipment and unit.
export function renderDatasetInfo(container, { sources, conventions, noSourcesNote }) {
  container.replaceChildren(
    ...(sources.length ? sources.map((source) => datasetCard(source, conventions.unknownText)) : [el("p", "note", noSourcesNote)]),
  );
}
