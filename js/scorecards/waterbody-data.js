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
import { BUILT_IN, allSources, isSourceOn, sourceReadings, switchedOffNames, usesSource } from "./hub-sources.js";

const NUTRIENTS = ["phosphate", "nitrate", "nitrite", "ammonia", "turbidity", "conductivity"];
const cache = new Map(); // waterBodyId -> promise of { locationIDs, observations }

// Riverfly samples in range: from the floor date (or the range start, if
// later) to the range end. `extra` narrows further (e.g. which samples).
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
      where: riverflyWhere(),
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
  const hubTotals = new Map(); // source name -> { sites: Set, readings }
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
      const total = hubTotals.get(found.name) ?? { sites: new Set(), readings: 0 };
      found.sites.forEach((site) => total.sites.add(site));
      total.readings += found.points.length;
      hubTotals.set(found.name, total);
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

  const wildlifeOn = usesSource("wildlife", "national_river_survey");
  const invasivesOn = usesSource("invasives", "national_river_survey");
  const wildlifeSpeciesFound = wildlifeOn ? present(WILDLIFE_FIELDS) : [];
  const invasiveSpeciesFound = invasivesOn ? present(INVASIVE_PLANT_FIELDS) : [];

  const scorecard = {
    error,
    locationCount: data.locationIDs.length,
    observationCount: obs.length,
    nrsRatingsAvailable,
    wildlifeRank: wildlifeOn ? gated(ratings.wildlifeRank(wildlifeSpeciesFound.length)) : null,
    invasiveRank: invasivesOn ? gated(ratings.invasiveRank(invasiveSpeciesFound.length)) : null,
    invertebrateRank: riverflyOn ? ratings.invertebrateRank(riverfly.samples, riverfly.sites, riverfly.breaches) : null,
    actionRank: nbsOn ? ratings.actionRank(actionDeliveredCount) : null,
    // Which sources feed which measures, after the sources panel.
    sourcesOn: { wildlife: wildlifeOn, invasives: invasivesOn, invertebrates: riverflyOn, action: nbsOn },
    // measure key -> the datasets with data here in the period, switched
    // on or not: what the sources panel offers.
    available: {
      ...available,
      wildlife: listed("wildlife", "national_river_survey") && obs.length ? ["national_river_survey"] : [],
      invasives: listed("invasives", "national_river_survey") && obs.length ? ["national_river_survey"] : [],
      invertebrates: riverfly.samples ? ["riverfly"] : [],
      action: actionDeliveredCount ? ["nbs_interventions"] : [],
    },
    switchedOff: Object.fromEntries(["phosphate", "nitrate", "nitrite", "ammonia", "turbidity", "conductivity", "wildlife", "invasives", "invertebrates", "action"]
      .map((key) => [key, switchedOffNames(key)])),

    wildlifeSpeciesFound,
    invasiveSpeciesFound,
    invertebrateSurveyCount: riverfly.samples,
    invertebrateBreachCount: riverfly.breaches,
    invertebrateSiteCount: riverfly.sites,
    actionDeliveredCount,
    // The hub's datasets, totalled across the nutrient measures.
    hubSources: [...hubTotals].map(([name, total]) => ({ name, sites: total.sites.size, readings: total.readings })),
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
