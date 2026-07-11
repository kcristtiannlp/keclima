/**
 * Página do mapa em tela cheia (fluida).
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
  const wrap = el('div', { className: 'page-map page-map-full' });
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

  // Layout estável após paint (mobile + sticky header)
  const resize = () => mapWidget.map?.invalidateSize();
  requestAnimationFrame(() => {
    resize();
    setTimeout(resize, 80);
    setTimeout(resize, 280);
  });
  window.addEventListener('resize', resize, { passive: true });
  window.addEventListener('orientationchange', resize, { passive: true });

  container._teardown = () => {
    unsubs.forEach((u) => u());
    window.removeEventListener('resize', resize);
    window.removeEventListener('orientationchange', resize);
    mapWidget.destroy();
  };
}
