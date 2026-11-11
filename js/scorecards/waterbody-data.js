// =====================================================================
// WATERBODY DATA
// Builds one WFD waterbody's Catchment Health scorecard from:
//   - NRS: every site with this water_body_id (ANY organisation) and all
//     their observations, pooled across the waterbody, in the date range
//   - the hub's own datasets listed in data/scorecard.json, pooled
//     with NRS for the nutrient measures (hub-sources.js)
//   - Riverfly: samples inside the waterbody polygon (spatial - no join key)
//   - Nature-Based Solutions: delivered interventions inside the polygon
// The NRS sites/observations don't depend on the date range, so they're
// cached per waterbody; Riverfly and NBS are re-queried each time
// (Riverfly is date-filtered; NBS needs the polygon).
// =====================================================================

import { NRS, METRICS, SCORECARD, SCORECARD_SOURCES, WILDLIFE_FIELDS, INVASIVE_PLANT_FIELDS } from "./config.js";
import { median } from "./metrics.js";
import { getDateRange, isWithinDateRange } from "./date-range.js";
import { getLayer, queryAll } from "./nrs-service.js";
import { escapeSql, sqlTimestamp } from "./format.js";
import * as ratings from "./ratings.js";
import { BUILT_IN, allSources, isSourceOn, sourceReadings, sourceSurveys, switchedOffNames, usesSource } from "./hub-sources.js";

const NUTRIENTS = ["phosphate", "nitrate", "nitrite", "ammonia", "turbidity", "conductivity"];
const cache = new Map(); // waterBodyId -> promise of { locationIDs, observations }

// Riverfly samples in range: from the floor date (or the range start, if
// later) to the range end. `extra` narrows further (e.g. which samples).
// A Riverfly sample the scorecard can use: one actually taken, and judged
// against its site's trigger level - clean, or a confirmed breach. Left
// out: a blank result (usually a site with no trigger level, so it can't
// be judged), an unconfirmed breach, and a visit where no sample was
// taken. The map shows the same samples.
export const RIVERFLY_ASSESSED = "(sampleTaken IS NULL OR sampleTaken <> 0) AND (breach = 0 OR breachType = 'Confirmed')";

export function riverflyWhere(extra) {
  const { from, to } = getDateRange();
  const floor = from !== null ? Math.max(SCORECARD.riverflyFloor, from) : SCORECARD.riverflyFloor;
  let where = `timestamp >= TIMESTAMP '${sqlTimestamp(floor)}'`;
  if (to !== null) where += ` AND timestamp <= TIMESTAMP '${sqlTimestamp(to)}'`;
  return extra ? `(${extra}) AND ${where}` : where;
}

function fetchCached(waterBodyId) {
  if (!cache.has(waterBodyId)) {
    const promise = (async () => {
      const [locations, observationsTable] = await Promise.all([getLayer(NRS.locationsUrl), getLayer(NRS.observationsUrl)]);
      const sites = await queryAll(locations, {
        where: `water_body_id = '${escapeSql(waterBodyId)}'`,
        outFields: ["GlobalID"],
        returnGeometry: false,
      });
      const locationIDs = sites.map((f) => f.attributes.GlobalID);
      const observations = locationIDs.length
        ? (await queryAll(observationsTable, {
          where: `location_id IN (${locationIDs.map((id) => `'${escapeSql(id)}'`).join(", ")})`,
          outFields: [
            "location_id", "time_of_observation", ...NUTRIENTS,
            ...WILDLIFE_FIELDS.map((w) => w.observationField),
            ...INVASIVE_PLANT_FIELDS.map((w) => w.observationField),
          ],
          returnGeometry: false,
        })).map((f) => f.attributes)
        : [];
      return { locationIDs, observations };
    })();
    cache.set(waterBodyId, promise);
    promise.catch(() => cache.delete(waterBodyId)); // retry next time
  }
  return cache.get(waterBodyId);
}

