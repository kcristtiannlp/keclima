/**
 * @module widgets/MoonWidget
 */

import { Widget } from './Widget.js';
import { el } from '../utils/dom.js';
import { t } from '../utils/i18n.js';
import { getMoonPhase } from '../utils/weather.js';

export class MoonWidget extends Widget {
  constructor(data = {}) {
    super({ id: 'moon', title: t('moon'), icon: '🌙' });
    this.data = data;
  }

  update(data) {
    this.data = data;
    this.setTitle(t('moon'));
    this.render();
  }

  render() {
    if (!this.body) {
      return;
    }
    this.body.innerHTML = '';
    const moon = getMoonPhase(new Date());
    this.body.append(
      el('p', { className: 'moon-icon', text: moon.icon }),
      el('p', { className: 'metric-value small', text: t(moon.key) }),
      el('p', { className: 'metric-sub', text: `${moon.illumination}%` })
    );
  }
}
