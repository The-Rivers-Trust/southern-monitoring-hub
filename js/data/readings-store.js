// =====================================================================
// READINGS STORE
// Holds the readings inside the clip area, with only the fields the
// catalogue uses. Every metric is drawn from this copy.
//
// Datasets come from one of two places:
//   - ArcGIS services, fetched once at start-up. One query per
//     partnership rather than one merged shape: neighbouring polygons
//     can't interfere with each other, and each reading learns which
//     partnership it's in. These go straight to the REST endpoint,
//     which timed far faster here than the SDK's query path.
//   - Prebuilt yearly files (the Environment Agency), fetched one year
//     at a time as the year filter needs them.
// =====================================================================

import { baseWhere, describeReading } from "../readings.js";
import { waterbodyFinder } from "../aggregation.js";

export const PARTNERSHIP_FIELD = "hub_partnership";
export const YEAR_FIELD = "hub_year";
export const WATERBODY_FIELD = "hub_waterbody";
// Set only for a reading just outside its waterbody: the point on the
// boundary it counts at, so its hexagon is one the waterbody reaches.
export const PLACED_LON_FIELD = "hub_placed_lon";
export const PLACED_LAT_FIELD = "hub_placed_lat";

const SHARED_FIELDS = [
  { name: PARTNERSHIP_FIELD, alias: "CaBA partnership", type: "string" },
  { name: YEAR_FIELD, alias: "Year", type: "integer" },
  { name: WATERBODY_FIELD, alias: "Waterbody", type: "string" },
  { name: PLACED_LON_FIELD, alias: "Placed longitude", type: "double" },
  { name: PLACED_LAT_FIELD, alias: "Placed latitude", type: "double" },
];

let store = null;
let findWaterbody = null;

function placementAttributes(placed, fallbackPartnership) {
  return {
    // A reading follows its waterbody, so filters stay consistent.
    [PARTNERSHIP_FIELD]: placed?.waterbody.partnership ?? fallbackPartnership,
    [WATERBODY_FIELD]: placed?.waterbody.id ?? null,
    [PLACED_LON_FIELD]: placed?.isBeside ? placed.lon : null,
    [PLACED_LAT_FIELD]: placed?.isBeside ? placed.lat : null,
  };
}

// ---------------------------------------------------------------------
// ArcGIS services
// ---------------------------------------------------------------------

async function queryPage(url, params) {
  const response = await fetch(`${url}/query`, { method: "POST", body: new URLSearchParams({ f: "json", ...params }) });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  const page = await response.json();
  if (page.error) throw new Error(`${url}: ${page.error.message}`);
  return page;
}

async function fetchPartnership(url, partnership, { where, outFields, objectIdField }) {
  const params = {
    where,
    geometry: JSON.stringify({ rings: partnership.rings, spatialReference: { wkid: 4326 } }),
    geometryType: "esriGeometryPolygon",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: outFields.join(","),
    returnGeometry: "true",
    outSR: "4326",
    orderByFields: objectIdField,
  };
  const features = [];
  for (;;) {
    const page = await queryPage(url, { ...params, resultOffset: String(features.length) });
    features.push(...page.features);
    if (!page.exceededTransferLimit || !page.features.length) return { features, fields: page.fields };
  }
}

async function loadServiceDataset(dataset, area, Field) {
  const active = Object.values(dataset.metrics).filter((mapping) => mapping.active);
  // observationFields: loaded for other uses, such as the scorecard.
  const outFields = [...new Set([...Object.values(dataset.fields), ...active.map((mapping) => mapping.field), ...(dataset.observationFields ?? [])])];
  const options = { where: baseWhere(dataset), outFields, objectIdField: dataset.fields.objectId };

  // All or nothing: a partly loaded map would look complete but not be.
  const perPartnership = await Promise.all(area.partnerships.map((partnership) => fetchPartnership(dataset.url, partnership, options)));

  // A point exactly on a shared boundary comes back twice.
  const byId = new Map();
  perPartnership.forEach(({ features }, index) => {
    for (const { attributes, geometry } of features) {
      byId.set(attributes[dataset.fields.objectId], {
        attributes: {
          ...attributes,
          ...placementAttributes(findWaterbody(geometry.x, geometry.y), area.partnerships[index].name),
          [YEAR_FIELD]: new Date(attributes[dataset.fields.date]).getUTCFullYear(),
        },
        geometry: { x: geometry.x, y: geometry.y },
      });
    }
  });

  return {
    records: [...byId.values()],
    fields: [...perPartnership[0].fields, ...SHARED_FIELDS].map((field) => (field.type?.startsWith("esri") ? Field.fromJSON(field) : new Field(field))),
  };
}

// ---------------------------------------------------------------------
// Prebuilt yearly files
// ---------------------------------------------------------------------

async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.json();
}

