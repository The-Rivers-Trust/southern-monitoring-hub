// =====================================================================
// SCORECARD GUIDE
// The "Data and thresholds guide" dialog: how the scorecard works, then
// for each rated measure what feeds it, how it's counted, its thresholds
// and what data it needs. Everything comes from data/scorecard.json,
// data/catalog.json and the scorecard settings, read when the guide
// opens, so it always says what the scorecard actually does.
// =====================================================================

import { el } from "../dom.js";
import { provenanceText } from "../catalog.js";
import { BUILT_IN } from "./hub-sources.js";
import { CATCHMENT_HEALTH_SPOKES, INVASIVE_PLANT_FIELDS, METRICS, RATING_BANDS, SCORECARD } from "./config.js";
import { dateRangeDescription } from "./date-range.js";

const VALUE_TYPE_LABELS = {
  absolute: "Exact readings",
  range: "Ranges or colour-chart steps",
  mixed: "Exact, with some at a detection limit",
  flags: "Yes/No for each sign",
  keywords: "Free text, searched for keywords",
};

const BUILT_IN_DETAILS = {
  national_river_survey: {
    how: "Every National River Survey site whose water_body_id is this waterbody, from any organisation, and their surveys in the period.",
    equipment: "As recorded on each survey (NRS equipment table)",
  },
  riverfly: {
    how: "Riverfly samples whose location falls inside the waterbody boundary, in the period. Only samples actually taken and judged against the site's trigger level count: clean (breach = 0) or a confirmed breach (breachType = Confirmed). Left out: samples with no breach result (usually a site with no trigger level set), unconfirmed breaches, and visits where no sample was taken (sampleTaken = 0). The map shows the same samples.",
    equipment: "Riverfly Partnership kick-sample method",
  },
  nbs_interventions: {
    how: "Nature-Based Solutions interventions with Status = Delivered whose footprint touches the waterbody boundary. Not limited by the period.",
    equipment: "Not applicable",
  },
};

const MEASURE_DESCRIPTIONS = {
  wildlife: "How often surveys in the waterbody record an indicator species, and how widely those sightings spread across the indicator species. Frequent sightings of many species score highest; frequent sightings of just one species score far lower.",
  invasives: "How many different invasive plant species have been seen at survey sites in the waterbody.",
  invertebrates: "How often Riverfly samples in the waterbody show a confirmed breach of their trigger level - the share of samples, not the number.",
  action: "How many Nature-Based Solutions interventions have been delivered in the waterbody.",
  visiblePollution: "How often surveys in the waterbody record a visible sign of pollution - the share of surveys showing at least one sign, not the number of signs.",
};

const NUTRIENT_REASONS = {
  mean: "the mean (average) of every reading.",
  median: "the median (middle) reading, so a few very high spikes don't dominate.",
};

const count = (value) => value.toLocaleString("en-GB");
const plural = (n, word, many = `${word}s`) => `${count(n)} ${n === 1 ? word : many}`;
const number = (value) => String(Number(value.toPrecision(4)));

// A rate as a fraction and a percentage: "1 in 20 (5%)".
function rateText(value) {
  if (value === 0) return "0%";
  const inverse = 1 / value;
  const percent = `${Number((value * 100).toPrecision(3))}%`;
  return Math.abs(inverse - Math.round(inverse)) < 1e-9 ? `1 in ${Math.round(inverse)} (${percent})` : percent;
}

function bandCell(rank) {
  const band = RATING_BANDS[rank];
  const cell = el("th");
  cell.scope = "row";
  const swatch = el("span", "guideSwatch");
  swatch.style.background = band.color;
  cell.append(swatch, band.label);
  return cell;
}

function table(headings, rows) {
  const node = el("table", "guideTable");
  const head = el("tr");
  headings.forEach((heading) => {
    const cell = el("th", null, heading);
    cell.scope = "col";
    head.append(cell);
  });
  node.append(head);
  rows.forEach((cells) => {
    const row = el("tr");
    cells.forEach((cell) => row.append(typeof cell === "string" ? el("td", null, cell) : cell));
    node.append(row);
  });
  return node;
}

// ---- Thresholds ----

