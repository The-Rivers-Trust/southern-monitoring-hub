// =====================================================================
// CLASSIFICATION DETAILS
// The right-hand panel: a legend that doubles as a filter, with counts,
// then charts that answer the selected question for the whole area.
// =====================================================================

import { el } from "../dom.js";

const SVG = "http://www.w3.org/2000/svg";
const CHART_WIDTH = 268;
const SHORT_STATUS = { Moderate: "Mod." };
const count = (value) => value.toLocaleString("en-GB");
const percent = (part, whole) => (whole ? `${Math.round((part / whole) * 100)}%` : "0%");
const sites = (value) => `${count(value)} site${value === 1 ? "" : "s"}`;

function svgNode(tag, attributes = {}, text) {
  const node = document.createElementNS(SVG, tag);
  Object.entries(attributes).forEach(([name, value]) => node.setAttribute(name, value));
  if (text !== undefined) node.textContent = text;
  return node;
}

function withTitle(node, text) {
  node.append(svgNode("title", {}, text));
  return node;
}

function marker(entry) {
  const node = el("span", `marker marker--circle${entry.hollow ? " marker--hollow" : ""}`);
  node.style.setProperty("--marker-colour", entry.colour);
  if (entry.small) node.classList.add("marker--small");
  return node;
}

// Each row shows and hides its category on the map.
function legend(entries, counts, hidden, onToggle) {
  const list = el("ul", "legend legend--toggles");
  for (const entry of entries) {
    const row = el("li");
    const label = document.createElement("calcite-label");
    label.layout = "inline";
    label.scale = "s";
    label.className = "legendToggle";
    const checkbox = document.createElement("calcite-checkbox");
    checkbox.checked = !hidden.has(entry.id);
    checkbox.scale = "s";
    checkbox.addEventListener("calciteCheckboxChange", () => onToggle(entry.id, checkbox.checked));
    const text = el("span", "legendText");
    text.append(el("span", "legendLabel", entry.label), el("span", "legendHint", entry.hint ?? ""));
    label.append(checkbox, marker(entry), text, el("span", "legendCount", count(counts.get(entry.id) ?? 0)));
    row.append(label);
    list.append(row);
  }
  return list;
}

function chartBlock(heading, chart, caption) {
  const block = el("section", "clsChart");
  block.append(el("h3", null, heading), chart);
  if (caption) block.append(el("p", "note", caption));
  return block;
}

// One bar per round, as long as the number of sites classified, split by
// status when statusColours is given.
function roundsChart(perRound, statuses, statusColours) {
  const rowHeight = 24;
  const labelWidth = 34;
  const countWidth = 40;
  const barWidth = CHART_WIDTH - labelWidth - countWidth;
  const most = Math.max(1, ...perRound.map((row) => row.total));
  const svg = svgNode("svg", { viewBox: `0 0 ${CHART_WIDTH} ${perRound.length * rowHeight}`, role: "img" });
  svg.setAttribute("aria-label", perRound.map((row) => `${row.round}: ${sites(row.total)}`).join(", "));

  perRound.forEach((row, index) => {
    const y = index * rowHeight;
    svg.append(svgNode("text", { x: 0, y: y + 15, class: "chartLabel chartLabel--strong" }, String(row.round)));
    if (!row.inUse) {
      svg.append(svgNode("text", { x: labelWidth, y: y + 15, class: "chartLabel" }, "Not classified in England this round"));
      return;
    }
    let x = labelWidth;
    if (statusColours) {
      for (const status of statuses) {
        const value = row.counts.get(status.value);
        if (!value) continue;
        const width = (value / most) * barWidth;
        svg.append(withTitle(
          svgNode("rect", { x, y: y + 4, width: Math.max(width - 1, 0.5), height: rowHeight - 8, fill: statusColours[status.value], class: "chartBar" }),
          `${row.round}: ${sites(value)} ${status.value} (${percent(value, row.total)})`,
        ));
        x += width;
      }
    } else {
      const width = (row.total / most) * barWidth;
      svg.append(withTitle(
        svgNode("rect", { x, y: y + 4, width: Math.max(width, 0.5), height: rowHeight - 8, class: "chartBar chartBar--plain" }),
        `${row.round}: ${sites(row.total)} classified`,
      ));
      x += width;
    }
    svg.append(svgNode("text", { x: x + 4, y: y + 15, class: "chartLabel" }, count(row.total)));
  });
  return svg;
}

// Each bar filters the map to that year; the chosen one again clears it.
// Sites last classified in the latest round are still monitored, so
// they're blue; earlier years have lapsed, so they're orange.
function lastClassifiedChart(byYear, latestRound, selectedYear, onPickYear) {
  const height = 96;
  const bottom = 16;
  const top = 12;
  const slot = CHART_WIDTH / byYear.length;
  const most = Math.max(1, ...byYear.map(([, value]) => value));
  const svg = svgNode("svg", { viewBox: `0 0 ${CHART_WIDTH} ${height}`, role: "img" });
  svg.setAttribute("aria-label", byYear.map(([year, value]) => `${year}: ${sites(value)}`).join(", "));
  byYear.forEach(([year, value], index) => {
    const barHeight = (value / most) * (height - bottom - top);
    const x = index * slot + slot * 0.15;
    const y = height - bottom - barHeight;
    const classes = ["chartBar", year >= latestRound ? "chartBar--plain" : "chartBar--lapsed"];
    if (selectedYear !== null && year !== selectedYear) classes.push("isDimmed");
    const bar = svgNode("g", { class: "yearBar", tabindex: 0, role: "button" });
    bar.setAttribute("aria-pressed", String(year === selectedYear));
    bar.setAttribute("aria-label", `Last classified ${year}: ${sites(value)}. ${year === selectedYear ? "Show all years" : "Show only these on the map"}`);
    // The whole column is clickable, so short bars are easy to hit.
    bar.append(svgNode("rect", { x: index * slot, y: 0, width: slot, height, class: "yearBarHit" }));
    bar.append(withTitle(
      svgNode("rect", { x, y, width: slot * 0.7, height: Math.max(barHeight, 0.5), class: classes.join(" ") }),
      `Last classified ${year}: ${sites(value)}`,
    ));
    const pick = () => onPickYear(year === selectedYear ? null : year);
    bar.addEventListener("click", pick);
    bar.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      pick();
    });
    svg.append(bar);
    svg.append(svgNode("text", { x: x + slot * 0.35, y: y - 3, "text-anchor": "middle", class: "chartLabel" }, count(value)));
    svg.append(svgNode("text", { x: x + slot * 0.35, y: height - 4, "text-anchor": "middle", class: "chartLabel" }, `'${String(year).slice(2)}`));
  });
  return svg;
}

