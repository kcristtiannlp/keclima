/**
 * Focos de incêndio unificados: INPE Queimadas + NASA FIRMS.
 * Proxy: /api/fires/hotspots
 * @module api/providers/firms
 */

import { CACHE_TTL } from '../../config.js';
import { cacheGet, cacheSet } from '../../services/cacheService.js';
import { getSettings } from '../../storage/settingsStore.js';
import { fetchRetry } from '../../utils/fetchRetry.js';

/**
 * @typedef {Object} FireHotspot
 * @property {number} latitude
 * @property {number} longitude
 * @property {string|null} [date]
 * @property {string|null} [time]
 * @property {string|null} [confidence]
 * @property {string|null} [satellite]
 * @property {number|null} [frp]
 * @property {number|null} [brightness]
 * @property {string|null} [daynight]
 * @property {string} [provider] firms | inpe | both
 * @property {string[]} [sources]
 * @property {string|null} [municipio]
 * @property {string|null} [estado]
 * @property {string|null} [bioma]
 */

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
export async function fetchFireHotspots(opts) {
  const { west, south, east, north, lat, lon, signal } = opts;
  const settings = getSettings();
  const key = (settings.firmsMapKey || '').trim();
  const days = settings.firmsDayRange || 1;

  const cacheKey = `fires:merged:${west.toFixed(1)},${south.toFixed(1)},${east.toFixed(1)},${north.toFixed(1)}:${key ? 'k' : 'p'}:${days}`;
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
    days: String(days),
  });
  if (key) {
    params.set('key', key);
  }

  // Endpoint unificado INPE + FIRMS (fallback para só FIRMS se o servidor for antigo)
  let url = `/api/fires/hotspots?${params}`;
  let res = await fetchRetry(url, {
    signal,
    retries: 1,
    timeoutMs: 45000,
    headers: { Accept: 'application/json' },
  });

  if (res.status === 404) {
    url = `/api/firms/hotspots?${params}`;
    res = await fetchRetry(url, {
      signal,
      retries: 1,
      timeoutMs: 25000,
      headers: { Accept: 'application/json' },
    });
  }

  if (!res.ok) {
    let detail = '';
    try {
      const errBody = await res.json();
      detail = errBody.error || errBody.detail || '';
    } catch {
      /* ignore */
    }
    const err = new Error(typeof detail === 'string' ? detail : `fires HTTP ${res.status}`);
    err.code = typeof detail === 'string' ? detail : 'fires_http';
    throw err;
  }

  const data = await res.json();
  if (data.error) {
    const err = new Error(data.error);
    err.code = data.error;
    throw err;
  }

  const result = {
    points: data.points || [],
    source: data.source || 'fires',
    count: data.count ?? (data.points || []).length,
    countInpe: data.count_inpe ?? null,
    countFirms: data.count_firms ?? null,
    countBoth: data.count_both ?? null,
    note: data.note || null,
  };
  cacheSet(cacheKey, result, CACHE_TTL.fires || 15 * 60 * 1000);
  return result;
}

/**
 * @param {number} lat
 * @param {number} lon
 * @param {number} [halfSize=4]
 */
export function bboxAround(lat, lon, halfSize = 4) {
  return {
    west: clamp(lon - halfSize, -180, 180),
    south: clamp(lat - halfSize, -90, 90),
    east: clamp(lon + halfSize, -180, 180),
    north: clamp(lat + halfSize, -90, 90),
    lat,
    lon,
  };
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}
