/**
 * @module widgets/PressureWidget
 */

import { Widget } from './Widget.js';
import { el } from '../utils/dom.js';
import { t } from '../utils/i18n.js';
import { formatPressure } from '../utils/units.js';
import { pressureTrend } from '../utils/weather.js';

export class PressureWidget extends Widget {
  constructor(data = {}) {
    super({ id: 'pressure', title: t('pressure'), icon: '⏲️' });
    this.data = data;
  }

  update(data) {
    this.data = data;
    this.setTitle(t('pressure'));
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

    const pressures = (weather.hourly?.pressure || []).slice(0, 12);
    const trend = pressureTrend(pressures);
    const trendKey =
      trend === 'rising' ? 'trend_rising' : trend === 'falling' ? 'trend_falling' : 'trend_stable';
    const arrow = trend === 'rising' ? '↑' : trend === 'falling' ? '↓' : '→';

    this.body.append(
      el('p', { className: 'metric-value', text: formatPressure(weather.current.pressure) }),
      el('p', {
        className: `metric-sub trend-${trend}`,
        text: `${t('pressure_trend')}: ${arrow} ${t(trendKey)}`,
      })
    );
  }
}
