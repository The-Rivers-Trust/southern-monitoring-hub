// =====================================================================
// HISTORY
// Adds a place's full record to its details, with a slider to narrow
// the years shown. The map shows one year at a time, but a chart of one
// year would rarely have enough to show, so every year is fetched the
// first time a chart is opened.
// =====================================================================

import { el } from "../dom.js";
import { describeReading } from "../readings.js";
import { countBySource } from "../aggregation.js";
import { ensureYearLoaded } from "../data/readings-store.js";
import { historyChart } from "./history-chart.js";

function toPoint(row, metric, conventions) {
  const { record, source } = row;
  const { attributes } = record;
  const { dataset, mapping } = source;
  const reading = describeReading(attributes[mapping.field], mapping, conventions);
  const time = new Date(attributes[dataset.fields.date]).getTime();
  return {
    time,
    year: new Date(time).getUTCFullYear(),
    value: row.value,
    isEstimate: row.isEstimate,
    text: `${reading.headline}${metric.basis ? ` as ${metric.basis}` : ""}`,
    site: attributes[dataset.fields.site] || "Site not recorded",
    dataset: dataset.label,
    sourceLabel: dataset.label,
  };
}

const yearSpan = (from, to) => (from === to ? String(from) : `${from}–${to}`);
const readingCount = (count) => `${count.toLocaleString("en-GB")} reading${count === 1 ? "" : "s"}`;

function caption(visible, total, from, to, firstYear, lastYear, placeName) {
  const estimates = visible.some((point) => point.isEstimate) ? " Diamonds are estimates from a range or limit." : "";
  if (from === firstYear && to === lastYear) {
    return `Full record for ${placeName}, all years: ${readingCount(total)}, ${yearSpan(from, to)}.${estimates}`;
  }
  return `Showing ${yearSpan(from, to)}: ${visible.length.toLocaleString("en-GB")} of ${readingCount(total)} for ${placeName}.${estimates}`;
}

function sourcesLine(visible) {
  if (!visible.length) return "";
  const parts = countBySource(visible).map(([label, count]) => `${label} (${count.toLocaleString("en-GB")})`);
  return `Data sources in this chart: ${parts.join(", ")}.`;
}

function yearSlider(firstYear, lastYear, onChange) {
  const slider = document.createElement("calcite-slider");
  slider.className = "historySlider";
  slider.min = firstYear;
  slider.max = lastYear;
  slider.step = 1;
  slider.snap = true;
  slider.value = [firstYear, lastYear];
  slider.labelHandles = true;
  slider.scale = "s";
  slider.minLabel = "First year shown";
  slider.maxLabel = "Last year shown";
  slider.groupSeparator = false;
  slider.addEventListener("calciteSliderInput", () => onChange(slider.value[0], slider.value[1]));
  return slider;
}

// getRows runs once every year is loaded.
export async function appendHistory(root, { catalog, loaded, metric, placeName, getRows }) {
  const section = el("div", "historySection");
  section.append(el("h3", "historyHeading", `${metric.label} over time (${metric.unit}${metric.basis ? ` as ${metric.basis}` : ""})`));
  const status = el("p", "readingNote", "Loading the full record…");
  section.append(status);
  root.append(section);

  try {
    await ensureYearLoaded(catalog, loaded, null);
  } catch (error) {
    console.error(error);
    status.textContent = "Couldn't load the full record. Please try again.";
    return;
  }
  const points = getRows()
    .map((row) => toPoint(row, metric, catalog.conventions))
    .filter((point) => Number.isFinite(point.time));
  const years = points.map((point) => point.year);
  const firstYear = Math.min(...years);
  const lastYear = Math.max(...years);

  const sources = el("p", "readingNote");
  section.append(sources);
  const chartHost = el("div");
  let drawnRange = "";
  const draw = (from, to) => {
    // The slider reports every pixel of a drag, not just each new year.
    if (drawnRange === `${from}-${to}`) return;
    drawnRange = `${from}-${to}`;
    const visible = points.filter((point) => point.year >= from && point.year <= to);
    status.textContent = caption(visible, points.length, from, to, firstYear, lastYear, placeName);
    sources.textContent = sourcesLine(visible);
    chartHost.replaceChildren(visible.length
      ? historyChart(visible, metric, section.clientWidth, from, to)
      : el("p", "readingNote", `No readings in ${yearSpan(from, to)}.`));
  };

  if (firstYear < lastYear) section.append(yearSlider(firstYear, lastYear, draw));
  section.append(chartHost);
  draw(firstYear, lastYear);
}
