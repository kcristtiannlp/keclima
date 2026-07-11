/**
 * Persistência de configurações do usuário.
 * @module storage/settingsStore
 */

import {
  DEFAULT_SETTINGS,
  STORAGE_KEYS,
  WIDGET_CATALOG,
  WIDGET_SIZES,
} from '../config.js';
import { getItem, setItem } from './Storage.js';
import { EventBus, Events } from '../core/EventBus.js';

/**
 * @returns {typeof DEFAULT_SETTINGS}
 */
export function getSettings() {
  const stored = getItem(STORAGE_KEYS.settings, {}) || {};
  const widgetOrder = sanitizeWidgetOrder(
    Array.isArray(stored.widgetOrder) ? stored.widgetOrder : null
  );
  const widgetSizes = sanitizeWidgetSizes(stored.widgetSizes);

  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    units: {
      ...DEFAULT_SETTINGS.units,
      ...(stored.units || {}),
    },
    widgetOrder,
    widgetSizes,
  };
}

/**
 * @param {string[]|null} saved
 * @returns {string[]}
 */
export function sanitizeWidgetOrder(saved) {
  const catalog = WIDGET_CATALOG;
  if (!saved || !saved.length) {
    return [...DEFAULT_SETTINGS.widgetOrder];
  }
  const seen = new Set();
  const out = [];
  for (const id of saved) {
    if (catalog.includes(id) && !seen.has(id)) {
      out.push(id);
      seen.add(id);
    }
  }
  // Novos painéis do cerne (ex.: situação) entram no topo se ainda não estavam salvos
  if (catalog.includes('survival') && !seen.has('survival')) {
    out.unshift('survival');
    seen.add('survival');
  }
  return out.length ? out : [...DEFAULT_SETTINGS.widgetOrder];
}

/**
 * @param {Record<string, string>|null|undefined} saved
 * @returns {Record<string, 's'|'m'|'l'>}
 */
export function sanitizeWidgetSizes(saved) {
  const defaults = { ...DEFAULT_SETTINGS.widgetSizes };
  if (!saved || typeof saved !== 'object') {
    return defaults;
  }
  const out = { ...defaults };
  for (const id of WIDGET_CATALOG) {
    const v = saved[id];
    if (WIDGET_SIZES.includes(/** @type {any} */ (v))) {
      out[id] = /** @type {'s'|'m'|'l'} */ (v);
    }
  }
  return out;
}

/**
 * @param {string} id
 * @returns {'s'|'m'|'l'}
 */
export function getWidgetSize(id) {
  const sizes = getSettings().widgetSizes || DEFAULT_SETTINGS.widgetSizes;
  const v = sizes[id];
  if (WIDGET_SIZES.includes(/** @type {any} */ (v))) {
    return /** @type {'s'|'m'|'l'} */ (v);
  }
  return DEFAULT_SETTINGS.widgetSizes[id] || 's';
}

/**
 * @param {string} id
 * @param {'s'|'m'|'l'} size
 */
export function setWidgetSize(id, size) {
  if (!WIDGET_CATALOG.includes(id) || !WIDGET_SIZES.includes(size)) {
    return getSettings();
  }
  const widgetSizes = {
    ...getSettings().widgetSizes,
    [id]: size,
  };
  return updateSettings({ widgetSizes });
}

/**
 * Cicla S → M → L → S.
 * @param {string} id
 */
export function cycleWidgetSize(id) {
  const cur = getWidgetSize(id);
  const idx = WIDGET_SIZES.indexOf(cur);
  const next = WIDGET_SIZES[(idx + 1) % WIDGET_SIZES.length];
  return setWidgetSize(id, next);
}

/**
 * @param {Partial<typeof DEFAULT_SETTINGS>} partial
 * @returns {typeof DEFAULT_SETTINGS}
 */
export function updateSettings(partial) {
  const current = getSettings();
  const next = {
    ...current,
    ...partial,
    units: {
      ...current.units,
      ...(partial.units || {}),
    },
  };
  if (partial.widgetOrder) {
    next.widgetOrder = sanitizeWidgetOrder(partial.widgetOrder);
  }
  if (partial.widgetSizes) {
    next.widgetSizes = sanitizeWidgetSizes({
      ...current.widgetSizes,
      ...partial.widgetSizes,
    });
  }
  setItem(STORAGE_KEYS.settings, next);
  EventBus.emit(Events.SETTINGS_CHANGED, next);
  return next;
}

/**
 * @param {string} id
 */
export function hideWidget(id) {
  const order = getSettings().widgetOrder.filter((w) => w !== id);
  if (!order.length) {
    return getSettings();
  }
  return updateSettings({ widgetOrder: order });
}

/**
 * @param {string} id
 */
export function showWidget(id) {
  if (!WIDGET_CATALOG.includes(id)) {
    return getSettings();
  }
  const order = [...getSettings().widgetOrder];
  if (!order.includes(id)) {
    order.push(id);
  }
  return updateSettings({ widgetOrder: order });
}

/**
 * @param {string[]} ids
 * @param {Record<string, 's'|'m'|'l'>} [sizes]
 */
export function setVisibleWidgets(ids, sizes) {
  const current = getSettings().widgetOrder;
  const selected = sanitizeWidgetOrder(ids);
  const ordered = [];
  const sel = new Set(selected);
  for (const id of current) {
    if (sel.has(id)) {
      ordered.push(id);
      sel.delete(id);
    }
  }
  for (const id of selected) {
    if (sel.has(id)) {
      ordered.push(id);
    }
  }
  const partial = {
    widgetOrder: ordered.length ? ordered : ['temperature'],
  };
  if (sizes) {
    partial.widgetSizes = sizes;
  }
  return updateSettings(partial);
}

/**
 * @returns {typeof DEFAULT_SETTINGS}
 */
export function resetSettings() {
  const next = {
    ...DEFAULT_SETTINGS,
    units: { ...DEFAULT_SETTINGS.units },
    widgetOrder: [...DEFAULT_SETTINGS.widgetOrder],
    widgetSizes: { ...DEFAULT_SETTINGS.widgetSizes },
  };
  setItem(STORAGE_KEYS.settings, next);
  EventBus.emit(Events.SETTINGS_CHANGED, next);
  return next;
}
