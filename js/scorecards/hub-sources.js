// =====================================================================
// HUB SOURCES
// data/scorecard.json says which datasets feed each scorecard
// measure. The built-in ones (NRS, Riverfly, NBS) are read by
// waterbody-data.js; every other one is a dataset in data/catalog.json,
// whose readings the hub has already loaded and placed in a waterbody.
// They're read the same way as everywhere in the hub: converted to the
// metric's unit, ranges at their bottom, below a limit as 0.
// =====================================================================

import { PLACED_LON_FIELD, readingsFor, WATERBODY_FIELD } from "../data/readings-store.js";
import { estimateOf, mappedValue } from "../readings.js";
import { isWithinDateRange } from "./date-range.js";

export const BUILT_IN = new Set(["national_river_survey", "riverfly", "nbs_interventions"]);
const VALUE_TYPES = ["absolute", "range", "mixed", "flags", "keywords"];
// Measures counted from survey observations, not a determinand.
export const SIGN_TYPES = ["flags", "keywords"];

let context = null; // { catalog, loaded, measures }

// ---------------------------------------------------------------------
// Sites
// The hub's own datasets have no reliable site ID: names are typed in
// free text (with typos, and reused for different places), and a phone's
// GPS fix moves a little on every visit. So a site is a group of samples
// within groupWithinMetres of each other, directly or through a chain of
// others (data/scorecard.json "sites"). Worked out once per dataset
// across the whole area, so a site on a waterbody boundary stays one
// site. Each is named by its most common name and placed at the middle
// of its samples.
// ---------------------------------------------------------------------

let groupWithinMetres = 50;
const siteGroups = new Map(); // dataset id -> WeakMap(record -> site)
const METRES_PER_DEGREE = 111320;

function distance(a, b) {
  const dy = (a.y - b.y) * METRES_PER_DEGREE;
  const dx = (a.x - b.x) * METRES_PER_DEGREE * Math.cos((a.y * Math.PI) / 180);
  return Math.hypot(dx, dy);
}

function groupSites(dataset) {
  const records = context.loaded.get(dataset.id)?.records ?? [];
  const parent = records.map((_, i) => i);
  const root = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  // A grid of cells at least groupWithinMetres across, so only
  // neighbouring cells need checking.
  const maxLat = Math.max(0, ...records.map(({ geometry }) => Math.abs(geometry.y)));
  const latCell = groupWithinMetres / METRES_PER_DEGREE;
  const lonCell = latCell / Math.cos((maxLat * Math.PI) / 180);
  const cellOf = ({ x, y }) => [Math.floor(x / lonCell), Math.floor(y / latCell)];
  const grid = new Map();
  records.forEach(({ geometry }, i) => {
    const key = cellOf(geometry).join(",");
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(i);
  });
  records.forEach(({ geometry }, i) => {
    const [cx, cy] = cellOf(geometry);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const j of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (j > i && distance(geometry, records[j].geometry) <= groupWithinMetres) parent[root(i)] = root(j);
        }
      }
    }
  });

  const groups = new Map(); // root -> { records, names }
  records.forEach((record, i) => {
    const r = root(i);
    if (!groups.has(r)) groups.set(r, { records: [], names: new Map() });
    const group = groups.get(r);
    group.records.push(record);
    const name = String(record.attributes[dataset.fields.site] ?? "").trim();
    if (name) group.names.set(name, (group.names.get(name) ?? 0) + 1);
  });
  const byRecord = new WeakMap();
  let n = 0;
  for (const group of groups.values()) {
    const site = {
      id: `${dataset.id}#${n++}`,
      name: [...group.names].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Site not recorded",
      lon: group.records.reduce((sum, { geometry }) => sum + geometry.x, 0) / group.records.length,
      lat: group.records.reduce((sum, { geometry }) => sum + geometry.y, 0) / group.records.length,
      locations: group.records.length,
    };
    group.records.forEach((record) => byRecord.set(record, site));
  }
  return byRecord;
}

// The site a record belongs to: { id, name, lon, lat }.
function siteOf(dataset, record) {
  if (!siteGroups.has(dataset.id)) siteGroups.set(dataset.id, groupSites(dataset));
  return siteGroups.get(dataset.id).get(record);
}

export const siteGroupDistance = () => groupWithinMetres;

// The scorecard only counts records inside a waterbody's boundary. The
// hub also places records up to 250 m outside one into the nearest
// waterbody (for the Monitoring explorer); those have a placed position
// and are left out here.
const isInside = (attributes, waterBodyId) => attributes[WATERBODY_FIELD] === waterBodyId && attributes[PLACED_LON_FIELD] == null;
const switchedOff = new Set(); // "measureKey|dataset", from the sources panel

export async function loadScorecardSources() {
  const response = await fetch("data/scorecard.json", { cache: "no-cache" });
  if (!response.ok) throw new Error(`data/scorecard.json returned ${response.status}`);
  return response.json();
}

