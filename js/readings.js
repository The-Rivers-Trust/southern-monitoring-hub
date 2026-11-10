// =====================================================================
// READINGS
// Turns a catalogue entry into what the map needs: the load filter, the
// Arcade expression that puts each point in a category, and the wording
// for one reading. No map or page code here, so it can be tested alone.
//
// A category is "c<step>-<x|e>" (colour step, exact or estimated),
// "flagged" (suspect value) or "unscaled" (can't go on the colour scale).
// =====================================================================

export const FLAGGED = "flagged";
export const UNSCALED = "unscaled";

// The dataset-wide filter applied when loading: metric-level "is this a
// real reading?" is decided afterwards by describeReading.
export function baseWhere(dataset, now = new Date()) {
  const parts = [];
  if (dataset.filters?.excludeFutureDates) {
    parts.push(`${dataset.fields.date} <= TIMESTAMP '${now.toISOString().slice(0, 10)} 23:59:59'`);
  }
  if (dataset.filters?.defaultWhere) parts.push(`(${dataset.filters.defaultWhere})`);
  return parts.join(" AND ") || "1=1";
}

export const isOnScale = (mapping, metric) => Boolean(metric.scale) && mapping.toMetricUnit != null;

// A value carrying its own limit, such as <0.03 or >2.5, as a band.
function limitBand(raw, mapping) {
  if (!mapping.limits || typeof raw !== "string") return null;
  const match = /^([<>])\s*(.+)$/.exec(raw.trim());
  const limit = match ? Number(match[2]) : NaN;
  if (!Number.isFinite(limit)) return null;
  if (match[1] === ">") return { kind: "above_limit", min: limit, max: null, mapValue: limit };
  return mapping.limits.below === "zero"
    ? { kind: "below_limit_as_zero", min: 0, max: limit, mapValue: 0 }
    : { kind: "below_limit", min: 0, max: limit, mapValue: limit / 2 };
}

// The band for a raw value, if it's an estimate or limit rather than exact.
export function bandFor(raw, mapping) {
  if (raw === null || raw === undefined) return null;
  return mapping.bands?.[raw] ?? limitBand(raw, mapping);
}

// Which band a value is in. Thresholds are inclusive upper bounds.
export function stepIndex(value, breaks) {
  const index = breaks.findIndex((limit) => value <= limit);
  return index === -1 ? breaks.length : index;
}

export const category = (step, isEstimate) => `c${step}-${isEstimate ? "e" : "x"}`;

// The Arcade that gives each point its category in the renderer.
export function categoryExpression(mapping, metric) {
  const field = JSON.stringify(mapping.field);
  const onScale = isOnScale(mapping, metric);

  if (mapping.valueType === "banded") {
    const pairs = Object.entries(mapping.bands).flatMap(([code, band]) => {
      const result = onScale
        ? category(stepIndex(band.mapValue * mapping.toMetricUnit, metric.scale.breaks), true)
        : UNSCALED;
      return [`raw == ${JSON.stringify(code)}`, JSON.stringify(result)];
    });
    // Text(), because some banded fields hold numbers.
    return `var raw = Text($feature[${field}]);\nreturn When(${pairs.join(", ")}, null);`;
  }

  // Special values on a number field, such as an instrument's limits.
  const limitChecks = Object.entries(mapping.bands ?? {}).map(([code, band]) => {
    const result = onScale
      ? category(stepIndex(band.mapValue * mapping.toMetricUnit, metric.scale.breaks), true)
      : UNSCALED;
    return `if (value == ${Number(code)}) { return ${JSON.stringify(result)}; }`;
  });

  // Values carrying their own limit have to be read in Arcade too.
  const scaledResult = (variable, suffix) => {
    if (!onScale) return JSON.stringify(UNSCALED);
    const { breaks } = metric.scale;
    const pairs = breaks.flatMap((limit, step) => [`${variable} <= ${limit}`, JSON.stringify(category(step, suffix))]);
    return `When(${pairs.join(", ")}, ${JSON.stringify(category(breaks.length, suffix))})`;
  };
  const textLimitLines = mapping.limits ? [
    `var text = Text($feature[${field}]);`,
    `var prefix = Left(text, 1);`,
    `if (prefix == "<" || prefix == ">") {`,
    `  var limit = Number(Mid(text, 1));`,
    `  var limitValue = IIf(prefix == "<", limit * ${mapping.limits.below === "zero" ? 0 : 0.5}, limit) * ${mapping.toMetricUnit ?? 1};`,
    `  return ${scaledResult("limitValue", true)};`,
    `}`,
  ] : [];

  const { suspectValues = [], plausibleRange } = mapping.quality;
  const checks = ["IsNan(value)"];
  if (suspectValues.length) checks.push(`Includes(${JSON.stringify(suspectValues)}, value)`);
  if (plausibleRange) checks.push(`value < ${plausibleRange[0]}`, `value > ${plausibleRange[1]}`);

  const result = scaledResult("scaled", false);
  return [
    ...textLimitLines,
    `var value = Number($feature[${field}]);`,
    ...limitChecks,
    `if (${checks.join(" || ")}) { return ${JSON.stringify(FLAGGED)}; }`,
    `var scaled = value * ${mapping.toMetricUnit ?? 1};`,
    `return ${result};`,
  ].join("\n");
}

