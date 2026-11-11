// =====================================================================
// BAR CHART
// The scorecards' compact trend charts: one determinand's readings,
// pooled across a waterbody, averaged per month and drawn as one bar for
// every month of the period, over that determinand's threshold bands
// (tinted backgrounds + dashed threshold lines). A month with no readings
// keeps its place, marked by a grey dash on the baseline. The
// y-axis is fixed rather than fitted to the data, so the bands keep their
// true proportions: SCORECARD.trendChartMaxOverride, else the
// equipment's range, else the next threshold above the data.
// Drawn as SVG (panels) or onto a canvas (PNG for the PDF reports).
// =====================================================================

import { SCORECARD } from "../config.js";
import { bandsForMetric, metricColor } from "../metrics.js";
import { getDateRange } from "../date-range.js";
import { formatTickValue, hexToRgbArray } from "../format.js";
import { niceTicks, niceNumber } from "./nice-ticks.js";

const SVG_NS = "http://www.w3.org/2000/svg";

// Every period the scorecard offers is a year or a quarter, so the
// charts are always monthly.
export function bucketGranularity() {
  return "month";
}

const CADENCE = { day: "daily", week: "weekly", month: "monthly" };
const NO_DATA_COLOR = "#8f8d86";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function chartTitle(metric, granularity) {
  return `${metric.label} (${metric.unit}) – ${CADENCE[granularity]} average`;
}

const monthStart = (ms) => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
};

// Every month of the period, oldest first: { date (month start), label
// ("Jan"), name ("Jan 2026"), value (mean, or null with no readings),
// count }. Without a fixed period, the months the readings span.
function bucket(points) {
  const { from, to } = getDateRange();
  const times = points.map((p) => new Date(p.date).getTime());
  const first = monthStart(from ?? Math.min(...times));
  const last = monthStart(to ?? Math.max(...times));
  const months = new Map();
  for (let d = new Date(first); d.getTime() <= last; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    months.set(d.getTime(), { sum: 0, count: 0 });
  }
  points.forEach((p, i) => {
    const month = months.get(monthStart(times[i]));
    if (!month) return;
    month.sum += p.value;
    month.count += 1;
  });
  return [...months].map(([date, m]) => ({
    date,
    label: MONTHS[new Date(date).getMonth()],
    name: `${MONTHS[new Date(date).getMonth()]} ${new Date(date).getFullYear()}`,
    value: m.count ? m.sum / m.count : null,
    count: m.count,
  }));
}

function yMaxFor(metric, bands, dataMax, equipMax) {
  const override = SCORECARD.trendChartMaxOverride[metric.key];
  if (override !== undefined) return dataMax > override ? niceNumber(dataMax * 1.08, true) : override;
  if (equipMax !== undefined) return equipMax;
  if (!bands) return niceTicks(0, dataMax, 3).max;
  const next = bands.slice(0, 4).map((b) => b.max).find((t) => t > 0 && t >= dataMax);
  return (next ?? Math.max(dataMax, bands[3].max) * 1.15) * 1.08;
}

// Everything both renderers need, in plot coordinates.
function layout(metric, points, granularity, equipMax, width, height, margin, labelGap) {
  const buckets = bucket(points);
  const bands = bandsForMetric(metric.key);
  const dataMax = Math.max(0, ...buckets.filter((p) => p.value !== null).map((p) => p.value));
  const yMax = yMaxFor(metric, bands, dataMax, equipMax);
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const y = (v) => margin.top + plotH - (Math.min(v, yMax) / yMax) * plotH;
  const slot = plotW / buckets.length;
  const x = (i) => margin.left + slot * (i + 0.5);

  let lower = 0;
  const bandRects = (bands ?? []).map((band) => {
    const top = Math.min(band.max ?? Infinity, yMax);
    const bottom = Math.min(lower, yMax);
    lower = band.max ?? Infinity;
    return top > bottom ? { color: band.color, y: y(top), h: y(bottom) - y(top) } : null;
  }).filter(Boolean);

  const thresholds = (bands ?? []).slice(0, 4).filter((b) => b.max > 0 && b.max < yMax).map((b) => ({ color: b.color, y: y(b.max) }));

  // 0 and each visible threshold, skipping any too close to the last.
  const candidates = bands ? [0, ...bands.slice(0, 4).map((b) => b.max).filter((v) => v > 0 && v <= yMax)] : niceTicks(0, dataMax, 3).ticks;
  const yLabels = [];
  for (const v of candidates) {
    if (yLabels.length && Math.abs(yLabels[yLabels.length - 1].y - y(v)) < labelGap) continue;
    yLabels.push({ y: y(v), text: formatTickValue(v) });
  }

  // Every month labelled; just its initial where the months are narrow.
  const xLabels = buckets.map((p, i) => ({ x: x(i), text: slot >= 22 ? p.label : p.label[0], anchor: "middle" }));

  return {
    plotW, plotH, y0: y(0), bandRects, thresholds, yLabels, xLabels,
    bars: buckets.flatMap((p, i) => (p.value === null ? [] : [{ x: x(i), y: y(p.value), name: p.name, value: p.value, count: p.count }])),
    empty: buckets.flatMap((p, i) => (p.value === null ? [{ x: x(i), name: p.name }] : [])),
    barW: slot * 0.62,
  };
}

// Blend toward the card's background rather than use opacity, so band
// tints read the same on dark and light surfaces.
function mix(hex, towardHex, fraction) {
  const a = hexToRgbArray(hex);
  const b = hexToRgbArray(towardHex);
  return `#${[0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * fraction).toString(16).padStart(2, "0")).join("")}`;
}

