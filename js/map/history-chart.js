// =====================================================================
// HISTORY CHART
// A time series of readings, drawn as SVG. Each dot is
// coloured by its threshold band on soft band stripes, with the same
// circles and diamonds as the map. Pointing at the chart picks the
// nearest reading and describes it underneath.
// =====================================================================

import { el } from "../dom.js";
import { stepIndex } from "../readings.js";
import { BANDS } from "../palette.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const MIN_WIDTH = 320;
const HEIGHT = 200;
const MARGIN = { top: 8, right: 10, bottom: 22, left: 40 };
const X_LABEL_SPACING = 70;
const MIN_Y_LABEL_GAP = 12;
const DAY = 86400000;

function svg(tag, attributes = {}, text) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  if (text !== undefined) node.textContent = text;
  return node;
}

function valueTop(points, breaks) {
  const highest = Math.max(...points.map((point) => point.value));
  const firstThreshold = breaks.find((limit) => limit > 0);
  return Math.max(highest, firstThreshold) * 1.08;
}

// Year labels, or every few months when the record is short.
function timeTicks([start, end], maxLabels) {
  const utc = (date) => [date.getUTCFullYear(), date.getUTCMonth()];
  const [startYear] = utc(new Date(start));
  const [endYear] = utc(new Date(end));
  const ticks = [];
  if (end - start > 548 * DAY) {
    const step = Math.ceil((endYear - startYear + 1) / maxLabels);
    for (let year = startYear; year <= endYear + 1; year += step) ticks.push({ time: Date.UTC(year, 0, 1), label: String(year) });
  } else {
    const months = Math.max(1, Math.ceil((end - start) / (30 * DAY) / maxLabels));
    for (let month = 0; month <= (endYear - startYear + 1) * 12; month += months) {
      const time = Date.UTC(startYear, month, 1);
      ticks.push({ time, label: new Date(time).toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" }) });
    }
  }
  return ticks.filter((tick) => tick.time >= start && tick.time <= end);
}

function diamondPoints(x, y, size) {
  return `${x},${y - size} ${x + size},${y} ${x},${y + size} ${x - size},${y}`;
}

const roundLabel = (value) => String(Number(value.toPrecision(3)));

function readoutText(point) {
  const date = new Date(point.time).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return `${date}: ${point.text}. ${point.site}, ${point.dataset}.`;
}

// points: { time, value, isEstimate, text, site, dataset }
// fromYear and toYear set the time axis, from the start of one to the
// end of the other.
export function historyChart(points, metric, availableWidth, fromYear, toYear) {
  const WIDTH = Math.max(MIN_WIDTH, Math.round(availableWidth));
  const sorted = [...points].sort((a, b) => a.time - b.time);
  const { breaks } = metric.scale;
  const domain = [Date.UTC(fromYear, 0, 1), Date.UTC(toYear + 1, 0, 1)];
  const top = valueTop(sorted, breaks);
  const plotRight = WIDTH - MARGIN.right;
  const plotBottom = HEIGHT - MARGIN.bottom;
  const xFor = (time) => MARGIN.left + ((time - domain[0]) / (domain[1] - domain[0])) * (plotRight - MARGIN.left);
  const yFor = (value) => plotBottom - (value / top) * (plotBottom - MARGIN.top);

  const chart = svg("svg", {
    viewBox: `0 0 ${WIDTH} ${HEIGHT}`,
    role: "img",
    "aria-label": `${metric.label} readings over time: ${sorted.length} readings, the highest ${roundLabel(Math.max(...sorted.map((point) => point.value)))} ${metric.unit}.`,
  });

  // Soft stripes for the bands the chart reaches.
  [0, ...breaks].forEach((lower, index) => {
    const upper = breaks[index] ?? top;
    if (lower >= top || upper <= lower) return;
    const yTop = yFor(Math.min(upper, top));
    chart.append(svg("rect", {
      x: MARGIN.left, y: yTop, width: plotRight - MARGIN.left, height: yFor(lower) - yTop, fill: BANDS[index].colour, "fill-opacity": 0.16,
    }));
  });

  // The thresholds, then the highest reading, which sets the scale.
  const highest = Math.max(...sorted.map((point) => point.value));
  let lastLabelY = Infinity;
  [0, ...breaks.filter((limit) => limit > 0 && limit < highest), highest].forEach((value) => {
    const y = yFor(value);
    if (lastLabelY - y < MIN_Y_LABEL_GAP) return;
    lastLabelY = y;
    chart.append(svg("text", { x: MARGIN.left - 5, y: y + 3, "text-anchor": "end", class: "chartLabel" }, roundLabel(value)));
  });

  chart.append(svg("line", { x1: MARGIN.left, x2: plotRight, y1: plotBottom, y2: plotBottom, class: "chartAxis" }));
  timeTicks(domain, Math.floor((WIDTH - MARGIN.left) / X_LABEL_SPACING)).forEach(({ time, label }) => {
    const x = xFor(time);
    chart.append(svg("line", { x1: x, x2: x, y1: plotBottom, y2: plotBottom + 3, class: "chartAxis" }));
    chart.append(svg("text", { x, y: HEIGHT - 6, "text-anchor": "middle", class: "chartLabel" }, label));
  });

  const placed = sorted.map((point) => {
    const x = xFor(point.time);
    const y = yFor(point.value);
    const fill = BANDS[stepIndex(point.value, breaks)].colour;
    chart.append(point.isEstimate
      ? svg("polygon", { points: diamondPoints(x, y, 4), fill, class: "chartMark" })
      : svg("circle", { cx: x, cy: y, r: 3.2, fill, class: "chartMark" }));
    return { point, x, y };
  });

  const highlight = svg("circle", { r: 6, class: "chartHighlight", visibility: "hidden" });
  chart.append(highlight);

  const readout = el("p", "chartReadout", "Point at the chart to see a reading.");
  readout.setAttribute("aria-live", "polite");

  // Pointer tracking picks the nearest reading, so small dots stay usable.
  const pickNearest = (event) => {
    const box = chart.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * WIDTH;
    const py = ((event.clientY - box.top) / box.height) * HEIGHT;
    let nearest = placed[0];
    let best = Infinity;
    for (const candidate of placed) {
      const distance = (candidate.x - px) ** 2 + (candidate.y - py) ** 2;
      if (distance < best) {
        best = distance;
        nearest = candidate;
      }
    }
    highlight.setAttribute("cx", nearest.x);
    highlight.setAttribute("cy", nearest.y);
    highlight.setAttribute("visibility", "visible");
    readout.textContent = readoutText(nearest.point);
  };
  chart.addEventListener("pointermove", pickNearest);
  chart.addEventListener("pointerdown", pickNearest); // a tap on a phone

  const wrapper = el("div", "historyChart");
  wrapper.append(chart, readout);
  return wrapper;
}
