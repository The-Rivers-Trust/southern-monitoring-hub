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

function stat(label, value, hint) {
  const node = el("div", "summaryStat");
  node.append(el("span", "summaryStatLabel", label), el("span", "readingValue", value));
  if (hint) node.append(el("span", "summaryStatHint", hint));
  return node;
}

const readings = (count) => `${count} reading${count === 1 ? "" : "s"}`;

// One line per way a reading fell short of exact: what was recorded, and
// what it counts as.
function estimateLine(group, unitText) {
  const limits = group.limits.slice(0, 3).map((limit) => `${roundValue(limit)}${unitText}`);
  const limitText = (word) => (limits.length ? `, recorded as ${word} ${limits.join(" or ")}` : "");
  const sources = group.sources.map(([label, count]) => `${label} (${count})`).join(", ");
  const text = {
    range: ["Recorded as a range", `${readings(group.count)}. Counted at the bottom of each range, so 2–5 would count as 2.`],
    step: ["Read off a colour chart", `${readings(group.count)}. Counted at the step read.`],
    below: ["Below the limit of detection", `${readings(group.count)}${limitText("below")}. Counted as 0.`],
    above: ["Beyond the limit of detection", `${readings(group.count)}${limitText("above")}. Counted at the limit, so the true value is higher.`],
  }[group.kind];
  const line = el("li");
  line.append(el("strong", null, `${text[0]}: `), `${text[1]} From ${sources}.`);
  return line;
}

// Where citizen science or local readings weren't exact values.
// Laboratory datasets with reliable limits are never counted here.
function estimatesNote(summary, unitText) {
  const total = summary.estimates.reduce((sum, group) => sum + group.count, 0);
  const note = el("div", "rangesNote");
  note.setAttribute("role", "note");
  const list = el("ul");
  summary.estimates.forEach((group) => list.append(estimateLine(group, unitText)));
  note.append(
    el("p", "rangesNoteTitle", `Not exact values: ${total} of ${readings(summary.count)}`),
    list,
    el("p", null, "So the median and mean may be lower than the true values."),
  );
  return note;
}

export function summaryPopupContent(summary, metric) {
  const withUnit = (value) => `${roundValue(value)} ${metric.unit}${metric.basis ? ` as ${metric.basis}` : ""}`;
  const root = popupRoot();
  const stats = el("div", "summaryStats");
  stats.append(stat("Median", withUnit(summary.median), "Colours the map"), stat("Mean", withUnit(summary.mean)));
  root.append(stats);
  root.append(el("p", "readingNote", `From ${summary.count} reading${summary.count === 1 ? "" : "s"} in ${summary.place}. Zoom in for more detail.`));
  if (summary.estimates.length) root.append(estimatesNote(summary, ` ${metric.unit}`));
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
