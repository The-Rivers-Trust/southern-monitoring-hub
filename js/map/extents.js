// Map extents for the whole clip area, or one partnership within it.
const WGS84 = { wkid: 4326 };

export function areaExtent(area) {
  return { ...area.extent, type: "extent", spatialReference: WGS84 };
}

export function partnershipExtent(area, name) {
  const points = area.partnerships.find((partnership) => partnership.name === name).rings.flat();
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return {
    type: "extent",
    xmin: Math.min(...xs),
    ymin: Math.min(...ys),
    xmax: Math.max(...xs),
    ymax: Math.max(...ys),
    spatialReference: WGS84,
  };
}
