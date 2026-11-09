// =====================================================================
// THEME
// Dark/light switching. The inline script in index.html applies a saved
// choice before first paint; this keeps Calcite, the ArcGIS stylesheet
// and anything registered with onThemeChange in step after that.
// =====================================================================

const THEME_STORAGE_KEY = "southernHubTheme"; // also used in index.html
const ARCGIS_THEME_URL = (theme) => `https://js.arcgis.com/5.1/esri/themes/${theme}/main.css`;

const listeners = new Set();

export function getTheme() {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

function setTheme(theme) {
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  root.classList.remove("calcite-mode-dark", "calcite-mode-light");
  root.classList.add(`calcite-mode-${theme}`);
  document.getElementById("arcgisThemeLink").href = ARCGIS_THEME_URL(theme);
  try { localStorage.setItem(THEME_STORAGE_KEY, theme); } catch (e) { /* not remembered, which is fine */ }
  listeners.forEach((listener) => listener(theme));
}

export function onThemeChange(listener) {
  listeners.add(listener);
}

export function initTheme(toggleButton) {
  toggleButton.addEventListener("click", () => setTheme(getTheme() === "dark" ? "light" : "dark"));
}
