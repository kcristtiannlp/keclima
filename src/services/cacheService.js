/**
 * Cache em memória + localStorage com TTL.
 * @module services/cacheService
 */

import { getItem, setItem } from '../storage/Storage.js';

/** @type {Map<string, { value: any, expires: number }>} */
const memory = new Map();

/**
 * @param {string} key
 * @returns {any|null}
 */
export function cacheGet(key) {
  const mem = memory.get(key);
  if (mem) {
    if (mem.expires > Date.now()) {
      return mem.value;
    }
    memory.delete(key);
  }

  const stored = getItem(`keclima:cache:${key}`, null);
  if (stored && stored.expires > Date.now()) {
    memory.set(key, stored);
    return stored.value;
  }
  return null;
}

/**
 * @param {string} key
 * @param {any} value
 * @param {number} ttlMs
 */
export function cacheSet(key, value, ttlMs) {
  const entry = { value, expires: Date.now() + ttlMs };
  memory.set(key, entry);
  setItem(`keclima:cache:${key}`, entry);
}

/**
 * @param {string} key
 */
export function cacheDelete(key) {
  memory.delete(key);
  try {
    localStorage.removeItem(`keclima:cache:${key}`);
  } catch {
    /* ignore */
  }
}
