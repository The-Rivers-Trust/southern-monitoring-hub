// =====================================================================
// FORMAT
// Small display helpers shared across tabs.
// =====================================================================

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Escapes a value for a single-quoted SQL string literal (where clauses).
export function escapeSql(value) {
  return String(value).replace(/'/g, "''");
}

// Stat boxes and survey cards: one decimal place, "-" for no value.
export function formatNumber(value) {
  return value == null ? "-" : Number(value).toFixed(1);
}

// Chart ticks and labels: up to two decimal places, no trailing zeros.
export function formatTickValue(value) {
  return (Math.round(value * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function formatDateShort(ms) {
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatDateLong(ms) {
  return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

// Free-text form values come back lowercase ("clear", "steady").
export function capitalize(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

export function hexToRgbArray(hex, alpha = 1) {
  const clean = hex.replace("#", "");
  return [
    parseInt(clean.substring(0, 2), 16),
    parseInt(clean.substring(2, 4), 16),
    parseInt(clean.substring(4, 6), 16),
    alpha,
  ];
}

export function hexToRgba(hex, alpha) {
  const [r, g, b] = hexToRgbArray(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ms -> "YYYY-MM-DD HH:MM:SS" (UTC), for a SQL TIMESTAMP '...' literal.
export function sqlTimestamp(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}