function backgroundHex(el) {
  const nums = getComputedStyle(el).backgroundColor.match(/\d+/g);
  return nums && nums.length >= 3 ? `#${nums.slice(0, 3).map((n) => Number(n).toString(16).padStart(2, "0")).join("")}` : "#808080";
}

// Appends a chart card to `container` and returns its width (so sibling
// cards can skip measuring), or null with no data.
export function renderBarChart(container, { metric, points, granularity, equipMax, knownWidth }) {
  if (!points.length) return null;
  const card = document.createElement("div");
  card.className = "barChart";
  const title = document.createElement("div");
  title.className = "barChartTitle";
  title.textContent = chartTitle(metric, granularity);
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "barChartSvg");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", title.textContent);
  card.append(title, svg);
  container.append(card);

  const width = knownWidth || Math.max(Math.round(svg.getBoundingClientRect().width) || 0, 260);
  const height = 130;
  const margin = { left: 38, right: 12, top: 10, bottom: 20 };
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const L = layout(metric, points, granularity, equipMax, width, height, margin, 10);
  const surface = backgroundHex(card);
  const add = (tag, attrs, className) => {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (className) node.setAttribute("class", className);
    svg.append(node);
    return node;
  };

  for (const r of L.bandRects) add("rect", { x: margin.left, y: r.y, width: L.plotW, height: r.h, fill: mix(r.color, surface, 0.82) });
  for (const l of L.yLabels) add("text", { x: margin.left - 6, y: l.y + 3, "text-anchor": "end" }, "trendTick").textContent = l.text;
  add("line", { x1: margin.left, x2: width - margin.right, y1: L.y0, y2: L.y0 }, "trendBaseline");
  const barW = Math.min(L.barW, 34);
  const color = metricColor(metric);
  for (const b of L.bars) {
    const bar = add("rect", { x: b.x - barW / 2, y: b.y, width: barW, height: L.y0 - b.y, fill: color, rx: 1.5 });
    const tip = document.createElementNS(SVG_NS, "title");
    tip.textContent = `${b.name}: ${formatTickValue(b.value)} ${metric.unit} (${b.count} reading${b.count === 1 ? "" : "s"})`;
    bar.append(tip);
  }
  for (const e of L.empty) {
    const dash = add("rect", { x: e.x - barW / 2, y: L.y0 - 3, width: barW, height: 3, fill: NO_DATA_COLOR, rx: 1 }, "barNoData");
    const tip = document.createElementNS(SVG_NS, "title");
    tip.textContent = `${e.name}: no readings`;
    dash.append(tip);
  }
  for (const t of L.thresholds) {
    add("line", { x1: margin.left, x2: width - margin.right, y1: t.y, y2: t.y, stroke: t.color, "stroke-width": 1, "stroke-dasharray": "3,2", "stroke-opacity": 0.8 });
  }
  for (const l of L.xLabels) add("text", { x: l.x, y: height - 4, "text-anchor": l.anchor }, "trendTick").textContent = l.text;
  if (L.empty.length) {
    const key = document.createElement("div");
    key.className = "barChartKey";
    const swatch = document.createElement("span");
    swatch.className = "barChartNoData";
    key.append(swatch, `No readings that month (${L.empty.length} of ${L.empty.length + L.bars.length})`);
    card.append(key);
  }
  return width;
}

// PNG data URL on white, or null with no data. `showTitle: false` leaves
// the title out, for reports that label the chart themselves.
export function barChartImage(metric, points, granularity, equipMax, width, height, { showTitle = true } = {}) {
  if (!points.length) return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const margin = { left: 64, right: 20, top: showTitle ? 40 : 14, bottom: 44 };
  const L = layout(metric, points, granularity, equipMax, width, height, margin, 18);

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#111111";
  ctx.font = "bold 20px Helvetica, Arial, sans-serif";
  if (showTitle) ctx.fillText(chartTitle(metric, granularity), margin.left, 24);

  ctx.globalAlpha = 0.14;
  for (const r of L.bandRects) {
    ctx.fillStyle = r.color;
    ctx.fillRect(margin.left, r.y, L.plotW, r.h);
  }
  ctx.globalAlpha = 1;

  ctx.font = "16px Helvetica, Arial, sans-serif";
  ctx.fillStyle = "#666666";
  ctx.textAlign = "right";
  for (const l of L.yLabels) ctx.fillText(l.text, margin.left - 10, l.y + 5);

  ctx.strokeStyle = "#999999";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(margin.left, L.y0);
  ctx.lineTo(width - margin.right, L.y0);
  ctx.stroke();

  const barW = Math.min(L.barW, 70);
  ctx.fillStyle = metric.colorLight; // always printed on white
  for (const b of L.bars) ctx.fillRect(b.x - barW / 2, b.y, barW, L.y0 - b.y);
  ctx.fillStyle = NO_DATA_COLOR;
  for (const e of L.empty) ctx.fillRect(e.x - barW / 2, L.y0 - 5, barW, 5);

  ctx.setLineDash([5, 4]);
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = 1.4;
  for (const t of L.thresholds) {
    ctx.strokeStyle = t.color;
    ctx.beginPath();
    ctx.moveTo(margin.left, t.y);
    ctx.lineTo(width - margin.right, t.y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  ctx.fillStyle = "#666666";
  for (const l of L.xLabels) {
    ctx.textAlign = l.anchor === "start" ? "left" : l.anchor === "end" ? "right" : "center";
    ctx.fillText(l.text, l.x, height - 14);
  }
  return canvas.toDataURL("image/png");
}