function isFlagged(value, quality) {
  const { suspectValues = [], plausibleRange } = quality;
  if (suspectValues.includes(value)) return true;
  return Boolean(plausibleRange) && (value < plausibleRange[0] || value > plausibleRange[1]);
}

const fill = (template, values) =>
  template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? "").replace(/\s+/g, " ").replace(/\s+\./g, ".").trim();

// The value used for hexagon summaries, in the metric's unit. Null for
// a suspect value or one that can't be converted.
export function mappedValue(raw, mapping) {
  if (mapping.toMetricUnit == null) return null;
  const band = bandFor(raw, mapping);
  if (band) return band.mapValue * mapping.toMetricUnit;
  if (mapping.valueType === "banded") return null;
  const value = mapping.valueType === "number_as_text" ? Number(raw) : raw;
  if (!Number.isFinite(value) || isFlagged(value, mapping.quality)) return null;
  return value * mapping.toMetricUnit;
}

function bandHeadline(band, show) {
  return {
    range: `${show(band.min)}–${show(band.max)}`,
    below_limit: `< ${show(band.max)}`,
    below_limit_as_zero: `< ${show(band.max)}`,
    above_limit: `> ${show(band.min)}`,
    graduation: show(band.mapValue),
  }[band.kind];
}

// One reading in words, for the details panel, in the metric's reporting form.
// Null if it isn't a real reading. originalHeadline is set if converted.
export function describeReading(raw, mapping, conventions) {
  const unit = mapping.unit.value ?? "";
  const withUnit = (text) => `${text} ${unit}`.trim();
  const factor = mapping.toMetricUnit ?? 1;
  const asRecorded = (value) => String(value);
  const show = (value) => (factor === 1 ? asRecorded(value) : String(Number((value * factor).toPrecision(3))));

  const band = bandFor(raw, mapping);
  if (mapping.valueType === "banded" && !band) return null;
  if (band) {
    const kind = conventions.readingKinds[band.kind];
    const shown = (value) => (value === null ? null : show(value));
    return {
      headline: withUnit(bandHeadline(band, show)),
      originalHeadline: factor === 1 ? null : withUnit(bandHeadline(band, asRecorded)),
      note: fill(kind.label, { min: shown(band.min), max: shown(band.max), mapValue: shown(band.mapValue), unit }),
      isEstimate: kind.isEstimate,
      isFlagged: false,
    };
  }

  const value = mapping.valueType === "number_as_text" ? Number(raw) : raw;
  if (raw === null || raw === undefined || !Number.isFinite(value)) return null;
  if (mapping.quality.noReadingValues.includes(raw)) return null;
  return {
    headline: withUnit(show(value)),
    originalHeadline: factor === 1 ? null : withUnit(asRecorded(value)),
    note: "",
    isEstimate: false,
    isFlagged: isFlagged(value, mapping.quality),
  };
}

export function stepLabels(breaks) {
  return [
    breaks[0] === 0 ? "0" : `Up to ${breaks[0]}`,
    ...breaks.slice(1).map((limit, index) => `Above ${breaks[index]}, up to ${limit}`),
    `Above ${breaks.at(-1)}`,
  ];
}
