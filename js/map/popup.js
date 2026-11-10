// =====================================================================
// POP-UP
// One reading: what was recorded, how it was mapped, and what we do and
// don't know about how it was measured.
// =====================================================================

import { el } from "../dom.js";
import { provenanceText } from "../catalog.js";
import { describeReading } from "../readings.js";
import { PARTNERSHIP_FIELD } from "../data/readings-store.js";

function formatDate(epoch, time) {
  if (epoch === null || epoch === undefined) return "Not recorded";
  // UTC, so a midnight date can't slip to the previous day.
  const date = new Date(epoch).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return time ? `${date}, ${time}` : date;
}

function safePhotoUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch (e) {
    return null;
  }
}

const popupRoot = () => el("div", "readingPopup");

function detailsTable(rows) {
  const table = el("table");
  for (const [label, value] of rows) {
    const row = el("tr");
    row.append(el("th", null, label), el("td", null, value));
    table.append(row);
  }
  return table;
}

const roundValue = (value) => String(Number(value.toPrecision(3)));

export function summaryPopupContent(summary, metric) {
  const withUnit = (value) => `${roundValue(value)} ${metric.unit}${metric.basis ? ` as ${metric.basis}` : ""}`;
  const root = popupRoot();
  root.append(el("p", "readingValue", `Median ${withUnit(summary.median)}`));
  root.append(el("p", "readingNote", `From ${summary.count} reading${summary.count === 1 ? "" : "s"} in ${summary.place}. Zoom in for more detail.`));
  if (summary.hasEstimates) {
    root.append(el("p", "readingNote", "Includes estimates: ranges use their mid-point, below-limit readings half the limit, and above-limit readings the limit."));
  }
  if (summary.besideCount) {
    root.append(el("p", "readingNote", `Includes ${summary.besideCount} reading${summary.besideCount === 1 ? "" : "s"} from just outside the waterbody boundary, such as a tidal river channel.`));
  }
  root.append(detailsTable([
    ["Waterbody", summary.waterbodyName],
    ["Waterbody ID", summary.waterbodyId],
    ["Lowest", withUnit(summary.min)],
    ["Highest", withUnit(summary.max)],
    ["Year reported", yearReported(summary)],
    ...summary.sourceCounts.map(([label, count], index) => [
      index === 0 ? (summary.sourceCounts.length === 1 ? "Data source" : "Data sources") : "",
      `${label}: ${count} reading${count === 1 ? "" : "s"}`,
    ]),
  ]));
  return root;
}

function yearReported({ reportedYear, minYear, maxYear }) {
  if (reportedYear !== null) return String(reportedYear);
  return minYear === maxYear ? `All years (${minYear})` : `All years (${minYear}–${maxYear})`;
}

export const reportTitle = (metric, year) => `${metric.label}, ${year === null ? "all years" : year}`;

export function popupContent(attributes, { dataset, mapping, metric, conventions }) {
  const { fields } = dataset;
  const { unknownText } = conventions;
  const reading = describeReading(attributes[mapping.field], mapping, conventions);
  const asBasis = metric.basis ? ` as ${metric.basis}` : "";

  const root = popupRoot();

  root.append(el("p", "readingValue", reading ? `${reading.headline}${asBasis}` : "No reading"));
  if (reading?.note) root.append(el("p", "readingNote", reading.note));
  if (reading?.originalHeadline) {
    root.append(el("p", "readingNote", `Recorded as ${reading.originalHeadline} as ${mapping.basis.value}, converted to ${metric.basis} (× ${mapping.toMetricUnit}).`));
  }
  if (reading?.isFlagged) root.append(el("p", "readingFlag", "This value looks suspect and may not be a real reading."));

  const rows = [
    ["Site", attributes[fields.site] || "Not recorded"],
    ["Sampled", formatDate(attributes[fields.date], attributes[fields.time])],
    ...(fields.river ? [["River", attributes[fields.river] || "Not recorded"]] : []),
    ...(fields.group ? [["Group", attributes[fields.group] || "Not recorded"]] : []),
    ["Partnership", attributes[PARTNERSHIP_FIELD]],
    ["Dataset", dataset.label],
    ["Equipment", provenanceText(mapping.equipment, mapping.equipment.name, unknownText.equipment)],
    ["Unit", provenanceText(mapping.unit, mapping.unit.value, unknownText.unit)],
  ];
  if (mapping.basis) {
    rows.push(["Recorded as", provenanceText(mapping.basis, mapping.basis.value, unknownText.basis)]);
  }
  root.append(detailsTable(rows));

  const photo = fields.photo ? safePhotoUrl(attributes[fields.photo]) : null;
  if (photo) {
    const link = el("a", "photoLink", "View photo");
    link.href = photo;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    root.append(link);
  }
  return root;
}