// Nutrients: the catalogue's bands, worded as ratings.
function nutrientRows(catalogMetric) {
  const breaks = catalogMetric.scale.breaks;
  const unit = `${catalogMetric.unit}${catalogMetric.basis ? ` as ${catalogMetric.basis}` : ""}`;
  return RATING_BANDS.map((_, rank) => {
    let condition;
    if (rank === 0) condition = breaks[0] === 0 ? `0 ${unit} (only a true zero)` : `Up to ${breaks[0]} ${unit}`;
    else if (rank < breaks.length) condition = `Above ${breaks[rank - 1]}, up to ${breaks[rank]} ${unit}`;
    else condition = `Above ${breaks.at(-1)} ${unit}`;
    return [bandCell(rank), condition];
  });
}

// Counts where more is better (wildlife, action). steps: best first.
function higherRows(steps, noun, many, noneIsNoData) {
  const rows = RATING_BANDS.map((_, rank) => {
    if (rank === 0) return [bandCell(rank), `${plural(steps[0], noun, many)} or more`];
    if (rank < steps.length) {
      const low = steps[rank];
      const high = steps[rank - 1] - 1;
      return [bandCell(rank), low === high ? plural(low, noun, many) : `${count(low)} to ${plural(high, noun, many)}`];
    }
    const below = steps.at(-1);
    if (noneIsNoData) {
      if (below === 1) return [bandCell(rank), "Not used: none shows as no data (grey) instead"];
      return [bandCell(rank), below === 2 ? plural(1, noun, many) : `1 to ${plural(below - 1, noun, many)}`];
    }
    return [bandCell(rank), below === 1 ? "None" : `Fewer than ${plural(below, noun, many)}`];
  });
  // None at all, when that's no data rather than a rating.
  if (noneIsNoData) rows.push([noDataCell(), "None"]);
  return rows;
}

function noDataCell() {
  const cell = el("th");
  cell.scope = "row";
  cell.append(el("span", "guideSwatch isNoData"), "No data");
  return cell;
}

// Shares where more is better (the wildlife score), as percentages.
function higherRateRows(steps) {
  const percent = (value) => `${Number((value * 100).toPrecision(3))}%`;
  return RATING_BANDS.map((_, rank) => {
    if (rank === 0) return [bandCell(rank), `${percent(steps[0])} or more`];
    if (rank < steps.length) return [bandCell(rank), `${percent(steps[rank])} to under ${percent(steps[rank - 1])}`];
    return [bandCell(rank), `Under ${percent(steps.at(-1))}`];
  });
}

// Whole counts where less is better (invasives).
function lowerCountRows(steps, noun, many) {
  return RATING_BANDS.map((_, rank) => {
    if (rank === 0) return [bandCell(rank), steps[0] === 0 ? "None" : `${plural(steps[0], noun, many)} or fewer`];
    if (rank < steps.length) {
      const low = steps[rank - 1] + 1;
      const high = steps[rank];
      return [bandCell(rank), low === high ? plural(low, noun, many) : `${count(low)} to ${plural(high, noun, many)}`];
    }
    return [bandCell(rank), `${plural(steps.at(-1) + 1, noun, many)} or more`];
  });
}

// Rates where less is better (invertebrates).
function lowerRows(steps, format) {
  return RATING_BANDS.map((_, rank) => {
    if (rank === 0) return [bandCell(rank), steps[0] === 0 ? `None (${format(0)})` : `Up to ${format(steps[0])}`];
    if (rank < steps.length) return [bandCell(rank), `More than ${format(steps[rank - 1])}, up to ${format(steps[rank])}`];
    return [bandCell(rank), `More than ${format(steps.at(-1))}`];
  });
}

