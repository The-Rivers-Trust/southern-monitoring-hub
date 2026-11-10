// =====================================================================
// EA CLASSIFICATION EXPLORER
// The second tab. Pick a classification item and a question:
//   Coverage - where has monitoring lapsed or become patchy?
//   Change   - are things getting better or worse?
//   Status   - what was it in one round?
// The map, legend counts and charts all follow the header's partnership.
// =====================================================================

import { el } from "../dom.js";
import { getTheme, onThemeChange } from "../theme.js";
import { shortPartnershipName } from "../ui/partnership-filter.js";
import { areaExtent } from "../map/extents.js";
import { setupLayersPanel } from "../map/layers-panel.js";
import { loadClassificationCatalog, loadSites } from "./data.js";
import {
  CATEGORY_COLOURS,
  CHANGE,
  COVERAGE,
  FIRST,
  LATEST,
  changeCounts,
  changeOf,
  coverageCounts,
  coverageOf,
  hasRecord,
  itemRounds,
  lapsedByYear,
  sitesPerRound,
  statusCounts,
  statusOf,
  transitions,
} from "./measures.js";
import { addSiteLayer, restyleSites, showSelectedSite, siteAt } from "./site-layer.js";
import { renderClassificationDetails } from "./details.js";
import { siteDetails } from "./site-panel.js";

const BASEMAP = { dark: "dark-gray-vector", light: "gray-vector" };

const MODE_HINTS = {
  coverage: "Where has monitoring lapsed or become patchy? Each site is grouped by the rounds it was classified in.",
  change: "Are things getting better or worse? Compares each site's status between two rounds.",
  status: "The status at each site in one round.",
};

const count = (value) => value.toLocaleString("en-GB");
const sites = (value) => `${count(value)} site${value === 1 ? "" : "s"}`;
const percent = (part, whole) => (whole ? `${Math.round((part / whole) * 100)}%` : "0%");

function selectControl(labelText, options, value, onChange) {
  const label = document.createElement("calcite-label");
  label.layout = "inline-space-between";
  label.scale = "s";
  label.append(labelText);
  const select = document.createElement("calcite-select");
  select.label = labelText;
  select.scale = "s";
  for (const [optionValue, optionLabel] of options) {
    const option = document.createElement("calcite-option");
    option.value = String(optionValue);
    option.label = optionLabel;
    option.selected = optionValue === value;
    select.append(option);
  }
  select.addEventListener("calciteSelectChange", () => {
    const picked = options.find(([optionValue]) => String(optionValue) === select.value)[0];
    onChange(picked);
  });
  label.append(select);
  return label;
}

