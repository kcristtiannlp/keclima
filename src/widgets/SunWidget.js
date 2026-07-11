/**
 * @module widgets/SunWidget
 */

import { Widget } from './Widget.js';
import { el } from '../utils/dom.js';
import { t } from '../utils/i18n.js';
import { formatTime } from '../utils/units.js';

export class SunWidget extends Widget {
  constructor(data = {}) {
    super({ id: 'sun', title: t('sunrise'), icon: '🌅' });
    this.data = data;
  }

  update(data) {
    this.data = data;
    this.setTitle(`${t('sunrise')} / ${t('sunset')}`);
    this.render();
  }

  render() {
    if (!this.body) {
      return;
    }
    this.body.innerHTML = '';
    const daily = this.data.weather?.daily;
    if (!daily?.sunrise?.[0]) {
      this.body.append(el('p', { className: 'muted', text: '—' }));
      return;
    }

    const sunrise = new Date(daily.sunrise[0]);
    const sunset = new Date(daily.sunset[0]);
    const now = Date.now();
    const total = sunset.getTime() - sunrise.getTime();
    const progress = total > 0 ? Math.min(1, Math.max(0, (now - sunrise.getTime()) / total)) : 0;

    this.body.append(
      el('div', { className: 'sun-times' }, [
        el('div', {}, [
          el('span', { className: 'label', text: t('sunrise') }),
          el('strong', { text: formatTime(sunrise) }),
        ]),
        el('div', {}, [
          el('span', { className: 'label', text: t('sunset') }),
          el('strong', { text: formatTime(sunset) }),
        ]),
      ]),
      el('div', { className: 'sun-arc' }, [
        el('div', { className: 'sun-track' }),
        el('div', {
          className: 'sun-dot',
          style: { left: `${progress * 100}%` },
        }),
      ])
    );
  }
}
