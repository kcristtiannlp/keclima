/**
 * Estado global reativo da aplicação.
 * @module core/State
 */

import { EventBus, Events } from './EventBus.js';

/**
 * @typedef {Object} AppLocation
 * @property {string} name
 * @property {string} [country]
 * @property {number} latitude
 * @property {number} longitude
 * @property {string} [timezone]
 */

/**
 * @typedef {Object} AppState
 * @property {AppLocation|null} location
 * @property {Object|null} weather
 * @property {Object|null} airQuality
 * @property {Object|null} compareWeather
 * @property {AppLocation|null} compareLocation
 * @property {Object|null} archive
 * @property {boolean} loading
 * @property {boolean} offline
 * @property {string|null} error
 * @property {boolean} fromCache
 * @property {string|null} cacheAgeLabel
 */

/** @type {AppState} */
const state = {
  location: null,
  weather: null,
  airQuality: null,
  compareWeather: null,
  compareLocation: null,
  archive: null,
  loading: false,
  offline: typeof navigator !== 'undefined' ? !navigator.onLine : false,
  error: null,
  fromCache: false,
  cacheAgeLabel: null,
};

/**
 * @returns {AppState}
 */
export function getState() {
  return { ...state };
}

/**
 * @param {Partial<AppState>} partial
 */
export function setState(partial) {
  const prev = { ...state };
  Object.assign(state, partial);

  if ('location' in partial && partial.location !== prev.location) {
    EventBus.emit(Events.LOCATION_CHANGED, state.location);
  }
  if ('weather' in partial) {
    EventBus.emit(Events.WEATHER_UPDATED, state.weather);
  }
  if ('airQuality' in partial) {
    EventBus.emit(Events.AIR_QUALITY_UPDATED, state.airQuality);
  }
  if ('compareWeather' in partial || 'compareLocation' in partial) {
    EventBus.emit(Events.COMPARE_UPDATED, {
      weather: state.compareWeather,
      location: state.compareLocation,
    });
  }
  if ('archive' in partial) {
    EventBus.emit(Events.ARCHIVE_UPDATED, state.archive);
  }
  if ('loading' in partial) {
    EventBus.emit(Events.LOADING, state.loading);
  }
  if ('error' in partial && partial.error) {
    EventBus.emit(Events.ERROR, state.error);
  }
  if ('offline' in partial) {
    EventBus.emit(partial.offline ? Events.OFFLINE : Events.ONLINE, null);
  }
}
