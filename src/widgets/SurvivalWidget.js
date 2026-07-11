/**
 * Quadro de situação / preparação civil.
 * @module widgets/SurvivalWidget
 */

import { Widget } from './Widget.js';
import { el } from '../utils/dom.js';
import { t } from '../utils/i18n.js';
import { assessSurvivalThreats } from '../utils/survival.js';
import { navigate, ROUTES } from '../router.js';

export class SurvivalWidget extends Widget {
  constructor(data = {}) {
    super({
      id: 'survival',
      title: t('surv_title'),
      icon: '🛡️',
      className: 'widget-wide widget-survival',
    });
    this.data = data;
  }

  update(data) {
    this.data = data;
    this.setTitle(t('surv_title'));
    this.render();
  }

  render() {
    if (!this.body) {
      return;
    }
    this.body.innerHTML = '';

    const assessment = assessSurvivalThreats({
      weather: this.data.weather,
      airQuality: this.data.airQuality,
      firesNearby: this.data.firesNearby ?? null,
    });

    const badge = el('div', {
      className: `surv-level surv-level-${assessment.level}`,
    }, [
      el('span', { className: 'surv-level-label', text: assessment.levelLabel }),
      el('span', {
        className: 'surv-level-count muted',
        text: assessment.threats.length
          ? `${assessment.threats.length} ${t('surv_threats')}`
          : t('surv_all_clear'),
      }),
    ]);

    this.body.append(badge);

    if (!assessment.threats.length) {
      this.body.append(
        el('p', { className: 'muted surv-ok-msg', text: t('surv_ok_detail') })
      );
    } else {
      const list = el('ul', { className: 'surv-threat-list' });
      for (const th of assessment.threats.slice(0, 5)) {
        list.append(
          el('li', { className: `surv-threat severity-${th.severity}` }, [
            el('strong', { text: th.title }),
            el('span', { className: 'surv-threat-sum', text: th.summary }),
            th.actions?.[0]
              ? el('span', { className: 'surv-threat-act muted', text: `→ ${th.actions[0]}` })
              : null,
          ])
        );
      }
      this.body.append(list);
    }

    const actions = el('div', { className: 'surv-quick-actions' }, [
      el('button', {
        type: 'button',
        className: 'btn btn-sm btn-primary',
        text: t('surv_open_prep'),
        onClick: () => navigate(ROUTES.survival),
      }),
      el('a', {
        className: 'btn btn-sm',
        href: 'https://alertas2.inmet.gov.br/',
        target: '_blank',
        rel: 'noopener noreferrer',
        text: t('surv_link_inmet'),
      }),
    ]);
    this.body.append(actions);
    this.body.append(
      el('p', { className: 'muted field-hint surv-disc', text: assessment.disclaimer })
    );
  }
}