export function initClassificationExplorer({ area, elements }) {
  const { mapEl, modeEl, hintEl, optionsEl, listEl, detailsEl, infoPanel, infoBody, layersPanel, layersAction } = elements;

  const state = {
    catalog: null,
    sites: [],
    itemId: null,
    mode: "coverage",
    from: FIRST,
    to: LATEST,
    round: LATEST,
    partnership: null,
    // Sites not classified in both rounds swamp the change map, so start hidden.
    hidden: { coverage: new Set(), change: new Set(["unpaired"]), status: new Set() },
    selectedSite: null,
  };
  let listItems = [];
  let ready = null;
  let drawable = false; // set once the map layer and list exist
  let latestDraw = 0;

  const item = () => state.catalog.items.find((candidate) => candidate.id === state.itemId);
  const inArea = () => (state.partnership === null ? state.sites : state.sites.filter((site) => site.partnership === state.partnership));
  const statusColours = () => Object.fromEntries(state.catalog.statuses.map((status) => [status.value, status.colour[getTheme()]]));
  const roundName = (round) => (round === LATEST ? "their latest assessment" : String(round));

  function clipNote() {
    return state.partnership === null
      ? `Sites in the ${area.partnerships.length} CaBA partnerships.`
      : `Sites in ${shortPartnershipName(state.partnership)}.`;
  }

  // Why nothing can be drawn, if so.
  function blockedMessage(current) {
    if (state.mode === "change" && typeof state.from === "number" && typeof state.to === "number" && state.from >= state.to) {
      return "Choose a ‘To’ round later than the ‘From’ round.";
    }
    if (state.mode === "status" && typeof state.round === "number" && !itemRounds(state.catalog, current).includes(state.round)) {
      return `${current.label} wasn't classified anywhere in England in ${state.round}.`;
    }
    return null;
  }

  function entriesFor(theme) {
    if (state.mode === "status") {
      return state.catalog.statuses.map((status) => ({
        id: status.value,
        label: status.value,
        colour: status.colour[theme],
        drawOrder: 6 - status.rank, // worst on top
      }));
    }
    return (state.mode === "coverage" ? COVERAGE : CHANGE).map((entry) => ({ ...entry, colour: CATEGORY_COLOURS[entry.colour][theme] }));
  }

  function categoryFor(current) {
    const { catalog } = state;
    if (state.mode === "coverage") return (site) => coverageOf(catalog, current, site.items[current.id]);
    if (state.mode === "change") return (site) => changeOf(catalog, current, site.items[current.id], state.from, state.to)?.category ?? null;
    return (site) => statusOf(site.items[current.id], state.round);
  }

  function countsFor(current, here) {
    const { catalog } = state;
    if (state.mode === "coverage") return coverageCounts(catalog, current, here);
    if (state.mode === "change") return changeCounts(catalog, current, here, state.from, state.to);
    return statusCounts(catalog, current, here, state.round);
  }

  function summaryText(current, counts, here) {
    const withRecord = here.filter((site) => hasRecord(site.items[current.id])).length;
    if (!withRecord) return `No site here has had ${current.label} classified.`;
    if (state.mode === "coverage") {
      const lapsed = counts.get("lapsed");
      return `${sites(withRecord)} have had ${current.label} classified. ${count(lapsed)} (${percent(lapsed, withRecord)}) weren't classified in ${itemRounds(state.catalog, current).at(-1)}.`;
    }
    if (state.mode === "change") {
      const paired = counts.get("improved") + counts.get("declined") + counts.get("same");
      return `${sites(paired)} classified in both rounds: ${count(counts.get("improved"))} got better, ${count(counts.get("declined"))} got worse.`;
    }
    const shown = [...counts.values()].reduce((sum, value) => sum + value, 0);
    return `${sites(shown)} with ${current.label} classified in ${roundName(state.round)}.`;
  }

  function describeItem(current, here) {
    const { catalog } = state;
    const withRecord = here.filter((site) => hasRecord(site.items[current.id])).length;
    if (!withRecord) return "No sites here";
    if (state.mode === "coverage") return `${sites(withRecord)} · ${count(coverageCounts(catalog, current, here).get("lapsed"))} lapsed`;
    if (state.mode === "change") {
      const counts = changeCounts(catalog, current, here, state.from, state.to);
      return `${count(counts.get("improved"))} better · ${count(counts.get("declined"))} worse`;
    }
    const shown = [...statusCounts(catalog, current, here, state.round).values()].reduce((sum, value) => sum + value, 0);
    return state.round === LATEST ? `${sites(shown)} assessed` : `${sites(shown)} in ${state.round}`;
  }

  function updateList(here) {
    for (const listItem of listItems) {
      const current = state.catalog.items.find((candidate) => candidate.id === listItem.value);
      listItem.description = describeItem(current, here);
      listItem.disabled = !here.some((site) => hasRecord(site.items[current.id]));
    }
  }

  function renderOptions() {
    optionsEl.replaceChildren();
    hintEl.textContent = MODE_HINTS[state.mode];
    const rounds = state.catalog.rounds;
    if (state.mode === "change") {
      optionsEl.append(
        selectControl("From", [[FIRST, "Earliest classified"], ...rounds.slice(0, -1).map((round) => [round, String(round)])], state.from, (value) => { state.from = value; draw(); }),
        selectControl("To", [[LATEST, "Latest classified"], ...rounds.slice(1).reverse().map((round) => [round, String(round)])], state.to, (value) => { state.to = value; draw(); }),
      );
    } else if (state.mode === "status") {
      optionsEl.append(selectControl("Round", [[LATEST, "Latest assessed"], ...[...rounds].reverse().map((round) => [round, String(round)])], state.round, (value) => { state.round = value; draw(); }));
      optionsEl.append(el("p", "modeHint", "Latest assessed is each site's most recent classification, which for some sites is years old."));
    }
  }

  function showSite(site) {
    state.selectedSite = site;
    showSelectedSite(site, getTheme());
    if (!site) {
      infoPanel.closed = true;
      return;
    }
    infoPanel.heading = site.name || "Unnamed site";
    infoPanel.description = [site.siteId, site.source, shortPartnershipName(site.partnership ?? "")].filter(Boolean).join(" · ");
    infoBody.replaceChildren(siteDetails(state.catalog, site, state.itemId, statusColours()));
    infoPanel.closed = false;
  }

  async function draw() {
    const request = ++latestDraw;
    const current = item();
    const theme = getTheme();
    const here = inArea();
    const message = here.some((site) => hasRecord(site.items[current.id]))
      ? blockedMessage(current)
      : `No site here has had ${current.label} classified.`;
    const entries = entriesFor(theme);
    const hidden = state.hidden[state.mode];
    const categoryOf = message ? () => null : categoryFor(current);
    const counts = message ? new Map(entries.map((entry) => [entry.id, 0])) : countsFor(current, here);

    updateList(here);
    renderClassificationDetails(detailsEl, {
      catalog: state.catalog,
      item: current,
      mode: state.mode,
      entries,
      counts,
      hidden,
      message,
      summaryText: message ?? summaryText(current, counts, here),
      totalSites: here.length,
      clipNote: clipNote(),
      perRound: sitesPerRound(state.catalog, current, here),
      lapsedByYear: lapsedByYear(state.catalog, current, here),
      transitions: state.mode === "change" && !message ? transitions(state.catalog, current, here, state.from, state.to) : null,
      from: state.from,
      to: state.to,
      statusColours: statusColours(),
      onToggle: (id, visible) => {
        if (visible) hidden.delete(id);
        else hidden.add(id);
        draw();
      },
    });
    await restyleSites(state.sites, { entries, categoryOf, hidden, partnership: state.partnership, theme });
    if (request !== latestDraw) return;
    if (state.selectedSite) showSite(state.selectedSite); // keeps the highlighted row in step
  }

  function renderItemList() {
    const groups = new Map();
    for (const current of state.catalog.items) {
      if (!groups.has(current.group)) {
        const group = document.createElement("calcite-list-item-group");
        group.heading = current.group;
        groups.set(current.group, group);
        listEl.append(group);
      }
      const listItem = document.createElement("calcite-list-item");
      listItem.label = current.label;
      listItem.value = current.id;
      listItem.selected = current.id === state.itemId;
      groups.get(current.group).append(listItem);
      listItems.push(listItem);
    }
    const pick = (id) => {
      if (!id || id === state.itemId) return;
      state.itemId = id;
      listItems.forEach((listItem) => { listItem.selected = listItem.value === id; });
      draw();
    };
    // Clicks and keyboard selection arrive differently, so both are heard.
    listEl.addEventListener("calciteListChange", () => pick(listEl.selectedItems[0]?.value));
    listItems.forEach((listItem) => listItem.addEventListener("click", () => {
      if (!listItem.disabled) pick(listItem.value);
    }));
  }

  async function start() {
    mapEl.basemap = BASEMAP[getTheme()];
    mapEl.extent = areaExtent(area);
    mapEl.popupDisabled = true;
    mapEl.addEventListener("pointerdown", () => mapEl.classList.add("pointerFocus"));
    mapEl.addEventListener("keydown", (event) => {
      if (event.key === "Tab") mapEl.classList.remove("pointerFocus");
    });

    state.catalog = await loadClassificationCatalog();
    const loading = loadSites(state.catalog, area.partnerships.map((partnership) => partnership.name));
    await mapEl.viewOnReady();
    state.sites = await loading;
    state.itemId = state.catalog.items[0].id;

    await addSiteLayer(mapEl, state.sites);
    renderItemList();
    renderOptions();

    modeEl.addEventListener("calciteSegmentedControlChange", () => {
      state.mode = modeEl.value;
      renderOptions();
      draw();
    });
    mapEl.addEventListener("arcgisViewClick", async (event) => {
      const objectId = await siteAt(mapEl, event.detail);
      showSite(state.sites.find((site) => site.objectId === objectId) ?? null);
    });
    infoPanel.addEventListener("calcitePanelClose", () => {
      state.selectedSite = null;
      showSelectedSite(null);
    });
    onThemeChange((theme) => {
      mapEl.basemap = BASEMAP[theme];
      draw();
    });

    drawable = true;
    await draw();
    setupLayersPanel(mapEl, layersPanel, layersAction, 0)
      .catch((error) => console.error("Could not set up map layers", error));
  }

  return {
    // Starts the first time the tab is opened.
    show() {
      ready ??= start().catch((error) => {
        console.error(error);
        const failure = el("p", "summary isError", "The classification data couldn't be loaded. Please refresh the page.");
        failure.setAttribute("role", "alert");
        detailsEl.replaceChildren(failure);
      });
      return ready;
    },
    setPartnership(name) {
      state.partnership = name;
      if (state.selectedSite && name !== null && state.selectedSite.partnership !== name) showSite(null);
      if (drawable) draw();
    },
  };
}
