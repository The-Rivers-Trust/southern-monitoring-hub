// =====================================================================
// STORM OVERFLOWS
// The two storm overflow layers in the Map Explorer's web map, restyled
// to match the NRS and AQuA dashboards (the code is theirs, kept in step):
//
//   Storm Overflows - Southern Water's live feed. An emoji for each
//     outfall: discharging now, discharged in the last 48 hours, not, or
//     offline. The two that need attention draw larger and on top. The
//     pop-up shows the latest discharge, its duration (ticking while it is
//     still going) and when the data was last updated.
//   Event Duration Monitoring - the 2025 annual returns, one point per
//     outfall sized by its spill count. The pop-up shows the spills, their
//     total duration and the outfall's details.
//
// The layers come from the web map, so this replaces their symbols,
// ordering and pop-ups, and leaves the rest as they are. The pop-up styles
// are in css/storm-popup.css, loaded into each pop-up, since pop-ups draw
// inside the map's shadow DOM where page styles don't reach.
// =====================================================================

import { escapeHtml, sqlTimestamp } from "../scorecards/format.js";

const LIVE_URL = /SouthernWater_StormOverflowActivity/;
const EDM_URL = /Event_Duration_Monitoring/;

const LIVE = {
  title: "Storm Overflows",
  refreshMinutes: 5,
  recentHours: 48,
  fields: {
    id: "Id",
    company: "Company",
    status: "Status",
    statusStart: "StatusStart",
    latestEventStart: "LatestEventStart",
    latestEventEnd: "LatestEventEnd",
    receivingWaterCourse: "ReceivingWaterCourse",
    lastUpdated: "LastUpdated",
  },
  // Emoji rather than dots so outfalls never read as survey sites. The
  // two states that need attention draw larger and on top.
  categories: [
    { key: "spilling", label: "Currently discharging", headline: "Discharging Now", glyph: "\u{1F4A9}", size: 20, priority: 3 },
    { key: "recent", label: "Discharged in last 48 hours", headline: "Discharged in last 48 hours", glyph: "⚠️", size: 20, priority: 2 },
    { key: "notspilling", label: "Not discharged in last 48 hours", headline: "Not discharged in last 48 hours", glyph: "✅", size: 8, priority: 0 },
    { key: "offline", label: "Offline", headline: "Offline", glyph: "❓", size: 8, priority: 1 },
  ],
};

const EDM = {
  color: [99, 79, 63, 190],
  // Spill counts: [highest count in the class, label, symbol size].
  classes: [
    [0, "No spills", 4],
    [19, "1 - 19 spills", 7],
    [39, "20 - 39 spills", 10],
    [59, "40 - 59 spills", 13],
    [99, "60 - 99 spills", 16],
    [366, "100 or more spills", 19],
  ],
  fields: [
    "OBJECTID", "waterCompanyName", "siteNameEA", "siteNameWASC", "permitReferenceEA", "assetType",
    "recievingWaterName", "wfdWaterbodyName", "countedSpills", "totalDurationAllSpillsHrs",
    "longTermAverageSpillCount", "edmOperationPercent", "edmCommissionYear", "treatmentType",
  ],
};

const POPUP_STYLESHEET = `<link rel="stylesheet" href="css/storm-popup.css" />`;
const categoryByKey = Object.fromEntries(LIVE.categories.map((category) => [category.key, category]));