async function openFileDataset(dataset, Field) {
  const { folder } = dataset.source;
  const [manifest, sites] = await Promise.all([fetchJson(`${folder}/manifest.json`), fetchJson(`${folder}/sites.json`)]);
  const { fields } = dataset;
  const metricFields = Object.values(dataset.metrics).map((mapping) => ({ name: mapping.field, alias: mapping.field, type: "string" }));
  return {
    records: [],
    fields: [
      { name: fields.objectId, alias: "ID", type: "oid" },
      { name: fields.date, alias: "Sampled", type: "date" },
      { name: fields.time, alias: "Time", type: "string" },
      { name: fields.site, alias: "Site", type: "string" },
      ...metricFields,
      ...SHARED_FIELDS,
    ].map((field) => new Field(field)),
    manifest,
    sites,
    placements: new Map(),
    yearLoads: new Map(),
    nextId: 1,
  };
}

function placementFor(entry, notation) {
  if (!entry.placements.has(notation)) {
    const [, lon, lat, partnership] = entry.sites[notation];
    entry.placements.set(notation, placementAttributes(findWaterbody(lon, lat), partnership));
  }
  return entry.placements.get(notation);
}

// Readings arrive one per determinand; one sample becomes one record.
function appendYear(dataset, entry, file) {
  const { fields } = dataset;
  const metricFields = file.metrics.map((id) => dataset.metrics[id].field);
  const samples = new Map();
  for (const [siteIndex, time, metricIndex, result] of file.readings) {
    const key = `${siteIndex}|${time}`;
    if (!samples.has(key)) {
      const notation = file.sites[siteIndex];
      const [name, lon, lat] = entry.sites[notation];
      samples.set(key, {
        attributes: {
          [fields.objectId]: entry.nextId++,
          [fields.date]: Date.parse(`${time}:00Z`),
          [fields.time]: time.slice(11),
          [fields.site]: name,
          [YEAR_FIELD]: file.year,
          ...placementFor(entry, notation),
        },
        geometry: { x: lon, y: lat },
      });
    }
    samples.get(key).attributes[metricFields[metricIndex]] = result;
  }
  for (const record of samples.values()) entry.records.push(record);
}

function loadYear(dataset, entry, year) {
  if (!entry.yearLoads.has(year)) {
    entry.yearLoads.set(year, fetchJson(`${dataset.source.folder}/${year}.json`)
      .then((file) => appendYear(dataset, entry, file))
      .catch((error) => {
        entry.yearLoads.delete(year); // so it can be tried again
        throw error;
      }));
  }
  return entry.yearLoads.get(year);
}

// Makes sure the yearly files for a year (null: every year) are loaded.
export async function ensureYearLoaded(catalog, loaded, year) {
  await Promise.all(catalog.datasets.filter((dataset) => dataset.source).flatMap((dataset) => {
    const entry = loaded.get(dataset.id);
    const years = year === null ? entry.manifest.years : entry.manifest.years.filter((candidate) => candidate === year);
    return years.map((candidate) => loadYear(dataset, entry, candidate));
  }));
}

// ---------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------

async function loadAll(catalog, area, waterbodies) {
  const [Field] = await $arcgis.import(["@arcgis/core/layers/support/Field.js"]);
  findWaterbody = waterbodyFinder(waterbodies);
  const entries = await Promise.all(catalog.datasets.map(async (dataset) => [
    dataset.id,
    dataset.source ? await openFileDataset(dataset, Field) : await loadServiceDataset(dataset, area, Field),
  ]));
  return new Map(entries);
}

// Safe to call repeatedly: the data is only fetched once.
export function loadReadings(catalog, area, waterbodies) {
  store ??= loadAll(catalog, area, waterbodies).catch((error) => {
    store = null;
    throw error;
  });
  return store;
}

// Which records hold a real reading of each metric, rebuilt only when
// more records have been loaded.
const validRecords = new Map();

function recordsWithReading(loaded, { dataset, mapping }, conventions) {
  const { records } = loaded.get(dataset.id);
  const key = `${dataset.id}|${mapping.field}`;
  const cached = validRecords.get(key);
  if (cached?.size === records.length) return cached.valid;
  const valid = records.filter((record) => describeReading(record.attributes[mapping.field], mapping, conventions) !== null);
  validRecords.set(key, { size: records.length, valid });
  return valid;
}

// The records in a dataset holding a real reading of this metric,
// optionally for one year and one partnership.
export function readingsFor(loaded, source, conventions, { year = null, partnership = null } = {}) {
  const valid = recordsWithReading(loaded, source, conventions);
  if (year === null && partnership === null) return valid;
  return valid.filter(({ attributes }) =>
    (year === null || attributes[YEAR_FIELD] === year) &&
    (partnership === null || attributes[PARTNERSHIP_FIELD] === partnership));
}

// Every year with data, newest first, including years not yet loaded.
export function availableYears(loaded) {
  const years = new Set();
  for (const { records, manifest } of loaded.values()) {
    manifest?.years.forEach((year) => years.add(year));
    records.forEach((record) => years.add(record.attributes[YEAR_FIELD]));
  }
  return [...years].sort((a, b) => b - a);
}
