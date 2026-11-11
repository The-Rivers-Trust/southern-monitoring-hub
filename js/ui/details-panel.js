// =====================================================================
// DETAILS PANEL
// Legend, reading count and, for each dataset, its equipment and unit,
// including a plain statement wherever those aren't known.
// =====================================================================

import { el } from "../dom.js";
import { provenanceText } from "../catalog.js";
import { isOnScale, stepLabels } from "../readings.js";
import { BANDS, NEUTRAL } from "../palette.js";
import { HEXAGON_LEVELS, hexagonWidthLabel } from "../aggregation.js";

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

function legend(metric, sources, theme, summaries) {
  const list = el("ul", "legend");
  const scaled = sources.filter(({ mapping }) => isOnScale(mapping, metric));
  const hasEstimated = scaled.some(({ mapping }) => (mapping.bands || mapping.limits) && !mapping.limitsAreExact);
  const hasExact = scaled.some(({ mapping }) => mapping.valueType !== "banded");

  // With no sources to draw, the bands are still worth showing.
  if (metric.scale && (scaled.length || !sources.length)) {
    const shape = hasEstimated && !hasExact ? "diamond" : "circle";
    // Highest value first, so the list reads top-down like a scale.
    stepLabels(metric.scale.breaks).forEach((label, step) => {
      list.prepend(legendRow(marker(shape, BANDS[step].colour), `${BANDS[step].label}: ${label} ${metric.unit}`));
    });
  }
  if (summaries.active) {
    list.append(legendRow(marker("square", NEUTRAL), "Filled waterbody: median of the readings inside"));
    list.append(legendRow(marker("hexagon", NEUTRAL), `Zooming in splits each waterbody into hexagons, from ${hexagonWidthLabel(HEXAGON_LEVELS[0].widthMetres)} down to ${hexagonWidthLabel(HEXAGON_LEVELS.at(-1).widthMetres)} across`));
    list.append(legendRow(marker("outline"), "Outlined waterbody: no readings"));
  }
  if (hasExact) list.append(legendRow(marker("circle", NEUTRAL), "Circle: exact reading"));
  if (hasEstimated) list.append(legendRow(marker("diamond", NEUTRAL), "Diamond: recorded as a range or limit, shown at the bottom of it"));
  if (sources.some(({ mapping }) => !isOnScale(mapping, metric))) {
    list.append(legendRow(marker("circle", NEUTRAL), "Reading can't be compared: no common unit"));
  }
  if (sources.some(({ mapping }) => mapping.valueType !== "banded" &&
      (mapping.quality.suspectValues?.length || mapping.quality.plausibleRange))) {
    list.append(legendRow(marker("ring"), "Suspect value, may not be real"));
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

// Returns a function to call with the reading counts once they're known.
export function renderDetails(container, { metric, sources, theme, conventions, clipNote, noSourcesNote, yearText, summaries }) {
  const summary = el("p", "summary", "Counting readings…");
  summary.setAttribute("aria-live", "polite");
  const note = el("p", "note", "Bands match the National River Survey dashboard.");
  const conversionNote = sources.some(({ mapping }) => mapping.toMetricUnit && mapping.toMetricUnit !== 1)
    ? [el("p", "note", `All readings are shown as ${metric.unit} ${metric.basis}, converted where a dataset records them differently.`)]
    : [];
  container.replaceChildren(
    el("h2", null, metric.label),
    summary,
    legend(metric, sources, theme, summaries),
    note,
    ...conversionNote,
    ...(summaries.besideCount
      ? [el("p", "note", `${summaries.besideCount.toLocaleString("en-GB")} of these readings ${summaries.besideCount === 1 ? "is" : "are"} just outside a waterbody boundary, such as in a tidal river channel, and ${summaries.besideCount === 1 ? "counts" : "count"} towards the nearest waterbody.`)]
      : []),
    ...(summaries.outsideCount
      ? [el("p", "note", `${summaries.outsideCount.toLocaleString("en-GB")} of these readings ${summaries.outsideCount === 1 ? "is" : "are"} outside the waterbody catchments, so ${summaries.outsideCount === 1 ? "it stays" : "they stay"} as individual points at every zoom.`)]
      : []),
    el("h2", "sectionHeading", "Data sources"),
    el("p", "note clipNote", clipNote),
    ...(sources.length ? sources.map((source) => datasetCard(source, conventions.unknownText)) : [el("p", "note", noSourcesNote)]),
  );

  const datasetWord = `${sources.length} dataset${sources.length === 1 ? "" : "s"}`;
  return (total, inView) => {
    const totalText = `${total.toLocaleString("en-GB")} reading${total === 1 ? "" : "s"} ${yearText} from ${datasetWord}`;
    summary.textContent = inView === null ? totalText : `${totalText}, ${inView.toLocaleString("en-GB")} in this map view`;
  };
}