// A number with a fixed number of decimals, "-" for none.
function formatNumber(value, decimals = 0) {
  if (value == null || Number.isNaN(Number(value))) return "–";
  return new Intl.NumberFormat("en-GB", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
}

// ---------------------------------------------------------------------
// Live storm overflows
// Status: 1 = discharging, 0 = not, empty = offline. "Recent" = stopped
// within the last recentHours.
// ---------------------------------------------------------------------

// Nested ifs rather than IIf(): Arcade evaluates both IIf branches, and
// DateDiff on an empty date throws.
function categoryArcade(fields) {
  return `
    var status = $feature.${fields.status};
    var latestEnd = $feature.${fields.latestEventEnd};
    var category = "offline";
    if (!IsEmpty(status)) {
      if (status == 1) {
        category = "spilling";
      } else if (status == 0) {
        category = "notspilling";
        if (!IsEmpty(latestEnd)) {
          var hours = DateDiff(Now(), latestEnd, "hours");
          if (hours >= 0 && hours <= ${LIVE.recentHours}) { category = "recent"; }
        }
      }
    }`;
}

// Same rules in JS, for the pop-up.
function categoryOf(attributes, fields) {
  const status = attributes[fields.status];
  const latestEnd = attributes[fields.latestEventEnd];
  if (status === 1) return "spilling";
  if (status !== 0) return "offline";
  if (latestEnd != null) {
    const hours = (Date.now() - latestEnd) / 3600000;
    if (hours >= 0 && hours <= LIVE.recentHours) return "recent";
  }
  return "notspilling";
}

// A text symbol doesn't draw through the WebGL point pipeline, so each
// emoji is rasterised as a tiny SVG picture marker.
function glyphSymbol(glyph, size) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><text x="16" y="23" font-size="24" `
    + `font-family="Arial, &apos;Segoe UI Emoji&apos;, &apos;Noto Color Emoji&apos;, sans-serif" text-anchor="middle">${glyph}</text></svg>`;
  return { type: "picture-marker", url: `data:image/svg+xml,${encodeURIComponent(svg)}`, width: size, height: size };
}

function liveRenderer(fields) {
  return {
    type: "unique-value",
    valueExpression: `${categoryArcade(fields)}\n    return category;`,
    valueExpressionTitle: "Storm overflow status",
    uniqueValueInfos: LIVE.categories.map((category) => ({ value: category.key, label: category.label, symbol: glyphSymbol(category.glyph, category.size) })),
    defaultSymbol: glyphSymbol(categoryByKey.offline.glyph, categoryByKey.offline.size),
    defaultLabel: "Unknown",
  };
}

// Which icon wins where outfalls overlap: highest priority drawn on top.
function priorityArcade(fields) {
  const cases = LIVE.categories.map((category) => `if (category == "${category.key}") { return ${category.priority}; }`).join("\n    ");
  return `${categoryArcade(fields)}\n    ${cases}\n    return 0;`;
}

// "Discharging / recent only" as SQL. The cutoff is a literal timestamp, so
// it's re-applied every refreshMinutes.
function recentFilterSql(fields) {
  const cutoff = sqlTimestamp(Date.now() - LIVE.recentHours * 3600000);
  return `${fields.status} = 1 OR (${fields.status} = 0 AND ${fields.latestEventEnd} >= TIMESTAMP '${cutoff}')`;
}

function formatTime(ms) {
  if (ms == null) return null;
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).replace(/AM|PM/i, (m) => m.toLowerCase());
}

function formatDateTime(ms) {
  if (ms == null) return null;
  const date = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${formatTime(ms)}`;
}

