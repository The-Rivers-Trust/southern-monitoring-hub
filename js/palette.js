// =====================================================================
// PALETTE
// The five threshold bands, named and coloured as on the National River
// Survey dashboard. Each metric's own thresholds are in the catalogue.
// =====================================================================

export const BANDS = [
  { label: "Low", colour: "#0072b0" },
  { label: "Slightly Elevated", colour: "#56d5e8" },
  { label: "Elevated", colour: "#e6b800" },
  { label: "High", colour: "#f08c00" },
  { label: "Very High", colour: "#d63129" },
];

export const BAND_COLOURS = BANDS.map((band) => band.colour);

export const NEUTRAL = "#898781";
export const markerRing = (theme) => (theme === "light" ? "#fcfcfb" : "#1a1a19");
