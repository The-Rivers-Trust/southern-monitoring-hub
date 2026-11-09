// =====================================================================
// BUILD CLIP AREA
// Saves two static files, so the app needs no boundary requests:
//   - the exact boundaries of the partnerships named in the catalogue
//   - the exact river and coastal waterbody catchments inside them
// Run after changing the list, or if the source boundaries are updated:
//   npm run build:clip
// =====================================================================

import { readFileSync, writeFileSync } from "node:fs";

const { clipArea, waterbodies } = JSON.parse(readFileSync("data/catalog.json", "utf8"));
const today = new Date().toISOString().slice(0, 10);

async function query(url, params) {
  const response = await fetch(`${url}/query`, { method: "POST", body: new URLSearchParams({ f: "json", ...params }) });
  const result = await response.json();
  if (result.error) throw new Error(JSON.stringify(result.error));
  if (result.exceededTransferLimit) throw new Error(`${url} returned a partial result.`);
  return result;
}

async function buildPartnerships() {
  const result = await query(clipArea.sourceUrl, {
    where: "1=1",
    outFields: clipArea.nameField,
    returnGeometry: "true",
    outSR: "4326", // what the monitoring datasets are stored in
    geometryPrecision: "6", // about 0.1 m
  });

  // Matched after trimming: some names in the service end in a space.
  const wanted = new Set(clipArea.names);
  const partnerships = result.features
    .map((feature) => ({ name: feature.attributes[clipArea.nameField].trim(), rings: feature.geometry.rings }))
    .filter((partnership) => wanted.has(partnership.name));

  const found = new Set(partnerships.map((partnership) => partnership.name));
  const missing = clipArea.names.filter((name) => !found.has(name));
  if (missing.length) throw new Error(`Not found in the service: ${missing.join(", ")}`);
  if (partnerships.length !== clipArea.names.length) throw new Error("A partnership appears more than once in the service.");

  const points = partnerships.flatMap((partnership) => partnership.rings.flat());
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  writeFileSync(clipArea.file, `${JSON.stringify({
    generatedOn: today,
    extent: { xmin: Math.min(...xs), ymin: Math.min(...ys), xmax: Math.max(...xs), ymax: Math.max(...ys) },
    partnerships,
  })}\n`);
  console.log(`${partnerships.length} partnerships, ${points.length} vertices written to ${clipArea.file}`);
  return partnerships;
}

function insideRings(x, y, rings) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

// The centroid of the whole shape: every part, less any holes.
function centroid(rings) {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (const ring of rings) {
    for (let i = 0; i < ring.length - 1; i++) {
      const cross = ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
      area += cross;
      cx += (ring[i][0] + ring[i + 1][0]) * cross;
      cy += (ring[i][1] + ring[i + 1][1]) * cross;
    }
  }
  return [cx / (3 * area), cy / (3 * area)];
}

async function buildWaterbodies(partnerships) {
  const touching = await Promise.all(partnerships.map((partnership) => query(waterbodies.sourceUrl, {
    where: "1=1",
    geometry: JSON.stringify({ rings: partnership.rings, spatialReference: { wkid: 4326 } }),
    geometryType: "esriGeometryPolygon",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    returnIdsOnly: "true",
  })));
  const ids = [...new Set(touching.flatMap((result) => result.objectIds ?? []))];

  const features = [];
  for (let start = 0; start < ids.length; start += 200) {
    const page = await query(waterbodies.sourceUrl, {
      objectIds: ids.slice(start, start + 200).join(","),
      outFields: `${waterbodies.idField},${waterbodies.nameField}`,
      returnGeometry: "true",
      outSR: "4326",
      geometryPrecision: "7", // about 1 cm. The shapes are not simplified.
    });
    features.push(...page.features);
  }

  // Neighbours that only touch the edge of a partnership are left out.
  // The vertex check keeps long coastal shapes whose centre falls outside.
  const partnershipAt = ([x, y]) => partnerships.find((partnership) => insideRings(x, y, partnership.rings))?.name ?? null;
  const assigned = features.flatMap((feature) => {
    const byCentroid = partnershipAt(centroid(feature.geometry.rings));
    if (byCentroid) return [{ feature, partnership: byCentroid, method: "centroid" }];
    const vertices = feature.geometry.rings.flat();
    const counts = new Map();
    for (const vertex of vertices) {
      const name = partnershipAt(vertex);
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const inside = [...counts.values()].reduce((sum, count) => sum + count, 0);
    if (inside < vertices.length / 2) return [];
    const partnership = [...counts].sort((a, b) => b[1] - a[1])[0][0];
    return [{ feature, partnership, method: "most of its boundary" }];
  });
  writeFileSync(waterbodies.file, `${JSON.stringify({
    generatedOn: today,
    waterbodies: assigned.map(({ feature, partnership }) => ({
      id: feature.attributes[waterbodies.idField],
      name: feature.attributes[waterbodies.nameField] ?? waterbodies.unnamedLabel,
      partnership,
      rings: feature.geometry.rings,
    })),
  })}\n`);
  const fallback = assigned.filter(({ method }) => method !== "centroid").length;
  console.log(`${assigned.length} of ${features.length} touching waterbodies written to ${waterbodies.file} (${fallback} by most of their boundary, centroid outside every partnership)`);
}

const partnerships = await buildPartnerships();
await buildWaterbodies(partnerships);
