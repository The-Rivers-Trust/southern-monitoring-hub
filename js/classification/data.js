// =====================================================================
// CLASSIFICATION DATA
// Loads the WFD site classifications for the CaBA partnerships straight
// from the service. Each site carries its own partnership, so one query
// on that field does the clipping. Records are kept as plain objects.
// =====================================================================

const PAGE_SIZE = 2000;

export async function loadClassificationCatalog() {
  const response = await fetch("data/classification-catalog.json", { cache: "no-cache" });
  if (!response.ok) throw new Error(`data/classification-catalog.json returned ${response.status}`);
  return response.json();
}

const quoted = (text) => `'${text.replace(/'/g, "''")}'`;

async function query(url, params) {
  const response = await fetch(`${url}/query`, { method: "POST", body: new URLSearchParams({ f: "json", ...params }) });
  if (!response.ok) throw new Error(`Classification service returned ${response.status}`);
  const json = await response.json();
  if (json.error) throw new Error(`Classification service: ${json.error.message}`);
  return json;
}

// Some items hold the last assessed year as text, some as a number.
function yearValue(value) {
  const year = Number.parseInt(value, 10);
  return Number.isFinite(year) ? year : null;
}

function toSite(catalog, { attributes, geometry }) {
  const { fields, partnershipField, lastYearSuffix, lastStatusSuffix } = catalog.service;
  const items = {};
  for (const item of catalog.items) {
    const statuses = {};
    for (const round of catalog.rounds) {
      const status = attributes[`${item.id}_${round}`];
      if (status) statuses[round] = status;
    }
    items[item.id] = {
      statuses,
      lastYear: yearValue(attributes[`${item.id}${lastYearSuffix}`]),
      lastStatus: attributes[`${item.id}${lastStatusSuffix}`] || null,
    };
  }
  return {
    objectId: attributes[fields.objectId],
    siteId: attributes[fields.siteId],
    name: attributes[fields.name],
    source: attributes[fields.source],
    region: attributes[fields.region],
    partnership: attributes[partnershipField],
    lon: geometry.x,
    lat: geometry.y,
    items,
  };
}

function outFields(catalog) {
  const { fields, partnershipField, lastYearSuffix, lastStatusSuffix } = catalog.service;
  return [
    ...Object.values(fields),
    partnershipField,
    ...catalog.items.flatMap((item) => [
      ...catalog.rounds.map((round) => `${item.id}_${round}`),
      `${item.id}${lastYearSuffix}`,
      `${item.id}${lastStatusSuffix}`,
    ]),
  ].join(",");
}

export async function loadSites(catalog, partnershipNames) {
  const { url, fields, partnershipField } = catalog.service;
  const where = `${partnershipField} IN (${partnershipNames.map(quoted).join(",")})`;
  const sites = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await query(url, {
      where,
      outFields: outFields(catalog),
      returnGeometry: true,
      outSR: 4326,
      orderByFields: fields.objectId,
      resultOffset: offset,
      resultRecordCount: PAGE_SIZE,
    });
    sites.push(...page.features.filter((feature) => feature.geometry).map((feature) => toSite(catalog, feature)));
    if (!page.exceededTransferLimit) return sites;
  }
}
