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
  visiblePollution: "Visible Pollution",
};

// Built when used: the minimums come from data/scorecard.json.
const NRS_SHORTFALL = () => `Fewer than ${SCORECARD.nrsMinSites} sites or ${SCORECARD.nrsMinSurveys} surveys across the waterbody - not enough NRS coverage yet for a rating.`;
const NUTRIENT_SHORTFALL = () => `Fewer than ${SCORECARD.nrsMinSites} sites or ${SCORECARD.nrsMinSurveys} readings across the waterbody - not enough yet for a rating.`;
const WILDLIFE_SHORTFALL = () => `Fewer than ${SCORECARD.nrsMinSites} sites or ${SCORECARD.nrsMinSurveys} surveys across the waterbody - not enough yet for a rating.`;
const VISIBLE_SHORTFALL = () => `Fewer than ${SCORECARD.nrsMinSites} sites or ${SCORECARD.nrsMinSurveys} surveys across the waterbody - not enough yet for a rating.`;
const count = (n) => n.toLocaleString("en-GB");
const RIVERFLY_SHORTFALL = () => `Fewer than ${SCORECARD.invertebrateMinSites} sites or ${SCORECARD.invertebrateMinSamples} samples - not enough yet for a rating.`;

const offLine = (subKey, scorecard) => {
  const names = scorecard.switchedOff?.[subKey] ?? [];
  return names.length ? [`Switched off: ${names.join(", ")}`] : [];
};

const OFF_SOURCE = { invasives: "National River Survey", invertebrates: "Riverfly", action: "Nature-Based Solutions Interventions (NBS)" };

// A survey-counted measure's breakdown, most common first, with each
// row's share of the surveys: [{ label, surveys, share }]. Visible
// pollution's signs, or every wildlife indicator species (unseen ones too).
export function breakdownRows(scorecard, subKey) {
  const total = subKey === "wildlife" ? scorecard.wildlifeSurveys : scorecard.visiblePollutionSurveys;
  const rows = subKey === "wildlife" ? scorecard.wildlifeSpeciesSeen : scorecard.visiblePollutionSigns;
  if (!total || !rows) return [];
  return rows.map((row) => ({ ...row, share: `${Math.round((100 * row.surveys) / total)}%` }));
}

// The headings for each breakdown table.
export const BREAKDOWNS = {
  visiblePollution: { title: "Visible pollution: signs seen", column: "Sign seen", note: "A survey can show more than one sign, so these can add up to more than the surveys with any sign." },
  wildlife: { title: "Wildlife: indicator species seen", column: "Species", note: "A survey can record more than one species, so these can add up to more than the surveys with an indicator species." },
};

