/**
 * Página Sobre.
 * @module pages/AboutPage
 */

import { el } from '../utils/dom.js';
import { t } from '../utils/i18n.js';
import { APP_VERSION } from '../config.js';
import { EventBus, Events } from '../core/EventBus.js';

/**
 * @param {HTMLElement} container
 */
export async function renderAboutPage(container) {
  const page = el('div', { className: 'page-panel about-page' });
  container.append(page);

  function render() {
    page.innerHTML = '';
    page.append(
      el('div', { className: 'about-hero' }, [
        el('span', { className: 'about-logo', text: '⛅' }),
        el('h2', { text: t('about_title') }),
        el('p', { className: 'muted', text: t('about_desc') }),
      ]),
      el('h3', { text: t('about_apis') }),
      el('ul', { className: 'about-list' }, [
        el('li', { text: 'Open-Meteo Forecast & Archive (previsão / modelo)' }),
        el('li', { text: 'INMET — estação automática mais próxima (Brasil)' }),
        el('li', { text: 'Open-Meteo Air Quality' }),
        el('li', { text: 'OpenStreetMap Nominatim' }),
        el('li', { text: 'RainViewer (radar / satélite)' }),
        el('li', { text: 'INPE Queimadas + NASA FIRMS (focos de calor unificados)' }),
        el('li', { text: 'INPE DETER / PRODES via TerraBrasilis (desmatamento)' }),
        el('li', { text: 'OpenSky + hexdb/adsbdb (voos / aeronave)' }),
        el('li', { text: 'Links: avisos INMET · Defesa Civil · Queimadas' }),
        el('li', { text: 'Leaflet + Chart.js' }),
      ]),
      el('p', { className: 'muted field-hint', text: t('sources_trust_note') }),
      el('p', { className: 'muted field-hint', text: t('fires_disclaimer') }),
      el('p', {}, [
        el('strong', { text: `${t('about_version')}: ` }),
        el('span', { text: APP_VERSION }),
      ]),
      el('p', { className: 'muted', text: t('about_license') }),
      el('p', { className: 'muted sources-footer', text: t('sources_footer') })
    );
  }

  render();
  const unsub = EventBus.on(Events.SETTINGS_CHANGED, render);
  container._teardown = () => unsub();
}