function thresholdTable(key, catalog) {
  const metric = METRICS.find((candidate) => candidate.key === key);
  if (metric) return table(["Rating", "Waterbody's " + metric.aggregation], nutrientRows(catalog.metrics.find((m) => m.id === metric.catalogId)));
  if (key === "wildlife") return table(["Rating", "Wildlife score"], higherRateRows(SCORECARD.wildlifeScoreMin));
  if (key === "invasives") return table(["Rating", "Invasive species seen"], lowerCountRows(SCORECARD.invasiveRichnessMax, "species", "species"));
  if (key === "invertebrates") return table(["Rating", "Samples with a confirmed breach"], lowerRows(SCORECARD.invertebrateBreachRateMax, rateText));
  if (key === "visiblePollution") return table(["Rating", "Surveys with any visible sign of pollution"], lowerRows(SCORECARD.visiblePollutionRateMax, rateText));
  if (key === "action") return table(["Rating", "Delivered interventions"], higherRows(SCORECARD.actionCountMin, "intervention", "interventions", SCORECARD.actionNoneIsNoData));
  return el("p", "note", "No thresholds set.");
}

// ---- Data sources and requirements ----

// How a survey-counted source's fields are read.
function signText(key, source) {
  const signs = Object.entries(source.signs);
  if (source.values === "keywords") {
    return `A survey shows a sign when its answer contains any of: ${signs.map(([keyword]) => `"${keyword}"`).join(", ")} (ignoring capitals, spaces and underscores, so "Oily sheen" also finds "Oily_sheen"). A blank answer isn't counted as a survey.`;
  }
  const list = signs.map(([field, label]) => `${label} (${field})`).join(", ");
  const text = key === "wildlife"
    ? `A survey records a species when its field is ticked: ${list}.`
    : `A survey shows a sign when any of these is 1: ${list}.`;
  return source.answeredNote ? `${text} ${source.answeredNote}` : text;
}

function sourceRows(key, measure, catalog) {
  const metric = METRICS.find((candidate) => candidate.key === key);
  return measure.sources.map((source) => {
    const signsText = source.signs ? signText(key, source) : "";
    if (BUILT_IN.has(source.dataset)) {
      const details = BUILT_IN_DETAILS[source.dataset];
      return [source.name, source.fields.join(", "), VALUE_TYPE_LABELS[source.values] ?? source.values, details?.equipment ?? "",
        [details?.how, signsText].filter(Boolean).join(" ")];
    }
    if (source.signs) {
      return [source.name, source.fields.join(", "), VALUE_TYPE_LABELS[source.values] ?? source.values, "Visual survey",
        `${signsText} Only surveys inside the waterbody boundary count.`];
    }
    const dataset = catalog.datasets.find((candidate) => candidate.id === source.dataset);
    const mapping = dataset?.metrics[metric?.catalogId];
    const unknown = catalog.conventions.unknownText;
    const notes = [];
    if (mapping) {
      notes.push(`Recorded in ${provenanceText(mapping.unit, mapping.unit.value, unknown.unit)}${mapping.basis?.value ? ` as ${provenanceText(mapping.basis, mapping.basis.value, unknown.basis)}` : ""}.`);
      if (mapping.toMetricUnit && mapping.toMetricUnit !== 1) notes.push(`Converted to the measure's unit by × ${mapping.toMetricUnit}.`);
      if (mapping.quality?.plausibleRange) notes.push(`Values outside ${mapping.quality.plausibleRange[0]}–${mapping.quality.plausibleRange[1]} are treated as suspect and left out.`);
    }
    notes.push("Only readings inside the waterbody boundary count.");
    return [
      source.name,
      source.fields.join(", "),
      VALUE_TYPE_LABELS[source.values] ?? source.values,
      mapping ? provenanceText(mapping.equipment, mapping.equipment.name, catalog.conventions.unknownText.equipment) : "",
      notes.join(" "),
    ];
  });
}

