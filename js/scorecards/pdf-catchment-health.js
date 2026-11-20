// =====================================================================
// CATCHMENT HEALTH PDF
// A4, portrait, always two pages, and every scorecard has the same layout:
// each thing has a slot of a fixed size in a fixed place, whether or not
// there is data for it. A slot with nothing to show says so in grey.
//
//   Page 1 - the headline: the title and overall rating, the wheel beside a
//            map, the eight themes' ratings, the six nutrient charts, and
//            the data sources.
//   Page 2 - the evidence: a card for each measure (visible pollution,
//            wildlife, riverfly, invasives, action), the habitat card and
//            its subreaches, notes, and a strip for themes not yet assessed.
//
// Lists that vary in length are cut to a fixed number of rows ("and 3
// more" for the rest), so nothing can push a slot out of place. If a slot
// ever overflowed, a warning goes to the console.
// =====================================================================

import { CATCHMENT_HEALTH_SPOKES, INVASIVE_PLANT_FIELDS, RATING_BANDS, SCORECARD } from "./config.js";
import { getMetric } from "./metrics.js";
import { bandForRank, catchmentHealthRanks, themeRank, catchmentHealthOverallRank } from "./ratings.js";
import { catchmentHealthWheelImage } from "./charts/wheels.js";
import { barChartImage } from "./charts/bar-chart.js";
import { dataSourceRows, habitatSubreachRows } from "./scorecard-text.js";
import { formatNumber } from "./format.js";
import { rect, text, rgb } from "./pdf-common.js";
import { CONTENT_W, MAP_GAP, MAP_W, PAGE, ROW_H, WHEEL_W } from "./pdf-layout.js";

const M = PAGE.margin;
const CONTENT_BOTTOM = PAGE.height - 18; // the footer rule sits 3 mm below this
const COLOR = {
  ink: "#1f2933",
  body: "#3e4c59",
  muted: "#7b8794",
  rule: "#dde2e8",
  panel: "#f5f7fa",
  noData: "#c3cad3",
  bar: "#9fb3c8",
  seen: "#d55181",
};
const CADENCE = { day: "daily", week: "weekly", month: "monthly" };
// Chart height / width of one nutrient chart.
const CHART_ASPECT = 0.34;
// How many rows each variable list gets.
const SIGN_ROWS = 4;
const SUBREACH_ROWS = 6;
// The data sources always listed, in this order, with the name shown for each.
const SOURCE_SLOTS = [
  ["National River Survey", "National River Survey"],
  ["FreshWater Watch", "FreshWater Watch"],
  ["Angling Trust WQMN", "Angling Trust WQMN"],
  ["River Guardians", "River Guardians"],
  ["Environment Agency", "Environment Agency"],
  ["Riverfly", "Riverfly"],
  ["Modular River Survey (MoRPh)", "MoRPh"],
  ["Nature-Based Solutions Interventions (NBS)", "Nature-Based Solutions"],
];

// ---- Small drawing helpers ----

const plural = (n, word, many = `${word}s`) => `${n.toLocaleString("en-GB")} ${n === 1 ? word : many}`;

function rule(doc, y, x = M, width = CONTENT_W) {
  rect(doc, x, y, width, 0.25, COLOR.rule);
}

function eyebrow(doc, label, x, y, align) {
  text(doc, label.toUpperCase(), x, y, { fontSize: 7, bold: true, color: COLOR.muted, spaced: true, align });
}

