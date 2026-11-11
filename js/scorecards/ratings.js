// =====================================================================
// RATINGS
// Scorecard scoring rules: a value or count -> a 0-4 rank (0 = High,
// best; 4 = Bad), using SCORECARD / RATING_BANDS in config.js. Every rank
// is null when there's nothing reliable to rate.
// =====================================================================

import { RATING_BANDS, SCORECARD, CATCHMENT_HEALTH_SPOKES } from "./config.js";
import { bandsForMetric } from "./metrics.js";

const isMissing = (v) => v == null || Number.isNaN(v);

// rank -> { key, label, color }, or null.
export function bandForRank(rank) {
  if (isMissing(rank)) return null;
  return RATING_BANDS[Math.max(0, Math.min(RATING_BANDS.length - 1, rank))];
}

// Against the map's agreed thresholds: Low -> High (0) ... Very High -> Bad (4).
export function determinandRank(metricKey, value) {
  if (isMissing(value)) return null;
  const bands = bandsForMetric(metricKey);
  if (!bands) return null;
  const i = bands.findIndex((b) => b.max === null || value <= b.max);
  return i === -1 ? bands.length - 1 : i;
}

export function wildlifeRank(speciesCount) {
  if (isMissing(speciesCount)) return null;
  const i = SCORECARD.wildlifeRichnessMin.findIndex((min) => speciesCount >= min);
  return i === -1 ? SCORECARD.wildlifeRichnessMin.length : i;
}

export function invasiveRank(speciesCount) {
  if (isMissing(speciesCount)) return null;
  const i = SCORECARD.invasiveRichnessMax.findIndex((max) => speciesCount <= max);
  return i === -1 ? SCORECARD.invasiveRichnessMax.length : i;
}

export function invertebrateDataSufficient(siteCount, sampleCount) {
  return (siteCount || 0) >= SCORECARD.invertebrateMinSites && (sampleCount || 0) >= SCORECARD.invertebrateMinSamples;
}

export function invertebrateRank(sampleCount, siteCount, breachCount) {
  if (isMissing(sampleCount) || !invertebrateDataSufficient(siteCount, sampleCount)) return null;
  const rate = breachCount / sampleCount;
  const i = SCORECARD.invertebrateBreachRateMax.findIndex((max) => rate <= max);
  return i === -1 ? SCORECARD.invertebrateBreachRateMax.length : i;
}

// Zero delivered interventions is Bad, or "no data" when Action's
// whenNone in data/scorecard.json says so.
export function actionRank(count) {
  if (isMissing(count)) return null;
  if (count === 0 && SCORECARD.actionNoneIsNoData) return null;
  const i = SCORECARD.actionCountMin.findIndex((min) => count >= min);
  return i === -1 ? SCORECARD.actionCountMin.length : i;
}

// Rounded mean of the known ranks, on a 1-5 scale and back.
export function averageRank(ranks) {
  const known = ranks.filter((r) => !isMissing(r));
  return known.length ? Math.round(known.reduce((sum, r) => sum + r + 1, 0) / known.length) - 1 : null;
}

// ---- Catchment Health wheel ----

// Sub key -> rank, or null with no scorecard.
export function catchmentHealthRanks(scorecard) {
  return scorecard ? {
    phosphate: scorecard.phosphateRank,
    nitrate: scorecard.nitrateRank,
    nitrite: scorecard.nitriteRank,
    ammonia: scorecard.ammoniaRank,
    turbidity: scorecard.turbidityRank,
    conductivity: scorecard.conductivityRank,
    wildlife: scorecard.wildlifeRank,
    invasives: scorecard.invasiveRank,
    invertebrates: scorecard.invertebrateRank,
    action: scorecard.actionRank,
  } : null;
}

// A theme's main wedge: the average of whichever subs have a rank.
export function themeRank(spoke, ranks) {
  if (!ranks) return null;
  return averageRank(spoke.subs.map((s) => ranks[s.key]));
}

// The hub: the average of the wired themes' ranks.
export function catchmentHealthOverallRank(scorecard) {
  const ranks = catchmentHealthRanks(scorecard);
  if (!ranks) return null;
  return averageRank(CATCHMENT_HEALTH_SPOKES.filter((s) => s.wired).map((s) => themeRank(s, ranks)));
}
