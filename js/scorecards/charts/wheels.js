// =====================================================================
// WHEELS
// The Catchment Health wheel: 8 themes, an inner wedge per theme
// (average of its subs), an outer ring of its sub-categories and the
// overall rating in the hub. Described once as a set of ring segments + a
// centre hub (in a 300-unit square), then drawn either as live SVG (the
// panel) or onto a canvas (PNG for the PDF report, always in the light
// print palette).
// =====================================================================

import { RATING_BANDS, CATCHMENT_HEALTH_SPOKES } from "../config.js";
import { bandForRank, catchmentHealthRanks, themeRank, catchmentHealthOverallRank } from "../ratings.js";
import { hexToRgbArray } from "../format.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const PRINT_PALETTE = { placeholderFill: "#e0e0e0", placeholderText: "#8a8a8a", stroke: "#ffffff", theme: "light" };

// Black or white text, whichever reads better on `hex` (WCAG luminance).
export function textColorOn(hex) {
  const [r, g, b] = hexToRgbArray(hex).slice(0, 3).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.5 ? "#141414" : "#ffffff";
}

// A segment painted with a rating band, or the muted placeholder.
function bandPaint(band, palette) {
  return band
    ? { fill: band.color, labelColor: textColorOn(band.color) }
    : { fill: palette.placeholderFill, labelColor: palette.placeholderText };
}

// ---- Model ----

// `scorecard` null = nothing selected (wired themes show their own colour).
function catchmentHealthModel(scorecard, palette) {
  const ranks = catchmentHealthRanks(scorecard);
  const per = 360 / CATCHMENT_HEALTH_SPOKES.length;
  const themeGap = 2.2;
  const subGap = 0.9;
  const segments = [];
  const aria = [];

  CATCHMENT_HEALTH_SPOKES.forEach((spoke, i) => {
    const start = i * per;
    const themeColor = spoke.color[palette.theme];
    const haveData = !!(spoke.wired && ranks);

    // Inner wedge: rated average (wired + selected), the theme's colour
    // (wired, nothing selected), or grey (not wired yet).
    const avgBand = haveData ? bandForRank(themeRank(spoke, ranks)) : null;
    const mainPaint = haveData ? bandPaint(avgBand, palette)
      : spoke.wired ? { fill: themeColor, labelColor: textColorOn(themeColor) }
        : bandPaint(null, palette);
    segments.push({
      inner: 54, outer: 108, start: start + themeGap / 2, end: start + per - themeGap / 2,
      ...mainPaint, opacity: 1, label: spoke.shortLabel, fontSize: 13,
      spoke, band: haveData ? avgBand : undefined,
    });

    // Outer ring: a theme's own subs are separated by a thinner seam.
    const subPer = per / spoke.subs.length;
    spoke.subs.forEach((sub, j) => {
      const subStart = start + j * subPer + (j === 0 ? themeGap : subGap) / 2;
      const subEnd = start + (j + 1) * subPer - (j === spoke.subs.length - 1 ? themeGap : subGap) / 2;
      let paint = bandPaint(null, palette);
      let opacity = 1;
      if (haveData) paint = bandPaint(bandForRank(ranks[sub.key]), palette);
      else if (spoke.wired) {
        paint = { fill: themeColor, labelColor: textColorOn(themeColor) };
        opacity = 0.32;
      }
      segments.push({ inner: 108, outer: 142, start: subStart, end: subEnd, ...paint, opacity, label: sub.shortLabel, fontSize: 9, radial: true });
    });

    aria.push(`${spoke.label}: ${spoke.subs.map((s) => (haveData ? `${s.label}: ${bandForRank(ranks[s.key])?.label ?? "no data"}` : `${s.label} not yet scored`)).join(", ")}`);
  });

  const overall = bandForRank(catchmentHealthOverallRank(scorecard));
  return {
    segments,
    hub: { r: 50, ...bandPaint(overall, palette), text: overall?.label ?? "No data" },
    aria: `Catchment Health wheel. Overall: ${overall?.label ?? "no data"}. ${aria.join(". ")}.`,
  };
}

// ---- SVG ----

function polar(r, deg) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [150 + r * Math.cos(rad), 150 + r * Math.sin(rad)];
}

function sectorPath({ inner, outer, start, end }) {
  const large = end - start > 180 ? 1 : 0;
  const [ox1, oy1] = polar(outer, start);
  const [ox2, oy2] = polar(outer, end);
  const [ix2, iy2] = polar(inner, end);
  const [ix1, iy1] = polar(inner, start);
  const f = (n) => n.toFixed(2);
  return `M ${f(ox1)} ${f(oy1)} A ${outer} ${outer} 0 ${large} 1 ${f(ox2)} ${f(oy2)} L ${f(ix2)} ${f(iy2)} A ${inner} ${inner} 0 ${large} 0 ${f(ix1)} ${f(iy1)} Z`;
}

// Label position, plus rotation for radial (outer ring) labels - kept
// upright on the lower half of the wheel.
function labelPlacement(seg) {
  const mid = (seg.start + seg.end) / 2;
  const [x, y] = polar((seg.inner + seg.outer) / 2, mid);
  let rotate = 0;
  if (seg.radial) rotate = mid - 90 + (mid > 180 ? 180 : 0);
  return { x, y, rotate };
}

function el(parent, tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  parent.append(node);
  return node;
}