// What a catalogue mapping's values are: every value a band (range),
// some values at a band or limit (mixed), or none (absolute).
export function valueTypeOf(mapping) {
  if (mapping.valueType === "banded") return "range";
  return mapping.bands || mapping.limits ? "mixed" : "absolute";
}

// Problems with the sources file, as sentences. metricIds: measure key ->
// its metric id in data/catalog.json, for the measures read from it.
export function checkSources(sources, catalog, metricIds) {
  const problems = [];
  for (const [key, measure] of Object.entries(sources.measures)) {
    for (const source of measure.sources) {
      const where = `${measure.label}, ${source.name ?? source.dataset}`;
      if (!VALUE_TYPES.includes(source.values)) problems.push(`${where}: values should be ${VALUE_TYPES.join(", ")}`);
      if (BUILT_IN.has(source.dataset)) continue;
      const dataset = catalog.datasets.find((candidate) => candidate.id === source.dataset);
      if (SIGN_TYPES.includes(source.values)) {
        if (!dataset) problems.push(`${where}: no dataset "${source.dataset}" in data/catalog.json`);
        const loadedFields = dataset?.observationFields ?? [];
        source.fields.filter((field) => !loadedFields.includes(field))
          .forEach((field) => problems.push(`${where}: add ${field} to this dataset's observationFields in data/catalog.json so it's loaded`));
        if (!source.signs || !Object.keys(source.signs).length) problems.push(`${where}: list the signs to look for`);
        if (source.values === "flags") {
          Object.keys(source.signs ?? {}).filter((field) => !source.fields.includes(field))
            .forEach((field) => problems.push(`${where}: sign ${field} isn't in fields`));
        }
        continue;
      }
      const mapping = dataset?.metrics[metricIds[key]];
      if (!dataset) problems.push(`${where}: no dataset "${source.dataset}" in data/catalog.json`);
      else if (!metricIds[key]) problems.push(`${where}: only built-in sources can feed ${measure.label} so far`);
      else if (!mapping?.active) problems.push(`${where}: data/catalog.json has no ${metricIds[key]} for this dataset`);
      else {
        if (!source.fields.includes(mapping.field)) problems.push(`${where}: data/catalog.json reads field ${mapping.field}, not ${source.fields.join(", ")}`);
        if (valueTypeOf(mapping) !== source.values) problems.push(`${where}: values are ${valueTypeOf(mapping)} in data/catalog.json, not ${source.values}`);
      }
    }
  }
  return problems;
}

