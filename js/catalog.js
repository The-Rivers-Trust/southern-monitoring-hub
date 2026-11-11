// =====================================================================
// CATALOG
// Loads data/catalog.json and answers "which datasets hold this metric?"
// =====================================================================

export async function loadCatalog() {
  const response = await fetch("data/catalog.json", { cache: "no-cache" });
  if (!response.ok) throw new Error(`data/catalog.json returned ${response.status}`);
  const catalog = await response.json();
  // Readings only see their own mapping, so the dataset's setting is copied in.
  for (const dataset of catalog.datasets) {
    for (const mapping of Object.values(dataset.metrics)) mapping.limitsAreExact = Boolean(dataset.limitsAreExact);
  }
  return catalog;
}

export async function loadClipArea(catalog) {
  const response = await fetch(catalog.clipArea.file);
  if (!response.ok) throw new Error(`${catalog.clipArea.file} returned ${response.status}`);
  return response.json();
}

export async function loadWaterbodies(catalog) {
  const response = await fetch(catalog.waterbodies.file);
  if (!response.ok) throw new Error(`${catalog.waterbodies.file} returned ${response.status}`);
  return (await response.json()).waterbodies;
}

// Every dataset holding live data for a metric.
export function sourcesFor(catalog, metricId) {
  return catalog.datasets
    .filter((dataset) => dataset.metrics[metricId]?.active)
    .map((dataset) => ({ dataset, mapping: dataset.metrics[metricId] }));
}

// "Colour-change tube (unconfirmed)" or the catalogue's "not recorded" text.
export function provenanceText(item, value, unknownText) {
  if (!item || item.status === "unknown") return unknownText;
  return item.status === "inferred" ? `${value} (unconfirmed)` : value;
}
