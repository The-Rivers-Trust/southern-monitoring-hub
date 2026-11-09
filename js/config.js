// =====================================================================
// CONFIG
// Settings for the map's reference layers. Monitoring data is described
// in data/catalog.json instead.
// =====================================================================

import { WATERBODY_MAX_SCALE } from "./aggregation.js";

// Open River Network, styled as on the AQuA and NRS dashboards: one fixed
// blue, width by Strahler order, only drawn once zoomed in. Its lines are
// digitised in flow direction, which the animated overlay relies on.
export const RIVER_NETWORK = {
  url: "https://services3.arcgis.com/Bb8lfThdhugyc4G3/arcgis/rest/services/OpenRiverNetwork_CaBA_ID/FeatureServer/0",
  title: "Open River Network",
  flowTitle: "River flow direction",
  color: "#0277bd",
  // Rivers appear when the first hexagons do.
  minScale: WATERBODY_MAX_SCALE,
  // Flow needs the rivers on screen, so it can't start before them.
  flowMinScale: WATERBODY_MAX_SCALE,
  widthByStrahler: [
    { value: 1, size: 0.4 },
    { value: 2, size: 0.8 },
    { value: 3, size: 1.3 },
    { value: 4, size: 2 },
    { value: 5, size: 3 },
    { value: 7, size: 5 },
  ],
};
