/**
 * Página de cidades favoritas.
 * @module pages/FavoritesPage
 */

import { el } from '../utils/dom.js';
import { t } from '../utils/i18n.js';
import { getFavorites, removeFavorite } from '../storage/favoritesStore.js';
import { loadWeatherFor } from '../services/weatherService.js';
import { navigate, ROUTES } from '../router.js';
import { EventBus, Events } from '../core/EventBus.js';

/**
 * @param {HTMLElement} container
 */
export async function renderFavoritesPage(container) {
  const page = el('div', { className: 'page-panel' });
  const list = el('div', { className: 'fav-list' });
  page.append(el('h2', { text: t('nav_favorites') }), list);
  container.append(page);

  function render() {
    list.innerHTML = '';
    const favs = getFavorites();
    if (!favs.length) {
      list.append(el('p', { className: 'muted', text: t('no_favorites') }));
      return;
    }
    for (const f of favs) {
      const card = el('div', { className: 'fav-card' }, [
        el('button', {
          type: 'button',
          className: 'fav-main',
          onClick: async () => {
            await loadWeatherFor({
              name: f.name,
              country: f.country,
              latitude: f.latitude,
              longitude: f.longitude,
            });
            navigate(ROUTES.dashboard);
          },
        }, [
          el('strong', { text: f.name }),
          el('span', { className: 'muted', text: f.country || `${f.latitude.toFixed(2)}, ${f.longitude.toFixed(2)}` }),
        ]),
        el('button', {
          type: 'button',
          className: 'icon-btn danger',
          text: '✕',
          title: t('remove_favorite'),
          onClick: () => removeFavorite(f.id),
        }),
      ]);
      list.append(card);
    }
  }

  render();
  const unsub = EventBus.on(Events.FAVORITES_CHANGED, render);
  const unsubSettings = EventBus.on(Events.SETTINGS_CHANGED, () => {
    page.querySelector('h2').textContent = t('nav_favorites');
    render();
  });

  container._teardown = () => {
    unsub();
    unsubSettings();
  };
}
