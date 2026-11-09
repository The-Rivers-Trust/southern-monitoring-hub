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
const { apiUrl, firstYear, folder, samplingPointTypes, excludePurposes } = dataset.source;

const metricIds = Object.keys(dataset.metrics);
const codeInfo = new Map(metricIds.flatMap((id, metricIndex) =>
  dataset.metrics[id].codes.map((code, rank) => [code, { metricIndex, rank }])));

const today = new Date().toISOString().slice(0, 10);
const thisYear = Number(today.slice(0, 4));
const years = process.argv.includes("--all")
  ? Array.from({ length: thisYear - firstYear + 1 }, (_, index) => firstYear + index)
  : [thisYear - 1, thisYear];

async function fetchPage(partnership, year, skip) {
  const query = new URLSearchParams({
    determinand: [...codeInfo.keys()].join(","),
    dateFrom: `${year}-01-01`,
    dateTo: year === thisYear ? today : `${year}-12-31`,
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
  for (;;) {
    const page = await fetchPage(partnership, year, observations.length);
    observations.push(...page);
    if (page.length < PAGE_SIZE) return observations;
  }
}

const isExcluded = (purpose) => excludePurposes.some((text) => purpose?.includes(text));

// Combines the partnerships' results for one year into the file's shape.
function buildYear(year, perPartnership, allSites) {
  const chosen = new Map();
  perPartnership.forEach((observations, index) => {
    for (const observation of observations) {
      if (isExcluded(observation.samplingPurpose)) continue;
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
  .sort((a, b) => b - a);
// Rewritten on every run, which also keeps the scheduled job active.
writeFileSync(join(folder, "manifest.json"), `${JSON.stringify({ generatedOn: new Date().toISOString(), years: yearsOnDisk })}\n`);
console.log(`Wrote ${built.length} year files to ${folder}`);
