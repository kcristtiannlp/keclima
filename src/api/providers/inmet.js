/**
 * INMET — estação mais próxima, observação e avisos oficiais (via proxy local).
 * @module api/providers/inmet
 */

import { CACHE_TTL } from '../../config.js';
import { cacheGet, cacheSet } from '../../services/cacheService.js';
import { fetchRetry } from '../../utils/fetchRetry.js';

/**
 * Avisos meteorológicos oficiais INMET (Alert-AS) para o ponto.
 * @param {number} latitude
 * @param {number} longitude
 * @param {AbortSignal} [signal]
 */
export async function fetchInmetAlerts(latitude, longitude, signal) {
  const key = `inmet:alerts:${latitude.toFixed(2)},${longitude.toFixed(2)}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const params = new URLSearchParams({
    lat: String(latitude),
    lon: String(longitude),
  });
  const res = await fetchRetry(`/api/inmet/alerts?${params}`, {
    signal,
    retries: 1,
    timeoutMs: 20000,
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    const err = new Error(`INMET alerts HTTP ${res.status}`);
    err.code = res.status === 404 ? 'inmet_alerts_proxy_missing' : 'inmet_alerts_http';
    throw err;
  }
  const data = await res.json();
  if (data.error) {
    const err = new Error(data.error);
    err.code = data.error;
    throw err;
  }
  const payload = {
    count: data.count ?? (data.alerts || []).length,
    alerts: data.alerts || [],
    source: data.source || 'INMET',
    sourceUrl: data.sourceUrl || 'https://alertas2.inmet.gov.br/',
    disclaimer: data.disclaimer || '',
  };
  cacheSet(key, payload, CACHE_TTL.inmetAlerts || 5 * 60 * 1000);
  return payload;
}

/**
 * @param {number} latitude
 * @param {number} longitude
 * @param {AbortSignal} [signal]
 */
export async function fetchNearestInmet(latitude, longitude, signal) {
  const key = `inmet:near:${latitude.toFixed(2)},${longitude.toFixed(2)}`;
  const cached = cacheGet(key);
  if (cached) {
    return cached;
  }

  const params = new URLSearchParams({
    lat: String(latitude),
    lon: String(longitude),
  });
  const res = await fetchRetry(`/api/inmet/nearest?${params}`, {
    signal,
    retries: 1,
    timeoutMs: 25000,
    headers: { Accept: 'application/json' },
  });

  if (!res.ok) {
    const err = new Error(`INMET HTTP ${res.status}`);
    err.code = 'inmet_http';
    throw err;
  }

  const data = await res.json();
  if (data.error) {
    const err = new Error(data.error);
    err.code = data.error;
    throw err;
  }

  cacheSet(key, data, CACHE_TTL.inmet || 10 * 60 * 1000);
  return data;
}

/**
 * Heurística: área continental BR aproximada.
 * @param {number} lat
 * @param {number} lon
 */
export function isLikelyBrazil(lat, lon) {
  return lat >= -35 && lat <= 6 && lon >= -75 && lon <= -30;
}
