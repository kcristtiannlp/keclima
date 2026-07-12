/**
 * Shell da aplicação KeClima.
 * @module app
 */

import { el } from './utils/dom.js';
import { t } from './utils/i18n.js';
import { mountHeader } from './components/Header.js';
import { mountNav } from './components/Nav.js';
import { mountToastHost } from './components/Toast.js';
import { mountOfflineBanner } from './components/OfflineBanner.js';
import { maybeShowOnboarding } from './components/Onboarding.js';
import { registerRoute, setOutlet, startRouter, ROUTES } from './router.js';
import { getInitialLocation } from './services/locationService.js';
import { loadWeatherFor, refreshWeather, restoreCompare } from './services/weatherService.js';
import { initTheme } from './services/themeService.js';
import { getSettings } from './storage/settingsStore.js';
import { setState, getState } from './core/State.js';
import { EventBus, Events } from './core/EventBus.js';

/**
 * @param {HTMLElement} root
 * @param {{ onReady?: () => void }} [options]
 */
export async function createApp(root, options = {}) {
  initTheme();
  document.documentElement.classList.toggle('compact-mode', getSettings().compactMode);

  const skip = el('a', {
    className: 'skip-link',
    href: '#app-main',
    text: t('skip_to_content'),
  });
  const shell = el('div', { className: 'app-shell' });
  const headerHost = el('div', { className: 'header-host' });
  const main = el('main', { className: 'app-main', id: 'app-main', tabindex: '-1' });
  const navHost = el('div', { className: 'nav-host' });

  shell.append(headerHost, main, navHost);
  root.append(skip, shell);

  mountOfflineBanner(shell);
  mountToastHost(document.body);

  const headerApi = mountHeader(headerHost);
  const navApi = mountNav(navHost);

  setOutlet(main);

  const registerRouteAliases = (paths, handler) => {
    for (const path of paths) {
      registerRoute(path, handler);
    }
  };

  registerRouteAliases([ROUTES.dashboard, '/dashboard'], async (c) => {
    const { renderDashboardPage } = await import('./pages/DashboardPage.js');
    return renderDashboardPage(c);
  });
  registerRouteAliases([ROUTES.map, '/map'], async (c) => {
    const { renderMapPage } = await import('./pages/MapPage.js');
    return renderMapPage(c);
  });
  const chartsHandler = async (c) => {
    const { renderChartsPage } = await import('./pages/ChartsPage.js');
    return renderChartsPage(c);
  };
  registerRoute(ROUTES.charts, chartsHandler);
  // sub-rota da aba Satélite IV (estilo Climatempo)
  registerRoute('/graficos/satelite', chartsHandler);
  registerRoute('/graficos/satellite', chartsHandler);
  registerRoute('/charts', chartsHandler);
  registerRoute('/charts/satellite', chartsHandler);
  registerRouteAliases([ROUTES.favorites, '/favorites'], async (c) => {
    const { renderFavoritesPage } = await import('./pages/FavoritesPage.js');
    return renderFavoritesPage(c);
  });
  registerRouteAliases([ROUTES.history, '/history'], async (c) => {
    const { renderHistoryPage } = await import('./pages/HistoryPage.js');
    return renderHistoryPage(c);
  });
  registerRouteAliases([ROUTES.settings, '/settings'], async (c) => {
    const { renderSettingsPage } = await import('./pages/SettingsPage.js');
    return renderSettingsPage(c);
  });
  registerRouteAliases([ROUTES.about, '/about'], async (c) => {
    const { renderAboutPage } = await import('./pages/AboutPage.js');
    return renderAboutPage(c);
  });

  // UI pronta — remove splash antes de rede/onboarding
  startRouter();
  restoreCompare();
  options.onReady?.();

  window.addEventListener('online', () => {
    setState({ offline: false });
    refreshWeather({ force: true });
  });
  window.addEventListener('offline', () => setState({ offline: true }));

  let lastModel = getSettings().weatherModel;
  EventBus.on(Events.SETTINGS_CHANGED, () => {
    headerApi.refreshLabels();
    navApi.refreshLabels();
    document.documentElement.classList.toggle('compact-mode', getSettings().compactMode);
    const curModel = getSettings().weatherModel;
    if (curModel !== lastModel) {
      lastModel = curModel;
      refreshWeather({ force: true }).catch(() => undefined);
    }
  });

  // Onboarding e clima em background (não bloqueiam a UI)
  Promise.resolve()
    .then(async () => {
      await maybeShowOnboarding(document.body);
      if (!getState().weather) {
        await loadWeatherFor(getInitialLocation(), { silent: true });
      }
    })
    .catch((err) => {
      console.warn('[KeClima] carga inicial:', err);
      setState({ loading: false });
    });

  let timer = null;
  function scheduleAutoUpdate() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    const settings = getSettings();
    if (settings.autoUpdate) {
      timer = setInterval(() => {
        if (navigator.onLine) {
          refreshWeather({ force: true });
        }
      }, settings.autoUpdateInterval || 10 * 60 * 1000);
    }
  }
  scheduleAutoUpdate();
  EventBus.on(Events.SETTINGS_CHANGED, scheduleAutoUpdate);

  return {
    destroy() {
      if (timer) {
        clearInterval(timer);
      }
      headerApi.destroy();
      navApi.destroy();
    },
  };
}
