// =====================================================================
// MEASURES
// Turns each site's statuses for one classification item into the
// answer to a question: has its monitoring kept going (coverage), has it
// got better or worse (change), or what was it in a given round (status).
// A blank status means not classified that round, never Good.
// =====================================================================

export const FIRST = "first";
export const LATEST = "latest";

// Map colours here are the validated categorical slots (blue, aqua,
// orange) plus neutral grey. "Started later" shares blue with "every
// round" but is drawn hollow, so the two never rely on colour alone.
export const COVERAGE = [
  { id: "lapsed", label: "Lapsed", hint: "Not classified in the latest round", colour: "orange", drawOrder: 4 },
  { id: "patchy", label: "Patchy", hint: "Classified in the latest round, but missed one or more rounds before it", colour: "aqua", drawOrder: 3 },
  { id: "later", label: "Started later", hint: "First classified after the first round, none missed since", colour: "blue", hollow: true, drawOrder: 2 },
  { id: "every", label: "Every round", hint: "Classified in every round", colour: "blue", drawOrder: 1 },
];

export const CHANGE = [
  { id: "declined", label: "Got worse", hint: "Status fell by at least one class", colour: "orange", drawOrder: 4 },
  { id: "improved", label: "Got better", hint: "Status rose by at least one class", colour: "blue", drawOrder: 3 },
  { id: "same", label: "No change", hint: "Same status in both rounds", colour: "grey", drawOrder: 2 },
  { id: "unpaired", label: "Can't compare", hint: "Not classified in both rounds", colour: "grey", hollow: true, small: true, drawOrder: 1 },
];

export const CATEGORY_COLOURS = {
  blue: { dark: "#3987e5", light: "#2a78d6" },
  aqua: { dark: "#199e70", light: "#1baf7a" },
  orange: { dark: "#d95926", light: "#eb6834" },
  grey: { dark: "#898781", light: "#898781" },
};

// The rounds an item was classified in anywhere, so a round nobody was
// classified in isn't counted as a gap at any site.
export const itemRounds = (catalog, item) => item.rounds ?? catalog.rounds;
const gapRounds = (catalog, item) => itemRounds(catalog, item).filter((round) => !(item.gapIgnoredRounds ?? []).includes(round));

export function rankOf(catalog, status) {
  return catalog.statuses.find((candidate) => candidate.value === status)?.rank ?? null;
}

// Whether the site has ever had this item classified, in any year.
export const hasRecord = (record) => Boolean(record && (record.lastYear || Object.keys(record.statuses).length));

export function coverageOf(catalog, item, record) {
  if (!hasRecord(record)) return null;
  const rounds = itemRounds(catalog, item);
  const { statuses } = record;
  if (!statuses[rounds.at(-1)]) return "lapsed";
  const checked = gapRounds(catalog, item);
  const first = checked.findIndex((round) => statuses[round]);
  if (checked.slice(first).some((round) => !statuses[round])) return "patchy";
  return first === 0 ? "every" : "later";
}

// The two rounds to compare. "first" and "latest" mean the site's own
// earliest and latest classified rounds.
export function changeRounds(catalog, item, record, from, to) {
  const classified = itemRounds(catalog, item).filter((round) => record.statuses[round]);
  return [from === FIRST ? classified[0] : from, to === LATEST ? classified.at(-1) : to];
}

// { category, from, to, steps } or null if the item was never classified
// in any round here.
export function changeOf(catalog, item, record, from, to) {
  if (!record || !Object.keys(record.statuses).length) return null;
  const [a, b] = changeRounds(catalog, item, record, from, to);
  const before = record.statuses[a];
  const after = record.statuses[b];
  if (!before || !after || a >= b) return { category: "unpaired", from: a, to: b, steps: 0 };
  const steps = rankOf(catalog, after) - rankOf(catalog, before);
  return { category: steps > 0 ? "improved" : steps < 0 ? "declined" : "same", from: a, to: b, steps };
}

// The status in a round, or the last assessed status.
export function statusOf(record, round) {
  if (!record) return null;
  return round === LATEST ? record.lastStatus : record.statuses[round] ?? null;
}

const countWhere = (values, ids) => new Map(ids.map((id) => [id, values.filter((value) => value === id).length]));

export function coverageCounts(catalog, item, sites) {
  return countWhere(sites.map((site) => coverageOf(catalog, item, site.items[item.id])), COVERAGE.map((entry) => entry.id));
}

export function changeCounts(catalog, item, sites, from, to) {
  return countWhere(sites.map((site) => changeOf(catalog, item, site.items[item.id], from, to)?.category), CHANGE.map((entry) => entry.id));
}

export function statusCounts(catalog, item, sites, round) {
  return countWhere(sites.map((site) => statusOf(site.items[item.id], round)), catalog.statuses.map((status) => status.value));
}

// How many sites had the item classified in each round.
export function sitesPerRound(catalog, item, sites) {
  return catalog.rounds.map((round) => ({
    round,
    counts: statusCounts(catalog, item, sites, round),
    total: sites.filter((site) => statusOf(site.items[item.id], round)).length,
    inUse: itemRounds(catalog, item).includes(round),
  }));
}

// The year a site last had this item classified, or null if never.
export function lastClassifiedYear(record) {
  if (!hasRecord(record)) return null;
  return record.lastYear ?? Math.max(...Object.keys(record.statuses).map(Number));
}

// Sites by the year they were last classified, oldest first.
export function lastClassifiedByYear(item, sites) {
  const years = new Map();
  for (const site of sites) {
    const year = lastClassifiedYear(site.items[item.id]);
    if (year !== null) years.set(year, (years.get(year) ?? 0) + 1);
  }
  return [...years].sort(([a], [b]) => a - b);
}

// Counts of [from status][to status], among sites classified in both.
export function transitions(catalog, item, sites, from, to) {
  const matrix = new Map(catalog.statuses.map((status) => [status.value, new Map(catalog.statuses.map((other) => [other.value, 0]))]));
  for (const site of sites) {
    const record = site.items[item.id];
    const change = changeOf(catalog, item, record, from, to);
    if (!change || change.category === "unpaired") continue;
    const row = matrix.get(record.statuses[change.from]);
    row.set(record.statuses[change.to], row.get(record.statuses[change.to]) + 1);
  }
  return matrix;
}
