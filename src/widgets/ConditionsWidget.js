/**
 * Nebulosidade, visibilidade, chuva e acumulado.
 * @module widgets/ConditionsWidget
 */

import { Widget } from './Widget.js';
import { el } from '../utils/dom.js';
import { t } from '../utils/i18n.js';
import { formatPercent, formatVisibility, formatPrecip } from '../utils/units.js';
import { currentVisibility, currentPrecipProb } from '../utils/weather.js';

export class ConditionsWidget extends Widget {
  constructor(data = {}) {
    super({ id: 'conditions', title: t('condition'), icon: '☁️', className: 'widget-wide' });
    this.data = data;
  }

  update(data) {
    this.data = data;
    this.setTitle(t('condition'));
    this.render();
  }

  render() {
    if (!this.body) {
      return;
    }
    this.body.innerHTML = '';
    const weather = this.data.weather;
    if (!weather?.current) {
      this.body.append(el('p', { className: 'muted', text: '—' }));
      return;
    }

    const c = weather.current;
    const vis = currentVisibility(weather);
    const rainChance = currentPrecipProb(weather);
    const todayPrecip = weather.daily?.precipitationSum?.[0];

    this.body.append(
      el('div', { className: 'conditions-grid' }, [
        metric(t('cloud_cover'), formatPercent(c.cloudCover)),
        metric(t('visibility'), formatVisibility(vis)),
        metric(t('rain_chance'), formatPercent(rainChance)),
        metric(t('precipitation'), formatPrecip(c.precipitation)),
        metric(`${t('precipitation')} (24h)`, formatPrecip(todayPrecip)),
      ])
    );
  }
}

function metric(label, value) {
  return el('div', { className: 'condition-item' }, [
    el('span', { className: 'label', text: label }),
    el('strong', { text: value }),
  ]);
}
