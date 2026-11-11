// =====================================================================
// CATCHMENT HEALTH PDF
// A4, portrait.
//   Page 1 - summary: header with the overall rating, the wheel beside a
//            map, a "themes at a glance" table and the data sources.
//   Page 2+ - detail: a section per wired theme. Nutrients & Sediment is
//            a two-column grid of trend charts; the others a table of
//            measure / rating / evidence.
// Every rating is drawn the same way - a coloured dot and its label -
// and every block is measured before it's drawn, so nothing is split
// across a page break.
// =====================================================================

import { CATCHMENT_HEALTH_SPOKES, RATING_BANDS } from "./config.js";
import { getMetric } from "./metrics.js";
import { bandForRank, catchmentHealthRanks, themeRank, catchmentHealthOverallRank } from "./ratings.js";
import { catchmentHealthWheelImage, WHEEL_IMAGE_ASPECT } from "./charts/wheels.js";
import { barChartImage } from "./charts/bar-chart.js";
import { dataSourceRows, subDetailLines } from "./scorecard-text.js";
import { rect, text, rgb } from "./pdf-common.js";

const PAGE = { width: 210, height: 297, margin: 18 };
const CONTENT_W = PAGE.width - PAGE.margin * 2;
const CONTENT_BOTTOM = PAGE.height - 18; // footer rule sits 3mm below this
const COLOR = {
  ink: "#1f2933",
  body: "#3e4c59",
  muted: "#7b8794",
  rule: "#dde2e8",
  panel: "#f5f7fa",
  noData: "#c3cad3",
};
const CADENCE = { day: "daily", week: "weekly", month: "monthly" };
// Chart height / width - low enough for the six nutrient charts to share
// a page with the other themes.
const CHART_ASPECT = 0.34;

// ---- Small drawing helpers ----

function rule(doc, y, x = PAGE.margin, width = CONTENT_W) {
  rect(doc, x, y, width, 0.25, COLOR.rule);
}

function eyebrow(doc, label, x, y, align) {
  text(doc, label.toUpperCase(), x, y, { fontSize: 7, bold: true, color: COLOR.muted, spaced: true, align });
}

// A rating: coloured dot + label. Returns the width used. align "right"
// puts the label's end at x.
function ratingMark(doc, band, x, y, { fontSize = 8.5, align = "left", label } = {}) {
  const words = label ?? band?.label ?? "No data";
  doc.setFont("helvetica", band ? "bold" : "normal");
  doc.setFontSize(fontSize);
  const r = fontSize * 0.13;
  const width = r * 2 + 1.6 + doc.getTextWidth(words);
  const left = align === "right" ? x - width : x;
  const cy = y - fontSize * 0.11;
  doc.setFillColor(...rgb(band?.color ?? COLOR.noData));
  doc.circle(left + r, cy, r, "F");
  text(doc, words, left + r * 2 + 1.6, y, { fontSize, bold: !!band, color: band ? COLOR.ink : COLOR.muted });
  return width;
}

function wrap(doc, value, width, fontSize, style = "normal") {
  doc.setFont("helvetica", style);
  doc.setFontSize(fontSize);
  return doc.splitTextToSize(value, width);
}

// Line height in mm for a font size in pt.
const lineH = (fontSize) => fontSize * 0.42;

// ---- Data for the summary page ----

function themeSummaries(ranks) {
  return CATCHMENT_HEALTH_SPOKES.map((spoke) => {
    if (!spoke.wired) return { spoke, band: null, basis: "Not yet assessed", wired: false };
    const rated = spoke.subs.filter((s) => ranks[s.key] != null).length;
    return {
      spoke,
      band: bandForRank(themeRank(spoke, ranks)),
      basis: `${rated} of ${spoke.subs.length} measure${spoke.subs.length === 1 ? "" : "s"} rated`,
      wired: true,
    };
  });
}

