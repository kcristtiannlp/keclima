/**
 * Wrapper tipado sobre localStorage com serialização JSON.
 * @module storage/Storage
 */

/**
 * @param {string} key
 * @param {any} [fallback=null]
 * @returns {any}
 */
export function getItem(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) {
      return fallback;
    }
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/**
 * @param {string} key
 * @param {any} value
 * @returns {boolean}
 */
export function setItem(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    console.error('[Storage] Falha ao gravar:', key, err);
    return false;
  }
}

/**
 * @param {string} key
 */
export function removeItem(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/**
 * @param {string} prefix
 */
export function clearByPrefix(prefix) {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(prefix)) {
      keys.push(k);
    }
  }
  keys.forEach((k) => removeItem(k));
}
