// =====================================================================
// HUB SOURCES
// data/scorecard.json says which datasets feed each scorecard
// measure. The built-in ones (NRS, Riverfly, NBS) are read by
// waterbody-data.js; every other one is a dataset in data/catalog.json,
// whose readings the hub has already loaded and placed in a waterbody.
// They're read the same way as everywhere in the hub: converted to the
// metric's unit, ranges at their bottom, below a limit as 0.
// =====================================================================

import { readingsFor, WATERBODY_FIELD } from "../data/readings-store.js";
import { estimateOf, mappedValue } from "../readings.js";
import { isWithinDateRange } from "./date-range.js";

export const BUILT_IN = new Set(["national_river_survey", "riverfly", "nbs_interventions"]);
const VALUE_TYPES = ["absolute", "range", "mixed"];

let context = null; // { catalog, loaded, measures }
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
      if (!VALUE_TYPES.includes(source.values)) problems.push(`${where}: values should be absolute, range or mixed`);
      if (BUILT_IN.has(source.dataset)) continue;
      const dataset = catalog.datasets.find((candidate) => candidate.id === source.dataset);
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
  context = { catalog, loaded, measures: sources.measures };
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

// The sites of every non-built-in source with a reading of any listed
// measure in one waterbody, in the date range, one per location:
// [{ dataset, name, site, lon, lat, readings }]. metricIds: measure key
// -> its metric id in data/catalog.json.
export function hubSites(waterBodyId, metricIds) {
  if (!context) return [];
  const { catalog, loaded, measures } = context;
  const byLocation = new Map();
  for (const [measureKey, measure] of Object.entries(measures)) {
    for (const source of measure.sources) {
      if (BUILT_IN.has(source.dataset) || !isSourceOn(measureKey, source.dataset)) continue;
      const dataset = catalog.datasets.find((candidate) => candidate.id === source.dataset);
      const mapping = dataset?.metrics[metricIds[measureKey]];
      if (!mapping?.active || !loaded.has(dataset.id)) continue;
      for (const { attributes, geometry } of readingsFor(loaded, { dataset, mapping }, catalog.conventions)) {
        if (attributes[WATERBODY_FIELD] !== waterBodyId || !isWithinDateRange(dateValue(attributes[dataset.fields.date]))) continue;
        if (mappedValue(attributes[mapping.field], mapping) === null) continue;
        const key = `${dataset.id}|${geometry.x.toFixed(5)}|${geometry.y.toFixed(5)}`;
        const site = byLocation.get(key) ?? {
          dataset: dataset.id, name: source.name, site: attributes[dataset.fields.site] || "Site not recorded",
          lon: geometry.x, lat: geometry.y, samples: new Set(), measures: new Set(),
        };
        site.samples.add(attributes[dataset.fields.objectId]);
        site.measures.add(measure.label);
        byLocation.set(key, site);
      }
    }
  }
  return [...byLocation.values()].map(({ samples, measures: found, ...site }) => ({ ...site, samples: samples.size, measures: [...found] }));
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
  for (const { attributes } of readingsFor(loaded, { dataset, mapping }, catalog.conventions)) {
    if (attributes[WATERBODY_FIELD] !== waterBodyId) continue;
    const date = dateValue(attributes[dataset.fields.date]);
    if (!isWithinDateRange(date)) continue;
    const raw = attributes[mapping.field];
    const value = mappedValue(raw, mapping);
    if (value === null) continue;
    points.push({ date, value, isEstimate: estimateOf(raw, mapping) !== null });
    sites.add(attributes[dataset.fields.site] ?? "Site not recorded");
  }
  return { name: source.name, points, sites };
}
