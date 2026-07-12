/**
 * Navios / embarcações AIS (Digitraffic + AISStream opcional) + ISS.
 * @module api/providers/ships
 */

import { CACHE_TTL } from '../../config.js';
import { cacheGet, cacheSet } from '../../services/cacheService.js';
import { getSettings } from '../../storage/settingsStore.js';
import { fetchRetry } from '../../utils/fetchRetry.js';

/**
 * @param {Object} opts
 * @param {number} opts.west
 * @param {number} opts.south
 * @param {number} opts.east
 * @param {number} opts.north
 * @param {AbortSignal} [opts.signal]
 */
export async function fetchLiveShips(opts) {
  const { west, south, east, north, signal } = opts;
  const key = (getSettings().aisStreamKey || '').trim();
  const cacheKey = `ships:v2:${west.toFixed(1)},${south.toFixed(1)},${east.toFixed(1)},${north.toFixed(1)}:${key ? 'k' : 'p'}`;
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
  if (key) {
    params.set('key', key);
  }

  const res = await fetchRetry(`/api/ships/live?${params}`, {
    signal,
    retries: 1,
    timeoutMs: key ? 20000 : 35000,
    headers: { Accept: 'application/json' },
  });

  if (!res.ok) {
    let body = null;
    try {
      body = await res.json();
    } catch {
      /* ignore */
    }
    const err = new Error(body?.detail || body?.error || `ships HTTP ${res.status}`);
    err.code =
      res.status === 404
        ? 'ships_proxy_missing'
        : body?.error || 'ships_http';
    throw err;
  }

  const data = await res.json();
  if (data.error) {
    const err = new Error(data.error);
    err.code = data.error;
    throw err;
  }

  const payload = {
    count: data.count ?? (data.ships || []).length,
    ships: data.ships || [],
    source: data.source || 'AIS',
    coverage: data.coverage || '',
    coverageNote: data.coverageNote || '',
    truncated: !!data.truncated,
    needsKey: !!data.needsKey,
    region: data.region || '',
    aisstream: data.aisstream || null,
    digitraffic: data.digitraffic || null,
  };
  // Stream ao vivo: cache bem curto; sem chave e fora da Europa (vazio) — evita martelar
  let ttl = CACHE_TTL.ships || 30 * 1000;
  if (key) {
    ttl = payload.count > 0 ? 6 * 1000 : 3 * 1000;
  } else if (payload.needsKey) {
    ttl = 45 * 1000;
  }
  cacheSet(cacheKey, payload, ttl);
  return payload;
}

/**
 * Posição atual da ISS (gratuita).
 * @param {AbortSignal} [signal]
 */
export async function fetchIssPosition(signal) {
  const cacheKey = 'iss:now';
  const cached = cacheGet(cacheKey);
  if (cached) {
    return cached;
  }
  const res = await fetchRetry('/api/iss/now', {
    signal,
    retries: 1,
    timeoutMs: 15000,
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    const err = new Error(`iss HTTP ${res.status}`);
    err.code = 'iss_http';
    throw err;
  }
  const data = await res.json();
  if (data.error) {
    const err = new Error(data.error);
    err.code = data.error;
    throw err;
  }
  cacheSet(cacheKey, data, 8 * 1000);
  return data;
}