function drawSvg(svg, model, palette) {
  svg.replaceChildren();
  const paths = model.segments.map((seg) => {
    const path = el(svg, "path", { d: sectorPath(seg), fill: seg.fill, "fill-opacity": seg.opacity, stroke: palette.stroke, "stroke-width": 2 });
    const { x, y, rotate } = labelPlacement(seg);
    const text = el(svg, "text", {
      x: x.toFixed(2), y: y.toFixed(2), "text-anchor": "middle", "dominant-baseline": "middle",
      "font-size": seg.fontSize, "font-weight": "bold", fill: seg.labelColor, "pointer-events": "none",
      ...(rotate ? { transform: `rotate(${rotate.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)})` } : {}),
    });
    text.textContent = seg.label;
    return { seg, path, text };
  });
  el(svg, "circle", { cx: 150, cy: 150, r: model.hub.r, fill: model.hub.fill });
  el(svg, "text", { x: 150, y: 140, "text-anchor": "middle", "dominant-baseline": "middle", "font-size": 11, "letter-spacing": "0.05em", fill: model.hub.labelColor, opacity: 0.85 })
    .textContent = "OVERALL";
  el(svg, "text", { x: 150, y: 161, "text-anchor": "middle", "dominant-baseline": "middle", "font-size": 15, "font-weight": "bold", fill: model.hub.labelColor })
    .textContent = model.hub.text;
  svg.setAttribute("aria-label", model.aria);
  return paths;
}

// Inner (theme) wedges are buttons: onActivate(spoke, band, pathEl), where
// band is undefined when there's nothing to rate (not wired / no selection).
export function renderCatchmentHealthWheel(svg, scorecard, palette, onActivate) {
  const drawn = drawSvg(svg, catchmentHealthModel(scorecard, palette), palette);
  for (const { seg, path, text } of drawn) {
    if (!seg.spoke) continue;
    path.classList.add("wheelButton");
    path.setAttribute("tabindex", "0");
    path.setAttribute("role", "button");
    path.setAttribute("aria-label", `${seg.spoke.label}${seg.band !== undefined ? ` - ${seg.band?.label ?? "no data"}` : ""}`);
    const activate = () => {
      // Bring the wedge (and its label) to the front so its outline isn't
      // painted over by the ring next to it.
      svg.append(path, text);
      onActivate(seg.spoke, seg.band, path);
    };
    path.addEventListener("click", activate);
    path.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activate(); }
    });
  }
}

// The five rating bands as a key.
export function renderRatingLegend(container) {
  container.innerHTML = RATING_BANDS.map((b) => `<span class="ratingKeyItem"><span class="ratingKeyDot" style="background:${b.color}"></span>${b.label}</span>`).join("");
}

// ---- Canvas (PDF) ----

// PNG data URL of a wheel with the rating key underneath, `size` px wide.
function drawCanvas(model, size) {
  const legendH = Math.round(size * 0.12);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size + legendH;
  const ctx = canvas.getContext("2d");
  const k = size / 300;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (const seg of model.segments) {
    const a0 = ((seg.start - 90) * Math.PI) / 180;
    const a1 = ((seg.end - 90) * Math.PI) / 180;
    ctx.save();
    ctx.globalAlpha = seg.opacity;
    ctx.beginPath();
    ctx.arc(150 * k, 150 * k, seg.outer * k, a0, a1, false);
    ctx.arc(150 * k, 150 * k, seg.inner * k, a1, a0, true);
    ctx.closePath();
    ctx.fillStyle = seg.fill;
    ctx.fill();
    ctx.lineWidth = size * 0.007;
    ctx.strokeStyle = PRINT_PALETTE.stroke;
    ctx.stroke();
    ctx.restore();

    const { x, y, rotate } = labelPlacement(seg);
    ctx.save();
    ctx.translate(x * k, y * k);
    if (rotate) ctx.rotate((rotate * Math.PI) / 180);
    ctx.fillStyle = seg.labelColor;
    ctx.font = `bold ${Math.round(seg.fontSize * k)}px Helvetica, Arial, sans-serif`;
    ctx.fillText(seg.label, 0, 0);
    ctx.restore();
  }

  ctx.beginPath();
  ctx.arc(150 * k, 150 * k, model.hub.r * k, 0, Math.PI * 2);
  ctx.fillStyle = model.hub.fill;
  ctx.fill();
  ctx.fillStyle = model.hub.labelColor;
  ctx.globalAlpha = 0.85;
  ctx.font = `${Math.round(11 * k)}px Helvetica, Arial, sans-serif`;
  ctx.fillText("OVERALL", 150 * k, 140 * k);
  ctx.globalAlpha = 1;
  ctx.font = `bold ${Math.round(15 * k)}px Helvetica, Arial, sans-serif`;
  ctx.fillText(model.hub.text, 150 * k, 161 * k);

  // Rating key, centred under the wheel.
  const fontSize = Math.round(size * 0.03);
  ctx.font = `${fontSize}px Helvetica, Arial, sans-serif`;
  const dotR = fontSize * 0.32;
  const gap = size * 0.03;
  const widths = RATING_BANDS.map((b) => dotR * 2 + 6 + ctx.measureText(b.label).width);
  let x = size / 2 - (widths.reduce((a, b) => a + b, 0) + gap * (RATING_BANDS.length - 1)) / 2;
  const y = size + legendH / 2;
  ctx.textAlign = "left";
  RATING_BANDS.forEach((band, i) => {
    ctx.beginPath();
    ctx.arc(x + dotR, y, dotR, 0, Math.PI * 2);
    ctx.fillStyle = band.color;
    ctx.fill();
    ctx.fillStyle = "#444444";
    ctx.fillText(band.label, x + dotR * 2 + 6, y);
    x += widths[i] + gap;
  });
  return canvas.toDataURL("image/png");
}

export const WHEEL_IMAGE_ASPECT = 1.12; // height / width, key included

export function catchmentHealthWheelImage(scorecard, size) {
  return drawCanvas(catchmentHealthModel(scorecard, PRINT_PALETTE), size);
}
