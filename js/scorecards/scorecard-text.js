// =====================================================================
// SCORECARD TEXT
// The wording behind each Catchment Health measure - what its rating is
// based on, and where the data comes from - shared by the panel and the
// PDF report so they always say the same thing.
// =====================================================================

import { SCORECARD } from "./config.js";
import { getMetric } from "./metrics.js";
import { invertebrateDataSufficient } from "./ratings.js";
import { formatNumber } from "./format.js";

const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

const MEASURE_LABELS = {
  phosphate: "Orthophosphate", nitrate: "Nitrate", nitrite: "Nitrite", ammonia: "Ammonia", turbidity: "Turbidity",
  conductivity: "Conductivity", wildlife: "Wildlife", invasives: "Invasives", invertebrates: "Invertebrates", action: "Action",
};

// Built when used: the minimums come from data/scorecard.json.
const NRS_SHORTFALL = () => `Fewer than ${SCORECARD.nrsMinSites} sites or ${SCORECARD.nrsMinSurveys} surveys across the waterbody - not enough NRS coverage yet for a rating.`;
const NUTRIENT_SHORTFALL = () => `Fewer than ${SCORECARD.nrsMinSites} sites or ${SCORECARD.nrsMinSurveys} readings across the waterbody - not enough yet for a rating.`;
const RIVERFLY_SHORTFALL = () => `Fewer than ${SCORECARD.invertebrateMinSites} sites or ${SCORECARD.invertebrateMinSamples} samples - not enough yet for a rating.`;

const offLine = (subKey, scorecard) => {
  const names = scorecard.switchedOff?.[subKey] ?? [];
  return names.length ? [`Switched off: ${names.join(", ")}`] : [];
};

const OFF_SOURCE = { wildlife: "National River Survey", invasives: "National River Survey", invertebrates: "Riverfly", action: "Nature-Based Solutions Interventions (NBS)" };

// What's behind one sub-category's rating, as sentences.
export function subDetailLines(subKey, scorecard) {
  if (scorecard.sourcesOn && scorecard.sourcesOn[subKey] === false) {
    return [`${OFF_SOURCE[subKey]} is switched off for this measure, so it isn't rated.`];
  }
  const metric = getMetric(subKey);
  if (metric && scorecard[`${subKey}ReadingCount`] !== undefined) {
    const value = scorecard[`${subKey}Value`];
    const count = scorecard[`${subKey}ReadingCount`];
    const lines = [value == null
      ? `No ${metric.label.toLowerCase()} readings in the current date range`
      : `${metric.label}: ${formatNumber(value)} ${metric.unit} (${metric.aggregation} of ${plural(count, "reading")})`];
    const estimates = scorecard[`${subKey}EstimateCount`];
    if (estimates) {
      lines.push(`${estimates} of these ${estimates === 1 ? "was" : "were"} not an exact value (a range, or beyond a limit of detection) and ${estimates === 1 ? "counts" : "count"} at the bottom of the range.`);
    }
    if (!scorecard[`${subKey}Rated`]) lines.push(NUTRIENT_SHORTFALL());
    return lines;
  }
  if (subKey === "wildlife" || subKey === "invasives") {
    const found = subKey === "wildlife" ? scorecard.wildlifeSpeciesFound : scorecard.invasiveSpeciesFound;
    const what = subKey === "wildlife" ? "species" : "invasive species";
    const lines = [found.length ? `${found.length} ${what} spotted: ${found.join(", ")}` : `No ${what} spotted in the current date range`];
    if (!scorecard.nrsRatingsAvailable) lines.push(NRS_SHORTFALL());
    return lines;
  }
  if (subKey === "invertebrates") {
    const lines = [`${plural(scorecard.invertebrateSiteCount, "riverfly site")}, ${plural(scorecard.invertebrateSurveyCount, "sample")}, `
      + plural(scorecard.invertebrateBreachCount, "breach", "breaches")];
    if (!invertebrateDataSufficient(scorecard.invertebrateSiteCount, scorecard.invertebrateSurveyCount)) lines.push(RIVERFLY_SHORTFALL());
    return lines;
  }
  if (subKey === "action") {
    const lines = [`${plural(scorecard.actionDeliveredCount, "delivered Nature-Based Solutions intervention")} in this waterbody`];
    if (scorecard.actionDeliveredCount === 0 && SCORECARD.actionNoneIsNoData) lines.push("With none delivered, this isn't rated.");
    return lines;
  }
  return ["No detail available for this segment yet."];
}

