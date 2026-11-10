// =====================================================================
// SITE PANEL
// What opens along the bottom of the map when a site is clicked: every
// item's status in every round, with its coverage and change.
// =====================================================================

import { el } from "../dom.js";
import { COVERAGE, FIRST, LATEST, changeOf, coverageOf, hasRecord, itemRounds } from "./measures.js";

const changeText = (change) => {
  if (!change) return "";
  if (change.category === "unpaired") return "Only classified once";
  if (change.category === "same") return `No change, ${change.from}–${change.to}`;
  const classes = Math.abs(change.steps);
  return `${change.category === "improved" ? "Better" : "Worse"} by ${classes} class${classes === 1 ? "" : "es"}, ${change.from}–${change.to}`;
};

function statusCell(status, statusColours, note) {
  const cell = el("td", "statusCell");
  if (status) {
    const chip = el("span", "statusChip", status);
    chip.style.setProperty("--chip-colour", statusColours[status]);
    cell.append(chip);
  } else {
    cell.append(el("span", "statusBlank", note ? "n/a" : "–"));
    cell.title = note ?? "Not classified";
  }
  return cell;
}

export function siteDetails(catalog, site, selectedItemId, statusColours) {
  const root = el("div", "readingPopup sitePopup");
  const table = el("table", "siteTable");
  const head = el("tr");
  head.append(el("th", null, "Item"));
  catalog.rounds.forEach((round) => head.append(el("th", null, String(round))));
  head.append(el("th", null, "Last assessed"), el("th", null, "Coverage"), el("th", null, "Change"));
  table.append(head);

  for (const item of catalog.items) {
    const record = site.items[item.id];
    const row = el("tr", item.id === selectedItemId ? "isSelected" : null);
    row.append(el("th", null, item.label));
    const rounds = itemRounds(catalog, item);
    catalog.rounds.forEach((round) => row.append(statusCell(
      record.statuses[round],
      statusColours,
      rounds.includes(round) ? null : "Not classified anywhere in England this round",
    )));
    const last = el("td", null, record.lastYear ? `${record.lastStatus ?? "–"}, ${record.lastYear}` : "Never");
    const coverage = COVERAGE.find((entry) => entry.id === coverageOf(catalog, item, record));
    row.append(last, el("td", null, coverage?.label ?? ""), el("td", null, changeText(changeOf(catalog, item, record, FIRST, LATEST))));
    if (!hasRecord(record)) row.classList.add("isEmpty");
    table.append(row);
  }

  const wrapper = el("div", "tableScroll");
  wrapper.append(table);
  root.append(
    wrapper,
    el("p", "note", "– means not classified that round. Change compares the site's earliest and latest classified rounds."),
  );
  return root;
}
