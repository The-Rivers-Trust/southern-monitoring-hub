// =====================================================================
// SCORECARD METRICS
// Determinand lookups and threshold banding for the scorecard. Each
// determinand's label, unit, colours and thresholds are filled in from
// the hub's catalogue (useCatalog), so there's one copy of the agreed
// NRS values.
// =====================================================================

import { METRICS } from "./config.js";
import { BANDS } from "../palette.js";
import { getTheme } from "../theme.js";

const thresholds = {};

// Call once, before anything is rated.
export function useCatalog(catalog) {
  for (const metric of METRICS) {
    const source = catalog.metrics.find((candidate) => candidate.id === metric.catalogId);
    if (!source) throw new Error(`Scorecard: ${metric.catalogId} isn't in the catalogue`);
    metric.label = source.label;
    metric.unit = source.unit;
    metric.colorDark = source.colour.dark;
    metric.colorLight = source.colour.light;
    thresholds[metric.key] = source.scale.breaks;
  }
}

export function getMetric(key) {
  return METRICS.find((m) => m.key === key) ?? null;
}

// A determinand's colour for the current theme.
export function metricColor(metric) {
  return getTheme() === "light" ? metric.colorLight : metric.colorDark;
}

// The five { key, label, color, max } bands for a determinand, or null if
// it has no thresholds. The last band's max is null (open-ended).
export function bandsForMetric(metricKey) {
  const breaks = thresholds[metricKey];
  if (!breaks) return null;
  return BANDS.map((band, i) => ({ key: band.label, label: band.label, color: band.colour, max: i < breaks.length ? breaks[i] : null }));
}

export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
