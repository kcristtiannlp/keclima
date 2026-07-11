/**
 * @module widgets/WindWidget
 */

import { Widget } from './Widget.js';
import { el } from '../utils/dom.js';
import { t } from '../utils/i18n.js';
import { formatWind, windDirectionLabel } from '../utils/units.js';

export class WindWidget extends Widget {
  constructor(data = {}) {
    super({ id: 'wind', title: t('wind'), icon: '💨' });
    this.data = data;
  }

  update(data) {
    this.data = data;
    this.setTitle(t('wind'));
    this.render();
  }

  render() {
    if (!this.body) {
      return;
    }
    this.body.innerHTML = '';
    const c = this.data.weather?.current;
    if (!c) {
      this.body.append(el('p', { className: 'muted', text: '—' }));
      return;
    }

    const dir = windDirectionLabel(c.windDirection);
    this.body.append(
      el('p', { className: 'metric-value', text: formatWind(c.windSpeed, 0) }),
      el('div', { className: 'wind-dir-row' }, [
        el('span', {
          className: 'wind-arrow',
          style: { transform: `rotate(${(c.windDirection ?? 0) + 180}deg)` },
          text: '↑',
          title: `${c.windDirection ?? 0}°`,
        }),
        el('span', { text: `${t('direction')}: ${dir} (${Math.round(c.windDirection ?? 0)}°)` }),
      ]),
      el('p', {
        className: 'metric-sub',
        text: `${t('gusts')}: ${formatWind(c.windGusts, 0)}`,
      })
    );
  }
}