function completedDuration(startMs, endMs) {
  if (!startMs || !endMs) return null;
  const minutes = Math.max(0, Math.round((endMs - startMs) / 60000));
  if (minutes < 60) return `${String(minutes).padStart(2, "0")} mins`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${String(rest).padStart(2, "0")}m`;
}

function liveDuration(startMs) {
  const total = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const parts = [];
  if (hours > 0) parts.push(`${hours} ${hours === 1 ? "hour" : "hours"}`);
  parts.push(`${minutes} ${minutes === 1 ? "min" : "mins"}`);
  parts.push(`${String(total % 60).padStart(2, "0")} secs`);
  return parts.join(" ");
}

function dateBadge(ms) {
  if (ms == null) return "";
  const date = new Date(ms);
  return `<div class="stormDateBadge">
      <span>${date.toLocaleDateString([], { month: "short" })}</span>
      <span class="stormDateBadgeDay">${date.getDate()}</span>
      <span>${date.getFullYear()}</span>
    </div>`;
}

// Built as an element so an ongoing discharge's duration can tick every
// second; the timer stops itself once the pop-up content is removed.
function livePopupContent(attributes, fields) {
  const category = categoryOf(attributes, fields);
  const info = categoryByKey[category];
  const startMs = attributes[fields.latestEventStart];
  const endMs = attributes[fields.latestEventEnd];
  const updatedMs = attributes[fields.lastUpdated];
  const id = attributes[fields.id];
  const watercourse = attributes[fields.receivingWaterCourse];

  let details;
  if (category === "spilling") {
    details = `
      <div class="stormTime"><span class="stormTimeLabel">Started</span><span class="stormTimeValue">${escapeHtml(formatDateTime(startMs) ?? "–")}</span></div>
      <div class="stormDuration">Duration: <span data-live-duration>${startMs ? liveDuration(startMs) : "–"}</span></div>`;
  } else if (category === "recent") {
    const duration = completedDuration(startMs, endMs);
    details = `
      <div class="stormTimes">
        <div class="stormTime"><span class="stormTimeLabel">Started</span><span class="stormTimeValue">${escapeHtml(formatTime(startMs) ?? "–")}</span></div>
        <div class="stormTime"><span class="stormTimeLabel">Ended</span><span class="stormTimeValue">${escapeHtml(formatTime(endMs) ?? "–")}</span></div>
      </div>
      ${duration ? `<div class="stormDuration">Duration: ${duration}</div>` : ""}`;
  } else {
    details = `<div class="stormNoActivity">No discharge currently recorded for this outfall.</div>`;
  }

  const element = document.createElement("div");
  element.className = "stormPopup";
  element.innerHTML = `${POPUP_STYLESHEET}
    ${id ? `<div class="stormId">${escapeHtml(id)}</div>` : ""}
    ${watercourse ? `<div class="stormFeeds">Feeds into: <strong>${escapeHtml(watercourse)}</strong></div>` : ""}
    <div class="stormCard stormCard--${category}">
      ${dateBadge(category === "notspilling" || category === "offline" ? updatedMs : startMs ?? updatedMs)}
      <div class="stormDetails">
        <div class="stormHeadlineRow">
          <span class="stormHeadline">${escapeHtml(info.headline)} ${info.glyph}</span>
          ${category === "spilling" ? `<span class="stormActivePill">Active</span>` : ""}
        </div>
        ${details}
      </div>
    </div>
    ${updatedMs ? `<div class="stormUpdated">Data last updated ${new Date(updatedMs).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</div>` : ""}`;

  if (category === "spilling" && startMs) {
    const live = element.querySelector("[data-live-duration]");
    let ticks = 0;
    let seen = false;
    const timer = setInterval(() => {
      ticks++;
      if (element.isConnected) seen = true;
      else if (seen || ticks > 10) return clearInterval(timer); // closed, or never shown
      live.textContent = liveDuration(startMs);
    }, 1000);
  }
  return element;
}

// Restyles the live layer. Returns { setRecentOnly(on) } for the layer
// list's "only discharging or in the last 48 hours" option.
function styleLive(layer) {
  const { fields } = LIVE;
  const outFields = Object.values(fields);
  const original = layer.definitionExpression;
  layer.minScale = 0; // every outfall at every zoom
  layer.maxScale = 0;
  layer.outFields = outFields;
  layer.refreshInterval = LIVE.refreshMinutes;
  layer.renderer = liveRenderer(fields);
  layer.orderBy = [{ valueExpression: priorityArcade(fields), order: "descending" }];
  layer.popupEnabled = true;
  layer.popupTemplate = {
    title: (event) => event.graphic.attributes[fields.company] || LIVE.title,
    outFields,
    content: (event) => livePopupContent(event.graphic.attributes, fields),
  };

  let timer = null;
  const apply = (on) => { layer.definitionExpression = on ? recentFilterSql(fields) : original; };
  return {
    setRecentOnly(on) {
      apply(on);
      clearInterval(timer);
      timer = on ? setInterval(() => apply(true), LIVE.refreshMinutes * 60000) : null;
    },
  };
}

// ---------------------------------------------------------------------
// Event Duration Monitoring 2025
// ---------------------------------------------------------------------

function edmSymbol(size) {
  return { type: "simple-marker", style: "circle", size, color: EDM.color, outline: { color: [255, 255, 255, 230], width: 0.75 } };
}

function edmRenderer() {
  return {
    type: "class-breaks",
    field: "countedSpills",
    classBreakInfos: EDM.classes.map(([max, label, size], index) => ({
      minValue: index === 0 ? 0 : EDM.classes[index - 1][0] + 0.0001,
      maxValue: max,
      label,
      symbol: edmSymbol(size),
    })),
    defaultSymbol: { ...edmSymbol(4), color: [156, 156, 156, 170] },
    defaultLabel: "Not reported",
  };
}

function edmPopupContent(a) {
  const stats = [
    [a.countedSpills == null ? "–" : formatNumber(a.countedSpills), "Spills in 2025"],
    [a.totalDurationAllSpillsHrs == null ? "–" : `${formatNumber(a.totalDurationAllSpillsHrs, 1)} h`, "Total spill duration"],
    [a.longTermAverageSpillCount == null ? "–" : formatNumber(a.longTermAverageSpillCount, 1), "Long-term average spills"],
  ];
  const details = [
    ["Water company", a.waterCompanyName],
    ["Receiving water", a.recievingWaterName],
    ["WFD waterbody", a.wfdWaterbodyName],
    ["Asset type", a.assetType],
    ["Treatment type", a.treatmentType],
    ["EA permit reference", a.permitReferenceEA],
    ["Monitor operating", a.edmOperationPercent == null ? null : `${formatNumber(a.edmOperationPercent, 1)}% of the year`],
    ["Monitor installed", a.edmCommissionYear],
  ].filter(([, value]) => value != null && value !== "");

  const element = document.createElement("div");
  element.className = "edmPopup";
  element.innerHTML = `${POPUP_STYLESHEET}
    ${a.siteNameWASC && a.siteNameWASC !== a.siteNameEA ? `<div class="stormId">${escapeHtml(a.siteNameWASC)}</div>` : ""}
    <div class="riverStats">
      ${stats.map(([value, label]) => `
        <div class="riverStat">
          <span class="riverStatValue">${escapeHtml(value)}</span>
          <span class="riverStatLabel">${escapeHtml(label)}</span>
        </div>`).join("")}
    </div>
    <dl class="edmFacts">
      ${details.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}
    </dl>
    <div class="stormUpdated">Event Duration Monitoring 2025 annual return</div>`;
  return element;
}

function styleEdm(layer) {
  layer.minScale = 0;
  layer.maxScale = 0;
  layer.outFields = EDM.fields;
  layer.renderer = edmRenderer();
  // Biggest on the bottom so a busy outfall doesn't hide its neighbours.
  layer.orderBy = [{ field: "countedSpills", order: "ascending" }];
  layer.popupEnabled = true;
  layer.popupTemplate = {
    title: (event) => event.graphic.attributes.siteNameEA || event.graphic.attributes.siteNameWASC || "Event Duration Monitoring",
    outFields: EDM.fields,
    content: (event) => edmPopupContent(event.graphic.attributes),
  };
}

// Finds the two layers in the web map and restyles them. Returns
// { liveLayer, live }: the live layer and its "recent only" control, each
// null if the web map doesn't hold it.
export function styleStormOverflows(map) {
  const find = (pattern) => map.allLayers.find((layer) => pattern.test(layer.url ?? ""));
  const liveLayer = find(LIVE_URL);
  const edmLayer = find(EDM_URL);
  if (edmLayer) styleEdm(edmLayer);
  return { liveLayer: liveLayer ?? null, live: liveLayer ? styleLive(liveLayer) : null };
}
