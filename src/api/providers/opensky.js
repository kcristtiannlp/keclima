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
export async function fetchLiveFlights(opts) {
  const { west, south, east, north, includeGround = false, signal } = opts;
  const cacheKey = `flights:${west.toFixed(2)},${south.toFixed(2)},${east.toFixed(2)},${north.toFixed(2)}:${includeGround ? 'g' : 'a'}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    return cached;
  }

  const params = new URLSearchParams({
    west: String(west),
    south: String(south),
    east: String(east),
    north: String(north),
  });
  if (includeGround) {
    params.set('ground', '1');
  }

  const res = await fetchRetry(`/api/flights/live?${params}`, {
    signal,
    retries: 1,
    timeoutMs: 20000,
    headers: { Accept: 'application/json' },
  });

  if (!res.ok) {
    let body = null;
    try {
      body = await res.json();
    } catch {
      /* ignore */
    }
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

  const data = await res.json();
  if (data.error) {
    const err = new Error(data.error);
    err.code = data.error;
    throw err;
  }

  const payload = {
    time: data.time ?? null,
    count: data.count ?? (data.flights || []).length,
    flights: data.flights || [],
    source: data.source || 'OpenSky Network',
  };
  cacheSet(cacheKey, payload, CACHE_TTL.flights || 10 * 1000);
  return payload;
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
