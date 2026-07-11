/**
 * Página de gráficos multi-período.
 * @module pages/ChartsPage
 */

import { el } from '../utils/dom.js';
import { getState } from '../core/State.js';
import { EventBus, Events } from '../core/EventBus.js';
import { ChartWidget } from '../widgets/ChartWidget.js';
import { getSettings } from '../storage/settingsStore.js';
import { loadArchive } from '../services/weatherService.js';

/**
 * @param {HTMLElement} container
 */
export async function renderChartsPage(container) {
  const grid = el('div', { className: 'charts-grid' });
  container.append(grid);

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

  const unsubs = [
    EventBus.on(Events.WEATHER_UPDATED, sync),
    EventBus.on(Events.ARCHIVE_UPDATED, sync),
    EventBus.on(Events.SETTINGS_CHANGED, sync),
    EventBus.on(Events.THEME_CHANGED, sync),
  ];

  container._teardown = () => {
    unsubs.forEach((u) => u());
    widgets.forEach((w) => w.destroy());
  };
}