// Data provenance for one sub: source, coverage rule, statistic, counts.
export function subSourceLines(subKey, scorecard) {
  const nrsRule = `Data requirement: Min. ${SCORECARD.nrsMinSites} sites, ${SCORECARD.nrsMinSurveys} surveys in range`;
  const metric = getMetric(subKey);
  if (metric && scorecard[`${subKey}ReadingCount`] !== undefined) {
    // Only the sources that had readings in the period.
    const used = scorecard[`${subKey}Sources`].filter((s) => s.readings > 0);
    const sources = used.map((s) => `${s.name} (${plural(s.readings, "reading")}, ${plural(s.sites, "site")})`).join("; ");
    return [`${used.length === 1 ? "Data source" : "Data sources"}: ${sources || "none with readings in this period"}`,
      ...offLine(subKey, scorecard),
      `Data requirement: Min. ${SCORECARD.nrsMinSites} sites, ${SCORECARD.nrsMinSurveys} readings in range`,
      `Statistical measure: ${metric.aggregation}`,
      `Sites: ${scorecard[`${subKey}SiteCount`]}`, `Readings: ${scorecard[`${subKey}ReadingCount`]}`];
  }
  if (scorecard.sourcesOn && scorecard.sourcesOn[subKey] === false) return offLine(subKey, scorecard);
  if (subKey === "wildlife" || subKey === "invasives") {
    return [`Data source: ${scorecard.observationCount ? "National River Survey" : "none with surveys in this period"}`, nrsRule, "Statistical measure: species presence count",
      `Sites: ${scorecard.locationCount}`, `Readings: ${plural(scorecard.observationCount, "survey")}`];
  }
  if (subKey === "invertebrates") {
    return [`Data source: ${scorecard.invertebrateSurveyCount ? "Riverfly" : "none with samples in this period"}`,
      `Data requirement: Min. ${SCORECARD.invertebrateMinSites} sites, ${SCORECARD.invertebrateMinSamples} samples in range`,
      "Statistical measure: confirmed-breach rate",
      `Sites: ${scorecard.invertebrateSiteCount}`, `Readings: ${plural(scorecard.invertebrateSurveyCount, "sample")}`];
  }
  if (subKey === "action") {
    return ["Data source: Nature-Based Solutions Interventions (NBS)", "Data requirement: Status = Delivered, within the waterbody",
      "Statistical measure: count of delivered interventions", `Interventions: ${scorecard.actionDeliveredCount}`];
  }
  return [];
}

// One row per data source behind the wired measures, for the PDF:
// { name, coverage }.
// Only sources that had data in the period are listed. NBS with none
// delivered is listed only when that rates Action as Bad (Action's
// whenNone in data/scorecard.json). Sources switched off in the sources
// panel are listed last.
export function dataSourceRows(scorecard) {
  const rows = [];
  const nrsUsed = scorecard.sourcesOn?.wildlife || scorecard.sourcesOn?.invasives
    || ["phosphate", "nitrate", "nitrite", "ammonia", "turbidity", "conductivity"]
      .some((key) => (scorecard[`${key}Sources`] ?? []).some((s) => s.name === "National River Survey"));
  if (scorecard.observationCount && nrsUsed) {
    rows.push({ name: "National River Survey", coverage: `${plural(scorecard.locationCount, "site")}, ${plural(scorecard.observationCount, "survey")}` });
  }
  for (const hub of scorecard.hubSources ?? []) {
    if (hub.readings) rows.push({ name: hub.name, coverage: `${plural(hub.sites, "site")}, ${plural(hub.readings, "reading")}` });
  }
  if (scorecard.sourcesOn?.invertebrates !== false && scorecard.invertebrateSurveyCount) {
    rows.push({ name: "Riverfly", coverage: `${plural(scorecard.invertebrateSiteCount, "site")}, ${plural(scorecard.invertebrateSurveyCount, "sample")}` });
  }
  if (scorecard.sourcesOn?.action !== false && (scorecard.actionDeliveredCount || !SCORECARD.actionNoneIsNoData)) {
    rows.push({ name: "Nature-Based Solutions Interventions (NBS)", coverage: plural(scorecard.actionDeliveredCount, "delivered intervention") });
  }
  // Switched off: each source with the measures it was left out of.
  const off = new Map();
  for (const [key, names] of Object.entries(scorecard.switchedOff ?? {})) {
    for (const name of names) off.set(name, [...(off.get(name) ?? []), MEASURE_LABELS[key]]);
  }
  for (const [name, measures] of off) rows.push({ name: `${name} (switched off)`, coverage: `Left out of: ${measures.join(", ")}` });
  return rows;
}
