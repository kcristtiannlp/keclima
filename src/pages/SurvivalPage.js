/**
 * Página Preparação — consciência situacional e checklists.
 * @module pages/SurvivalPage
 */

import { el } from '../utils/dom.js';
import { t } from '../utils/i18n.js';
import { getState } from '../core/State.js';
import { EventBus, Events } from '../core/EventBus.js';
import {
  assessSurvivalThreats,
  resolveKits,
  fireWeatherScore,
  fireWeatherMeta,
} from '../utils/survival.js';
import { navigate, ROUTES } from '../router.js';

/**
 * @param {HTMLElement} container
 */
export async function renderSurvivalPage(container) {
  const page = el('div', { className: 'page-panel survival-page' });
  container.append(page);

  function render() {
    page.innerHTML = '';
    const state = getState();
    const assessment = assessSurvivalThreats({
      weather: state.weather,
      airQuality: state.airQuality,
      firesNearby: null,
    });

    const c = state.weather?.current;
    const fw = fireWeatherScore(
      c?.temperature ?? null,
      c?.humidity ?? null,
      c?.windSpeed ?? null
    );
    const fwMeta = fireWeatherMeta(fw);

    page.append(
      el('header', { className: 'surv-page-hero' }, [
        el('h2', { text: t('surv_page_title') }),
        el('p', { className: 'muted', text: t('surv_page_intro') }),
      ])
    );

    // Nível
    page.append(
      el('section', { className: `surv-panel surv-level-panel surv-level-${assessment.level}` }, [
        el('h3', { text: t('surv_situation') }),
        el('p', { className: 'surv-level-big', text: assessment.levelLabel }),
        el('p', {
          className: 'muted',
          text: assessment.threats.length
            ? `${assessment.threats.length} ${t('surv_threats')}`
            : t('surv_all_clear'),
        }),
        el('p', {
          className: 'surv-fw-line',
          text: `${t('surv_fire_weather')}: ${fw}/100 · ${t(fwMeta.labelKey)}`,
        }),
        el('p', { className: 'muted field-hint', text: t('surv_fw_not_official') }),
      ])
    );

    // Ameaças
    const threatSec = el('section', { className: 'surv-panel' }, [
      el('h3', { text: t('surv_active_threats') }),
    ]);
    if (!assessment.threats.length) {
      threatSec.append(el('p', { className: 'muted', text: t('surv_ok_detail') }));
    } else {
      const ul = el('ul', { className: 'surv-threat-list surv-threat-list-full' });
      for (const th of assessment.threats) {
        const acts = el('ul', { className: 'surv-actions' });
        for (const a of th.actions || []) {
          acts.append(el('li', { text: a }));
        }
        ul.append(
          el('li', { className: `surv-threat severity-${th.severity}` }, [
            el('strong', { text: th.title }),
            el('p', { text: th.summary }),
            acts,
          ])
        );
      }
      threatSec.append(ul);
    }
    page.append(threatSec);

    // Checklists
    const kits = resolveKits(assessment.kitIds);
    const kitSec = el('section', { className: 'surv-panel' }, [
      el('h3', { text: t('surv_checklists') }),
      el('p', { className: 'muted field-hint', text: t('surv_checklists_hint') }),
    ]);
    for (const kit of kits) {
      const box = el('div', { className: 'surv-kit' }, [
        el('h4', { text: t(kit.titleKey) }),
      ]);
      const ul = el('ul', { className: 'surv-checklist' });
      for (const itemKey of kit.items) {
        const id = `chk-${kit.id}-${itemKey}`;
        ul.append(
          el('li', {}, [
            el('label', { className: 'surv-check-label', for: id }, [
              el('input', { type: 'checkbox', id, className: 'surv-check' }),
              el('span', { text: t(itemKey) }),
            ]),
          ])
        );
      }
      box.append(ul);
      kitSec.append(box);
    }
    page.append(kitSec);

    // Links oficiais
    const linkSec = el('section', { className: 'surv-panel' }, [
      el('h3', { text: t('surv_official') }),
      el('p', { className: 'muted field-hint', text: t('surv_official_hint') }),
    ]);
    const linkRow = el('div', { className: 'surv-link-row' });
    for (const L of assessment.officialLinks) {
      linkRow.append(
        el('a', {
          className: 'btn btn-sm',
          href: L.href,
          target: '_blank',
          rel: 'noopener noreferrer',
          text: L.label,
        })
      );
    }
    linkRow.append(
      el('button', {
        type: 'button',
        className: 'btn btn-sm',
        text: t('nav_map'),
        onClick: () => navigate(ROUTES.map),
      })
    );
    // Emergência BR
    linkRow.append(
      el('span', {
        className: 'surv-emergency-nums',
        text: t('surv_emergency_numbers'),
      })
    );
    linkSec.append(linkRow);
    page.append(linkSec);

    page.append(
      el('p', { className: 'muted field-hint surv-disc', text: assessment.disclaimer })
    );
  }

  render();
  const unsubs = [
    EventBus.on(Events.WEATHER_UPDATED, render),
    EventBus.on(Events.AIR_QUALITY_UPDATED, render),
    EventBus.on(Events.SETTINGS_CHANGED, render),
  ];
  container._teardown = () => {
    unsubs.forEach((u) => u());
  };
}
