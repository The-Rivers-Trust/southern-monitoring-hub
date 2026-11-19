// =====================================================================
// DETAIL SECTIONS
// What the bottom panel shows for a waterbody or hexagon: titled
// sections one after the other in the panel's scroll. The last is the
// chart over time, which needs every year's data, so it is only built
// once it comes into view.
// =====================================================================

import { el } from "../dom.js";

function section(title, content) {
  const node = el("section", "detailPane");
  node.append(el("h3", "detailHeading", title), content);
  return node;
}

// sections: [{ title, content }]. renderChart(container) runs once, when
// the chart first needs showing.
export function detailSections(sections, renderChart) {
  const root = el("div", "detailSections");
  sections.forEach(({ title, content }) => root.append(section(title, content)));

  const chart = el("section", "detailPane");
  root.append(chart);
  let chartBuilt = false;
  const build = () => {
    if (chartBuilt) return;
    chartBuilt = true;
    renderChart(chart);
  };
  if ("IntersectionObserver" in window) {
    const watcher = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      watcher.disconnect();
      build();
    }, { rootMargin: "200px" });
    // Observed once it's in the page, since it has no position before then.
    queueMicrotask(() => watcher.observe(chart));
  } else {
    build();
  }
  return root;
}
