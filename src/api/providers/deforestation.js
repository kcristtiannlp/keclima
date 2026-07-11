/**
 * Desmatamento — INPE DETER via proxy TerraBrasilis WFS.
 * @module api/providers/deforestation
 */

import { CACHE_TTL } from '../../config.js';
import { cacheGet, cacheSet } from '../../services/cacheService.js';
import { fetchRetry } from '../../utils/fetchRetry.js';

/**
 * @param {Object} opts
 * @param {number} opts.west
 * @param {number} opts.south
 * @param {number} opts.east
 * @param {number} opts.north
 * @param {number} [opts.lat]
 * @param {number} [opts.lon]
 * @param {AbortSignal} [opts.signal]
 */
export async function fetchDeforestationAlerts(opts) {
  const { west, south, east, north, lat, lon, signal } = opts;
  const cacheKey = `deter:v1:${west.toFixed(2)},${south.toFixed(2)},${east.toFixed(2)},${north.toFixed(2)}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    return cached;
  }

  const params = new URLSearchParams({
    west: String(west),
    south: String(south),
    east: String(east),
    north: String(north),
    lat: String(lat ?? (south + north) / 2),
    lon: String(lon ?? (west + east) / 2),
  });

  const res = await fetchRetry(`/api/deforestation/alerts?${params}`, {
    signal,
    retries: 1,
    timeoutMs: 45000,
    headers: { Accept: 'application/json' },
  });

  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = body.error || '';
    } catch {
      /* ignore */
    }
    const err = new Error(detail || `deforestation HTTP ${res.status}`);
    err.code = detail || 'deforestation_http';
    throw err;
  }

  const data = await res.json();
  if (data.error) {
    const err = new Error(data.error);
    err.code = data.error;
    throw err;
  }

  cacheSet(cacheKey, data, CACHE_TTL.deforestation || 30 * 60 * 1000);
  return data;
}

/**
 * @param {number} lat
 * @param {number} lon
 * @param {number} [half=2.2]
 */
export function bboxAroundPlace(lat, lon, half = 2.2) {
  return {
    west: lon - half,
    south: lat - half,
    east: lon + half,
    north: lat + half,
    lat,
    lon,
  };
}
