/**
 * Alertas locais (modelo) + avisos oficiais INMET (Alert-AS).
 * @module widgets/AlertWidget
 */

import { Widget } from './Widget.js';
import { el } from '../utils/dom.js';
import { t } from '../utils/i18n.js';
import { buildAlerts } from '../utils/weather.js';
import { getState } from '../core/State.js';

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

    const state = getState();
    const official = this.data.officialAlerts || state.officialAlerts;
    const inmetList = official?.alerts || [];
    const local = buildAlerts(this.data.weather, this.data.airQuality);

    if (!inmetList.length && !local.length) {
      this.body.append(el('p', { className: 'muted', text: t('no_alerts') }));
      return;
    }

    if (inmetList.length) {
      this.body.append(
        el('h3', { className: 'alert-section-title', text: t('alerts_inmet_section') })
      );
      const list = el('ul', { className: 'alert-list alert-list-official' });
      for (const a of inmetList) {
        list.append(this._renderOfficial(a));
      }
      this.body.append(list);
      this.body.append(
        el('p', {
          className: 'muted alert-source-note',
          text: official?.disclaimer || t('alerts_inmet_source'),
        })
      );
      this.body.append(
        el('a', {
          className: 'btn btn-sm btn-ghost alert-source-link',
          href: official?.sourceUrl || 'https://alertas2.inmet.gov.br/',
          target: '_blank',
          rel: 'noopener noreferrer',
          text: t('alerts_inmet_open'),
        })
      );
    }

    if (local.length) {
      this.body.append(
        el('h3', { className: 'alert-section-title', text: t('alerts_local_section') })
      );
      const list = el('ul', { className: 'alert-list' });
      for (const a of local) {
        list.append(
          el('li', { className: `alert-item severity-${a.severity}` }, [
            el('span', { text: a.message }),
          ])
        );
      }
      this.body.append(list);
    }
  }

  /**
   * @param {object} a
   */
  _renderOfficial(a) {
    const sev = a.severity || 'warning';
    const when =
      a.when === 'futuro' ? t('alerts_when_future') : t('alerts_when_today');
    const head = el('div', { className: 'alert-official-head' }, [
      el('strong', { text: a.title || a.event || t('alerts_inmet_section') }),
      el('span', {
        className: 'alert-badge',
        text: a.severityLabel || sev,
        style: a.color ? `border-color:${a.color};color:${a.color}` : undefined,
      }),
    ]);

    const parts = [];
    parts.push(
      el('p', {
        className: 'alert-official-msg',
        text: a.message || a.title || '',
      })
    );
    if (a.start || a.end) {
      parts.push(
        el('p', {
          className: 'muted alert-official-time',
          text: `${t('alerts_valid')}: ${a.start || '—'} → ${a.end || '—'} · ${when}`,
        })
      );
    }
    if (a.risks?.length) {
      parts.push(
        el('p', {
          className: 'alert-official-risk',
          text: a.risks.join(' '),
        })
      );
    }
    if (a.instructions?.length) {
      const ul = el('ul', { className: 'alert-instructions' });
      for (const ins of a.instructions.slice(0, 6)) {
        ul.append(el('li', { text: ins }));
      }
      parts.push(ul);
    }
    parts.push(
      el('small', {
        className: 'muted',
        text: `${a.provider || 'INMET'} · ${a.source || 'Alert-AS'}`,
      })
    );

    return el('li', { className: `alert-item alert-official severity-${sev}` }, [
      head,
      ...parts,
    ]);
  }
}
