// =====================================================================
// MORPH
// The Habitat measure, from the Modular River Survey (MoRPh). Each point
// is one surveyed module, a 10-50 m stretch of river, with summary
// indices. Habitat changes slowly and is surveyed project by project, so
// this isn't limited to the scorecard period: it takes the latest surveys
// from the years up to the end of the period (data/scorecard.json).
//
//   1. Modules inside the waterbody in that window, leaving out survey
//      types such as training.
//      Modules the service holds twice are counted once.
//   2. A module is superseded when a later survey (more than a week
//      later, of any type) has a module within a few metres of it, so a
//      pre-project survey only counts where nothing has been surveyed
//      there since. Matched on position, since projects often rename a
//      stretch between surveys.
//   3. The rest are grouped into subreach surveys (same river, reach and
//      subreach names, surveyed within a week), each scored as the mean
//      of its modules. The waterbody's score is the mean of its subreaches.
// =====================================================================

import { SCORECARD, SCORECARD_SOURCES } from "./config.js";
import { getDateRange } from "./date-range.js";
import { getLayer, queryAll } from "./nrs-service.js";
import { escapeSql, sqlTimestamp } from "./format.js";

const WEEK = 7 * 24 * 60 * 60 * 1000;
const METRES_PER_DEGREE = 111320;
const cache = new Map(); // "waterBodyId|window end" -> promise

const mean = (values) => {
  const known = values.filter((value) => value != null && Number.isFinite(value));
  return known.length ? known.reduce((sum, value) => sum + value, 0) / known.length : null;
};

function distance(a, b) {
  const dy = (a.lat - b.lat) * METRES_PER_DEGREE;
  const dx = (a.lon - b.lon) * METRES_PER_DEGREE * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dx, dy);
}

// The years of surveys used: { from, to } in ms, ending with the period.
export function morphWindow() {
  const { to } = getDateRange();
  const end = to ?? Date.now();
  const start = new Date(end);
  start.setFullYear(start.getFullYear() - SCORECARD.habitat.withinYears);
  return { from: start.getTime(), to: end };
}

async function fetchModules(geometry, window) {
  const { score, pressures, leaveOutSurveyTypes } = SCORECARD.habitat;
  const layer = await getLayer(SCORECARD_SOURCES.morphUrl);
  let where = `timestamp >= TIMESTAMP '${sqlTimestamp(window.from)}' AND timestamp <= TIMESTAMP '${sqlTimestamp(window.to)}'`;
  if (leaveOutSurveyTypes.length) {
    where += ` AND (surveyType IS NULL OR surveyType NOT IN (${leaveOutSurveyTypes.map((type) => `'${escapeSql(type)}'`).join(", ")}))`;
  }
  const features = await queryAll(layer, {
    where,
    geometry,
    spatialRelationship: "intersects",
    outFields: [...new Set([layer.objectIdField, "timestamp", "surveyType", "riverName", "reachName", "subreachName", "moduleNumber",
      ...Object.keys(score), ...Object.keys(pressures)])],
    returnGeometry: true,
    outSpatialReference: { wkid: 4326 },
  });
  return features.filter((f) => f.geometry && f.attributes.timestamp != null).map((f) => ({
    ...f.attributes,
    objectId: f.attributes[layer.objectIdField],
    lon: f.geometry.x,
    lat: f.geometry.y,
  }));
}

// A module's habitat complexity score: the mean of the score indices.
const moduleScore = (module) => mean(Object.keys(SCORECARD.habitat.score).map((field) => module[field]));

