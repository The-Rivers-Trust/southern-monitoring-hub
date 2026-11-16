// =====================================================================
// SCORECARD TEXT
// The wording behind each Catchment Health measure - what its rating is
// based on, and where the data comes from - shared by the panel and the
// PDF report so they always say the same thing.
// =====================================================================

import { SCORECARD } from "./config.js";
import { getDateRange } from "./date-range.js";
import { getMetric } from "./metrics.js";
import { invertebrateDataSufficient } from "./ratings.js";
import { formatNumber } from "./format.js";

const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

const MEASURE_LABELS = {
  phosphate: "Orthophosphate", nitrate: "Nitrate", nitrite: "Nitrite", ammonia: "Ammonia", turbidity: "Turbidity",
  conductivity: "Conductivity", wildlife: "Wildlife", invasives: "Invasives", invertebrates: "Invertebrates", action: "Action",
  visiblePollution: "Visible Pollution", habitatCondition: "Habitat",
};

// Built when used: the minimums come from data/scorecard.json.
const INVASIVES_SHORTFALL = () => `Fewer than ${SCORECARD.nrsMinSites} sites or ${SCORECARD.nrsMinSurveys} surveys across the waterbody (counting a MoRPh subreach as a site and a module as a survey) - not enough yet for a rating.`;
const NUTRIENT_SHORTFALL = () => `Fewer than ${SCORECARD.nrsMinSites} sites or ${SCORECARD.nrsMinSurveys} readings across the waterbody - not enough yet for a rating.`;
const WILDLIFE_SHORTFALL = () => `Fewer than ${SCORECARD.nrsMinSites} sites or ${SCORECARD.nrsMinSurveys} surveys across the waterbody - not enough yet for a rating.`;
const VISIBLE_SHORTFALL = () => `Fewer than ${SCORECARD.nrsMinSites} sites or ${SCORECARD.nrsMinSurveys} surveys across the waterbody - not enough yet for a rating.`;
const count = (n) => n.toLocaleString("en-GB");
const RIVERFLY_SHORTFALL = () => `Fewer than ${SCORECARD.invertebrateMinSites} sites or ${SCORECARD.invertebrateMinSamples} samples - not enough yet for a rating.`;

const offLine = (subKey, scorecard) => {
  const names = scorecard.switchedOff?.[subKey] ?? [];
  return names.length ? [`Switched off: ${names.join(", ")}`] : [];
};

const OFF_SOURCE = {
  invasives: "Every invasives source", invertebrates: "Riverfly", action: "Nature-Based Solutions Interventions (NBS)",
  habitatCondition: "Modular River Survey (MoRPh)",
};

// MoRPh's window, as text: "the 5 years to 31 December 2026".
const morphYearsText = () => {
  const { to } = getDateRange();
  const end = new Date(to ?? Date.now()).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  return `the ${plural(SCORECARD.habitat.withinYears, "year")} to ${end}`;
};
const HABITAT_SHORTFALL = () => `Fewer than ${plural(SCORECARD.habitat.minSubreaches, "subreach", "subreaches")}, and no subreach of ${SCORECARD.habitat.orModulesInOneSubreach} modules (a full MoRPh10) - not enough yet for a rating.`;
const score = (value) => (value == null ? "-" : value.toFixed(1));

// The Habitat measure's two tables, for the panel and the PDF.
// parts: what the score is made of, and the pressures shown beside it,
// as waterbody averages: [{ label, value, kind }].
export function habitatPartRows(scorecard) {
  const habitat = scorecard.habitat;
  if (!habitat?.subreaches.length) return [];
  return [
    ...habitat.components.map((part) => ({ label: part.label, value: score(part.value), kind: "In the score (higher is better)" })),
    ...habitat.pressures.map((part) => ({ label: part.label, value: score(part.value), kind: "Pressure, not in the score (lower is better)" })),
  ];
}

