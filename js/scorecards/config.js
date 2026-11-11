// =====================================================================
// SCORECARD CONFIG
// The Catchment Health scorecard, ported from the National River Survey
// dashboard. Service URLs, scoring thresholds, wheel themes and colours
// are as there. The determinands' names, units, colours and threshold
// bands are not repeated here: they come from data/catalog.json (see
// metrics.js), which holds the same agreed NRS values.
// =====================================================================

const NRS_SERVICE = "https://services3.arcgis.com/Bb8lfThdhugyc4G3/arcgis/rest/services/National_River_Survey/FeatureServer";

// Organisations (0) -> Locations (1, points) -> Observations (2, table,
// location_id = the location's GlobalID). Equipment (3) is a lookup.
export const NRS = {
  locationsUrl: `${NRS_SERVICE}/1`,
  observationsUrl: `${NRS_SERVICE}/2`,
  equipmentUrl: `${NRS_SERVICE}/3`,
};

// The six determinands the scorecard rates.
//   catalogId         its id in data/catalog.json (label, unit, colour, bands)
//   observationField  its field on the NRS Observations table
//   determinand       its spelling on the Equipment table
// How readings roll up (mean or median) is each measure's statistic in
// data/scorecard.json.
export const METRICS = [
  { key: "phosphate", catalogId: "orthophosphate", observationField: "phosphate", determinand: "Phosphate" },
  { key: "nitrate", catalogId: "nitrate", observationField: "nitrate", determinand: "Nitrate" },
  { key: "nitrite", catalogId: "nitrite", observationField: "nitrite", determinand: "Nitrite" },
  { key: "ammonia", catalogId: "ammonia", observationField: "ammonia", determinand: "Ammonia" },
  { key: "turbidity", catalogId: "turbidity", observationField: "turbidity", determinand: "Turbidity" },
  { key: "conductivity", catalogId: "conductivity", observationField: "conductivity", determinand: "Conductivity", decimals: 0 },
];

// Chart y-axis caps on top of the equipment's own range.
export const EQUIPMENT_RANGE_MAX_OVERRIDE = {};

// Per-survey "Yes" fields on the Observations table.
export const WILDLIFE_FIELDS = [
  { observationField: "wildlife_otter", label: "Otter" },
  { observationField: "wildlife_dipper", label: "Dipper" },
  { observationField: "wildlife_water_vole", label: "Water Vole" },
  { observationField: "wildlife_kingfisher", label: "Kingfisher" },
  { observationField: "wildlife_dragonflies_damselflies", label: "Dragonflies/Damselflies" },
  { observationField: "wildlife_heron", label: "Heron" },
  { observationField: "wildlife_fish", label: "Fish" },
  { observationField: "wildlife_grey_wagtail", label: "Grey Wagtail" },
  { observationField: "wildlife_bat", label: "Bats" },
  { observationField: "wildlife_mayflies_caddisflies", label: "Mayflies/Caddisflies" },
];

export const INVASIVE_PLANT_FIELDS = [
  { observationField: "invasive_plants_himalayan_balsam", label: "Himalayan Balsam" },
  { observationField: "invasive_plants_japanese_knotweed", label: "Japanese Knotweed" },
  { observationField: "invasive_plants_giant_hogweed", label: "Giant Hogweed" },
  { observationField: "invasive_plants_skunk_cabbage", label: "Skunk Cabbage" },
  { observationField: "invasive_plants_curly_waterweed", label: "Curly Waterweed" },
  { observationField: "invasive_plants_floating_pennywort", label: "Floating Pennywort" },
];

export const MAP = {
  basemap: { dark: "dark-gray-vector", light: "gray-vector" },
};

// Open River Network, cut to the selected waterbody.
export const RIVER_NETWORK = {
  url: "https://services3.arcgis.com/Bb8lfThdhugyc4G3/arcgis/rest/services/OpenRiverNetwork_CaBA_ID/FeatureServer/0",
  title: "Open River Network",
  color: "#0277bd",
  widthByStrahler: [
    { value: 1, size: 0.4 },
    { value: 2, size: 0.8 },
    { value: 3, size: 1.3 },
    { value: 4, size: 2 },
    { value: 5, size: 3 },
    { value: 7, size: 5 },
  ],
};

// Storm overflow outfalls are drawn as this emoji, so they never read
// as survey sites.
export const STORM_OVERFLOW_GLYPH = "\u{1F4A9}";

// =====================================================================
// SCORECARDS
// Every measure rates into five "quality" bands, High (rank 0, best) to
// Bad (rank 4) - the same colours as the threshold bands, but worded as
// a rating, since for some measures (wildlife) more is better.
// =====================================================================

export const RATING_BANDS = [
  { key: "high", label: "High", color: "#0072b0" },
  { key: "good", label: "Good", color: "#56d5e8" },
  { key: "moderate", label: "Moderate", color: "#e6b800" },
  { key: "poor", label: "Poor", color: "#f08c00" },
  { key: "bad", label: "Bad", color: "#d63129" },
];

// The rating thresholds and coverage minimums are set from each
// measure's rating in data/scorecard.json (rules.js), so they're edited
// there, beside the data sources. The rest are display settings.
export const SCORECARD = {
  nrsMinSites: null,
  nrsMinSurveys: null,
  wildlifeScoreMin: null,
  wildlifeSpecies: null, // the indicator species, from data/scorecard.json
  invasiveRichnessMax: null,
  invertebrateMinSites: null,
  invertebrateMinSamples: null,
  invertebrateBreachRateMax: null,
  riverflyFloor: null,
  actionCountMin: null,
  actionNoneIsNoData: null, // true: no delivered interventions is "no data", not Bad
  visiblePollutionRateMax: null,

  // The year the period drop-down offers, whole or by quarter.
  periodYear: 2026,

  // Bar chart y-axis ceilings (a tighter, more readable top than the
  // equipment's full range; grows if the data goes past it).
  trendChartMaxOverride: { nitrate: 25, nitrite: 3, ammonia: 4, turbidity: 150, conductivity: 2500 },
};

