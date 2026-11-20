// =====================================================================
// BUILD EA DATA
// Saves Environment Agency water quality readings for the partnerships
// as one small file per year, so the app never calls the API directly.
//
//   npm run build:ea          the current and previous years
//   npm run build:ea -- --all every year
//
// Nothing is written unless every request succeeds, so a failed run
// leaves the last good files in place.
// =====================================================================

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PAGE_SIZE = 2500;
const RETRIES = 3;

const catalog = JSON.parse(readFileSync("data/catalog.json", "utf8"));
const area = JSON.parse(readFileSync(catalog.clipArea.file, "utf8"));
const dataset = catalog.datasets.find((candidate) => candidate.source?.type === "static_files");
const { apiUrl, folder, samplingPointTypes, excludePurposes } = dataset.source;
const { firstYear } = catalog; // the first year kept, for every dataset

const metricIds = Object.keys(dataset.metrics);
const codeInfo = new Map(metricIds.flatMap((id, metricIndex) =>
  dataset.metrics[id].codes.map((code, rank) => [code, { metricIndex, rank }])));

const today = new Date().toISOString().slice(0, 10);
const thisYear = Number(today.slice(0, 4));
const years = process.argv.includes("--all")
  ? Array.from({ length: thisYear - firstYear + 1 }, (_, index) => firstYear + index)
  : [thisYear - 1, thisYear];

const dayAfter = (date) => new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

// The API leaves out the dateTo day itself, and allows no more than a year
// in one request. So a past year is two requests, the last day on its own.
function dateRanges(year) {
  // The current year runs to today; on 31 December that is a whole year too,
  // so it is split like a past one (Jan 1 to Jan 1 would be refused).
  if (year === thisYear && today < `${year}-12-31`) return [[`${year}-01-01`, dayAfter(today)]];
  return [[`${year}-01-01`, `${year}-12-31`], [`${year}-12-31`, `${year + 1}-01-01`]];
}

async function fetchPage(partnership, from, to, skip) {
  const query = new URLSearchParams({
    determinand: [...codeInfo.keys()].join(","),
    dateFrom: from,
    dateTo: to,
    samplingPointType: samplingPointTypes.join(","),
    skip: String(skip),
    limit: String(PAGE_SIZE),
  });
  const geometry = { type: "MultiPolygon", coordinates: partnership.rings.map((ring) => [ring]) };
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`${apiUrl}/data/observation?${query}`, {
      method: "POST",
      headers: {
        Accept: "application/x-jsonlines",
        "Content-Type": "application/json",
        "Accept-Crs": "http://www.opengis.net/def/crs/EPSG/0/4326",
      },
      body: JSON.stringify(geometry),
    });
    if (response.ok) {
      const text = (await response.text()).trim();
      return text ? text.split("\n").map((line) => JSON.parse(line)) : [];
    }
    if (attempt >= RETRIES) throw new Error(`${partnership.name} ${year}: API returned ${response.status}`);
    await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
  }
}

async function fetchPartnership(partnership, year) {
  const observations = [];
  for (const [from, to] of dateRanges(year)) {
    for (let skip = 0; ; skip += PAGE_SIZE) {
      const page = await fetchPage(partnership, from, to, skip);
      observations.push(...page);
      if (page.length < PAGE_SIZE) break;
    }
  }
  return observations;
}

const isExcluded = (purpose) => excludePurposes.some((text) => purpose?.includes(text));

// Combines the partnerships' results for one year into the file's shape.
function buildYear(year, perPartnership, allSites) {
  const chosen = new Map();
  perPartnership.forEach((observations, index) => {
    for (const observation of observations) {
      if (isExcluded(observation.samplingPurpose)) continue;
      if (!observation.phenomenonTime.startsWith(String(year))) continue; // the first moment of the next year
      const point = observation.samplingPoint;
      const { metricIndex, rank } = codeInfo.get(observation.determinand.notation);
      const time = observation.phenomenonTime.slice(0, 16);
      allSites[point.notation] = [point.prefLabel, point.longitude, point.latitude, area.partnerships[index].name];
      // Where one metric has several codes, the first listed wins.
      const key = `${point.notation}|${time}|${metricIndex}`;
      if (!chosen.has(key) || rank < chosen.get(key).rank) {
        chosen.set(key, { notation: point.notation, time, metricIndex, rank, result: observation.result });
      }
    }
  });

  const siteIndex = new Map();
  const readings = [...chosen.values()].map(({ notation, time, metricIndex, result }) => {
    if (!siteIndex.has(notation)) siteIndex.set(notation, siteIndex.size);
    return [siteIndex.get(notation), time, metricIndex, String(result)];
  });
  return { year, metrics: metricIds, sites: [...siteIndex.keys()], readings };
}

const sitesFile = join(folder, "sites.json");
const allSites = existsSync(sitesFile) ? JSON.parse(readFileSync(sitesFile, "utf8")) : {};

// Collected first, so nothing is written if a later year fails.
const built = [];
for (const year of years) {
  const perPartnership = await Promise.all(area.partnerships.map((partnership) => fetchPartnership(partnership, year)));
  const file = buildYear(year, perPartnership, allSites);
  built.push(file);
  console.log(`${year}: ${file.readings.length} readings from ${file.sites.length} sites`);
}

mkdirSync(folder, { recursive: true });
for (const file of built) writeFileSync(join(folder, `${file.year}.json`), `${JSON.stringify(file)}\n`);
writeFileSync(sitesFile, `${JSON.stringify(allSites)}\n`);

const yearsOnDisk = readdirSync(folder)
  .filter((name) => /^\d{4}\.json$/.test(name))
  .map((name) => Number(name.slice(0, 4)))
  .filter((year) => year >= firstYear) // nothing earlier than the catalog's firstYear is kept
  .sort((a, b) => b - a);
// Rewritten on every run, which also keeps the scheduled job active.
writeFileSync(join(folder, "manifest.json"), `${JSON.stringify({ generatedOn: new Date().toISOString(), years: yearsOnDisk })}\n`);
console.log(`Wrote ${built.length} year files to ${folder}`);