// A record's date as ms. Some datasets hold it as text, such as
// "2026-10-04", which is read as that local day.
function dateValue(value) {
  if (typeof value === "number") return value;
  const dayOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (dayOnly) return new Date(Number(dayOnly[1]), Number(dayOnly[2]) - 1, Number(dayOnly[3])).getTime();
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

export function useHubSources(catalog, loaded, sources) {
  context = { catalog, loaded, measures: sources.measures, scorecard: sources };
  groupWithinMetres = sources.sites?.groupWithinMetres ?? 50;
  siteGroups.clear();
}

// Every source data/scorecard.json lists for a measure, built-in or not.
export const allSources = (measureKey) => context?.measures[measureKey]?.sources ?? [];

export const isSourceOn = (measureKey, dataset) => !switchedOff.has(`${measureKey}|${dataset}`);

export function setSourceOn(measureKey, dataset, on) {
  if (on) switchedOff.delete(`${measureKey}|${dataset}`);
  else switchedOff.add(`${measureKey}|${dataset}`);
}

// The sources feeding a measure: those listed and switched on.
export const listedSources = (measureKey) => allSources(measureKey).filter((source) => isSourceOn(measureKey, source.dataset));

export const usesSource = (measureKey, dataset) => listedSources(measureKey).some((source) => source.dataset === dataset);

// The names of a measure's sources that are switched off.
export const switchedOffNames = (measureKey) => allSources(measureKey)
  .filter((source) => !isSourceOn(measureKey, source.dataset)).map((source) => source.name);

// Every measure's settings from data/scorecard.json.
export const scorecardMeasures = () => context?.measures ?? {};

// The whole of data/scorecard.json, and the catalogue it was checked
// against, for the data and threshold guide.
export const scorecardFile = () => context?.scorecard ?? null;
export const hubCatalog = () => context?.catalog ?? null;

// The sites of every non-built-in source with a reading of any listed
// measure in one waterbody, in the date range, one per location:
// [{ dataset, name, site, lon, lat, readings }]. metricIds: measure key
// -> its metric id in data/catalog.json.
export function hubSites(waterBodyId, metricIds) {
  if (!context) return [];
  const { catalog, loaded, measures } = context;
  const bySite = new Map();
  const addSite = (dataset, source, objectId, site, label) => {
    const entry = bySite.get(site.id) ?? {
      dataset, name: source.name, site: site.name, lon: site.lon, lat: site.lat, samples: new Set(), measures: new Set(),
    };
    entry.samples.add(objectId);
    entry.measures.add(label);
    bySite.set(site.id, entry);
  };
  for (const [measureKey, measure] of Object.entries(measures)) {
    for (const source of measure.sources) {
      if (BUILT_IN.has(source.dataset) || !isSourceOn(measureKey, source.dataset)) continue;
      if (SIGN_TYPES.includes(source.values)) {
        sourceSurveys(source, waterBodyId)?.points
          .forEach((point) => addSite(source.dataset, source, point.objectId, point.site, measure.label));
        continue;
      }
      const dataset = catalog.datasets.find((candidate) => candidate.id === source.dataset);
      const mapping = dataset?.metrics[metricIds[measureKey]];
      if (!mapping?.active || !loaded.has(dataset.id)) continue;
      for (const record of readingsFor(loaded, { dataset, mapping }, catalog.conventions)) {
        const { attributes } = record;
        if (!isInside(attributes, waterBodyId) || !isWithinDateRange(dateValue(attributes[dataset.fields.date]))) continue;
        if (mappedValue(attributes[mapping.field], mapping) === null) continue;
        addSite(dataset.id, source, attributes[dataset.fields.objectId], siteOf(dataset, record), measure.label);
      }
    }
  }
  return [...bySite.values()].map(({ samples, measures: found, ...site }) => ({ ...site, samples: samples.size, measures: [...found] }));
}

const normalise = (text) => String(text ?? "").toLowerCase().replace(/[\s_]+/g, "");

// One survey's signs from one source: the names of those it shows, or
// null if the survey didn't answer (a blank free-text answer).
const isTicked = (value) => value === 1 || value === "Yes";

function surveySigns(source, attributes) {
  if (source.values === "flags") {
    // A survey that didn't answer the question isn't counted at all.
    if (source.answeredFields && !source.answeredFields.some((field) => isTicked(attributes[field]))) return null;
    return Object.entries(source.signs).filter(([field]) => isTicked(attributes[field])).map(([, label]) => label);
  }
  const answer = normalise(attributes[source.fields[0]]);
  if (!answer) return null;
  return Object.entries(source.signs).filter(([keyword]) => answer.includes(normalise(keyword))).map(([, label]) => label);
}

// One sign-counting source's surveys in one waterbody, in the date
// range, switched on or not: { name, surveys, withSigns, signs: Map(label
// -> surveys showing it), sites: Set of site ids, points: [{ site, objectId }] }.
export function sourceSurveys(source, waterBodyId) {
  if (!context) return null;
  const { catalog, loaded } = context;
  const dataset = catalog.datasets.find((candidate) => candidate.id === source.dataset);
  if (!dataset || !loaded.has(dataset.id)) return null;
  const found = { name: source.name, surveys: 0, withSigns: 0, signs: new Map(), sites: new Set(), points: [] };
  for (const record of loaded.get(dataset.id).records) {
    const { attributes } = record;
    if (!isInside(attributes, waterBodyId)) continue;
    if (!isWithinDateRange(dateValue(attributes[dataset.fields.date]))) continue;
    const signs = surveySigns(source, attributes);
    if (signs === null) continue;
    found.surveys += 1;
    if (signs.length) found.withSigns += 1;
    signs.forEach((label) => found.signs.set(label, (found.signs.get(label) ?? 0) + 1));
    const site = siteOf(dataset, record);
    found.sites.add(site.id);
    found.points.push({ site, objectId: attributes[dataset.fields.objectId] });
  }
  return found;
}

// One measure's readings in one waterbody, in the date range, from every
// non-built-in source: [{ name, points: [{ date, value, isEstimate }], sites: Set }].
export function hubReadings(measureKey, metricId, waterBodyId) {
  return listedSources(measureKey).filter((source) => !BUILT_IN.has(source.dataset))
    .map((source) => sourceReadings(source, metricId, waterBodyId)).filter(Boolean);
}

// One non-built-in source's readings of a metric in one waterbody, in the
// date range, switched on or not: { name, points, sites }, or null if the
// dataset doesn't hold the metric.
export function sourceReadings(source, metricId, waterBodyId) {
  if (!context) return null;
  const { catalog, loaded } = context;
  const dataset = catalog.datasets.find((candidate) => candidate.id === source.dataset);
  const mapping = dataset?.metrics[metricId];
  if (!mapping?.active || !loaded.has(dataset.id)) return null;
  const points = [];
  const sites = new Set();
  for (const record of readingsFor(loaded, { dataset, mapping }, catalog.conventions)) {
    const { attributes } = record;
    if (!isInside(attributes, waterBodyId)) continue;
    const date = dateValue(attributes[dataset.fields.date]);
    if (!isWithinDateRange(date)) continue;
    const raw = attributes[mapping.field];
    const value = mappedValue(raw, mapping);
    if (value === null) continue;
    points.push({ date, value, isEstimate: estimateOf(raw, mapping) !== null });
    sites.add(siteOf(dataset, record).id);
  }
  return { name: source.name, points, sites };
}
