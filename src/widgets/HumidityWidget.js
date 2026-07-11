/**
 * @module widgets/HumidityWidget
 */

import { Widget } from './Widget.js';
import { el } from '../utils/dom.js';
import { t } from '../utils/i18n.js';
import { formatPercent } from '../utils/units.js';

export class HumidityWidget extends Widget {
  constructor(data = {}) {
    super({ id: 'humidity', title: t('humidity'), icon: '💧' });
    this.data = data;
  }

  update(data) {
    this.data = data;
    this.setTitle(t('humidity'));
    this.render();
  }

  render() {
    if (!this.body) {
      return;
    }
    this.body.innerHTML = '';
    const h = this.data.weather?.current?.humidity;
    this.body.append(
      el('p', { className: 'metric-value', text: formatPercent(h) }),
      el('div', { className: 'meter' }, [
        el('div', {
          className: 'meter-fill',
          style: { width: `${Math.min(100, Math.max(0, h ?? 0))}%` },
        }),
      ])
    );
  }
}