// Each subreach used, latest first: [{ name, date, surveyType, modules, score }].
export function habitatSubreachRows(scorecard) {
  return (scorecard.habitat?.subreaches ?? []).map((subreach) => ({
    // Subreach names usually start with the river already.
    name: subreach.river && !subreach.name.includes(subreach.river) ? `${subreach.name} (${subreach.river})` : subreach.name,
    date: new Date(subreach.date).toLocaleDateString("en-GB", { month: "short", year: "numeric" }),
    surveyType: subreach.surveyType,
    modules: String(subreach.modules),
    score: score(subreach.score),
  }));
}

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
    const seen = scorecard.invasiveSeenBy;
    const several = scorecard.invasiveSources.length > 1;
    const lines = [seen.length
      ? `${plural(seen.length, "invasive species", "invasive species")} spotted: ${seen.map((s) => (several ? `${s.label} (${s.sources.join(", ")})` : s.label)).join(", ")}`
      : "No invasive species spotted in the current date range"];
    if (!scorecard.invasivesRated) lines.push(INVASIVES_SHORTFALL());
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
  if (subKey === "habitatCondition") {
    const habitat = scorecard.habitat;
    if (!habitat) return ["The Modular River Survey couldn't be loaded, so this isn't rated."];
    if (!habitat.subreaches.length) return [`No MoRPh habitat surveys in ${morphYearsText()}`, HABITAT_SHORTFALL()];
    const lines = [`Habitat complexity: ${score(habitat.score)} out of 10 (mean of ${plural(habitat.subreaches.length, "subreach", "subreaches")}, from the latest MoRPh surveys in ${morphYearsText()})`];
    if (habitat.supersededCount) {
      lines.push(`${plural(habitat.supersededCount, "earlier module")} left out because the same place was surveyed again later.`);
    }
    if (habitat.preProjectCount) {
      lines.push(`${plural(habitat.preProjectCount, "subreach", "subreaches")} only had a pre-project survey, so may be out of date if work has been done since.`);
    }
    if (!habitat.rated) lines.push(HABITAT_SHORTFALL());
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
    const used = scorecard.invasiveSources;
    const sources = used.map((s) => `${s.name} (${plural(s.surveys, s.surveyWord)}, ${plural(s.sites, s.siteWord, s.siteWord === "subreach" ? "subreaches" : undefined)})`).join("; ");
    return [`${used.length === 1 ? "Data source" : "Data sources"}: ${sources || "none with surveys in this period"}`,
      ...offLine(subKey, scorecard),
      `${nrsRule}, counted across all the sources switched on`,
      "Statistical measure: number of species seen, any sighting at any site",
      `Sites: ${scorecard.invasiveSiteCount}`, `Surveys: ${scorecard.invasiveSurveyCount}`];
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
  if (subKey === "habitatCondition") {
    const habitat = scorecard.habitat;
    const modules = habitat?.modules.length ?? 0;
    return [`Data source: ${modules ? `Modular River Survey (MoRPh) (${plural(modules, "module")}, ${plural(habitat.subreaches.length, "subreach", "subreaches")})` : "none with surveys in this period"}`,
      `Data requirement: Min. ${plural(SCORECARD.habitat.minSubreaches, "subreach", "subreaches")}, or 1 of ${SCORECARD.habitat.orModulesInOneSubreach} modules, surveyed in ${morphYearsText()}`,
      "Statistical measure: mean of the subreaches' habitat complexity scores",
      "Not limited to the period: the latest survey at each place counts"];
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
  const nrsUsed = (scorecard.invasiveSources ?? []).some((s) => s.name === "National River Survey")
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
  const morphParts = [];
  if (scorecard.habitat?.modules.length) {
    morphParts.push(`Habitat: ${plural(scorecard.habitat.subreaches.length, "subreach", "subreaches")}, ${plural(scorecard.habitat.modules.length, "module")} (latest surveys in ${morphYearsText()})`);
  }
  const morphInvasives = (scorecard.invasiveSources ?? []).find((s) => s.siteWord === "subreach");
  if (morphInvasives) {
    morphParts.push(`Invasives: ${plural(morphInvasives.sites, "subreach", "subreaches")}, ${plural(morphInvasives.surveys, "module")} in the period`);
  }
  if (morphParts.length) rows.push({ name: "Modular River Survey (MoRPh)", coverage: morphParts.join("; ") });
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
