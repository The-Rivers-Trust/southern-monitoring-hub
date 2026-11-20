// =====================================================================
// PDF LAYOUT
// The sizes the Catchment Health report's first row is built from, in mm.
// The wheel and the map sit side by side at the same height; the map picture
// is cut to its slot (scorecards-tab.js), so both files read the shape
// from here.
// =====================================================================

import { WHEEL_IMAGE_ASPECT } from "./charts/wheels.js";

export const PAGE = { width: 210, height: 297, margin: 18 };
export const CONTENT_W = PAGE.width - PAGE.margin * 2;

export const WHEEL_W = 76;
export const MAP_GAP = 6;
export const MAP_W = CONTENT_W - WHEEL_W - MAP_GAP;
export const ROW_H = WHEEL_W * WHEEL_IMAGE_ASPECT;

// Map slot, height over width.
export const MAP_ASPECT = ROW_H / MAP_W;
