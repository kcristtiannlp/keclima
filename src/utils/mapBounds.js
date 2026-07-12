/**
 * Utilitários de bbox / grade para camadas do mapa (viewport global).
 * @module utils/mapBounds
 */

/**
 * @typedef {{ west: number, south: number, east: number, north: number }} BBox
 */

/**
 * @param {import('leaflet').Map} map
 * @param {number} [padRatio=0.08]
 * @returns {BBox}
 */
export function getMapBBox(map, padRatio = 0.08) {
  const b = map.getBounds();
  const padLat = Math.max(0.05, (b.getNorth() - b.getSouth()) * padRatio);
  const padLon = Math.max(0.05, (b.getEast() - b.getWest()) * padRatio);
  return {
    west: clamp(b.getWest() - padLon, -180, 180),
    south: clamp(b.getSouth() - padLat, -90, 90),
    east: clamp(b.getEast() + padLon, -180, 180),
    north: clamp(b.getNorth() + padLat, -90, 90),
  };
}

/**
 * Grade de pontos cobrindo o bbox (ou o mundo).
 * @param {BBox} box
 * @param {{ maxPoints?: number }} [opts]
 * @returns {{ latitude: number, longitude: number }[]}
 */
export function sampleGridInBBox(box, opts = {}) {
  const maxPoints = opts.maxPoints ?? 81;
  let { west, south, east, north } = box;
  if (west > east) {
    // antimeridiano: simplifica para world
    west = -180;
    east = 180;
  }
  const latSpan = Math.max(0.2, north - south);
  const lonSpan = Math.max(0.2, east - west);

  // n ≈ sqrt(maxPoints) por eixo, adaptativo
  let n = Math.max(3, Math.min(11, Math.round(Math.sqrt(maxPoints))));
  // zoom regional: densifica
  if (latSpan < 8 && lonSpan < 8) {
    n = Math.min(9, n + 2);
  }
  // mundo: grade grossa
  if (latSpan > 80 || lonSpan > 120) {
    n = Math.min(n, 7);
  }

  const points = [];
  for (let i = 0; i < n; i++) {
    const fi = n === 1 ? 0.5 : i / (n - 1);
    const lat = south + latSpan * fi;
    for (let j = 0; j < n; j++) {
      const fj = n === 1 ? 0.5 : j / (n - 1);
      const lon = west + lonSpan * fj;
      points.push({
        latitude: clamp(lat, -90, 90),
        longitude: clamp(lon, -180, 180),
      });
    }
  }
  return points;
}

/**
 * @param {number} v
 * @param {number} min
 * @param {number} max
 */
function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

/**
 * Chave de cache estável por viewport (zoom + centro).
 * @param {BBox} box
 * @param {number} [precision=1]
 */
export function bboxCacheKey(box, precision = 1) {
  const p = precision;
  return [
    box.west.toFixed(p),
    box.south.toFixed(p),
    box.east.toFixed(p),
    box.north.toFixed(p),
  ].join(',');
}
