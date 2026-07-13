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
        el('li', { text: '✈️ ADSB.lol + OpenSky — voos ao vivo (proxy)' }),
        el('li', { text: '🚢 Digitraffic + AISStream (opcional) — navios AIS' }),
        el('li', { text: '🌦️ Open-Meteo — previsão, grade, qualidade do ar' }),
        el('li', { text: '🇧🇷 INMET — estação observada + avisos oficiais (Alert-AS)' }),
        el('li', { text: '🗺️ OpenStreetMap / Nominatim + bases Carto/Esri' }),
        el('li', { text: '🌧️ RainViewer — radar e satélite IR' }),
        el('li', { text: '🔥 INPE Queimadas + NASA FIRMS — focos de calor' }),
        el('li', { text: '🌳 INPE DETER / PRODES (TerraBrasilis)' }),
        el('li', { text: '🌍 USGS — terremotos (GeoJSON público)' }),
        el('li', { text: '🛰️ NASA EONET — eventos naturais abertos' }),
        el('li', { text: '🛰 ISS — Where The ISS At / Open Notify' }),
        el('li', { text: '📡 GOES NOAA — satélite IV (América do Sul / disco / Atlântico)' }),
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
