/**
 * @module widgets/AlertWidget
 */

import { Widget } from './Widget.js';
import { el } from '../utils/dom.js';
import { t } from '../utils/i18n.js';
import { buildAlerts } from '../utils/weather.js';

export class AlertWidget extends Widget {
  constructor(data = {}) {
    super({ id: 'alerts', title: t('alerts'), icon: '⚠️', className: 'widget-wide' });
    this.data = data;
  }

  update(data) {
    this.data = data;
    this.setTitle(t('alerts'));
    this.render();
  }

  render() {
    if (!this.body) {
      return;
    }
    this.body.innerHTML = '';
    const alerts = buildAlerts(this.data.weather, this.data.airQuality);

    if (!alerts.length) {
      this.body.append(el('p', { className: 'muted', text: t('no_alerts') }));
      return;
    }

    const list = el('ul', { className: 'alert-list' });
    for (const a of alerts) {
      list.append(
        el('li', { className: `alert-item severity-${a.severity}` }, [
          el('span', { text: a.message }),
        ])
      );
    }
    this.body.append(list);
  }
}