// The service holds some modules more than once (same names, module
// number and time): keep one of each.
function withoutDuplicates(modules) {
  const seen = new Set();
  return modules.filter((module) => {
    const key = [module.riverName, module.reachName, module.subreachName, module.moduleNumber, module.timestamp].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function summarise(all) {
  const { supersededWithinMetres, score, pressures, minSubreaches, orModulesInOneSubreach } = SCORECARD.habitat;
  const modules = withoutDuplicates(all);
  const kept = modules.filter((module) => !modules.some((other) => other.timestamp - module.timestamp > WEEK
    && distance(module, other) <= supersededWithinMetres));

  // Subreach surveys: same names, surveyed within a week of the first.
  const byName = new Map();
  for (const module of [...kept].sort((a, b) => a.timestamp - b.timestamp)) {
    const key = [module.riverName, module.reachName, module.subreachName].map((part) => String(part ?? "").trim()).join("|");
    if (!byName.has(key)) byName.set(key, []);
    const surveys = byName.get(key);
    const last = surveys.at(-1);
    if (last && module.timestamp - last.first <= WEEK) last.modules.push(module);
    else surveys.push({ first: module.timestamp, modules: [module] });
  }
  const subreaches = [...byName.values()].flat().map(({ modules: group }) => {
    const types = new Map();
    group.forEach((module) => {
      const type = module.surveyType || "not recorded";
      types.set(type, (types.get(type) ?? 0) + 1);
    });
    const first = group[0];
    return {
      name: first.subreachName || first.reachName || first.riverName || "Unnamed subreach",
      river: first.riverName || "",
      date: Math.max(...group.map((module) => module.timestamp)),
      surveyType: [...types].sort((a, b) => b[1] - a[1])[0][0],
      modules: group.length,
      score: mean(group.map(moduleScore)),
      values: Object.fromEntries([...Object.keys(score), ...Object.keys(pressures)].map((field) => [field, mean(group.map((m) => m[field]))])),
    };
  }).sort((a, b) => b.date - a.date);

  const scored = subreaches.filter((subreach) => subreach.score != null);
  const average = (field) => mean(scored.map((subreach) => subreach.values[field]));
  return {
    modules: kept,
    supersededCount: modules.length - kept.length,
    subreaches,
    score: mean(scored.map((subreach) => subreach.score)),
    components: Object.entries(score).map(([field, label]) => ({ field, label, value: average(field) })),
    pressures: Object.entries(pressures).map(([field, label]) => ({ field, label, value: average(field) })),
    preProjectCount: subreaches.filter((subreach) => subreach.surveyType === "pre-project").length,
    rated: scored.length >= minSubreaches || scored.some((subreach) => subreach.modules >= orModulesInOneSubreach),
  };
}

// The waterbody's current MoRPh habitat picture, shared by the scorecard
// and the map: { modules (the ones used), supersededCount, subreaches,
// score, components, pressures, preProjectCount, rated }, or null if the
// service couldn't be read.
export function morphFor(waterBodyId, geometry) {
  const window = morphWindow();
  const key = `${waterBodyId}|${window.to}`;
  if (!cache.has(key)) {
    const promise = fetchModules(geometry, window).then(summarise).catch((error) => {
      console.error("Scorecards: MoRPh surveys failed to load:", error);
      cache.delete(key); // retry next time
      return null;
    });
    cache.set(key, promise);
  }
  return cache.get(key);
}

// ---------------------------------------------------------------------
// Invasives
// Unlike Habitat, limited to the scorecard period, with nothing
// superseded: like the National River Survey, any sighting in the period
// counts. A species is seen on a module when its extent is T, P or E.
// ---------------------------------------------------------------------

const SEEN = new Set(["T", "P", "E"]);
const invasivesCache = new Map(); // "waterBodyId|from|to" -> promise

// { modules, subreaches (count), seen: Map(label -> modules seeing it) },
// or null if the service couldn't be read. signs: field -> species name.
export function morphInvasivesFor(waterBodyId, geometry, signs) {
  const { from, to } = getDateRange();
  const key = `${waterBodyId}|${from}|${to}`;
  if (!invasivesCache.has(key)) {
    const promise = (async () => {
      const layer = await getLayer(SCORECARD_SOURCES.morphUrl);
      const types = SCORECARD.habitat?.leaveOutSurveyTypes ?? [];
      let where = `timestamp >= TIMESTAMP '${sqlTimestamp(from)}' AND timestamp <= TIMESTAMP '${sqlTimestamp(to)}'`;
      if (types.length) where += ` AND (surveyType IS NULL OR surveyType NOT IN (${types.map((type) => `'${escapeSql(type)}'`).join(", ")}))`;
      const features = await queryAll(layer, {
        where,
        geometry,
        spatialRelationship: "intersects",
        outFields: [layer.objectIdField, "timestamp", "riverName", "reachName", "subreachName", "moduleNumber", ...Object.keys(signs)],
        returnGeometry: false,
      });
      const modules = withoutDuplicates(features.map((f) => f.attributes));
      const seen = new Map();
      for (const module of modules) {
        Object.entries(signs).filter(([field]) => SEEN.has(String(module[field] ?? "").trim().toUpperCase()))
          .forEach(([, label]) => seen.set(label, (seen.get(label) ?? 0) + 1));
      }
      const subreaches = new Set(modules.map((module) => [module.riverName, module.reachName, module.subreachName].join("|")));
      return { modules: modules.length, subreaches: subreaches.size, seen };
    })().catch((error) => {
      console.error("Scorecards: MoRPh invasive sightings failed to load:", error);
      invasivesCache.delete(key);
      return null;
    });
    invasivesCache.set(key, promise);
  }
  return invasivesCache.get(key);
}
