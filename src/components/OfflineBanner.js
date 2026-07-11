/**
 * Faixa de status offline / cache.
 * @module components/OfflineBanner
 */

import { el } from '../utils/dom.js';
import { t } from '../utils/i18n.js';
import { getState } from '../core/State.js';
import { EventBus, Events } from '../core/EventBus.js';
import { formatDateTime } from '../utils/units.js';

/**
 * @param {HTMLElement} root
 */
export function mountOfflineBanner(root) {
  const banner = el('div', {
    className: 'offline-banner hidden',
    role: 'status',
  });
  root.prepend(banner);

  function sync() {
    const s = getState();
    const offline = s.offline || !navigator.onLine;
    const fromCache = s.fromCache;
    if (!offline && !fromCache) {
      banner.classList.add('hidden');
      banner.textContent = '';
      return;
    }
    banner.classList.remove('hidden');
    if (offline) {
      const when = s.weather?.fetchedAt ? formatDateTime(s.weather.fetchedAt) : '—';
      banner.textContent = `${t('offline_banner')} · ${t('last_update')}: ${when}`;
      banner.classList.add('is-offline');
      banner.classList.remove('is-cache');
    } else {
      banner.textContent = `${t('cache_banner')} · ${formatDateTime(s.weather?.fetchedAt)}`;
      banner.classList.add('is-cache');
      banner.classList.remove('is-offline');
    }
  }

  const unsubs = [
    EventBus.on(Events.WEATHER_UPDATED, sync),
    EventBus.on(Events.ONLINE, sync),
    EventBus.on(Events.OFFLINE, sync),
    EventBus.on(Events.LOADING, sync),
    EventBus.on(Events.SETTINGS_CHANGED, sync),
  ];
  window.addEventListener('online', sync);
  window.addEventListener('offline', sync);
  sync();

  return {
    destroy() {
      unsubs.forEach((u) => u());
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
      banner.remove();
    },
  };
}
