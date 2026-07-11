/**
 * @module widgets/AQIWidget
 */

import { Widget } from './Widget.js';
import { el } from '../utils/dom.js';
import { t } from '../utils/i18n.js';
import { aqiLevel } from '../utils/weather.js';

export class AQIWidget extends Widget {
  constructor(data = {}) {
    super({ id: 'aqi', title: t('aqi'), icon: '🏭' });
    this.data = data;
  }

  update(data) {
    this.data = data;
    this.setTitle(t('aqi'));
    this.render();
  }

  render() {
    if (!this.body) {
      return;
    }
    this.body.innerHTML = '';
    const aq = this.data.airQuality;
    if (!aq) {
      this.body.append(el('p', { className: 'muted', text: '—' }));
      return;
    }

    const level = aqiLevel(aq.usAqi);
    this.body.append(
      el('p', {
        className: 'metric-value',
        style: { color: level.color },
        text: aq.usAqi !== null && aq.usAqi !== undefined ? String(Math.round(aq.usAqi)) : '—',
      }),
      el('p', {
        className: 'metric-sub',
        style: { color: level.color },
        text: level.label,
      }),
      el('div', { className: 'aqi-grid' }, [
        el('span', { text: `${t('pm25')}: ${fmt(aq.pm25)}` }),
        el('span', { text: `${t('pm10')}: ${fmt(aq.pm10)}` }),
        el('span', { text: `${t('co')}: ${fmt(aq.co)}` }),
        el('span', { text: `${t('no2')}: ${fmt(aq.no2)}` }),
        el('span', { text: `${t('so2')}: ${fmt(aq.so2)}` }),
        el('span', { text: `${t('ozone')}: ${fmt(aq.ozone)}` }),
      ])
    );
  }
}

function fmt(v) {
  if (v === null || v === undefined || Number.isNaN(v)) {
    return '—';
  }
  return v >= 10 ? Math.round(v).toString() : v.toFixed(1);
}
