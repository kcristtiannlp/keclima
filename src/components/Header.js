/**
 * Cabeçalho com busca (teclado), favorito e status.
 * @module components/Header
 */

import { el, debounce } from '../utils/dom.js';
import { t } from '../utils/i18n.js';
import { getState } from '../core/State.js';
import { EventBus, Events } from '../core/EventBus.js';
import { searchCities } from '../services/locationService.js';
import { loadWeatherFor, refreshWeather } from '../services/weatherService.js';
import { addFavorite, removeFavorite, isFavorite, favoriteId } from '../storage/favoritesStore.js';
import { formatDateTime } from '../utils/units.js';
import { toastError, toastWarning, toast } from '../services/toastService.js';
import { navigate, ROUTES } from '../router.js';

/**
 * @param {HTMLElement} container
 */
export function mountHeader(container) {
  const searchInput = el('input', {
    type: 'search',
    className: 'search-input',
    placeholder: t('search_placeholder'),
    autocomplete: 'off',
    'aria-label': t('search_placeholder'),
    'aria-autocomplete': 'list',
    'aria-controls': 'search-results',
  });

  const resultsBox = el('ul', {
    className: 'search-results hidden',
    role: 'listbox',
    id: 'search-results',
  });
  const locationLabel = el('div', { className: 'location-label' });
  const statusBadge = el('span', { className: 'status-badge' });
  const favBtn = el('button', {
    type: 'button',
    className: 'icon-btn fav-btn',
    title: t('add_favorite'),
    'aria-label': t('add_favorite'),
  });
  const refreshBtn = el('button', {
    type: 'button',
    className: 'icon-btn',
    title: t('refresh'),
    text: '↻',
    'aria-label': t('refresh'),
  });
  const geoBtn = el('button', {
    type: 'button',
    className: 'icon-btn',
    title: t('use_location'),
    text: '📍',
    'aria-label': t('use_location'),
  });
  const installBtn = el('button', {
    type: 'button',
    className: 'btn btn-sm install-btn hidden',
    text: t('install_pwa'),
  });
  const loadingBar = el('div', { className: 'header-loading hidden' });

  const brandBtn = el(
    'button',
    {
      type: 'button',
      className: 'brand brand-home',
      title: t('nav_dashboard'),
      'aria-label': t('nav_dashboard'),
      onClick: () => navigate(ROUTES.dashboard),
    },
    [
      el('span', { className: 'brand-mark', text: '⛅', 'aria-hidden': 'true' }),
      el('div', {}, [el('strong', { className: 'brand-name', text: t('app_name') }), locationLabel]),
    ]
  );

  const header = el('header', { className: 'app-header' }, [
    brandBtn,
    el('div', { className: 'header-search' }, [searchInput, resultsBox]),
    el('div', { className: 'header-actions' }, [statusBadge, installBtn, geoBtn, favBtn, refreshBtn]),
    loadingBar,
  ]);

  container.append(header);

  /** @type {AbortController|null} */
  let searchAbort = null;
  /** @type {any} */
  let deferredPrompt = null;
  /** @type {Array<any>} */
  let lastResults = [];
  let activeIndex = -1;

  function highlight(idx) {
    activeIndex = idx;
    [...resultsBox.children].forEach((li, i) => {
      li.classList.toggle('active', i === idx);
      li.setAttribute('aria-selected', i === idx ? 'true' : 'false');
    });
    if (idx >= 0 && resultsBox.children[idx]) {
      resultsBox.children[idx].scrollIntoView({ block: 'nearest' });
    }
  }

  async function selectResult(r) {
    resultsBox.classList.add('hidden');
    searchInput.value = '';
    lastResults = [];
    activeIndex = -1;
    // Usa o nome local da busca (ex.: Cachoeira do Campo), não re-geocodifica
    await loadWeatherFor({
      name: r.name,
      country: r.country || (r.parentCity ? r.parentCity : ''),
      latitude: r.latitude,
      longitude: r.longitude,
      parentCity: r.parentCity || '',
      state: r.state || '',
      displayName: r.displayName || r.name,
    });
  }

  const doSearch = debounce(async (q) => {
    if (searchAbort) {
      searchAbort.abort();
    }
    if (q.trim().length < 2) {
      resultsBox.classList.add('hidden');
      resultsBox.innerHTML = '';
      lastResults = [];
      return;
    }
    searchAbort = new AbortController();
    try {
      const results = await searchCities(q, searchAbort.signal);
      lastResults = results;
      resultsBox.innerHTML = '';
      activeIndex = -1;
      if (!results.length) {
        resultsBox.append(el('li', { className: 'search-result-item muted', text: t('no_results') }));
        resultsBox.classList.remove('hidden');
        return;
      }
      results.forEach((r, i) => {
        const li = el('li', {
          role: 'option',
          className: 'search-result-item',
          text: r.displayName,
          id: `search-opt-${i}`,
          onClick: () => selectResult(r),
          onMouseEnter: () => highlight(i),
        });
        resultsBox.append(li);
      });
      resultsBox.classList.remove('hidden');
    } catch (err) {
      if (err?.name === 'AbortError') {
        return;
      }
      if (err?.code === 'rate_limit' || err?.message === 'rate_limit') {
        toastError(t('error_rate_limit'));
      } else {
        toastError(t('error_search'));
      }
    }
  }, 320);

  searchInput.addEventListener('input', () => doSearch(searchInput.value));
  searchInput.addEventListener('keydown', (e) => {
    if (resultsBox.classList.contains('hidden') && e.key !== 'Escape') {
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!lastResults.length) {
        return;
      }
      highlight(Math.min(lastResults.length - 1, activeIndex + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      highlight(Math.max(0, activeIndex - 1));
    } else if (e.key === 'Enter') {
      if (activeIndex >= 0 && lastResults[activeIndex]) {
        e.preventDefault();
        selectResult(lastResults[activeIndex]);
      }
    } else if (e.key === 'Escape') {
      resultsBox.classList.add('hidden');
      activeIndex = -1;
    }
  });

  document.addEventListener('click', onDocClick);
  function onDocClick(e) {
    if (!header.contains(e.target)) {
      resultsBox.classList.add('hidden');
    }
  }

  favBtn.addEventListener('click', () => {
    const { location } = getState();
    if (!location) {
      return;
    }
    if (isFavorite(location.latitude, location.longitude)) {
      removeFavorite(favoriteId(location.latitude, location.longitude));
    } else {
      addFavorite(location);
    }
    syncFav();
  });

  refreshBtn.addEventListener('click', () => {
    refreshBtn.classList.add('spin');
    refreshWeather({ force: true }).finally(() => {
      refreshBtn.classList.remove('spin');
    });
  });

  geoBtn.addEventListener('click', async () => {
    try {
      const {
        getBrowserPosition,
        resolvePlace,
        isCoarseAccuracy,
      } = await import('../services/locationService.js');
      toast(t('locating'), { type: 'info', duration: 2000 });
      const pos = await getBrowserPosition();
      const place = await resolvePlace(pos.latitude, pos.longitude);

      if (isCoarseAccuracy(pos.accuracy)) {
        const meters =
          pos.accuracy != null && !Number.isNaN(pos.accuracy)
            ? ` (~${Math.round(pos.accuracy)} m)`
            : '';
        toastWarning(`${t('location_coarse')}${meters}`);
      }

      await loadWeatherFor({
        ...place,
        latitude: pos.latitude,
        longitude: pos.longitude,
      });
    } catch {
      toastError(t('error_location'));
    }
  });

  window.addEventListener('beforeinstallprompt', onInstallPrompt);
  installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) {
      return;
    }
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    installBtn.classList.add('hidden');
  });

  function onInstallPrompt(e) {
    e.preventDefault();
    deferredPrompt = e;
    installBtn.classList.remove('hidden');
  }

  function syncFav() {
    const { location } = getState();
    if (!location) {
      favBtn.textContent = '☆';
      return;
    }
    const fav = isFavorite(location.latitude, location.longitude);
    favBtn.textContent = fav ? '★' : '☆';
    favBtn.title = fav ? t('remove_favorite') : t('add_favorite');
    favBtn.classList.toggle('is-fav', fav);
  }

  function syncStatus() {
    const s = getState();
    if (s.location?.name) {
      // Principal = local (distrito/vila); secundário = município/UF
      locationLabel.textContent = s.location.country
        ? `${s.location.name} · ${s.location.country}`
        : s.location.name;
      locationLabel.title = s.location.displayName || locationLabel.textContent;
    } else {
      locationLabel.textContent = '';
      locationLabel.title = '';
    }
    loadingBar.classList.toggle('hidden', !s.loading);

    if (s.loading) {
      statusBadge.textContent = t('loading');
      statusBadge.className = 'status-badge loading';
    } else if (s.offline || s.fromCache) {
      statusBadge.textContent = s.offline
        ? t('offline')
        : `${t('updated')}: ${formatDateTime(s.weather?.fetchedAt)}`;
      statusBadge.className = 'status-badge offline';
    } else if (s.weather?.fetchedAt) {
      statusBadge.textContent = `${t('updated')}: ${formatDateTime(s.weather.fetchedAt)}`;
      statusBadge.className = 'status-badge';
    } else {
      statusBadge.textContent = '';
    }
    syncFav();
  }

  const unsubs = [
    EventBus.on(Events.LOCATION_CHANGED, syncStatus),
    EventBus.on(Events.WEATHER_UPDATED, syncStatus),
    EventBus.on(Events.LOADING, syncStatus),
    EventBus.on(Events.FAVORITES_CHANGED, syncFav),
    EventBus.on(Events.ONLINE, syncStatus),
    EventBus.on(Events.OFFLINE, syncStatus),
  ];

  syncStatus();

  return {
    destroy() {
      unsubs.forEach((u) => u());
      document.removeEventListener('click', onDocClick);
      window.removeEventListener('beforeinstallprompt', onInstallPrompt);
      doSearch.cancel();
      header.remove();
    },
    refreshLabels() {
      searchInput.placeholder = t('search_placeholder');
      installBtn.textContent = t('install_pwa');
      refreshBtn.title = t('refresh');
      geoBtn.title = t('use_location');
      header.querySelector('.brand-name').textContent = t('app_name');
      syncStatus();
    },
  };
}
