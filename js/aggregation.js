// =====================================================================
// AGGREGATION
// Places readings in waterbodies, splits each waterbody's readings into
// hexagons, and summarises each group. No map code here, so it can be
// tested alone.
//
// The hexagon grid is built in Web Mercator from a fixed origin, so a
// hexagon sits in the same place whatever metric or year is showing.
// The width is a true ground width at the latitude of southern England.
// =====================================================================

const EARTH_RADIUS = 6378137;
const REFERENCE_LATITUDE = 51;
const GROUND_TO_MERCATOR = 1 / Math.cos((REFERENCE_LATITUDE * Math.PI) / 180);

// Waterbodies are shown until this map scale, then hexagons.
export const WATERBODY_MAX_SCALE = 100000;

// One level per zoom step. Widths halve as the map doubles, so hexagons
// stay about the same size on screen.
export const HEXAGON_LEVELS = [
  { widthMetres: 250, minScale: WATERBODY_MAX_SCALE, maxScale: 50000 },
  { widthMetres: 125, minScale: 50000, maxScale: 25000 },
  { widthMetres: 60, minScale: 25000, maxScale: 12500 },
  { widthMetres: 30, minScale: 12500, maxScale: 6250 },
];

// Individual readings take over from here: the 100 m mark on the scale bar.
export const HEXAGON_MAX_SCALE = HEXAGON_LEVELS.at(-1).maxScale;

export function hexagonWidthLabel(widthMetres) {
  return widthMetres >= 1000 ? `${widthMetres / 1000} km` : `${widthMetres} m`;
}

// How far outside a waterbody a reading can be and still count towards it.
export const BESIDE_LIMIT_METRES = 250;

const METRES_PER_DEGREE = 111319.49;

export function toMercator(lon, lat) {
  return [
    (lon * Math.PI * EARTH_RADIUS) / 180,
    Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * EARTH_RADIUS,
  ];
}

export function fromMercator(x, y) {
  return [
    (x * 180) / (Math.PI * EARTH_RADIUS),
    ((2 * Math.atan(Math.exp(y / EARTH_RADIUS)) - Math.PI / 2) * 180) / Math.PI,
  ];
}

export function insideRings(x, y, rings) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

// The closest point on a shape's edges to a location, with its distance.
function nearestEdgePoint(lon, lat, rings) {
  const toMetresX = METRES_PER_DEGREE * Math.cos((lat * Math.PI) / 180);
  let best = { distance: Infinity, lon, lat };
  for (const ring of rings) {
    for (let i = 0; i < ring.length - 1; i++) {
      const ax = (ring[i][0] - lon) * toMetresX;
      const ay = (ring[i][1] - lat) * METRES_PER_DEGREE;
      const dx = (ring[i + 1][0] - lon) * toMetresX - ax;
      const dy = (ring[i + 1][1] - lat) * METRES_PER_DEGREE - ay;
      const along = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
      const x = ax + along * dx;
      const y = ay + along * dy;
      const distance = Math.hypot(x, y);
      if (distance < best.distance) best = { distance, lon: lon + x / toMetresX, lat: lat + y / METRES_PER_DEGREE };
    }
  }
  return best;
}

// Finds a reading's waterbody. A reading just outside every waterbody,
// such as in a tidal river channel, counts towards the nearest one.
// Returns where it was placed, or null if nothing is close enough.
export function waterbodyFinder(waterbodies) {
  const entries = waterbodies.map((waterbody) => {
    const points = waterbody.rings.flat();
    const xs = points.map(([x]) => x);
    const ys = points.map(([, y]) => y);
    return { waterbody, xmin: Math.min(...xs), xmax: Math.max(...xs), ymin: Math.min(...ys), ymax: Math.max(...ys) };
  });

  return (lon, lat) => {
    const within = entries.find((entry) =>
      lon >= entry.xmin && lon <= entry.xmax && lat >= entry.ymin && lat <= entry.ymax &&
      insideRings(lon, lat, entry.waterbody.rings));
    if (within) return { waterbody: within.waterbody, lon, lat, isBeside: false };

    // Bounding boxes keep this to the few shapes that could be in range.
    const padLat = BESIDE_LIMIT_METRES / METRES_PER_DEGREE;
    const padLon = padLat / Math.cos((lat * Math.PI) / 180);
    let closest = null;
    for (const entry of entries) {
      if (lon < entry.xmin - padLon || lon > entry.xmax + padLon || lat < entry.ymin - padLat || lat > entry.ymax + padLat) continue;
      const point = nearestEdgePoint(lon, lat, entry.waterbody.rings);
      if (point.distance <= BESIDE_LIMIT_METRES && (!closest || point.distance < closest.distance)) {
        closest = { ...point, waterbody: entry.waterbody };
      }
    }
    return closest && { waterbody: closest.waterbody, lon: closest.lon, lat: closest.lat, isBeside: true };
  };
}

