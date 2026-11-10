// =====================================================================
// DETAIL TABS
// The bottom panel's Summary and Chart tabs. The chart is only built
// when its tab is first opened, because it needs every year's data. The
// chosen tab is remembered, so places can be compared while clicking.
// =====================================================================

import { el } from "../dom.js";

const SUMMARY = "summary";
const CHART = "chart";

let rememberedTab = SUMMARY;

function tabTitle(key, label) {
  const title = document.createElement("calcite-tab-title");
  title.dataset.tab = key;
  title.textContent = label;
  title.selected = key === rememberedTab;
  return title;
}

// renderChart(container) runs once, when the chart first needs showing.
export function detailTabs(summaryContent, summaryLabel, renderChart) {
  const nav = document.createElement("calcite-tab-nav");
  nav.append(tabTitle(SUMMARY, summaryLabel), tabTitle(CHART, "Chart"));

  const summaryPane = el("div", "detailPane");
  summaryPane.append(summaryContent);
  const chartPane = el("div", "detailPane");

  let chartBuilt = false;
  const show = (tab) => {
    summaryPane.hidden = tab !== SUMMARY;
    chartPane.hidden = tab !== CHART;
    if (tab === CHART && !chartBuilt) {
      chartBuilt = true;
      renderChart(chartPane);
    }
  };

  nav.addEventListener("calciteTabChange", () => {
    const selected = nav.selectedTitle;
    if (!selected?.dataset.tab) return;
    // A tab nav used on its own doesn't update each title's selected state.
    nav.querySelectorAll("calcite-tab-title").forEach((title) => { title.selected = title === selected; });
    rememberedTab = selected.dataset.tab;
    show(rememberedTab);
  });

  const root = el("div", "detailTabs");
  root.append(nav, summaryPane, chartPane);
  show(rememberedTab);
  return root;
}
