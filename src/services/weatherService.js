/**
 * Orquestra forecast + air quality + histórico + compare + archive.
 * @module services/weatherService
 */

import { CACHE_TTL, STORAGE_KEYS } from '../config.js';
import { fetchForecast, fetchArchiveDaily } from '../api/providers/openMeteo.js';
import { fetchAirQuality } from '../api/providers/airQuality.js';
import { fetchInmetAlerts } from '../api/providers/inmet.js';
import { cacheGet, cacheSet } from './cacheService.js';
import { setState, getState } from '../core/State.js';
import { persistLocation } from './locationService.js';
import { addHistoryEntry } from '../storage/historyStore.js';
import { setItem, getItem } from '../storage/Storage.js';
import { currentUv } from '../utils/weather.js';
import { toast, toastError } from './toastService.js';
import { t } from '../utils/i18n.js';
import { maybeNotifyRain } from './notificationService.js';
import { getSettings } from '../storage/settingsStore.js';

/** @type {AbortController|null} */
let activeController = null;
/** @type {AbortController|null} */
let archiveController = null;

/**
 * @param {import('../core/State.js').AppLocation} location
 * @param {{ force?: boolean, silent?: boolean }} [options]
 */
export async function loadWeatherFor(location, options = {}) {
  if (activeController) {
    activeController.abort();
  }
  activeController = new AbortController();
  const { signal } = activeController;

  persistLocation(location);
  setState({ location, loading: true, error: null });
  // toasts só em erro/offline — evita ruído a cada atualização

  // Nunca deixar loading eterno (rede presa / aba em background)
  const loadingWatchdog = setTimeout(() => {
    if (getState().loading) {
      setState({ loading: false });
    }
  }, 20000);

  const wKey = `weather:${location.latitude.toFixed(3)},${location.longitude.toFixed(3)}`;
  const aKey = `aq:${location.latitude.toFixed(3)},${location.longitude.toFixed(3)}`;

  if (!options.force) {
    const cachedW = cacheGet(wKey);
    const cachedA = cacheGet(aKey);
    if (cachedW) {
      cachedW.current.uvIndex = currentUv(cachedW);
      setState({
        weather: cachedW,
        airQuality: cachedA,
        loading: true,
        fromCache: true,
      });
    }
  }

  if (!navigator.onLine) {
    const lastW = getItem(STORAGE_KEYS.lastWeather, null);
    const lastA = getItem(STORAGE_KEYS.lastAirQuality, null);
    if (lastW) {
      lastW.current.uvIndex = currentUv(lastW);
      setState({
        weather: lastW,
        airQuality: lastA,
        loading: false,
        fromCache: true,
        offline: true,
      });
      toast(t('offline_banner'), { type: 'warning', duration: 4500 });
      clearTimeout(loadingWatchdog);
      return { weather: lastW, airQuality: lastA, fromCache: true };
    }
    setState({ loading: false, error: 'offline', offline: true });
    toastError(t('error_generic'));
    clearTimeout(loadingWatchdog);
    throw new Error('offline');
  }

  try {
    const [weather, airQuality, officialAlerts] = await Promise.all([
      fetchForecast(location.latitude, location.longitude, signal),
      fetchAirQuality(location.latitude, location.longitude, signal).catch(() => null),
      fetchInmetAlerts(location.latitude, location.longitude, signal).catch(() => null),
    ]);

    weather.current.uvIndex = currentUv(weather);
    cacheSet(wKey, weather, CACHE_TTL.weather);
    if (airQuality) {
      cacheSet(aKey, airQuality, CACHE_TTL.airQuality);
    }

    setItem(STORAGE_KEYS.lastWeather, weather);
    if (airQuality) {
      setItem(STORAGE_KEYS.lastAirQuality, airQuality);
    }

    setState({
      weather,
      airQuality,
      officialAlerts,
      loading: false,
      fromCache: false,
      offline: false,
      error: null,
    });

    addHistoryEntry({
      locationName: location.name,
      latitude: location.latitude,
      longitude: location.longitude,
      temperatura: weather.current.temperature,
      umidade: weather.current.humidity,
      pressao: weather.current.pressure,
      vento: weather.current.windSpeed,
      uv: weather.current.uvIndex,
      aqi: airQuality?.usAqi ?? null,
      weatherCode: weather.current.weatherCode,
    });

    maybeNotifyRain(weather, location);
    prefetchArchiveIfNeeded(location);

    return { weather, airQuality, fromCache: false };
  } catch (err) {
    if (err?.name === 'AbortError') {
      setState({ loading: false });
      return getState();
    }

    const lastW = getItem(STORAGE_KEYS.lastWeather, null) || cacheGet(wKey);
    const lastA = getItem(STORAGE_KEYS.lastAirQuality, null) || cacheGet(aKey);

    if (lastW) {
      lastW.current.uvIndex = currentUv(lastW);
      setState({
        weather: lastW,
        airQuality: lastA,
        loading: false,
        fromCache: true,
        error: null,
      });
      toast(t('cache_banner'), { type: 'warning' });
      return { weather: lastW, airQuality: lastA, fromCache: true };
    }

    setState({ loading: false, error: err?.message || 'error' });
    toastError(t('error_generic'));
    throw err;
  } finally {
    clearTimeout(loadingWatchdog);
  }
}

/**
 * @param {{ force?: boolean }} [options]
 */
export async function refreshWeather(options = { force: true }) {
  const { location } = getState();
  if (!location) {
    return null;
  }
  return loadWeatherFor(location, { ...options, silent: true });
}

/**
 * Carrega clima de cidade de comparação.
 * @param {import('../core/State.js').AppLocation|null} location
 */
export async function loadCompareWeather(location) {
  if (!location) {
    setState({ compareWeather: null, compareLocation: null });
    return null;
  }
  try {
    const weather = await fetchForecast(location.latitude, location.longitude);
    weather.current.uvIndex = currentUv(weather);
    setState({ compareWeather: weather, compareLocation: location });
    setItem(STORAGE_KEYS.compareWeather, { location, weather });
    return weather;
  } catch {
    toastError(t('error_generic'));
    return null;
  }
}

/**
 * @param {import('../core/State.js').AppLocation} location
 * @param {number} days
 */
export async function loadArchive(location, days) {
  if (archiveController) {
    archiveController.abort();
  }
  archiveController = new AbortController();
  const key = `archive:${location.latitude.toFixed(2)},${location.longitude.toFixed(2)}:${days}`;
  const cached = cacheGet(key);
  if (cached) {
    setState({ archive: cached });
    return cached;
  }
  if (!navigator.onLine) {
    return null;
  }
  try {
    const data = await fetchArchiveDaily(
      location.latitude,
      location.longitude,
      days,
      archiveController.signal
    );
    cacheSet(key, data, CACHE_TTL.archive);
    setState({ archive: data });
    return data;
  } catch (err) {
    if (err?.name !== 'AbortError') {
      console.warn('[archive]', err);
    }
    return null;
  }
}

/**
 * @param {import('../core/State.js').AppLocation} location
 */
function prefetchArchiveIfNeeded(location) {
  const range = getSettings().chartRange;
  if (range === '30d') {
    loadArchive(location, 30);
  } else if (range === '365d') {
    loadArchive(location, 365);
  }
}

/** Restaura compare do storage se existir. */
export function restoreCompare() {
  const saved = getItem(STORAGE_KEYS.compareWeather, null);
  if (saved?.location && saved?.weather) {
    setState({
      compareLocation: saved.location,
      compareWeather: saved.weather,
    });
  }
}
