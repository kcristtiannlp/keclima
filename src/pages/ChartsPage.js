/**
 * Página de gráficos multi-período + satélite infravermelho (estilo Climatempo).
 * @module pages/ChartsPage
 */

import { el } from '../utils/dom.js';
import { t } from '../utils/i18n.js';
import { getState } from '../core/State.js';
import { EventBus, Events } from '../core/EventBus.js';
import { ChartWidget } from '../widgets/ChartWidget.js';
import { SatelliteWidget } from '../widgets/SatelliteWidget.js';
import { getSettings } from '../storage/settingsStore.js';
import { loadArchive } from '../services/weatherService.js';

/**
 * @param {HTMLElement} container
 */
export async function renderChartsPage(container) {
  const page = el('div', { className: 'charts-page' });
  container.append(page);

  // Aba inicial: hash #/graficos/satelite ou query
  let activeTab = 'charts';
  try {
    const hash = (window.location.hash || '').toLowerCase();
    if (hash.includes('satelite') || hash.includes('satellite') || hash.includes('sat')) {
      activeTab = 'satellite';
    }
  } catch {
    /* ignore */
  }

  const tabBar = el('div', { className: 'charts-tabs', role: 'tablist' });
  const tabCharts = el('button', {
    type: 'button',
    role: 'tab',
    className: `charts-tab${activeTab === 'charts' ? ' active' : ''}`,
    'aria-selected': activeTab === 'charts' ? 'true' : 'false',
    text: t('tab_charts'),
  });
  const tabSat = el('button', {
    type: 'button',
    role: 'tab',
    className: `charts-tab${activeTab === 'satellite' ? ' active' : ''}`,
    'aria-selected': activeTab === 'satellite' ? 'true' : 'false',
    text: t('tab_satellite'),
  });
  tabBar.append(tabCharts, tabSat);

  const chartsPane = el('div', {
    className: `charts-pane${activeTab === 'charts' ? '' : ' hidden'}`,
    role: 'tabpanel',
  });
  const satPane = el('div', {
    className: `charts-pane sat-pane${activeTab === 'satellite' ? '' : ' hidden'}`,
    role: 'tabpanel',
  });

  page.append(tabBar, chartsPane, satPane);

  // ── Gráficos ──────────────────────────────────────────────
  const grid = el('div', { className: 'charts-grid' });
  chartsPane.append(grid);

  const types = /** @type {const} */ ([
    'temperature',
    'pressure',
    'humidity',
    'precipitation',
    'wind',
  ]);

  const state = getState();
  const widgets = types.map((type) => new ChartWidget(type, state));
  for (const w of widgets) {
    grid.append(w.mount());
  }

  const range = getSettings().chartRange;
  if (state.location && (range === '30d' || range === '365d')) {
    await loadArchive(state.location, range === '30d' ? 30 : 365);
  }

  function sync() {
    const s = getState();
    const payload = {
      weather: s.weather,
      airQuality: s.airQuality,
      location: s.location,
      archive: s.archive,
    };
    widgets.forEach((w) => w.update(payload));
  }

  // ── Satélite ──────────────────────────────────────────────
  const satWidget = new SatelliteWidget();
  satPane.append(satWidget.mount());

  function setTab(tab) {
    activeTab = tab;
    tabCharts.classList.toggle('active', tab === 'charts');
    tabSat.classList.toggle('active', tab === 'satellite');
    tabCharts.setAttribute('aria-selected', tab === 'charts' ? 'true' : 'false');
    tabSat.setAttribute('aria-selected', tab === 'satellite' ? 'true' : 'false');
    chartsPane.classList.toggle('hidden', tab !== 'charts');
    satPane.classList.toggle('hidden', tab !== 'satellite');
    // Não troca o hash aqui — evita remount completo do router a cada aba.
  }

  tabCharts.addEventListener('click', () => setTab('charts'));
  tabSat.addEventListener('click', () => setTab('satellite'));

  const unsubs = [
    EventBus.on(Events.WEATHER_UPDATED, sync),
    EventBus.on(Events.ARCHIVE_UPDATED, sync),
    EventBus.on(Events.SETTINGS_CHANGED, sync),
    EventBus.on(Events.THEME_CHANGED, sync),
  ];

  container._teardown = () => {
    unsubs.forEach((u) => u());
    widgets.forEach((w) => w.destroy());
    satWidget.destroy();
  };
}