export const isSignsLine = (line) => line.startsWith("Signs seen: ") || line.startsWith("Species seen: ");

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
  if (subKey === "wildlife") {
    const surveys = scorecard.wildlifeSurveys;
    if (!surveys) return ["No wildlife surveys in the current date range", ...(scorecard.wildlifeRated ? [] : [WILDLIFE_SHORTFALL()])];
    const percent = (x) => `${Number((100 * x).toFixed(1))}%`;
    const species = SCORECARD.wildlifeSpecies.length;
    const lines = [
      `Wildlife score: ${percent(scorecard.wildlifeScore)}`,
      scorecard.wildlifeWithSpecies
        ? `${count(scorecard.wildlifeWithSpecies)} of ${plural(surveys, "survey")} (${Math.round(100 * scorecard.wildlifeShare)}%) recorded an indicator species, spread across the equivalent of ${scorecard.wildlifeEffective.toFixed(1)} of the ${species} species`
        : `None of the ${plural(surveys, "survey")} recorded an indicator species`,
    ];
    const seen = scorecard.wildlifeSpeciesSeen.filter((s) => s.surveys);
    lines.push(seen.length ? `Species seen: ${seen.map((s) => `${s.label} (${count(s.surveys)})`).join(", ")}` : "Species seen: none");
    if (!scorecard.wildlifeRated) lines.push(WILDLIFE_SHORTFALL());
    return lines;
  }
  if (subKey === "invasives") {
    const found = scorecard.invasiveSpeciesFound;
    const what = "invasive species";
    const lines = [found.length ? `${found.length} ${what} spotted: ${found.join(", ")}` : `No ${what} spotted in the current date range`];
    if (!scorecard.nrsRatingsAvailable) lines.push(NRS_SHORTFALL());
    return lines;
  }
  if (subKey === "invertebrates") {
    const lines = [`${plural(scorecard.invertebrateSiteCount, "riverfly site")}, ${plural(scorecard.invertebrateSurveyCount, "assessed sample")}, `
      + plural(scorecard.invertebrateBreachCount, "confirmed breach", "confirmed breaches")];
    if (!invertebrateDataSufficient(scorecard.invertebrateSiteCount, scorecard.invertebrateSurveyCount)) lines.push(RIVERFLY_SHORTFALL());
    return lines;
  }
  if (subKey === "visiblePollution") {
    const surveys = scorecard.visiblePollutionSurveys;
    if (!surveys) {
      return [`No pollution surveys in the current date range`, ...(scorecard.visiblePollutionRated ? [] : [VISIBLE_SHORTFALL()])];
    }
    const share = Math.round((100 * scorecard.visiblePollutionWithSigns) / surveys);
    const lines = [`${plural(scorecard.visiblePollutionWithSigns, "survey")} of ${count(surveys)} (${share}%) showed a visible sign of pollution`];
    const signs = scorecard.visiblePollutionSigns;
    lines.push(signs.length ? `Signs seen: ${signs.map((s) => `${s.label} (${count(s.surveys)})`).join(", ")}` : "No visible signs of pollution recorded.");
    if (!scorecard.visiblePollutionRated) lines.push(VISIBLE_SHORTFALL());
    return lines;
  }
  if (subKey === "action") {
    const lines = [`${plural(scorecard.actionDeliveredCount, "delivered Nature-Based Solutions intervention")} in this waterbody`];
    if (scorecard.actionDeliveredCount === 0 && SCORECARD.actionNoneIsNoData) lines.push("With none delivered, this isn't rated.");
    return lines;
  }
  return ["Not yet assessed."];
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
  if (subKey === "wildlife") {
    const used = (scorecard.wildlifeSources ?? []).filter((s) => s.surveys > 0);
    const sources = used.map((s) => `${s.name} (${plural(s.surveys, "survey")}, ${plural(s.sites, "site")})`).join("; ");
    return [`${used.length === 1 ? "Data source" : "Data sources"}: ${sources || "none with surveys in this period"}`,
      ...offLine(subKey, scorecard),
      `Data requirement: Min. ${SCORECARD.nrsMinSites} sites, ${SCORECARD.nrsMinSurveys} surveys in range`,
      `Statistical measure: share of surveys with an indicator species × effective species ÷ ${SCORECARD.wildlifeSpecies.length}`,
      `Sites: ${scorecard.wildlifeSiteCount}`, `Surveys: ${scorecard.wildlifeSurveys}`];
  }
  if (subKey === "invasives") {
    return [`Data source: ${scorecard.observationCount ? "National River Survey" : "none with surveys in this period"}`, nrsRule, "Statistical measure: species presence count",
      `Sites: ${scorecard.locationCount}`, `Readings: ${plural(scorecard.observationCount, "survey")}`];
  }
  if (subKey === "invertebrates") {
    return [`Data source: ${scorecard.invertebrateSurveyCount ? "Riverfly" : "none with samples in this period"}`,
      `Data requirement: Min. ${SCORECARD.invertebrateMinSites} sites, ${SCORECARD.invertebrateMinSamples} samples in range`,
      "Statistical measure: confirmed-breach rate",
      "Counts only samples taken and judged against the site's trigger level (clean or a confirmed breach)",
      `Sites: ${scorecard.invertebrateSiteCount}`, `Readings: ${plural(scorecard.invertebrateSurveyCount, "sample")}`];
  }
  if (subKey === "visiblePollution") {
    const used = (scorecard.visiblePollutionSources ?? []).filter((s) => s.surveys > 0);
    const sources = used.map((s) => `${s.name} (${plural(s.surveys, "survey")}, ${plural(s.sites, "site")})`).join("; ");
    return [`${used.length === 1 ? "Data source" : "Data sources"}: ${sources || "none with surveys in this period"}`,
      ...offLine(subKey, scorecard),
      `Data requirement: Min. ${SCORECARD.nrsMinSites} sites, ${SCORECARD.nrsMinSurveys} surveys in range`,
      "Statistical measure: share of surveys with any visible sign",
      `Sites: ${scorecard.visiblePollutionSiteCount}`, `Surveys: ${scorecard.visiblePollutionSurveys}`];
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
  const nrsUsed = scorecard.sourcesOn?.invasives
    || (scorecard.wildlifeSources ?? []).some((s) => s.name === "National River Survey")
    || ["phosphate", "nitrate", "nitrite", "ammonia", "turbidity", "conductivity"]
      .some((key) => (scorecard[`${key}Sources`] ?? []).some((s) => s.name === "National River Survey"));
  if (scorecard.observationCount && nrsUsed) {
    rows.push({ name: "National River Survey", coverage: `${plural(scorecard.locationCount, "site")}, ${plural(scorecard.observationCount, "survey")}` });
  }
  for (const hub of scorecard.hubSources ?? []) {
    const counts = [hub.readings && plural(hub.readings, "reading"), hub.surveys && plural(hub.surveys, "survey")].filter(Boolean);
    if (counts.length) rows.push({ name: hub.name, coverage: `${plural(hub.sites, "site")}, ${counts.join(", ")}` });
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
