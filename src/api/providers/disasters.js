/**
 * Desastres / eventos naturais: USGS (terremotos) + NASA EONET.
 * @module api/providers/disasters
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
 * @param {number} [opts.minmagnitude=2.5]
 * @param {'day'|'week'|'month'} [opts.period='week']
 * @param {AbortSignal} [opts.signal]
 */
export async function fetchEarthquakes(opts) {
  const {
    west,
    south,
    east,
    north,
    minmagnitude = 2.5,
    period = 'week',
    signal,
  } = opts;
  const cacheKey = `eq:v1:${west.toFixed(1)},${south.toFixed(1)},${east.toFixed(1)},${north.toFixed(1)}:${minmagnitude}:${period}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const params = new URLSearchParams({
    west: String(west),
    south: String(south),
    east: String(east),
    north: String(north),
    minmagnitude: String(minmagnitude),
    period,
  });
  const res = await fetchRetry(`/api/earthquakes/live?${params}`, {
    signal,
    retries: 1,
    timeoutMs: 25000,
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    const err = new Error(`earthquakes HTTP ${res.status}`);
    err.code = res.status === 404 ? 'eq_proxy_missing' : 'eq_http';
    throw err;
  }
  const data = await res.json();
  if (data.error) {
    const err = new Error(data.error);
    err.code = data.error;
    throw err;
  }
  const payload = {
    count: data.count ?? (data.events || []).length,
    events: data.events || [],
    source: data.source || 'USGS',
    feed: data.feed,
    period: data.period,
    truncated: !!data.truncated,
  };
  cacheSet(cacheKey, payload, CACHE_TTL.earthquakes || 90 * 1000);
  return payload;
}

/**
 * @param {Object} opts
 * @param {number} opts.west
 * @param {number} opts.south
 * @param {number} opts.east
 * @param {number} opts.north
 * @param {number} [opts.days=30]
 * @param {AbortSignal} [opts.signal]
 */
export async function fetchEonetEvents(opts) {
  const { west, south, east, north, days = 30, signal } = opts;
  const cacheKey = `eonet:v1:${west.toFixed(1)},${south.toFixed(1)},${east.toFixed(1)},${north.toFixed(1)}:${days}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const params = new URLSearchParams({
    west: String(west),
    south: String(south),
    east: String(east),
    north: String(north),
    days: String(days),
    limit: '200',
  });
  const res = await fetchRetry(`/api/eonet/events?${params}`, {
    signal,
    retries: 1,
    timeoutMs: 30000,
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    const err = new Error(`eonet HTTP ${res.status}`);
    err.code = res.status === 404 ? 'eonet_proxy_missing' : 'eonet_http';
    throw err;
  }
  const data = await res.json();
  if (data.error) {
    const err = new Error(data.error);
    err.code = data.error;
    throw err;
  }
  const payload = {
    count: data.count ?? (data.events || []).length,
    events: data.events || [],
    source: data.source || 'NASA EONET',
    days: data.days,
    truncated: !!data.truncated,
  };
  cacheSet(cacheKey, payload, CACHE_TTL.eonet || 180 * 1000);
  return payload;
}
