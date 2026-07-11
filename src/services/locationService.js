/**
 * Serviço de localização e geocoding.
 * @module services/locationService
 */

import { CACHE_TTL, DEFAULT_LOCATION, STORAGE_KEYS } from '../config.js';
import { searchPlaces, reverseGeocode } from '../api/providers/nominatim.js';
import { cacheGet, cacheSet } from './cacheService.js';
import { getSettings } from '../storage/settingsStore.js';
import { getItem, setItem } from '../storage/Storage.js';

/**
 * @param {string} query
 * @param {AbortSignal} [signal]
 */
export async function searchCities(query, signal) {
  const key = `geo:search:v3:${query.trim().toLowerCase()}`;
  const cached = cacheGet(key);
  if (cached) {
    return cached;
  }
  const results = await searchPlaces(query, signal);
  cacheSet(key, results, CACHE_TTL.geocode);
  return results;
}

/**
 * @param {number} latitude
 * @param {number} longitude
 * @param {AbortSignal} [signal]
 */
export async function resolvePlace(latitude, longitude, signal) {
  const key = `geo:rev:v3:${latitude.toFixed(4)},${longitude.toFixed(4)}`;
  const cached = cacheGet(key);
  if (cached) {
    return {
      ...cached,
      // sempre mantém o ponto do GPS/dispositivo
      latitude,
      longitude,
    };
  }
  try {
    const place = await reverseGeocode(latitude, longitude, signal);
    const resolved = {
      ...place,
      latitude,
      longitude,
    };
    cacheSet(key, resolved, CACHE_TTL.reverse);
    return resolved;
  } catch {
    return {
      name: `${latitude.toFixed(2)}, ${longitude.toFixed(2)}`,
      country: '',
      latitude,
      longitude,
      displayName: `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
    };
  }
}

/**
 * Obtém posição do navegador (GPS quando possível).
 * @returns {Promise<{latitude: number, longitude: number, accuracy?: number}>}
 */
export function getBrowserPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation unavailable'));
      return;
    }

    const onOk = (pos) => {
      resolve({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      });
    };

    // 1ª tentativa: alta precisão (GPS)
    navigator.geolocation.getCurrentPosition(onOk, () => {
      // 2ª: rede (pode cair em cidade grande / ISP)
      navigator.geolocation.getCurrentPosition(onOk, (err2) => reject(err2), {
        enableHighAccuracy: false,
        timeout: 12000,
        maximumAge: 0,
      });
    }, {
      enableHighAccuracy: true,
      timeout: 20000,
      maximumAge: 0,
    });
  });
}

/**
 * Precisão ruim o suficiente para desconfiar do nome (metros).
 * > 3 km costuma ser IP/rede, não GPS de rua.
 */
export const COARSE_ACCURACY_M = 3000;

/**
 * @param {number|undefined} accuracy
 */
export function isCoarseAccuracy(accuracy) {
  return accuracy == null || Number.isNaN(accuracy) || accuracy > COARSE_ACCURACY_M;
}

/**
 * Localização inicial: última usada → cidade padrão → default.
 * @returns {import('../core/State.js').AppLocation}
 */
export function getInitialLocation() {
  const last = getItem(STORAGE_KEYS.lastLocation, null);
  if (last?.latitude && last?.longitude) {
    return last;
  }
  const settings = getSettings();
  if (settings.defaultCity?.latitude) {
    return settings.defaultCity;
  }
  return { ...DEFAULT_LOCATION };
}

/**
 * @param {import('../core/State.js').AppLocation} location
 */
export function persistLocation(location) {
  setItem(STORAGE_KEYS.lastLocation, location);
}