async function queryRiverfly(geometry) {
  try {
    const layer = await getLayer(SCORECARD_SOURCES.riverflyUrl);
    const features = await queryAll(layer, {
      where: riverflyWhere(RIVERFLY_ASSESSED),
      geometry,
      spatialRelationship: "intersects",
      outFields: ["breachType", "site"],
      returnGeometry: false,
    });
    return {
      samples: features.length,
      breaches: features.filter((f) => f.attributes.breachType === "Confirmed").length,
      sites: new Set(features.map((f) => f.attributes.site)).size,
    };
  } catch (error) {
    console.error("Scorecards: Riverfly samples failed to load:", error);
    return { samples: 0, breaches: 0, sites: 0 };
  }
}

async function queryNbsCount(geometry) {
  try {
    const layer = await getLayer(SCORECARD_SOURCES.nbsUrl);
    return await layer.queryFeatureCount({ where: "Status = 'Delivered'", geometry, spatialRelationship: "intersects" });
  } catch (error) {
    console.error("Scorecards: NBS interventions failed to load:", error);
    return 0;
  }
}

const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

// The scorecard for one waterbody. Every *Rank is 0-4 or null.
export async function computeScorecard(waterBodyId, geometry) {
  let data;
  let error = false;
  try {
    data = await fetchCached(waterBodyId);
  } catch (e) {
    console.error("Scorecards: waterbody NRS data failed to load:", e);
    data = { locationIDs: [], observations: [] };
    error = true;
  }
  // Every listed source is read, so the sources panel knows which have
  // data here. One switched off there isn't rated, so its measure has no
  // data rather than a rating of nothing.
  const riverflyOn = usesSource("invertebrates", "riverfly");
  const nbsOn = usesSource("action", "nbs_interventions");
  const listed = (key, dataset) => allSources(key).some((source) => source.dataset === dataset);
  const [riverfly, actionDeliveredCount] = await Promise.all([
    listed("invertebrates", "riverfly") ? queryRiverfly(geometry) : { samples: 0, breaches: 0, sites: 0 },
    listed("action", "nbs_interventions") ? queryNbsCount(geometry) : 0,
  ]);

  const obs = data.observations.filter((o) => isWithinDateRange(o.time_of_observation));
  const nrsRatingsAvailable = data.locationIDs.length >= SCORECARD.nrsMinSites && obs.length >= SCORECARD.nrsMinSurveys;
  const values = (field) => obs.map((o) => o[field]).filter((v) => v != null);
  const series = (field) => obs.filter((o) => o.time_of_observation != null && o[field] != null)
    .map((o) => ({ date: o.time_of_observation, value: o[field] }));
  const present = (fields) => fields.filter((f) => obs.some((o) => o[f.observationField] === "Yes")).map((f) => f.label);
  const gated = (rank) => (nrsRatingsAvailable ? rank : null);

  // Each nutrient pools NRS with the hub's listed sources, aggregated per
  // its METRICS `aggregation`, and is rated once it has enough sites and
  // readings of its own.
  const nutrient = {};
  const hubTotals = new Map(); // source name -> { sites: Set, readings, surveyIds: Set }
  const totalFor = (name) => {
    if (!hubTotals.has(name)) hubTotals.set(name, { sites: new Set(), readings: 0, surveyIds: new Set() });
    return hubTotals.get(name);
  };
  // A survey used by more than one measure is counted once.
  const addSurveys = (found) => {
    const total = totalFor(found.name);
    found.sites.forEach((site) => total.sites.add(site));
    found.points.forEach((point) => total.surveyIds.add(point.objectId));
  };
  // measure key -> the datasets with data here, switched on or not.
  const available = {};
  for (const key of NUTRIENTS) {
    const metric = METRICS.find((m) => m.key === key);
    const sources = [];
    let points = [];
    let siteCount = 0;
    available[key] = [];
    for (const source of allSources(key)) {
      let found;
      if (source.dataset === "national_river_survey") {
        found = {
          name: source.name,
          points: series(key).map((point) => ({ ...point, isEstimate: false })),
          sites: new Set(obs.filter((o) => o[key] != null).map((o) => o.location_id)),
          isHub: false,
        };
      } else if (!BUILT_IN.has(source.dataset)) {
        found = { ...sourceReadings(source, metric.catalogId, waterBodyId), isHub: true };
      }
      if (!found?.points?.length) continue;
      available[key].push(source.dataset);
      if (!isSourceOn(key, source.dataset)) continue;
      sources.push({ name: found.name, readings: found.points.length, sites: found.sites.size });
      points = points.concat(found.points);
      siteCount += found.sites.size;
      if (!found.isHub) continue;
      const total = totalFor(found.name);
      found.sites.forEach((site) => total.sites.add(site));
      total.readings += found.points.length;
    }
    const v = points.map((point) => point.value);
    nutrient[key] = {
      value: metric.aggregation === "median" ? median(v) : mean(v),
      count: v.length,
      series: points.map(({ date, value }) => ({ date, value })),
      sources,
      siteCount,
      estimateCount: points.filter((point) => point.isEstimate).length,
      rated: siteCount >= SCORECARD.nrsMinSites && v.length >= SCORECARD.nrsMinSurveys,
    };
  }

  // Visible pollution: surveys from every sign-counting source switched
  // on, pooled. Rated on the share showing any sign, once there are
  // enough sites and surveys.
  const pollution = { surveys: 0, withSigns: 0, siteCount: 0, signs: new Map(), sources: [] };
  available.visiblePollution = [];
  for (const source of allSources("visiblePollution")) {
    const found = sourceSurveys(source, waterBodyId);
    if (!found?.surveys) continue;
    available.visiblePollution.push(source.dataset);
    if (!isSourceOn("visiblePollution", source.dataset)) continue;
    pollution.surveys += found.surveys;
    pollution.withSigns += found.withSigns;
    pollution.siteCount += found.sites.size;
    found.signs.forEach((count, label) => pollution.signs.set(label, (pollution.signs.get(label) ?? 0) + count));
    pollution.sources.push({ name: found.name, surveys: found.surveys, withSigns: found.withSigns, sites: found.sites.size });
    addSurveys(found);
  }
  const pollutionRated = pollution.siteCount >= SCORECARD.nrsMinSites && pollution.surveys >= SCORECARD.nrsMinSurveys;

  // Wildlife: surveys from every source switched on, pooled. The score is
  // the share of surveys recording an indicator species, times the
  // effective number of species (how evenly the sightings spread, from
  // each species' share of them) over the number of species.
  const wildlife = { surveys: 0, withSpecies: 0, siteCount: 0, species: new Map(), sources: [] };
  available.wildlife = [];
  for (const source of allSources("wildlife")) {
    let found = null;
    if (source.dataset === "national_river_survey") {
      // NRS has no "nothing seen" answer, so every survey counts.
      found = { name: source.name, surveys: obs.length, withSigns: 0, signs: new Map(), sites: new Set(), points: [] };
      for (const o of obs) {
        const seen = Object.entries(source.signs ?? {}).filter(([field]) => o[field] === "Yes").map(([, label]) => label);
        if (seen.length) found.withSigns += 1;
        seen.forEach((label) => found.signs.set(label, (found.signs.get(label) ?? 0) + 1));
        found.sites.add(o.location_id);
      }
    } else if (!BUILT_IN.has(source.dataset)) {
      found = sourceSurveys(source, waterBodyId);
    }
    if (!found?.surveys) continue;
    available.wildlife.push(source.dataset);
    if (!isSourceOn("wildlife", source.dataset)) continue;
    wildlife.surveys += found.surveys;
    wildlife.withSpecies += found.withSigns;
    wildlife.siteCount += found.sites.size;
    found.signs.forEach((count, label) => wildlife.species.set(label, (wildlife.species.get(label) ?? 0) + count));
    wildlife.sources.push({ name: found.name, surveys: found.surveys, withSpecies: found.withSigns, sites: found.sites.size });
    if (source.dataset !== "national_river_survey") addSurveys(found);
  }
  const sightings = [...wildlife.species.values()].reduce((sum, n) => sum + n, 0);
  const wildlifeEffective = sightings ? 1 / [...wildlife.species.values()].reduce((sum, n) => sum + (n / sightings) ** 2, 0) : 0;
  const wildlifeShare = wildlife.surveys ? wildlife.withSpecies / wildlife.surveys : null;
  const wildlifeScore = wildlifeShare === null ? null : (wildlifeShare * wildlifeEffective) / SCORECARD.wildlifeSpecies.length;
  const wildlifeRated = wildlife.siteCount >= SCORECARD.nrsMinSites && wildlife.surveys >= SCORECARD.nrsMinSurveys;

  const invasivesOn = usesSource("invasives", "national_river_survey");
  const invasiveSpeciesFound = invasivesOn ? present(INVASIVE_PLANT_FIELDS) : [];

  const scorecard = {
    error,
    locationCount: data.locationIDs.length,
    observationCount: obs.length,
    nrsRatingsAvailable,
    wildlifeRank: wildlifeRated ? ratings.wildlifeRank(wildlifeScore) : null,
    wildlifeRated,
    wildlifeScore,
    wildlifeShare,
    wildlifeEffective,
    wildlifeSurveys: wildlife.surveys,
    wildlifeWithSpecies: wildlife.withSpecies,
    wildlifeSiteCount: wildlife.siteCount,
    // Every indicator species, most seen first, unseen ones last: [{ label, surveys }].
    wildlifeSpeciesSeen: SCORECARD.wildlifeSpecies.map((label) => ({ label, surveys: wildlife.species.get(label) ?? 0 }))
      .sort((a, b) => b.surveys - a.surveys),
    wildlifeSources: wildlife.sources,
    invasiveRank: invasivesOn ? gated(ratings.invasiveRank(invasiveSpeciesFound.length)) : null,
    invertebrateRank: riverflyOn ? ratings.invertebrateRank(riverfly.samples, riverfly.sites, riverfly.breaches) : null,
    actionRank: nbsOn ? ratings.actionRank(actionDeliveredCount) : null,
    visiblePollutionRank: pollutionRated ? ratings.visiblePollutionRank(pollution.withSigns / pollution.surveys) : null,
    visiblePollutionRated: pollutionRated,
    visiblePollutionSurveys: pollution.surveys,
    visiblePollutionWithSigns: pollution.withSigns,
    visiblePollutionSiteCount: pollution.siteCount,
    // Every sign seen, most common first: [{ label, surveys }].
    visiblePollutionSigns: [...pollution.signs].map(([label, surveys]) => ({ label, surveys })).sort((a, b) => b.surveys - a.surveys),
    visiblePollutionSources: pollution.sources,
    // Which sources feed which measures, after the sources panel.
    sourcesOn: { invasives: invasivesOn, invertebrates: riverflyOn, action: nbsOn },
    // measure key -> the datasets with data here in the period, switched
    // on or not: what the sources panel offers.
    available: {
      ...available,
      invasives: listed("invasives", "national_river_survey") && obs.length ? ["national_river_survey"] : [],
      invertebrates: riverfly.samples ? ["riverfly"] : [],
      action: actionDeliveredCount ? ["nbs_interventions"] : [],
    },
    switchedOff: Object.fromEntries(["phosphate", "nitrate", "nitrite", "ammonia", "turbidity", "conductivity", "wildlife", "invasives", "invertebrates", "action", "visiblePollution"]
      .map((key) => [key, switchedOffNames(key)])),

    invasiveSpeciesFound,
    invertebrateSurveyCount: riverfly.samples,
    invertebrateBreachCount: riverfly.breaches,
    invertebrateSiteCount: riverfly.sites,
    actionDeliveredCount,
    // The hub's datasets, totalled across the nutrient measures.
    hubSources: [...hubTotals].map(([name, total]) => ({ name, sites: total.sites.size, readings: total.readings, surveys: total.surveyIds.size })),
  };
  // Per nutrient: <key>Rank (against the agreed thresholds), <key>Value
  // (mean/median), <key>ReadingCount, <key>Series, <key>Sources (each
  // source's readings and sites), <key>SiteCount, <key>EstimateCount
  // (readings that were a range or at a limit) and <key>Rated.
  for (const key of NUTRIENTS) {
    const n = nutrient[key];
    scorecard[`${key}Rank`] = n.rated ? ratings.determinandRank(key, n.value) : null;
    scorecard[`${key}Value`] = n.value;
    scorecard[`${key}ReadingCount`] = n.count;
    scorecard[`${key}Series`] = n.series;
    scorecard[`${key}Sources`] = n.sources;
    scorecard[`${key}SiteCount`] = n.siteCount;
    scorecard[`${key}EstimateCount`] = n.estimateCount;
    scorecard[`${key}Rated`] = n.rated;
  }
  return scorecard;
}