function requirementLines(key) {
  const metric = METRICS.find((candidate) => candidate.key === key);
  if (metric) {
    return [
      `At least ${plural(SCORECARD.nrsMinSites, "site")} and ${plural(SCORECARD.nrsMinSurveys, "reading")} in the period, counted across all the sources switched on.`,
      `Statistic: ${NUTRIENT_REASONS[metric.aggregation]}`,
    ];
  }
  if (key === "wildlife") {
    const n = SCORECARD.wildlifeSpecies.length;
    const share = 0.2;
    return [
      `At least ${plural(SCORECARD.nrsMinSites, "site")} and ${plural(SCORECARD.nrsMinSurveys, "survey")} in the period, counted across all the sources switched on.`,
      `Indicator species: ${SCORECARD.wildlifeSpecies.join(", ")}. Common waterbirds (ducks, moorhens, coots, geese, swans) and "Other" aren't counted.`,
      "Wildlife score = the share of surveys recording at least one indicator species × the effective number of species ÷ " + n + ".",
      "The effective number of species measures how evenly the sightings spread: it's worked out from each species' share of all the sightings (the inverse Simpson index). Sightings spread evenly across every species give " + n + "; sightings all of one species give 1. A single sighting among many of another species adds little.",
      `For example, ${Math.round(share * 100)}% of surveys with an indicator species, all of them fish, scores ${Math.round(share * 100)}% × 1/${n} = ${(share * 100 / n).toFixed(1)}%; the same ${Math.round(share * 100)}% spread evenly across all ${n} species scores ${Math.round(share * 100)}%. The highest possible score is 100%.`,
      "Surveys that left the wildlife question unanswered aren't counted. A survey answering \"None\" counts as a survey without an indicator species.",
      "The scorecard lists every indicator species, with how many surveys recorded it.",
    ];
  }
  if (key === "invasives") {
    const fields = INVASIVE_PLANT_FIELDS;
    return [
      `At least ${plural(SCORECARD.nrsMinSites, "National River Survey site")} and ${plural(SCORECARD.nrsMinSurveys, "survey")} in the period.`,
      `A species counts once if any survey in the period records it as seen ("Yes"). Species looked for: ${fields.map((f) => f.label).join(", ")}.`,
    ];
  }
  if (key === "invertebrates") {
    const from = new Date(SCORECARD.riverflyFloor).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
    return [
      `At least ${plural(SCORECARD.invertebrateMinSites, "Riverfly site")} and ${plural(SCORECARD.invertebrateMinSamples, "sample")} in the period.`,
      `Only samples from ${from} onwards are used.`,
      "Statistic: confirmed breaches divided by all samples.",
    ];
  }
  if (key === "visiblePollution") {
    return [
      `At least ${plural(SCORECARD.nrsMinSites, "site")} and ${plural(SCORECARD.nrsMinSurveys, "survey")} in the period, counted across all the sources switched on.`,
      "Statistic: surveys showing at least one sign, divided by all surveys. A survey with several signs counts once.",
      "The scorecard lists every sign seen, with how many surveys showed it.",
    ];
  }
  if (key === "action") {
    return [
      "No minimum: every delivered intervention counts.",
      SCORECARD.actionNoneIsNoData ? "A waterbody with none delivered isn't rated, and shows as no data (grey)." : "A waterbody with none delivered is rated Bad.",
    ];
  }
  return [];
}

function measureSection(spoke, sub, measure, catalog) {
  const section = el("section", "guideMeasure");
  section.id = `guide-${sub.key}`;
  section.append(el("h4", null, sub.label));
  const metric = METRICS.find((candidate) => candidate.key === sub.key);
  const catalogMetric = metric && catalog.metrics.find((m) => m.id === metric.catalogId);
  section.append(el("p", null, metric
    ? `The ${metric.aggregation} ${catalogMetric.label.toLowerCase()} across every reading in the waterbody, in ${catalogMetric.unit}${catalogMetric.basis ? ` as ${catalogMetric.basis}` : ""}, rated against the same bands as the Monitoring explorer.`
    : MEASURE_DESCRIPTIONS[sub.key] ?? ""));

  section.append(el("h5", null, "Data sources"));
  section.append(measure?.sources.length
    ? table(["Dataset", "Field", "Values", "Equipment", "How it's used"], sourceRows(sub.key, measure, catalog))
    : el("p", "note", "No datasets listed yet."));

  section.append(el("h5", null, "Thresholds"));
  section.append(thresholdTable(sub.key, catalog));

  section.append(el("h5", null, "Data requirements"));
  const list = el("ul");
  requirementLines(sub.key).forEach((line) => list.append(el("li", null, line)));
  section.append(list);
  return section;
}

// ---- General sections ----

