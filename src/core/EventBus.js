/**
 * Barramento de eventos simples para comunicação desacoplada.
 * @module core/EventBus
 */

/**
 * @typedef {(payload: any) => void} EventHandler
 */

class EventBusClass {
  constructor() {
    /** @type {Map<string, Set<EventHandler>>} */
    this._handlers = new Map();
  }

  /**
   * @param {string} event
   * @param {EventHandler} handler
   * @returns {() => void}
   */
  on(event, handler) {
    if (!this._handlers.has(event)) {
      this._handlers.set(event, new Set());
    }
    this._handlers.get(event).add(handler);
    return () => this.off(event, handler);
  }

  /**
   * @param {string} event
   * @param {EventHandler} handler
   */
  once(event, handler) {
    const wrap = (payload) => {
      this.off(event, wrap);
      handler(payload);
    };
    return this.on(event, wrap);
  }

  /**
   * @param {string} event
   * @param {EventHandler} handler
   */
  off(event, handler) {
    const set = this._handlers.get(event);
    if (set) {
      set.delete(handler);
    }
  }

  /**
   * @param {string} event
   * @param {any} [payload]
   */
  emit(event, payload) {
    const set = this._handlers.get(event);
    if (!set) {
      return;
    }
    for (const handler of [...set]) {
      try {
        handler(payload);
      } catch (err) {
        console.error(`[EventBus] Erro em "${event}":`, err);
      }
    }
  }

  clear() {
    this._handlers.clear();
  }
}

export const EventBus = new EventBusClass();

export const Events = {
  LOCATION_CHANGED: 'location:changed',
  WEATHER_UPDATED: 'weather:updated',
  OFFICIAL_ALERTS_UPDATED: 'alerts:official',
  AIR_QUALITY_UPDATED: 'airquality:updated',
  COMPARE_UPDATED: 'compare:updated',
  SETTINGS_CHANGED: 'settings:changed',
  THEME_CHANGED: 'theme:changed',
  FAVORITES_CHANGED: 'favorites:changed',
  HISTORY_CHANGED: 'history:changed',
  ROUTE_CHANGED: 'route:changed',
  ONLINE: 'app:online',
  OFFLINE: 'app:offline',
  LOADING: 'app:loading',
  ERROR: 'app:error',
  TOAST: 'app:toast',
  ARCHIVE_UPDATED: 'archive:updated',
};