// A section heading: the label, an optional rating at the right, a rule.
function sectionHeading(doc, label, y, band) {
  eyebrow(doc, label, M, y);
  if (band !== undefined) ratingMark(doc, band, M + CONTENT_W, y, { fontSize: 7.5, align: "right" });
  rule(doc, y + 2.5);
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

// One line of text that fits the width, with "..." if it had to be cut.
function fit(doc, value, width, fontSize, style = "normal") {
  doc.setFont("helvetica", style);
  doc.setFontSize(fontSize);
  let line = String(value ?? "");
  if (doc.getTextWidth(line) <= width) return line;
  while (line.length > 1 && doc.getTextWidth(`${line}...`) > width) line = line.slice(0, -1);
  return `${line.trimEnd()}...`;
}

function wrap(doc, value, width, fontSize, style = "normal") {
  doc.setFont("helvetica", style);
  doc.setFontSize(fontSize);
  return doc.splitTextToSize(value, width);
}

// Line height in mm for a font size in pt.
const lineH = (fontSize) => fontSize * 0.42;

// A line of grey text for a slot with nothing in it.
function noData(doc, words, x, y) {
  text(doc, words, x, y, { fontSize: 7, italic: true, color: COLOR.muted });
}

// A card: a tinted panel with a title, and the rating at the right.
function card(doc, x, y, w, h, title, band, { dashed = false } = {}) {
  if (dashed) {
    doc.setDrawColor(...rgb(COLOR.noData));
    doc.setLineWidth(0.25);
    doc.setLineDashPattern([1.2, 1.2], 0);
    doc.roundedRect(x, y, w, h, 1, 1, "S");
    doc.setLineDashPattern([], 0);
  } else {
    rect(doc, x, y, w, h, COLOR.panel, { radius: 1 });
  }
  text(doc, fit(doc, title, w - 24, 8.5, "bold"), x + 2.5, y + 5.2, { fontSize: 8.5, bold: true, color: dashed ? COLOR.muted : COLOR.ink });
  if (!dashed) ratingMark(doc, band, x + w - 2.5, y + 5.2, { fontSize: 7.5, align: "right" });
}

// A row of a card: a label, a bar (a fraction of the width), and a value.
// fraction null draws an empty slot with a dash.
function barRow(doc, x, y, w, { label, fraction, value }, labelShare = 0.5) {
  const labelW = w * labelShare;
  const barW = w - labelW - 9;
  const empty = fraction === null;
  text(doc, fit(doc, label, labelW - 1.5, 7), x, y, { fontSize: 7, color: empty ? COLOR.muted : COLOR.body });
  rect(doc, x + labelW, y - 2.2, barW, 2.2, COLOR.rule);
  if (!empty && fraction > 0) rect(doc, x + labelW, y - 2.2, Math.max(barW * Math.min(fraction, 1), 0.5), 2.2, COLOR.bar);
  text(doc, empty ? "-" : value, x + w, y, { fontSize: 7, color: empty ? COLOR.muted : COLOR.ink, align: "right" });
}

// ---- Data ----

function themeSummaries(ranks) {
  return CATCHMENT_HEALTH_SPOKES.map((spoke) => {
    if (!spoke.wired) return { spoke, band: null, wired: false };
    return { spoke, band: bandForRank(themeRank(spoke, ranks)), wired: true };
  });
}

const percent = (fraction) => `${Math.round(100 * fraction)}%`;

export function buildCatchmentHealthPdf(JsPDF, { waterbodyName, waterBodyId, scorecard, screenshot, dateRangeText, granularity, equipmentRanges }) {
  const doc = new JsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const ranks = catchmentHealthRanks(scorecard);
  const overall = bandForRank(catchmentHealthOverallRank(scorecard));
  const generated = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const warn = (what, y) => { if (y > CONTENT_BOTTOM) console.warn(`Scorecard PDF: ${what} runs past the page bottom (${y.toFixed(1)} mm).`); };
  const topStrip = () => rect(doc, 0, 0, PAGE.width, 2, overall?.color ?? COLOR.noData);

  // ================= Page 1: the headline =================
  topStrip();
  eyebrow(doc, "Catchment Health Scorecard", M, 16);
  // One line, whatever the name: the type shrinks (to a floor) and then cuts.
  let titleSize = 20;
  doc.setFont("helvetica", "bold");
  while (titleSize > 13) {
    doc.setFontSize(titleSize);
    if (doc.getTextWidth(waterbodyName) <= CONTENT_W - 52) break;
    titleSize -= 1;
  }
  text(doc, fit(doc, waterbodyName, CONTENT_W - 52, titleSize, "bold"), M, 25, { fontSize: titleSize, bold: true, color: COLOR.ink });
  const meta = [waterBodyId && `WFD ${waterBodyId}`, `Period: ${dateRangeText}`, `Generated ${generated}`].filter(Boolean).join("   ·   ");
  text(doc, fit(doc, meta, CONTENT_W - 52, 8), M, 32, { fontSize: 8, color: COLOR.muted });
  eyebrow(doc, "Overall rating", PAGE.width - M, 16, "right");
  ratingMark(doc, overall, PAGE.width - M, 25, { fontSize: 15, align: "right" });
  rule(doc, 37);

  // Wheel and map, side by side, same height.
  let y = 43;
  doc.addImage(catchmentHealthWheelImage(scorecard, 900), "PNG", M, y, WHEEL_W, ROW_H);
  const mapX = M + WHEEL_W + MAP_GAP;
  if (screenshot) {
    // The picture is cut to this slot's shape already.
    doc.addImage(screenshot.dataUrl, "PNG", mapX, y, MAP_W, ROW_H);
    doc.setDrawColor(...rgb(COLOR.rule));
    doc.setLineWidth(0.2);
    doc.rect(mapX, y, MAP_W, ROW_H, "S");
  } else {
    rect(doc, mapX, y, MAP_W, ROW_H, COLOR.panel, { radius: 1 });
    noData(doc, "Map not available", mapX + 3, y + 6);
  }
  y += ROW_H + 7;

  // Theme ratings: eight fixed slots, four across.
  sectionHeading(doc, "Theme ratings", y);
  y += 5;
  const themeCellW = CONTENT_W / 4;
  themeSummaries(ranks).forEach((row, i) => {
    const x = M + (i % 4) * themeCellW;
    const top = y + Math.floor(i / 4) * 11;
    text(doc, fit(doc, row.spoke.label, themeCellW - 3, 8, row.wired ? "bold" : "normal"), x, top + 3.5, { fontSize: 8, bold: row.wired, color: row.wired ? COLOR.ink : COLOR.muted });
    if (row.wired) ratingMark(doc, row.band, x, top + 8, { fontSize: 7.5 });
    else text(doc, "Not yet assessed", x, top + 8, { fontSize: 7, italic: true, color: COLOR.muted });
  });
  y += 22 + 7;

  // Nutrients and sediment: six charts, three across.
  const nutrients = CATCHMENT_HEALTH_SPOKES.find((spoke) => spoke.key === "nutrients");
  sectionHeading(doc, "Nutrients and sediment", y, bandForRank(themeRank(nutrients, ranks)));
  y += 5;
  const gap = 5;
  const cellW = (CONTENT_W - gap * 2) / 3;
  const chartH = cellW * CHART_ASPECT;
  const cellH = 5 + chartH + 5;
  nutrients.subs.forEach((sub, i) => {
    const x = M + (i % 3) * (cellW + gap);
    const top = y + Math.floor(i / 3) * (cellH + 3);
    const metric = getMetric(sub.key);
    text(doc, fit(doc, `${sub.label}${metric ? ` (${metric.unit})` : ""}`, cellW - 17, 7.5, "bold"), x, top + 3.4, { fontSize: 7.5, bold: true, color: COLOR.ink });
    ratingMark(doc, bandForRank(ranks[sub.key]), x + cellW, top + 3.4, { fontSize: 7, align: "right" });
    const series = scorecard[`${sub.key}Series`] ?? [];
    const image = metric && barChartImage(metric, series, granularity, equipmentRanges[sub.key]?.max, 340, Math.round(340 * CHART_ASPECT), { showTitle: false });
    if (image) {
      doc.addImage(image, "PNG", x, top + 5, cellW, chartH);
    } else {
      rect(doc, x, top + 5, cellW, chartH, COLOR.panel, { radius: 1 });
      noData(doc, "No readings in this period", x + cellW / 2 - 18, top + 5 + chartH / 2 + 1);
    }
    const value = scorecard[`${sub.key}Value`];
    const readings = scorecard[`${sub.key}ReadingCount`] ?? 0;
    const caption = value == null ? "No readings in this period" : `${formatNumber(value)} ${metric?.unit ?? ""} (${metric?.aggregation ?? "value"} of ${plural(readings, "reading")})`;
    text(doc, fit(doc, caption, cellW, 6.8), x, top + 5 + chartH + 3.2, { fontSize: 6.8, color: value == null ? COLOR.muted : COLOR.body, italic: value == null });
  });
  y += 2 * cellH + 3 + 4;
  const cadence = CADENCE[granularity] ?? "monthly";
  text(doc, `Bars are ${cadence} averages across every site and source, over the rating bands.`, M, y, { fontSize: 6.8, italic: true, color: COLOR.muted });
  y += 7;

  // Data sources: eight fixed slots, two columns.
  sectionHeading(doc, "Data sources", y);
  y += 5;
  const rows = dataSourceRows(scorecard);
  const rowFor = (name) => rows.find((row) => row.name === name) ?? rows.find((row) => row.name === `${name} (switched off)`);
  const colW = (CONTENT_W - 6) / 2;
  SOURCE_SLOTS.forEach(([name, shown], i) => {
    const x = M + (i % 2) * (colW + 6);
    const top = y + Math.floor(i / 2) * 6.2;
    const row = rowFor(name);
    const off = row?.name.endsWith("(switched off)");
    let coverage = row?.coverage ?? "";
    if (name.startsWith("Modular River Survey") && scorecard.habitat?.modules.length) {
      coverage = `${plural(scorecard.habitat.subreaches.length, "subreach", "subreaches")}, ${plural(scorecard.habitat.modules.length, "module")}`;
    }
    text(doc, shown, x, top + 4, { fontSize: 7.5, bold: !!row && !off, color: row && !off ? COLOR.ink : COLOR.muted });
    const words = row ? (off ? "Switched off" : coverage) : "No data in this period";
    text(doc, fit(doc, words, colW - 36, 7), x + colW, top + 4, { fontSize: 7, color: row && !off ? COLOR.body : COLOR.muted, italic: !row || off, align: "right" });
    rule(doc, top + 5.4, x, colW);
  });
  y += 4 * 6.2;
  warn("page 1", y);

  // ================= Page 2: the evidence =================
  doc.addPage();
  topStrip();
  text(doc, fit(doc, waterbodyName, CONTENT_W - 50, 9, "bold"), M, 12, { fontSize: 9, bold: true, color: COLOR.ink });
  text(doc, "Catchment Health · Evidence", PAGE.width - M, 12, { fontSize: 8, color: COLOR.muted, align: "right" });
  rule(doc, 15);

  y = 22;
  sectionHeading(doc, "Recreation, biodiversity and recovery", y);
  y += 6;
  const cardW = (CONTENT_W - 8) / 3;
  const cardX = (i) => M + i * (cardW + 4);
  const inner = cardW - 5;

  // Visible pollution.
  {
    const x = cardX(0);
    card(doc, x, y, cardW, 50, "Visible pollution", bandForRank(ranks.visiblePollution));
    const surveys = scorecard.visiblePollutionSurveys ?? 0;
    if (!surveys) {
      noData(doc, "No pollution surveys in this period", x + 2.5, y + 11);
    } else {
      const withSigns = scorecard.visiblePollutionWithSigns ?? 0;
      text(doc, fit(doc, `${withSigns} of ${surveys.toLocaleString("en-GB")} surveys (${percent(withSigns / surveys)}) show a sign`, inner, 7.2), x + 2.5, y + 10.5, { fontSize: 7.2, bold: true, color: COLOR.ink });
      text(doc, `${plural(scorecard.visiblePollutionSiteCount ?? 0, "site")}`, x + 2.5, y + 14.5, { fontSize: 6.8, color: COLOR.muted });
    }
    const signs = scorecard.visiblePollutionSigns ?? [];
    for (let r = 0; r < SIGN_ROWS; r++) {
      const sign = signs[r];
      barRow(doc, x + 2.5, y + 21 + r * 5.2, inner, sign
        ? { label: sign.label, fraction: sign.surveys / surveys, value: String(sign.surveys) }
        : { label: surveys ? (r === 0 ? "No signs seen" : "") : "", fraction: null });
    }
    if (signs.length > SIGN_ROWS) text(doc, `and ${signs.length - SIGN_ROWS} more`, x + 2.5, y + 21 + SIGN_ROWS * 5.2, { fontSize: 6.5, italic: true, color: COLOR.muted });
    if (!scorecard.visiblePollutionRated) noData(doc, "Not enough data to rate", x + 2.5, y + 47);
  }

  // Wildlife.
  {
    const x = cardX(1);
    card(doc, x, y, cardW, 50, "Wildlife", bandForRank(ranks.wildlife));
    const surveys = scorecard.wildlifeSurveys ?? 0;
    if (!surveys) {
      noData(doc, "No wildlife surveys in this period", x + 2.5, y + 11);
    } else {
      text(doc, fit(doc, `Score ${Number((100 * (scorecard.wildlifeScore ?? 0)).toFixed(1))}% from ${plural(surveys, "survey")}`, inner, 7.2), x + 2.5, y + 10.5, { fontSize: 7.2, bold: true, color: COLOR.ink });
      text(doc, `${plural(scorecard.wildlifeSiteCount ?? 0, "site")}`, x + 2.5, y + 14.5, { fontSize: 6.8, color: COLOR.muted });
    }
    const species = scorecard.wildlifeSpeciesSeen ?? SCORECARD.wildlifeSpecies.map((label) => ({ label, surveys: 0 }));
    const speciesRows = [...species].slice(0, 7);
    for (let r = 0; r < 7; r++) {
      const item = speciesRows[r];
      barRow(doc, x + 2.5, y + 20 + r * 3.9, inner, item
        ? { label: item.label.replace("Dragonflies and damselflies", "Dragonflies"), fraction: surveys ? item.surveys / surveys : 0, value: String(item.surveys) }
        : { label: "", fraction: null });
    }
    if (!scorecard.wildlifeRated) noData(doc, "Not enough data to rate", x + 2.5, y + 47);
  }

  // Invertebrates (Riverfly).
  {
    const x = cardX(2);
    card(doc, x, y, cardW, 50, "Invertebrates", bandForRank(ranks.invertebrates));
    const samples = scorecard.invertebrateSurveyCount ?? 0;
    if (!samples) {
      noData(doc, "No Riverfly samples in this period", x + 2.5, y + 11);
    } else {
      const breaches = scorecard.invertebrateBreachCount ?? 0;
      text(doc, fit(doc, `${plural(breaches, "confirmed breach", "confirmed breaches")} in ${plural(samples, "sample")}`, inner, 7.2), x + 2.5, y + 10.5, { fontSize: 7.2, bold: true, color: COLOR.ink });
      text(doc, `${plural(scorecard.invertebrateSiteCount ?? 0, "riverfly site")}`, x + 2.5, y + 14.5, { fontSize: 6.8, color: COLOR.muted });
      // Clean samples against breaches, as one bar.
      rect(doc, x + 2.5, y + 22, inner, 4, COLOR.rule);
      if (breaches) rect(doc, x + 2.5, y + 22, Math.max(inner * (breaches / samples), 0.6), 4, COLOR.seen);
      text(doc, `${percent(breaches / samples)} of samples breached`, x + 2.5, y + 31, { fontSize: 6.8, color: COLOR.body });
    }
    if (!samples) {
      rect(doc, x + 2.5, y + 22, inner, 4, COLOR.rule);
    }
    if (!(bandForRank(ranks.invertebrates))) noData(doc, "Not enough data to rate", x + 2.5, y + 47);
  }

  y += 54;

  // Invasives: the six species always listed, ticked if spotted.
  {
    const x = cardX(0);
    card(doc, x, y, cardW, 44, "Invasives", bandForRank(ranks.invasives));
    const seen = new Set((scorecard.invasiveSeenBy ?? []).map((item) => item.label));
    const surveys = scorecard.invasiveSurveyCount ?? 0;
    if (!surveys) noData(doc, "No surveys in this period", x + 2.5, y + 11);
    else text(doc, `${seen.size} of ${INVASIVE_PLANT_FIELDS.length} species spotted`, x + 2.5, y + 10.5, { fontSize: 7.2, bold: true, color: COLOR.ink });
    INVASIVE_PLANT_FIELDS.forEach((field, i) => {
      const top = y + 16 + i * 3.5;
      const spotted = seen.has(field.label);
      doc.setFillColor(...rgb(spotted ? COLOR.seen : "#ffffff"));
      doc.setDrawColor(...rgb(spotted ? COLOR.seen : COLOR.noData));
      doc.setLineWidth(0.25);
      doc.circle(x + 3.6, top - 0.9, 1, "FD");
      text(doc, field.label, x + 6.5, top, { fontSize: 7, color: spotted ? COLOR.ink : COLOR.muted, bold: spotted });
    });
    if (!scorecard.invasivesRated) noData(doc, "Not enough data to rate", x + 2.5, y + 41.5);
  }

  // Action: delivered interventions.
  {
    const x = cardX(1);
    card(doc, x, y, cardW, 44, "Action (recovery)", bandForRank(ranks.action));
    const delivered = scorecard.actionDeliveredCount ?? 0;
    text(doc, String(delivered), x + 2.5, y + 21, { fontSize: 20, bold: true, color: delivered ? COLOR.ink : COLOR.noData });
    text(doc, "delivered Nature-Based", x + 2.5, y + 27, { fontSize: 7, color: COLOR.body });
    text(doc, "Solutions interventions", x + 2.5, y + 30.6, { fontSize: 7, color: COLOR.body });
    if (!bandForRank(ranks.action)) noData(doc, "Not rated: none delivered", x + 2.5, y + 41.5);
  }

  // Measures not yet assessed, kept as a reserved slot.
  {
    const x = cardX(2);
    card(doc, x, y, cardW, 44, "Not yet assessed", null, { dashed: true });
    ["E. coli", "Barriers"].forEach((label, i) => text(doc, label, x + 2.5, y + 12 + i * 4.5, { fontSize: 7.5, color: COLOR.muted }));
    noData(doc, "Reserved for future measures", x + 2.5, y + 41.5);
  }
  y += 48;

  // ---- Habitat ----
  sectionHeading(doc, "Habitat and naturalness", y, bandForRank(themeRank(CATCHMENT_HEALTH_SPOKES.find((spoke) => spoke.key === "habitat"), ranks)));
  y += 6;
  const habitat = scorecard.habitat;
  card(doc, M, y, CONTENT_W, 36, "Habitat", bandForRank(ranks.habitatCondition));
  if (!habitat?.subreaches.length) {
    // Kept inside the left column, beside the index slots.
    const words = habitat ? "No MoRPh habitat surveys in the five years to the period's end" : "The Modular River Survey could not be loaded";
    wrap(doc, words, 46, 7, "italic").slice(0, 4).forEach((line, i) => noData(doc, line, M + 2.5, y + 12 + i * 3.4));
  } else {
    text(doc, `${habitat.score == null ? "-" : habitat.score.toFixed(1)}`, M + 2.5, y + 20, { fontSize: 20, bold: true, color: COLOR.ink });
    text(doc, "out of 10", M + 22, y + 20, { fontSize: 7, color: COLOR.muted });
    text(doc, `${plural(habitat.subreaches.length, "subreach", "subreaches")}`, M + 2.5, y + 26, { fontSize: 7, color: COLOR.body });
    text(doc, `${plural(habitat.modules.length, "module")}, latest surveys`, M + 2.5, y + 29.6, { fontSize: 7, color: COLOR.body });
  }
  // The indices: what is in the score, then the pressures beside it.
  const bars = (list, x, title) => {
    text(doc, title, x, y + 10.5, { fontSize: 6.8, bold: true, color: COLOR.muted });
    for (let r = 0; r < 4; r++) {
      const part = list[r];
      barRow(doc, x, y + 15 + r * 4.6, 56, part
        ? { label: part.label, fraction: part.value == null ? 0 : part.value / 10, value: part.value == null ? "-" : part.value.toFixed(1) }
        : { label: "", fraction: null }, 0.62);
    }
  };
  bars(habitat?.components ?? [], M + 52, "In the score (higher is better)");
  bars(habitat?.pressures ?? [], M + 113, "Pressures, not scored (lower is better)");
  y += 40;

  // Subreaches: a fixed six rows.
  const columns = { name: 0, date: 88, type: 110, modules: 142, score: 160 };
  [["Subreach", columns.name], ["Surveyed", columns.date], ["Type", columns.type], ["Modules", columns.modules], ["Score", columns.score]]
    .forEach(([label, x]) => text(doc, label, M + x, y, { fontSize: 7, bold: true, color: COLOR.muted }));
  y += 1.5;
  const subreaches = habitatSubreachRows(scorecard);
  for (let r = 0; r < SUBREACH_ROWS; r++) {
    rule(doc, y);
    const row = subreaches[r];
    const baseline = y + 3.8;
    if (row) {
      text(doc, fit(doc, row.name, 84, 7.5), M + columns.name, baseline, { fontSize: 7.5, color: COLOR.ink });
      text(doc, row.date, M + columns.date, baseline, { fontSize: 7.5, color: COLOR.body });
      text(doc, fit(doc, row.surveyType, 30, 7.5), M + columns.type, baseline, { fontSize: 7.5, color: COLOR.body });
      text(doc, row.modules, M + columns.modules, baseline, { fontSize: 7.5, color: COLOR.body });
      text(doc, row.score, M + columns.score, baseline, { fontSize: 7.5, color: COLOR.body });
    } else if (r === 0) {
      noData(doc, "No subreaches surveyed", M, baseline);
    }
    y += 5;
  }
  rule(doc, y);
  const more = subreaches.length - SUBREACH_ROWS;
  text(doc, more > 0 ? `and ${more} more subreach${more === 1 ? "" : "es"}` : "The latest survey at each place; an earlier module is left out where the same place was surveyed again.", M, y + 4, { fontSize: 6.8, italic: true, color: COLOR.muted });
  y += 11;

  // ---- Notes and method ----
  sectionHeading(doc, "Notes and method", y);
  y += 6;
  const notes = [
    "Each measure is rated High, Good, Moderate, Poor or Bad against thresholds set in the scorecard settings; a measure without enough data is left unrated and does not count towards its theme.",
    "A survey can show more than one pollution sign or record more than one species, so the rows can add up to more than the surveys.",
    "Habitat is not limited to the period: the latest MoRPh survey at each place in the last five years counts.",
    "The wheel's centre is the average of the wired themes; themes not yet assessed are greyed on page 1.",
  ];
  notes.forEach((note) => {
    const lines = wrap(doc, note, CONTENT_W - 4, 7);
    text(doc, "•", M, y, { fontSize: 7, color: COLOR.muted });
    text(doc, lines, M + 3, y, { fontSize: 7, color: COLOR.body });
    y += lines.length * lineH(7) * 1.15 + 1.2;
  });
  y += 3;

  // ---- Themes not yet assessed: a reserved strip ----
  const pending = CATCHMENT_HEALTH_SPOKES.filter((spoke) => !spoke.wired).map((spoke) => spoke.label);
  doc.setDrawColor(...rgb(COLOR.noData));
  doc.setLineWidth(0.25);
  doc.setLineDashPattern([1.2, 1.2], 0);
  doc.roundedRect(M, y, CONTENT_W, 12, 1, 1, "S");
  doc.setLineDashPattern([], 0);
  text(doc, "Themes not yet assessed", M + 2.5, y + 4.8, { fontSize: 7.5, bold: true, color: COLOR.muted });
  text(doc, fit(doc, pending.join(" · "), CONTENT_W - 5, 7.5), M + 2.5, y + 9.2, { fontSize: 7.5, color: COLOR.muted });
  y += 12;
  warn("page 2", y);

  // Footer on both pages.
  const total = doc.internal.getNumberOfPages();
  if (total !== 2) console.warn(`Scorecard PDF: expected 2 pages, made ${total}.`);
  const scale = RATING_BANDS.map((b) => b.label).join(" · ");
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    rule(doc, PAGE.height - 15);
    text(doc, `Catchment Health scorecard. Ratings: ${scale}.`, M, PAGE.height - 10, { fontSize: 7, color: COLOR.muted });
    text(doc, `Page ${p} of ${total}`, PAGE.width - M, PAGE.height - 10, { fontSize: 7, color: COLOR.muted, align: "right" });
  }
  return doc;
}
