/**
 * Tráfego aéreo ao vivo (OpenSky) + detalhes (tipo/rota via proxy).
 * Proxies: /api/flights/live | /api/flights/aircraft | /api/flights/route
 * @module api/providers/opensky
 */

import { CACHE_TTL } from '../../config.js';
import { cacheGet, cacheSet } from '../../services/cacheService.js';
import { fetchRetry } from '../../utils/fetchRetry.js';

/**
 * @typedef {Object} FlightState
 * @property {string} icao24
 * @property {string|null} callsign
 * @property {string|null} originCountry
 * @property {number} latitude
 * @property {number} longitude
 * @property {number|null} altitudeM
 * @property {number|null} geoAltitudeM
 * @property {boolean} onGround
 * @property {number|null} velocityMs
 * @property {number|null} trackDeg
 * @property {number|null} verticalRateMs
 * @property {string|null} squawk
 */

/**
 * @param {Object} opts
 * @param {number} opts.west
 * @param {number} opts.south
 * @param {number} opts.east
 * @param {number} opts.north
 * @param {boolean} [opts.includeGround=false]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{ time: number|null, count: number, flights: FlightState[], source: string }>}
 */
/**
 * @param {Object} box
 * @param {boolean} includeGround
 * @param {boolean} global
 * @param {AbortSignal} [signal]
 */
async function requestFlights(box, includeGround, global, signal) {
  const params = new URLSearchParams({
    west: String(box.west),
    south: String(box.south),
    east: String(box.east),
    north: String(box.north),
  });
  if (includeGround) {
    params.set('ground', '1');
  }
  if (global) {
    params.set('global', '1');
  }

  const res = await fetchRetry(`/api/flights/live?${params}`, {
    signal,
    retries: global ? 0 : 1,
    timeoutMs: global ? 45000 : 28000,
    headers: { Accept: 'application/json' },
  });

  let body = null;
  try {
    body = await res.json();
  } catch {
    /* ignore */
  }

  if (!res.ok) {
    const code =
      res.status === 404
        ? 'flights_proxy_missing'
        : res.status === 429 || body?.error === 'rate_limited'
          ? 'rate_limited'
          : body?.error || 'flights_http';
    const err = new Error(body?.detail || body?.error || `flights HTTP ${res.status}`);
    err.code = code;
    throw err;
  }
  if (body?.error) {
    const err = new Error(body.error);
    err.code = body.error;
    throw err;
  }
  return body;
}

export async function fetchLiveFlights(opts) {
  let { west, south, east, north, includeGround = false, signal } = opts;
  // normaliza
  if (west > east) {
    const t = west;
    west = east;
    east = t;
  }
  if (south > north) {
    const t = south;
    south = north;
    north = t;
  }
  // includeGround default true (mais aviões; solo com estilo diferente no mapa)
  if (opts.includeGround === undefined) {
    includeGround = true;
  }
  const latSpan = Math.abs(north - south);
  const lonSpan = Math.abs(east - west);
  // Preferir bbox da OpenSky (completo na área). Global só em zoom planeta.
  let global = latSpan >= 120 || lonSpan >= 160;
  const cacheKey = `flights:v4:${west.toFixed(1)},${south.toFixed(1)},${east.toFixed(1)},${north.toFixed(1)}:${includeGround ? 'g' : 'a'}:${global ? 'G' : 'b'}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    return cached;
  }

  const box = { west, south, east, north };

  try {
    const data = await requestFlights(box, includeGround, global, signal);
    const payload = {
      time: data.time ?? null,
      count: data.count ?? (data.flights || []).length,
      flights: data.flights || [],
      source: data.source || 'OpenSky Network',
      scope: data.scope || (global ? 'global' : 'bbox'),
      truncated: !!data.truncated,
    };
    cacheSet(cacheKey, payload, CACHE_TTL.flights || 10 * 1000);
    return payload;
  } catch (err) {
    if (err?.code === 'flights_proxy_missing' || err?.code === 'rate_limited') {
      throw err;
    }
    // Fallback: global falhou → bbox no centro ampliado
    if (global && err?.name !== 'AbortError') {
      const clat = (south + north) / 2;
      const clon = (west + east) / 2;
      const halfLat = Math.min(40, Math.max(15, latSpan / 2));
      const halfLon = Math.min(40, Math.max(15, lonSpan / 2));
      const regional = {
        west: clon - halfLon,
        south: Math.max(-90, clat - halfLat),
        east: clon + halfLon,
        north: Math.min(90, clat + halfLat),
      };
      try {
        const data = await requestFlights(regional, includeGround, false, signal);
        const payload = {
          time: data.time ?? null,
          count: data.count ?? (data.flights || []).length,
          flights: data.flights || [],
          source: data.source || 'OpenSky Network',
          scope: 'bbox_fallback',
          truncated: !!data.truncated,
        };
        cacheSet(cacheKey, payload, CACHE_TTL.flights || 10 * 1000);
        return payload;
      } catch (err2) {
        if (err2?.name === 'AbortError') throw err2;
        throw err2;
      }
    }
    if (String(err?.message || '').includes('Failed') || err?.message === 'timeout') {
      const e = new Error(err.message);
      e.code = err.message === 'timeout' ? 'timeout' : 'flights_proxy_missing';
      throw e;
    }
    throw err;
  }
}

/**
 * Tipo, matrícula, operador (por ICAO24 / Mode S).
 * @param {string} icao24
 * @param {AbortSignal} [signal]
 */
export async function fetchAircraftDetails(icao24, signal) {
  const hex = String(icao24 || '')
    .trim()
    .toLowerCase()
    .replace(/[^0-9a-f]/g, '');
  if (hex.length < 6) {
    return null;
  }
  const cacheKey = `ac:${hex}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    return cached;
  }
  const res = await fetchRetry(`/api/flights/aircraft?icao24=${encodeURIComponent(hex)}`, {
    signal,
    retries: 1,
    timeoutMs: 12000,
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    return null;
  }
  const data = await res.json();
  if (data.error || !data.aircraft) {
    return null;
  }
  cacheSet(cacheKey, data.aircraft, CACHE_TTL.flightMeta || 24 * 60 * 60 * 1000);
  return data.aircraft;
}

/**
 * Rota / origem–destino pelo callsign.
 * @param {string} callsign
 * @param {AbortSignal} [signal]
 */
export async function fetchFlightRoute(callsign, signal) {
  const cs = String(callsign || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
  if (cs.length < 3) {
    return null;
  }
  const cacheKey = `route:${cs}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    return cached;
  }
  const res = await fetchRetry(`/api/flights/route?callsign=${encodeURIComponent(cs)}`, {
    signal,
    retries: 1,
    timeoutMs: 12000,
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    return null;
  }
  const data = await res.json();
  if (data.error || !data.route) {
    return null;
  }
  cacheSet(cacheKey, data.route, CACHE_TTL.flightMeta || 24 * 60 * 60 * 1000);
  return data.route;
}
