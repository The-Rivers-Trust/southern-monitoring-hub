// =====================================================================
// NRS SERVICE
// What the scorecard reads from the National River Survey feature
// service and its neighbours: layers (cached), paged queries and the
// equipment table's detection ranges. From the NRS dashboard.
// =====================================================================

import { NRS, METRICS, EQUIPMENT_RANGE_MAX_OVERRIDE } from "./config.js";

const layers = {};
let equipmentPromise = null;

export async function getLayer(url) {
  if (!layers[url]) {
    const [FeatureLayer] = await $arcgis.import(["@arcgis/core/layers/FeatureLayer.js"]);
    const layer = new FeatureLayer({ url });
    layers[url] = layer.load().then(() => layer);
  }
  return layers[url];
}

// Pages through a layer/table until every matching record is returned, so
// nothing is silently cut off at the service's maxRecordCount.
export async function queryAll(layer, params) {
  const pageSize = 1000;
  const features = [];
  for (let start = 0; ; start += pageSize) {
    const result = await layer.queryFeatures({ ...params, start, num: pageSize, orderByFields: params.orderByFields ?? [layer.objectIdField] });
    features.push(...result.features);
    if (!result.exceededTransferLimit && result.features.length < pageSize) return features;
  }
}

// { rangeByMetric }: metric key -> { min, max }, the widest range any
// listed device can read for that determinand - the charts' fixed y-axis.
export function fetchEquipment() {
  if (!equipmentPromise) {
    equipmentPromise = getLayer(NRS.equipmentUrl)
      .then((layer) => queryAll(layer, {
        where: "1=1",
        outFields: ["determinand", "range_bottom", "range_top"],
        returnGeometry: false,
      }))
      .then((features) => ({ rangeByMetric: equipmentRanges(features.map((f) => f.attributes)) }))
      .catch((error) => {
        console.error("Scorecards: equipment specs failed to load:", error);
        return { rangeByMetric: {} };
      });
  }
  return equipmentPromise;
}

function equipmentRanges(specs) {
  const ranges = {};
  for (const m of METRICS) {
    const matching = specs.filter((s) => s.determinand === m.determinand);
    const bottoms = matching.map((s) => s.range_bottom).filter((v) => v != null);
    const tops = matching.map((s) => s.range_top).filter((v) => v != null);
    if (!bottoms.length || !tops.length) continue;
    let max = Math.max(...tops);
    if (EQUIPMENT_RANGE_MAX_OVERRIDE[m.key] !== undefined) max = Math.min(max, EQUIPMENT_RANGE_MAX_OVERRIDE[m.key]);
    ranges[m.key] = { min: Math.min(...bottoms), max };
  }
  return ranges;
}
