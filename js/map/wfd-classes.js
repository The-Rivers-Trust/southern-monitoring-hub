// =====================================================================
// WFD CLASSES
// The ways the Environment Agency's river waterbody catchments can be
// coloured, one per classification in the data (as the "Colour by" choice
// on the NRS dashboard, with all the classifications rather than three).
// Each waterbody is filled by its class for the one chosen. A value that
// isn't one of the classes listed (empty, "Not assessed", "Does not
// require assessment") falls into one grey bucket.
// =====================================================================

const HIGH = [0, 114, 176, 255];
const GOOD = [86, 213, 232, 255];
const MODERATE = [230, 184, 0, 255];
const POOR = [240, 140, 0, 255];
const BAD = [214, 49, 41, 255];
const NOT_HIGH = [160, 200, 225, 255];
const NOT_ASSESSED = [156, 156, 156, 255];

// The five classes of status, then the other scales that appear.
const STATUS = [["High", HIGH], ["Good", GOOD], ["Moderate", MODERATE], ["Poor", POOR], ["Bad", BAD]];
const PASS_FAIL = [["Good", GOOD], ["Fail", BAD]];
const HYDROLOGY = [["Supports Good", GOOD], ["Does Not Support Good", POOR]];
const MORPHOLOGY = [["High", HIGH], ["Not High", NOT_HIGH]];

// { group, label, field, classes }, in the order of the "Colour by" list.
export const WFD_VIEWS = [
  { group: "Overall", label: "Overall", field: "overall_water_body_class", classes: STATUS },
  { group: "Overall", label: "Ecological", field: "ecological_class", classes: STATUS },
  { group: "Overall", label: "Chemical", field: "chemical_class", classes: PASS_FAIL },
  { group: "Biological", label: "Invertebrates", field: "invertebrates_class", classes: STATUS },
  { group: "Biological", label: "Fish", field: "fish_class", classes: STATUS },
  { group: "Biological", label: "Macrophytes and phytobenthos", field: "macrophytes_phytobenthos_combined_class", classes: STATUS },
  { group: "Physico-chemical", label: "Ammonia", field: "ammonia_phys_chem_class", classes: STATUS },
  { group: "Physico-chemical", label: "Dissolved oxygen", field: "dissolved_oxygen_class", classes: STATUS },
  { group: "Physico-chemical", label: "pH", field: "ph_class", classes: STATUS },
  { group: "Physico-chemical", label: "Orthophosphate", field: "phosphate_class", classes: STATUS },
  { group: "Physico-chemical", label: "Temperature", field: "temperature_class", classes: STATUS },
  { group: "Physico-chemical", label: "Biochemical oxygen demand", field: "biological_oxygen_demand_class", classes: STATUS },
  { group: "Physico-chemical", label: "Acid neutralising capacity", field: "acid_neutralising_capacity_class", classes: STATUS },
  { group: "Pollutants", label: "Priority substances", field: "priority_substances_class", classes: PASS_FAIL },
  { group: "Pollutants", label: "Priority hazardous substances", field: "priority_hazardous_substances", classes: PASS_FAIL },
  { group: "Pollutants", label: "Specific pollutants", field: "specific_pollutants_class", classes: STATUS },
  { group: "Pollutants", label: "Other pollutants", field: "other_pollutants_class", classes: PASS_FAIL },
  { group: "Hydromorphology", label: "Hydrological regime", field: "hydrological_regime_class", classes: HYDROLOGY },
  { group: "Hydromorphology", label: "Morphology", field: "morphology_class", classes: MORPHOLOGY },
];

const symbol = (color) => ({ type: "simple-fill", style: "solid", color, outline: { type: "simple-line", color: [110, 110, 110, 0], width: 0.7 } });

export function wfdRenderer(view) {
  return {
    type: "unique-value",
    field: view.field,
    uniqueValueInfos: view.classes.map(([value, color]) => ({ value, label: value, symbol: symbol(color) })),
    defaultSymbol: symbol(NOT_ASSESSED),
    defaultLabel: "Not assessed or no data",
  };
}