// Rows: status before. Columns: status after. A cell is better, worse or no
// change; one whose kind is switched off in the legend is dimmed, and cannot
// be picked. Picking a cell (onPick) shows only the sites that made that move.
function transitionTable(matrix, statuses, fromText, toText, { hidden, selected, onPick }) {
  const table = el("table", "transitionTable");
  const head = el("tr");
  const corner = el("th", "corner");
  corner.append(el("span", null, `${fromText} ↓`), el("span", null, `${toText} →`));
  head.append(corner);
  statuses.forEach((status) => {
    const cell = el("th", null, SHORT_STATUS[status.value] ?? status.value);
    cell.title = status.value;
    head.append(cell);
  });
  table.append(head);
  for (const before of statuses) {
    const row = el("tr");
    row.append(el("th", null, before.value));
    for (const after of statuses) {
      const value = matrix.get(before.value).get(after.value);
      const cell = el("td", value ? null : "isZero", count(value));
      const kind = after.rank > before.rank ? "improved" : after.rank < before.rank ? "declined" : "same";
      if (kind === "improved") cell.classList.add("isBetter");
      else if (kind === "declined") cell.classList.add("isWorse");
      const off = hidden.has(kind);
      if (off) cell.classList.add("isOff");
      const isSelected = selected?.from === before.value && selected?.to === after.value;
      if (isSelected) cell.classList.add("isSelected");
      cell.title = off
        ? `${count(value)} went from ${before.value} to ${after.value} (switched off in the key above)`
        : `${count(value)} went from ${before.value} to ${after.value}. Click to show only these on the map.`;
      if (!off && value) {
        cell.classList.add("isPick");
        cell.tabIndex = 0;
        cell.setAttribute("role", "button");
        cell.setAttribute("aria-pressed", String(isSelected));
        const pick = () => onPick(isSelected ? null : { from: before.value, to: after.value });
        cell.addEventListener("click", pick);
        cell.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          pick();
        });
      }
      row.append(cell);
    }
    table.append(row);
  }
  return table;
}

const roundText = (round, which) => (typeof round === "number" ? String(round) : which);

export function renderClassificationDetails(container, view) {
  const { catalog, item, mode, entries, counts, hidden, onToggle, perRound, statusColours } = view;
  const parts = [el("h2", null, item.label), el("p", "summary", view.summaryText)];

  if (view.message) {
    container.replaceChildren(...parts);
    return;
  }
  if (view.selectedYear !== null && view.selectedYear !== undefined) {
    parts.push(el("p", "note filterNote", `Map and counts below: sites last classified in ${view.selectedYear}.`));
  }
  parts.push(legend(entries, counts, hidden, onToggle));

  if (mode === "coverage") {
    parts.push(chartBlock("Sites classified each round", roundsChart(perRound, catalog.statuses, null)));
    if (view.lastClassifiedByYear.length) {
      const { selectedYear } = view;
      parts.push(chartBlock(
        "When sites were last classified",
        lastClassifiedChart(view.lastClassifiedByYear, catalog.rounds.at(-1), selectedYear, view.onPickYear),
        selectedYear === null
          ? "Click a bar to show only those sites on the map."
          : `Showing sites last classified in ${selectedYear}. Click the bar again to show all years.`,
      ));
    }
  } else {
    parts.push(chartBlock("Status each round", roundsChart(perRound, catalog.statuses, statusColours)));
  }

  if (mode === "change" && view.transitions) {
    const fromText = roundText(view.from, "Earliest");
    const toText = roundText(view.to, "Latest");
    // The whole area's counts, not those of a picked cell.
    const all = view.fullCounts;
    const paired = (all.get("improved") ?? 0) + (all.get("declined") ?? 0) + (all.get("same") ?? 0);
    const better = all.get("improved") ?? 0;
    const worse = all.get("declined") ?? 0;
    const { transition } = view;
    const caption = paired
      ? `Of ${sites(paired)} classified in both rounds, ${percent(better, paired)} got better and ${percent(worse, paired)} got worse. Shaded blue: better. Shaded orange: worse. Greyed cells are switched off in the key above.`
      : "No site here was classified in both rounds.";
    parts.push(chartBlock(
      "From one status to another",
      transitionTable(view.transitions, [...catalog.statuses].sort((a, b) => b.rank - a.rank), fromText, toText, {
        hidden,
        selected: transition,
        onPick: view.onPickTransition,
      }),
      transition
        ? `Showing sites that went from ${transition.from} to ${transition.to}. Click the cell again to show all. ${caption}`
        : `Click a cell to show only those sites on the map. ${caption}`,
    ));
  }

  if (item.note) parts.push(el("p", "note", item.note));
  container.replaceChildren(...parts);
}
