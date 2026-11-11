// =====================================================================
// SCORECARD PERIOD
// The scorecard's time period: a whole year, or one of its quarters,
// picked from a drop-down in the panel. Everything the scorecard counts
// (NRS surveys, the hub's datasets, Riverfly) is limited to it.
// Subscribe with onDateRangeChange.
// =====================================================================

import { SCORECARD } from "./config.js";

const QUARTERS = [
  { label: "Jan–Mar", firstMonth: 0 },
  { label: "Apr–Jun", firstMonth: 3 },
  { label: "Jul–Sep", firstMonth: 6 },
  { label: "Oct–Dec", firstMonth: 9 },
];

// { key, label, from, to } - from is the first moment, to the last
// (local time), both in ms.
function periodsFor(year) {
  const span = (firstMonth, months) => ({
    from: new Date(year, firstMonth, 1).getTime(),
    to: new Date(year, firstMonth + months, 1).getTime() - 1,
  });
  return [
    { key: String(year), label: String(year), ...span(0, 12) },
    ...QUARTERS.map((quarter, index) => ({ key: `${year}-q${index + 1}`, label: `${quarter.label} ${year}`, ...span(quarter.firstMonth, 3) })),
  ];
}

const PERIODS = periodsFor(SCORECARD.periodYear);
let current = PERIODS[0];
const listeners = new Set();

export function onDateRangeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getDateRange() {
  return { from: current.from, to: current.to };
}

export function isWithinDateRange(ms) {
  return ms != null && ms >= current.from && ms <= current.to;
}

// "2026", "Apr–Jun 2026", ...
export function dateRangeDescription() {
  return current.label;
}

export function initDateRange({ periodEl }) {
  periodEl.replaceChildren(...PERIODS.map((period) => {
    const option = document.createElement("calcite-option");
    option.value = period.key;
    option.label = period.label;
    option.selected = period === current;
    return option;
  }));
  periodEl.addEventListener("calciteSelectChange", () => {
    current = PERIODS.find((period) => period.key === periodEl.value) ?? PERIODS[0];
    listeners.forEach((fn) => fn());
  });
}