export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function summarise(rows) {
  const values = rows.map((row) => row.value);
  const years = rows.map((row) => row.year);
  return {
    count: rows.length,
    median: median(values),
    min: Math.min(...values),
    max: Math.max(...values),
    minYear: Math.min(...years),
    maxYear: Math.max(...years),
    hasEstimates: rows.some((row) => row.isEstimate),
    besideCount: rows.filter((row) => row.isBeside).length,
  };
}

function groupBy(rows, keyOf) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
}

// rows: { lon, lat, value, year, isEstimate, isBeside, waterbodyId }
// lon and lat are where the reading was placed in its waterbody.
export function summariseWaterbodies(rows) {
  return [...groupBy(rows, (row) => row.waterbodyId)].map(([waterbodyId, inside]) => ({ waterbodyId, ...summarise(inside) }));
}

function nearestCell(x, y, radius) {
  const q = ((Math.sqrt(3) / 3) * x - y / 3) / radius;
  const r = ((2 / 3) * y) / radius;
  const s = -q - r;
  let cellQ = Math.round(q);
  let cellR = Math.round(r);
  const cellS = Math.round(s);
  const errorQ = Math.abs(cellQ - q);
  const errorR = Math.abs(cellR - r);
  const errorS = Math.abs(cellS - s);
  if (errorQ > errorR && errorQ > errorS) cellQ = -cellR - cellS;
  else if (errorR > errorS) cellR = -cellQ - cellS;
  return [cellQ, cellR];
}

function hexagonRing(q, r, radius) {
  const centreX = radius * Math.sqrt(3) * (q + r / 2);
  const centreY = radius * 1.5 * r;
  const ring = [];
  // Clockwise, as polygon outer rings must be.
  for (let corner = 0; corner < 6; corner++) {
    const angle = Math.PI / 2 - (corner * Math.PI) / 3;
    ring.push([centreX + radius * Math.cos(angle), centreY + radius * Math.sin(angle)]);
  }
  ring.push([...ring[0]]);
  return ring;
}

// True if any waterbody edge passes through the hexagon's bounding box.
// If none does, a hexagon holding a reading lies wholly inside the
// waterbody and needs no cutting, which is the expensive step.
export function hexagonMayCrossBoundary(hexagonRing, waterbodyRings) {
  const xs = hexagonRing.map(([x]) => x);
  const ys = hexagonRing.map(([, y]) => y);
  const xmin = Math.min(...xs);
  const xmax = Math.max(...xs);
  const ymin = Math.min(...ys);
  const ymax = Math.max(...ys);
  for (const ring of waterbodyRings) {
    for (let i = 0; i < ring.length - 1; i++) {
      const [ax, ay] = ring[i];
      const [bx, by] = ring[i + 1];
      if (Math.max(ax, bx) >= xmin && Math.min(ax, bx) <= xmax && Math.max(ay, by) >= ymin && Math.min(ay, by) <= ymax) return true;
    }
  }
  return false;
}

// One entry per hexagon per waterbody: a hexagon crossing a boundary
// gives two separate pieces, so waterbodies are never blended. Rings
// are whole hexagons, in Web Mercator; the caller cuts them to shape.
export function summariseHexagons(rows, widthMetres) {
  const radius = (widthMetres * GROUND_TO_MERCATOR) / Math.sqrt(3);
  const cells = groupBy(rows, (row) => {
    const [x, y] = toMercator(row.lon, row.lat);
    return `${row.waterbodyId}|${nearestCell(x, y, radius).join(",")}`;
  });
  return [...cells].map(([key, inside]) => {
    const [q, r] = key.split("|")[1].split(",").map(Number);
    return { waterbodyId: inside[0].waterbodyId, ring: hexagonRing(q, r, radius), ...summarise(inside) };
  });
}
