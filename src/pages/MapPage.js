/**
 * Página do mapa em tela cheia.
 * @module pages/MapPage
 */

import { el } from '../utils/dom.js';
import { getState } from '../core/State.js';
import { EventBus, Events } from '../core/EventBus.js';
import { MapWidget } from '../widgets/MapWidget.js';

/**
 * @param {HTMLElement} container
 */
export async function renderMapPage(container) {
  const wrap = el('div', { className: 'page-map' });
  container.append(wrap);

  const mapWidget = new MapWidget(getState());
  wrap.append(mapWidget.mount());

  function sync() {
    mapWidget.update({
      weather: getState().weather,
      airQuality: getState().airQuality,
      location: getState().location,
    });
  }

  const unsubs = [
    EventBus.on(Events.LOCATION_CHANGED, sync),
    EventBus.on(Events.WEATHER_UPDATED, sync),
  ];

  // ensure size after layout
  setTimeout(() => {
    mapWidget.map?.invalidateSize();
  }, 100);

  container._teardown = () => {
    unsubs.forEach((u) => u());
    mapWidget.destroy();
  };
}
