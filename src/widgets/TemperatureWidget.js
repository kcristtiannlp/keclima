/**
 * @module widgets/TemperatureWidget
 */

import { Widget } from './Widget.js';
import { el } from '../utils/dom.js';
import { t, weatherLabel } from '../utils/i18n.js';
import { formatTemp } from '../utils/units.js';
import { getWeatherMeta } from '../utils/weather.js';

export class TemperatureWidget extends Widget {
  constructor(data = {}) {
    super({
      id: 'temperature',
      title: t('temperature'),
      icon: '🌡️',
      className: 'widget-temp widget-hero',
    });
    this.data = data;
  }

  update(data) {
    this.data = data;
    this.setTitle(t('temperature'));
    this.render();
  }

  render() {
    if (!this.body) {
      return;
    }
    this.body.innerHTML = '';
    const weather = this.data.weather;

    if (this.data.loading && !weather?.current) {
      this.body.append(skeleton());
      return;
    }

    if (!weather?.current) {
      this.body.append(el('p', { className: 'muted', text: '—' }));
      return;
    }

    const c = weather.current;
    const meta = getWeatherMeta(c.weatherCode);
    const daily = weather.daily;
    const elev = weather.elevation;

    this.body.append(
      el('div', { className: 'hero-temp' }, [
        el('div', { className: 'hero-temp-left' }, [
          el('span', { className: 'temp-icon pulse-soft', text: meta.icon }),
          el('div', {}, [
            el('span', { className: 'temp-value', text: formatTemp(c.temperature, 0) }),
            el('p', { className: 'temp-condition', text: weatherLabel(c.weatherCode) }),
          ]),
        ]),
        el('div', { className: 'hero-temp-meta' }, [
          el('div', { className: 'chip' }, [
            el('span', { className: 'chip-label', text: t('feels_like') }),
            el('strong', { text: formatTemp(c.apparentTemperature, 0) }),
          ]),
          daily?.temperatureMax?.[0] !== undefined
            ? el('div', { className: 'chip' }, [
                el('span', { className: 'chip-label', text: t('max_temp') }),
                el('strong', { text: formatTemp(daily.temperatureMax[0], 0) }),
              ])
            : null,
          daily?.temperatureMin?.[0] !== undefined
            ? el('div', { className: 'chip' }, [
                el('span', { className: 'chip-label', text: t('min_temp') }),
                el('strong', { text: formatTemp(daily.temperatureMin[0], 0) }),
              ])
            : null,
          elev != null
            ? el('div', { className: 'chip' }, [
                el('span', { className: 'chip-label', text: t('elevation') }),
                el('strong', { text: `${Math.round(elev)} m` }),
              ])
            : null,
        ]),
      ])
    );
  }
}

function skeleton() {
  return el('div', { className: 'skeleton-stack' }, [
    el('div', { className: 'skeleton sk-line lg' }),
    el('div', { className: 'skeleton sk-line' }),
    el('div', { className: 'skeleton sk-line sm' }),
  ]);
}