function bandKey() {
  const key = el("ul", "guideBandKey");
  RATING_BANDS.forEach((band) => {
    const item = el("li");
    const swatch = el("span", "guideSwatch");
    swatch.style.background = band.color;
    item.append(swatch, band.label);
    key.append(item);
  });
  const none = el("li");
  const swatch = el("span", "guideSwatch isNoData");
  none.append(swatch, "No data");
  key.append(none);
  return key;
}

function generalSections(file) {
  const parts = [];
  parts.push(el("h3", null, "How the scorecard works"));
  parts.push(el("p", null, "Each waterbody is rated on eight themes. A theme is made of one or more measures, and every measure is rated on the same five-step scale:"));
  parts.push(bandKey());
  const how = el("ul");
  [
    "A measure without enough data in the period isn't rated, and shows as no data (grey).",
    "A theme's rating is the average of its rated measures: each rating is scored 1 (High) to 5 (Bad), averaged, then rounded.",
    "The overall rating, in the centre of the wheel, is the average of the rated themes in the same way.",
    "Themes not yet assessed are drawn grey and don't count towards the overall rating.",
    `Every count uses the period chosen in the scorecard panel, currently ${dateRangeDescription()}: the year, or one of its quarters.`,
    "The Data sources panel can switch a dataset off for one measure. It's then left out of that measure's rating, chart and map marks, and the PDF lists it as switched off.",
  ].forEach((line) => how.append(el("li", null, line)));
  parts.push(how);

  parts.push(el("h3", null, "How readings are counted"));
  const counted = el("ul");
  Object.entries(file.valueTypes).forEach(([type, text]) => counted.append(el("li", null, `${VALUE_TYPE_LABELS[type] ?? type}: ${text}`)));
  [
    "Every reading is converted to the measure's unit first, such as phosphorus (P) to phosphate (PO₄) by × 3.066.",
    "Suspect values (outside an instrument's plausible range) are left out.",
    "Only readings and surveys inside a waterbody's boundary count towards its scorecard. (The Monitoring explorer also counts those within 250 m of a boundary, such as in a tidal channel; the scorecard doesn't.)",
    "Counting at the bottom of a range keeps a rating from being pushed up by a guess, so a rating may be lower than the true value.",
  ].forEach((line) => counted.append(el("li", null, line)));
  parts.push(counted);

  parts.push(el("p", "guideProvisional", "These thresholds are a provisional first pass from the National River Survey dashboard, not a reviewed standard. They're set in data/scorecard.json; the nutrient bands are set in data/catalog.json and shared with the Monitoring explorer."));
  return parts;
}

export function renderGuide(container, { file, catalog }) {
  const parts = [...generalSections(file)];
  const wired = CATCHMENT_HEALTH_SPOKES.filter((spoke) => spoke.wired);

  // Contents, to jump to a measure.
  const contents = el("nav", "guideContents");
  contents.setAttribute("aria-label", "Measures");
  contents.append(el("h3", null, "Measures"));
  const contentsList = el("ul");
  wired.forEach((spoke) => spoke.subs.filter((sub) => file.measures[sub.key]).forEach((sub) => {
    const item = el("li");
    const link = el("a", null, `${spoke.label}: ${sub.label}`);
    link.href = `#guide-${sub.key}`;
    link.addEventListener("click", (event) => {
      event.preventDefault();
      container.querySelector(`#guide-${sub.key}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    item.append(link);
    contentsList.append(item);
  }));
  contents.append(contentsList);
  parts.unshift(contents);

  for (const spoke of wired) {
    const theme = el("section", "guideTheme");
    theme.append(el("h3", null, spoke.label));
    spoke.subs.filter((sub) => file.measures[sub.key]).forEach((sub) => theme.append(measureSection(spoke, sub, file.measures[sub.key], catalog)));
    parts.push(theme);
  }

  parts.push(el("h3", null, "Measures not yet assessed"));
  const later = el("ul");
  CATCHMENT_HEALTH_SPOKES.forEach((spoke) => {
    const subs = spoke.subs.filter((sub) => !spoke.wired || !file.measures[sub.key]);
    if (subs.length) later.append(el("li", null, `${spoke.label}: ${subs.map((sub) => sub.label).join(", ")}`));
  });
  parts.push(later);

  container.replaceChildren(...parts);
}