export function buildCatchmentHealthPdf(JsPDF, { waterbodyName, waterBodyId, scorecard, screenshot, dateRangeText, granularity, equipmentRanges }) {
  const doc = new JsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const M = PAGE.margin;
  const ranks = catchmentHealthRanks(scorecard);
  const overall = bandForRank(catchmentHealthOverallRank(scorecard));
  const generated = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  // ================= Page 1: summary =================
  // A thin strip of the overall rating's colour across the top.
  rect(doc, 0, 0, PAGE.width, 2, overall?.color ?? COLOR.noData);

  eyebrow(doc, "Catchment Health Scorecard", M, 16);
  const titleLines = wrap(doc, waterbodyName, CONTENT_W - 52, 20, "bold");
  text(doc, titleLines, M, 25, { fontSize: 20, bold: true, color: COLOR.ink });
  let y = 25 + (titleLines.length - 1) * lineH(20) * 1.15;
  const meta = [waterBodyId && `WFD ${waterBodyId}`, `Period: ${dateRangeText}`, `Generated ${generated}`].filter(Boolean).join("   ·   ");
  text(doc, meta, M, y + 7, { fontSize: 8, color: COLOR.muted });

  // Overall rating, top right.
  eyebrow(doc, "Overall rating", PAGE.width - M, 16, "right");
  ratingMark(doc, overall, PAGE.width - M, 25, { fontSize: 15, align: "right" });

  y += 12;
  rule(doc, y);
  y += 7;

  // Wheel and map, side by side, same height.
  const colGap = 8;
  const colW = (CONTENT_W - colGap) / 2;
  const rowH = colW * WHEEL_IMAGE_ASPECT;
  doc.addImage(catchmentHealthWheelImage(scorecard, 900), "PNG", M, y, colW, rowH);
  const mapX = M + colW + colGap;
  rect(doc, mapX, y, colW, rowH, COLOR.panel, { radius: 1.5, borderHex: COLOR.rule });
  if (screenshot) {
    // Contain-fit inside the frame.
    const pad = 2;
    const aspect = screenshot.data.height / screenshot.data.width;
    let w = colW - pad * 2;
    let h = w * aspect;
    if (h > rowH - pad * 2) {
      h = rowH - pad * 2;
      w = h / aspect;
    }
    doc.addImage(screenshot.dataUrl, "PNG", mapX + (colW - w) / 2, y + (rowH - h) / 2, w, h);
  }
  y += rowH + 10;

  // Themes at a glance.
  eyebrow(doc, "Themes at a glance", M, y);
  y += 3;
  rule(doc, y);
  const col = { theme: M, rating: M + 78, basis: M + 118 };
  y += 2;
  text(doc, "Theme", col.theme, y + 3.5, { fontSize: 7.5, bold: true, color: COLOR.muted });
  text(doc, "Rating", col.rating, y + 3.5, { fontSize: 7.5, bold: true, color: COLOR.muted });
  text(doc, "Basis", col.basis, y + 3.5, { fontSize: 7.5, bold: true, color: COLOR.muted });
  y += 6;
  for (const row of themeSummaries(ranks)) {
    rule(doc, y);
    const baseline = y + 4.8;
    text(doc, row.spoke.label, col.theme, baseline, { fontSize: 9, bold: row.wired, color: row.wired ? COLOR.ink : COLOR.muted });
    if (row.wired) ratingMark(doc, row.band, col.rating, baseline, { fontSize: 8.5 });
    else text(doc, "—", col.rating, baseline, { fontSize: 9, color: COLOR.muted });
    text(doc, row.basis, col.basis, baseline, { fontSize: 8.5, color: row.wired ? COLOR.body : COLOR.muted });
    y += 7;
  }
  rule(doc, y);
  y += 10;

  // Data sources.
  eyebrow(doc, "Data sources", M, y);
  y += 3;
  rule(doc, y);
  for (const source of dataSourceRows(scorecard)) {
    const baseline = y + 4.8;
    text(doc, source.name, col.theme, baseline, { fontSize: 9, bold: true, color: COLOR.ink });
    text(doc, source.coverage || "—", col.basis, baseline, { fontSize: 8.5, color: COLOR.body });
    y += 7;
    rule(doc, y);
  }

  // ================= Page 2+: detail =================
  const runningHeader = () => {
    rect(doc, 0, 0, PAGE.width, 2, overall?.color ?? COLOR.noData);
    text(doc, waterbodyName, M, 12, { fontSize: 9, bold: true, color: COLOR.ink });
    text(doc, "Catchment Health · Detail", PAGE.width - M, 12, { fontSize: 8, color: COLOR.muted, align: "right" });
    rule(doc, 15);
  };
  const newPage = () => {
    doc.addPage();
    runningHeader();
    y = 24;
  };
  const ensure = (height) => {
    if (y + height > CONTENT_BOTTOM) newPage();
  };
  newPage();

  // Theme heading: name left, rating right, rule under. 12mm tall.
  const themeHeading = (spoke, band) => {
    text(doc, spoke.label, M, y + 5, { fontSize: 13, bold: true, color: COLOR.ink });
    ratingMark(doc, band, PAGE.width - M, y + 5, { fontSize: 9.5, align: "right" });
    y += 8;
    rule(doc, y);
    y += 5;
  };

  // Nutrients & Sediment: a two-column grid of charts, each labelled with
  // its measure, rating and figure.
  const chartGrid = (spoke) => {
    const gap = 8;
    const cellW = (CONTENT_W - gap) / 2;
    const chartH = cellW * CHART_ASPECT;
    const intro = `Bars are ${CADENCE[granularity]} averages across every monitoring site in the waterbody, from every data source listed, over the threshold bands. A grey dash on the baseline marks a month with no readings.`;
    const introLines = wrap(doc, intro, CONTENT_W, 8);
    const cells = spoke.subs.map((sub) => {
      const metric = getMetric(sub.key);
      const caption = wrap(doc, subDetailLines(sub.key, scorecard)[0], cellW, 7.5);
      return { sub, metric, band: bandForRank(ranks[sub.key]), caption };
    });
    // Nothing to chart at all: one line rather than a grid of empty boxes.
    if (spoke.subs.every((s) => !(scorecard[`${s.key}Series`] ?? []).length)) {
      ensure(13 + 10);
      themeHeading(spoke, bandForRank(themeRank(spoke, ranks)));
      text(doc, "No readings in this waterbody for the date range.", M, y, { fontSize: 8.5, color: COLOR.muted });
      y += 12;
      return;
    }

    const rows = [];
    for (let i = 0; i < cells.length; i += 2) rows.push(cells.slice(i, i + 2));
    // Label, chart, caption - the gap after a row isn't needed at a page end.
    const rowGap = 5;
    const rowHeight = (row) => 6 + chartH + 2 + Math.max(...row.map((c) => c.caption.length)) * lineH(7.5) + 1;

    ensure(13 + introLines.length * lineH(8) + 4 + rowHeight(rows[0]));
    themeHeading(spoke, bandForRank(themeRank(spoke, ranks)));
    text(doc, introLines, M, y, { fontSize: 8, color: COLOR.muted });
    y += introLines.length * lineH(8) + 4;

    for (const row of rows) {
      const height = rowHeight(row);
      ensure(height);
      row.forEach((cell, i) => {
        const x = M + i * (cellW + gap);
        text(doc, `${cell.sub.label}${cell.metric ? ` (${cell.metric.unit})` : ""}`, x, y + 3.5, { fontSize: 8.5, bold: true, color: COLOR.ink });
        ratingMark(doc, cell.band, x + cellW, y + 3.5, { fontSize: 8, align: "right" });
        const image = cell.metric && barChartImage(cell.metric, scorecard[`${cell.sub.key}Series`] ?? [], granularity,
          equipmentRanges[cell.sub.key]?.max, 600, Math.round(600 * CHART_ASPECT), { showTitle: false });
        if (image) {
          doc.addImage(image, "PNG", x, y + 6, cellW, chartH);
        } else {
          rect(doc, x, y + 6, cellW, chartH, COLOR.panel, { radius: 1 });
          text(doc, "No readings in this date range", x + cellW / 2, y + 6 + chartH / 2, { fontSize: 8, color: COLOR.muted, align: "center" });
        }
        text(doc, cell.caption, x, y + 6 + chartH + 4, { fontSize: 7.5, color: COLOR.body });
      });
      y += height + rowGap;
    }
    y += 4;
  };

  // Other themes: measure / rating / evidence table.
  const measureTable = (spoke) => {
    const col = { measure: M, rating: M + 40, evidence: M + 74 };
    const evidenceW = PAGE.width - M - col.evidence;
    const rows = spoke.subs.map((sub) => {
      const [first, ...rest] = subDetailLines(sub.key, scorecard);
      return {
        sub,
        band: bandForRank(ranks[sub.key]),
        evidence: wrap(doc, first, evidenceW, 8.5),
        caveat: rest.length ? wrap(doc, rest.join(" "), evidenceW, 7.5, "italic") : [],
      };
    });
    const rowHeight = (r) => 3 + r.evidence.length * lineH(8.5) * 1.15 + (r.caveat.length ? 1.5 + r.caveat.length * lineH(7.5) * 1.15 : 0) + 3;

    ensure(13 + 6 + rowHeight(rows[0]));
    themeHeading(spoke, bandForRank(themeRank(spoke, ranks)));
    text(doc, "Measure", col.measure, y, { fontSize: 7.5, bold: true, color: COLOR.muted });
    text(doc, "Rating", col.rating, y, { fontSize: 7.5, bold: true, color: COLOR.muted });
    text(doc, "Evidence", col.evidence, y, { fontSize: 7.5, bold: true, color: COLOR.muted });
    y += 2.5;
    for (const r of rows) {
      const height = rowHeight(r);
      ensure(height);
      rule(doc, y);
      const baseline = y + 3 + lineH(8.5);
      text(doc, r.sub.label, col.measure, baseline, { fontSize: 9, bold: true, color: COLOR.ink });
      ratingMark(doc, r.band, col.rating, baseline, { fontSize: 8.5 });
      text(doc, r.evidence, col.evidence, baseline, { fontSize: 8.5, color: COLOR.body });
      if (r.caveat.length) {
        text(doc, r.caveat, col.evidence, baseline + r.evidence.length * lineH(8.5) * 1.15 + 1.5, { fontSize: 7.5, italic: true, color: COLOR.muted });
      }
      y += height;
    }
    rule(doc, y);
    y += 9;
  };

  for (const spoke of CATCHMENT_HEALTH_SPOKES.filter((s) => s.wired)) {
    const charted = spoke.subs.length > 1 && spoke.subs.every((s) => getMetric(s.key));
    if (charted) chartGrid(spoke);
    else measureTable(spoke);
  }

  // (Themes not wired up yet are listed as "Not yet assessed" on page 1.)

  // Footer on every page, once the page count is known.
  const total = doc.internal.getNumberOfPages();
  const scale = RATING_BANDS.map((b) => b.label).join(" · ");
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    rule(doc, PAGE.height - 15);
    text(doc, `Catchment Health scorecard. Ratings: ${scale}.`, M, PAGE.height - 10, { fontSize: 7, color: COLOR.muted });
    text(doc, `Page ${p} of ${total}`, PAGE.width - M, PAGE.height - 10, { fontSize: 7, color: COLOR.muted, align: "right" });
  }
  return doc;
}
