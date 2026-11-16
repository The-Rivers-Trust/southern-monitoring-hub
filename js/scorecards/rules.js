// =====================================================================
// RATING RULES
// Reads how each measure is rated from data/scorecard.json into the
// SCORECARD settings and METRICS that ratings.js and the rest use.
// Called once, before anything is rated.
// =====================================================================

import { METRICS, SCORECARD } from "./config.js";

const STEPS = ["high", "good", "moderate", "poor"];

// The direction each rule is written for in ratings.js.
const DIRECTIONS = { wildlife: "higher", invasives: "lower", invertebrates: "lower", action: "higher", visiblePollution: "lower", habitatCondition: "higher" };

// A number, or a fraction written as "1/20".
function figure(value) {
  if (typeof value === "number") return value;
  const fraction = /^\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*$/.exec(String(value));
  return fraction ? Number(fraction[1]) / Number(fraction[2]) : NaN;
}

// A measure's four thresholds, best first, checked to run the right way.
function steps(key, rating, problems) {
  const values = STEPS.map((step) => figure(rating[step]));
  if (values.some((value) => !Number.isFinite(value))) problems.push(`${key}: high, good, moderate and poor must all be numbers`);
  if (rating.better !== DIRECTIONS[key]) problems.push(`${key}: better should be "${DIRECTIONS[key]}"`);
  const ordered = values.every((value, i) => i === 0 || (DIRECTIONS[key] === "higher" ? value <= values[i - 1] : value >= values[i - 1]));
  if (!ordered) problems.push(`${key}: thresholds should run from high to poor`);
  return values;
}

// Applies the rules and returns any problems, as sentences.
export function useRules(scorecard) {
  const problems = [];
  const { coverage, measures } = scorecard;
  SCORECARD.nrsMinSites = coverage.minSites;
  SCORECARD.nrsMinSurveys = coverage.minReadings;

  for (const metric of METRICS) {
    const rating = measures[metric.key]?.rating;
    if (rating?.thresholds !== "catalog") problems.push(`${metric.key}: thresholds should be "catalog"`);
    if (!["mean", "median"].includes(rating?.statistic)) problems.push(`${metric.key}: statistic should be mean or median`);
    metric.aggregation = rating?.statistic === "median" ? "median" : "mean";
  }

  SCORECARD.wildlifeScoreMin = steps("wildlife", measures.wildlife.rating, problems);
  SCORECARD.wildlifeSpecies = measures.wildlife.species ?? [];
  if (!SCORECARD.wildlifeSpecies.length) problems.push("wildlife: list the indicator species");
  for (const source of measures.wildlife.sources) {
    Object.values(source.signs ?? {}).filter((label) => !SCORECARD.wildlifeSpecies.includes(label))
      .forEach((label) => problems.push(`wildlife, ${source.name}: ${label} isn't one of the listed species`));
  }
  SCORECARD.invasiveRichnessMax = steps("invasives", measures.invasives.rating, problems);
  SCORECARD.actionCountMin = steps("action", measures.action.rating, problems);
  if (measures.visiblePollution) SCORECARD.visiblePollutionRateMax = steps("visiblePollution", measures.visiblePollution.rating, problems);
  const habitat = measures.habitatCondition?.rating;
  if (habitat) {
    SCORECARD.habitatScoreMin = steps("habitatCondition", habitat, problems);
    SCORECARD.habitat = {
      withinYears: habitat.withinYears ?? 5,
      minSubreaches: habitat.minSubreaches ?? 2,
      orModulesInOneSubreach: habitat.orModulesInOneSubreach ?? 10,
      supersededWithinMetres: habitat.supersededWithinMetres ?? 25,
      leaveOutSurveyTypes: habitat.leaveOutSurveyTypes ?? [],
      score: measures.habitatCondition.score ?? {},
      pressures: measures.habitatCondition.pressures ?? {},
    };
    if (!Object.keys(SCORECARD.habitat.score).length) problems.push("habitatCondition: list the score's indices");
  }
  const whenNone = measures.action.rating.whenNone ?? "bad";
  if (!["no data", "bad"].includes(whenNone)) problems.push('action: whenNone should be "no data" or "bad"');
  SCORECARD.actionNoneIsNoData = whenNone === "no data";
  const invertebrates = measures.invertebrates.rating;
  SCORECARD.invertebrateBreachRateMax = steps("invertebrates", invertebrates, problems);
  SCORECARD.invertebrateMinSites = invertebrates.minSites;
  SCORECARD.invertebrateMinSamples = invertebrates.minSamples;
  const [year, month, day] = String(invertebrates.samplesFrom).split("-").map(Number);
  SCORECARD.riverflyFloor = new Date(year, month - 1, day).getTime();
  if (!Number.isFinite(SCORECARD.riverflyFloor)) problems.push('invertebrates: samplesFrom should be a date such as "2026-01-01"');
  return problems;
}
