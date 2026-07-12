/**
 * Satélite infravermelho GOES (NOAA) — estilo Climatempo.
 * @module api/providers/satellite
 */

import { CACHE_TTL } from '../../config.js';
import { cacheGet, cacheSet } from '../../services/cacheService.js';
import { fetchRetry } from '../../utils/fetchRetry.js';

/**
 * @param {Object} [opts]
 * @param {'ssa'|'fd'|'taw'} [opts.sector='ssa']
 * @param {string} [opts.size='900x540']
 * @param {number} [opts.limit=36]
 * @param {AbortSignal} [opts.signal]
 */
export async function fetchGoesInfrared(opts = {}) {
  const sector = opts.sector || 'ssa';
  const size = opts.size || '900x540';
  const limit = opts.limit ?? 36;
  const cacheKey = `goes:ir:${sector}:${size}:${limit}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const params = new URLSearchParams({
    sector,
    size,
    limit: String(limit),
  });
  const res = await fetchRetry(`/api/satellite/goes?${params}`, {
    signal: opts.signal,
    retries: 1,
    timeoutMs: 30000,
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    const err = new Error(`satellite HTTP ${res.status}`);
    err.code = res.status === 404 ? 'sat_proxy_missing' : 'sat_http';
    throw err;
  }
  const data = await res.json();
  if (data.error) {
    const err = new Error(data.error);
    err.code = data.error;
    throw err;
  }
  const payload = {
    count: data.count ?? (data.frames || []).length,
    frames: data.frames || [],
    latest: data.latest,
    latestFull: data.latestFull,
    loopGif: data.loopGif,
    sector: data.sector,
    sectorLabel: data.sectorLabel,
    satellite: data.satellite,
    band: data.band,
    bandName: data.bandName,
    source: data.source || 'NOAA',
    sourceUrl: data.sourceUrl,
    attribution: data.attribution,
    note: data.note,
  };
  cacheSet(cacheKey, payload, CACHE_TTL.satellite || 90 * 1000);
  return payload;
}
