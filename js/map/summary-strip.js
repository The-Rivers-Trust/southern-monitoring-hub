// =====================================================================
// SUMMARY STRIP
// Every reading behind a waterbody or hexagon summary on one line, as on
// the AQuA dashboard's catchment strip: a dot per reading (coloured by
// its threshold band, a diamond where the value isn't exact), a solid
// bar at the mean.
// Dashed lines mark the band limits. Plain SVG.
// =====================================================================

import { el } from "../dom.js";
import { stepIndex } from "../readings.js";
import { BANDS } from "../palette.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const WIDTH = 640;
const ROW = 60;
const PAD = { left: 14, right: 16, top: 22, axis: 26 };
const JITTER = ROW * 0.3;

function svg(tag, attributes = {}, text) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  if (text !== undefined) node.textContent = text;
  return node;
}

const round = (value) => String(Number(value.toPrecision(3)));

// Past this many times the highest band limit, the axis goes log-style so
// a few extreme readings don't squash the rest into one corner.
const LOG_ABOVE = 5;
const MIN_TICK_GAP = 34; // pixels between axis labels

// Round axis steps, about six of them.
function tickValues(top) {
  const rough = top / 6;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((candidate) => candidate >= rough);
  const ticks = [];
  for (let value = 0; value <= top + 1e-9; value += step) ticks.push(Number(value.toPrecision(6)));
  return ticks;
}

// Zero, the band limits and each power of ten, dropping any label that
// would sit on the one before.
function logTicks(top, breaks, x) {
  const wanted = new Set([0, ...breaks.filter((limit) => limit > 0)]);
  for (let power = 10 ** Math.floor(Math.log10(Math.min(...breaks.filter((limit) => limit > 0)))); power <= top; power *= 10) wanted.add(power);
  const ticks = [];
  for (const value of [...wanted].filter((v) => v <= top).sort((a, b) => a - b)) {
    if (!ticks.length || x(value) - x(ticks.at(-1)) >= MIN_TICK_GAP) ticks.push(value);
  }
  return ticks;
}

const diamond = (x, y, size) => `${x},${y - size} ${x + size},${y} ${x},${y + size} ${x - size},${y}`;

// summary: { readings: [{ value, estimate, source, site }], mean }
export function summaryStrip(summary, metric) {
  const { readings, mean } = summary;
  const { breaks } = metric.scale;
  const unit = `${metric.unit}${metric.basis ? ` as ${metric.basis}` : ""}`;
  const highest = Math.max(...readings.map((reading) => reading.value));
  const top = Math.max(highest, breaks.find((limit) => limit > 0) ?? 0) * 1.06 || 1;
  const x0 = PAD.left;
  const x1 = WIDTH - PAD.right;
  const firstLimit = breaks.find((limit) => limit > 0) ?? 1;
  const isLog = highest > LOG_ABOVE * Math.max(...breaks);
  // log10(1 + value / first limit): zero stays at zero, and the band limits spread out.
  const scaled = (value) => (isLog ? Math.log10(1 + value / firstLimit) : value);
  const x = (value) => x0 + (scaled(value) / scaled(top)) * (x1 - x0);
  const plotBottom = PAD.top + ROW;
  const height = plotBottom + PAD.axis;
  const mid = PAD.top + ROW / 2;

  const chart = svg("svg", {
    viewBox: `0 0 ${WIDTH} ${height}`,
    role: "img",
    "aria-label": `${metric.label}: ${readings.length} readings, the mean ${round(mean)} ${unit}, the highest ${round(highest)} ${unit}.`,
  });

  // The row, tinted like AQuA's highlighted catchment, with the bands behind it.
  chart.append(svg("rect", { class: "stripBand", x: 0, y: PAD.top, width: WIDTH, height: ROW, rx: 3 }));
  [0, ...breaks].forEach((lower, index) => {
    const upper = breaks[index] ?? top;
    if (lower >= top || upper <= lower) return;
    chart.append(svg("rect", {
      x: x(lower), y: PAD.top, width: x(Math.min(upper, top)) - x(lower), height: ROW, fill: BANDS[index].colour, "fill-opacity": 0.1,
    }));
  });

  // Axis, then the band limits.
  chart.append(svg("line", { class: "chartAxis", x1: x0, x2: x1, y1: plotBottom, y2: plotBottom }));
  const ticks = isLog ? logTicks(top, breaks, x, x1) : tickValues(top);
  ticks.forEach((value) => {
    chart.append(svg("line", { class: "chartAxis", x1: x(value), x2: x(value), y1: plotBottom, y2: plotBottom + 3 }));
    chart.append(svg("text", { class: "chartLabel", x: x(value), y: plotBottom + 15, "text-anchor": "middle" }, round(value)));
  });
  breaks.filter((limit) => limit > 0 && limit < top).forEach((limit) => {
    chart.append(svg("line", { class: "stripLimit", x1: x(limit), x2: x(limit), y1: PAD.top, y2: plotBottom }));
  });

  // The readings. The same sideways nudge on every draw, so dots that
  // overlap spread out without moving about.
  readings.forEach((reading, index) => {
    const cx = x(reading.value);
    const cy = mid + ((((index * 31) % 11) - 5) / 5) * JITTER;
    const fill = BANDS[stepIndex(reading.value, breaks)].colour;
    const mark = reading.estimate
      ? svg("polygon", { class: "stripDot", points: diamond(cx, cy, 4.2), fill })
      : svg("circle", { class: "stripDot", cx: cx.toFixed(1), cy: cy.toFixed(1), r: 3.4, fill });
    mark.append(svg("title", {}, `${[reading.site, reading.source].filter(Boolean).join(", ")}: ${round(reading.value)} ${unit}${reading.estimate ? " (not an exact value)" : ""}`));
    chart.append(mark);
  });

  // The mean, as a bar across the row.
  chart.append(svg("line", { class: "stripMean", x1: x(mean), x2: x(mean), y1: PAD.top - 6, y2: plotBottom }));
  // Kept inside the chart: starts at the line near the left edge, ends at it near the right.
  const labelAnchor = x(mean) < x0 + 50 ? "start" : x(mean) > x1 - 50 ? "end" : "middle";
  chart.append(svg("text", { class: "stripMeanLabel", x: x(mean), y: PAD.top - 9, "text-anchor": labelAnchor }, `Mean ${round(mean)}`));

  const key = el("p", "stripKey");
  const item = (mark, text) => {
    const node = el("span");
    node.append(mark, text);
    return node;
  };
  const swatch = (className) => el("i", className);
  key.append(
    item(swatch("keyMean"), `Mean ${round(mean)} ${unit}`),
    item(swatch("keyLimit"), "Band limit"),
  );
  if (readings.some((reading) => reading.estimate)) key.append(item(swatch("keyEstimate"), "Not an exact value"));

  const figure = el("figure", "summaryStrip");
  figure.append(el("figcaption", null, `Every ${metric.label} reading (${unit}${isLog ? ", log-style scale" : ""})`), chart, key);
  return figure;
}
