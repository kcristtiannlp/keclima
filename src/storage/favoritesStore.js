/**
 * Favoritos de cidades (LocalStorage).
 * @module storage/favoritesStore
 */

import { STORAGE_KEYS } from '../config.js';
import { getItem, setItem } from './Storage.js';
import { EventBus, Events } from '../core/EventBus.js';

/**
 * @typedef {Object} FavoriteCity
 * @property {string} id
 * @property {string} name
 * @property {string} [country]
 * @property {number} latitude
 * @property {number} longitude
 * @property {number} addedAt
 */

/**
 * @returns {FavoriteCity[]}
 */
export function getFavorites() {
  return getItem(STORAGE_KEYS.favorites, []);
}

/**
 * @param {Omit<FavoriteCity, 'id' | 'addedAt'>} city
 * @returns {FavoriteCity[]}
 */
export function addFavorite(city) {
  const list = getFavorites();
  const id = `${city.latitude.toFixed(4)},${city.longitude.toFixed(4)}`;
  if (list.some((f) => f.id === id)) {
    return list;
  }
  const entry = {
    id,
    name: city.name,
    country: city.country || '',
    latitude: city.latitude,
    longitude: city.longitude,
    addedAt: Date.now(),
  };
  const next = [entry, ...list];
  setItem(STORAGE_KEYS.favorites, next);
  EventBus.emit(Events.FAVORITES_CHANGED, next);
  return next;
}

/**
 * @param {string} id
 * @returns {FavoriteCity[]}
 */
export function removeFavorite(id) {
  const next = getFavorites().filter((f) => f.id !== id);
  setItem(STORAGE_KEYS.favorites, next);
  EventBus.emit(Events.FAVORITES_CHANGED, next);
  return next;
}

/**
 * @param {number} latitude
 * @param {number} longitude
 * @returns {boolean}
 */
export function isFavorite(latitude, longitude) {
  const id = `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
  return getFavorites().some((f) => f.id === id);
}

/**
 * @param {number} latitude
 * @param {number} longitude
 * @returns {string}
 */
export function favoriteId(latitude, longitude) {
  return `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
}