export const SCORECARD_SOURCES = {
  riverflyUrl: "https://services3.arcgis.com/Bb8lfThdhugyc4G3/arcgis/rest/services/Riverfly1/FeatureServer/0",
  // EA Event Duration Monitoring 2025 - one row per outfall, joined on
  // wfdWaterbodyID. Shown on the map for context; not part of the rating.
  pollutionUrl: "https://services3.arcgis.com/Bb8lfThdhugyc4G3/ArcGIS/rest/services/Event_Duration_Monitoring_Storm_Overflows_2025/FeatureServer/0",
  nbsUrl: "https://services3.arcgis.com/Bb8lfThdhugyc4G3/ArcGIS/rest/services/NBS_Interventions_Public_Layer/FeatureServer/0",
};

// Map marker colours - deliberately none of the rating colours, so a
// marker never reads as a rating.
export const SCORECARD_COLORS = {
  site: "#a855f7",
  siteMuted: "#8f8d86",
  riverfly: "#2f9e44",
  nbs: "#e64dc4",
};

// Map symbols for the hub's own datasets in data/scorecard.json, by
// dataset id, each a different shape. A dataset not listed here gets the
// fallback. Black and white only, so none reads as a rating.
export const HUB_SOURCE_SYMBOLS = {
  angling_trust_wqmn: { style: "square", color: "#f5f5f0", outline: "#1f1f1c", size: 8 },
  global_data_set: { style: "diamond", color: "#1f1f1c", outline: "#f5f5f0", size: 10 },
  river_guardians: { style: "triangle", color: "#f5f5f0", outline: "#1f1f1c", size: 11 },
  fallback: { style: "x", color: "#f5f5f0", outline: "#1f1f1c", size: 10 },
};

// Catchment Health wheel: eight themes, each with named sub-categories.
// Only `wired` themes have data behind them; the rest are drawn as grey
// placeholders. Sub keys match catchmentHealthRanks() in ratings.js.
export const CATCHMENT_HEALTH_SPOKES = [
  {
    key: "recreation", label: "Recreation", shortLabel: "REC", color: { dark: "#c98500", light: "#eda100" }, wired: true,
    subs: [
      { key: "visiblePollution", label: "Visible Pollution", shortLabel: "VIS" },
      { key: "ecoli", label: "E.coli", shortLabel: "ECOLI" },
    ],
  },
  {
    key: "recovery", label: "River Recovery", shortLabel: "RCV", color: { dark: "#d55181", light: "#e87ba4" }, wired: true,
    subs: [{ key: "action", label: "Action", shortLabel: "ACT" }],
  },
  {
    // Species in and around the river - not "Ecology", which would read
    // as the WFD ecological status (chemistry too).
    key: "biodiversity", label: "Biodiversity", shortLabel: "BIO", color: { dark: "#008300", light: "#008300" }, wired: true,
    subs: [
      { key: "wildlife", label: "Wildlife", shortLabel: "WL" },
      { key: "invasives", label: "Invasives", shortLabel: "INNS" },
      { key: "invertebrates", label: "Invertebrates", shortLabel: "INV" },
    ],
  },
  {
    key: "chemicals", label: "Chemicals", shortLabel: "CHM", color: { dark: "#9085e9", light: "#6250d6" },
    subs: [
      { key: "metals", label: "Metals", shortLabel: "MET" },
      { key: "pharma", label: "Pharma", shortLabel: "PHA" },
      { key: "pfas", label: "PFAS", shortLabel: "PFAS" },
    ],
  },
  {
    key: "drought", label: "Drought", shortLabel: "DRT", color: { dark: "#e66767", light: "#e34948" },
    subs: [
      { key: "flow", label: "Flow", shortLabel: "FLW" },
      { key: "abstraction", label: "Abstraction", shortLabel: "ABS" },
    ],
  },
  {
    key: "habitat", label: "Habitat and Naturalness", shortLabel: "HAB", color: { dark: "#3987e5", light: "#2a78d6" },
    subs: [
      { key: "habitatCondition", label: "Habitat", shortLabel: "HAB" },
      { key: "barriers", label: "Barriers", shortLabel: "BAR" },
    ],
  },
  {
    key: "flooding", label: "Flooding", shortLabel: "FLD", color: { dark: "#d95926", light: "#eb6834" },
    subs: [{ key: "floodFlow", label: "Flow", shortLabel: "FLW" }],
  },
  {
    // Each nutrient rated on its own against the agreed thresholds.
    key: "nutrients", label: "Nutrients and Sediment", shortLabel: "N&S", color: { dark: "#199e70", light: "#1baf7a" }, wired: true,
    subs: [
      { key: "phosphate", label: "Orthophosphate", shortLabel: "PO₄" },
      { key: "nitrate", label: "Nitrate", shortLabel: "NO₃" },
      { key: "nitrite", label: "Nitrite", shortLabel: "NO₂" },
      { key: "ammonia", label: "Ammonia", shortLabel: "NH₃" },
      { key: "turbidity", label: "Turbidity", shortLabel: "TURB" },
      { key: "conductivity", label: "Conductivity", shortLabel: "COND" },
    ],
  },
];
