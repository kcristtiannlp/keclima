/**
 * Transparência de fontes de dados — ênfase em mapas e camadas.
 * @module widgets/SourcesWidget
 */

import { Widget } from './Widget.js';
import { el } from '../utils/dom.js';
import { t } from '../utils/i18n.js';
import { MAP_SOURCES, MAP_SOURCE_GROUPS } from '../data/mapCatalog.js';

export class SourcesWidget extends Widget {
  constructor(data = {}) {
    super({
      id: 'sources',
      title: t('sources_title'),
      icon: '🔗',
      className: 'widget-wide widget-sources',
    });
    this.data = data;
  }

  update(data) {
    this.data = data;
    this.setTitle(t('sources_title'));
    this.render();
  }

  render() {
    if (!this.body) {
      return;
    }
    this.body.innerHTML = '';

    this.body.append(
      el('p', {
        className: 'sources-lead',
        text: t('sources_lead'),
      })
    );

    // Destaque: mapas
    this.body.append(
      el('h3', { className: 'sources-section-title', text: t('sources_section_maps') })
    );

    for (const g of MAP_SOURCE_GROUPS) {
      const items = MAP_SOURCES.filter((s) => s.group === g.id);
      if (!items.length) continue;
      const section = el('section', { className: 'sources-group' });
      section.append(
        el('h4', { className: 'sources-group-title', text: t(g.titleKey) })
      );
      const list = el('ul', { className: 'sources-list sources-list-rich' });
      for (const it of items) {
        const nameNode = it.url
          ? el('a', {
              href: it.url,
              target: '_blank',
              rel: 'noopener noreferrer',
              text: it.name,
            })
          : el('strong', { text: it.name });
        list.append(
          el('li', { className: 'sources-item' }, [
            el('div', { className: 'sources-item-head' }, [
              nameNode,
              it.needsProxy
                ? el('span', { className: 'sources-badge', text: t('sources_needs_proxy') })
                : null,
            ].filter(Boolean)),
            el('div', { className: 'sources-item-meta' }, [
              el('span', { text: it.provider }),
              el('span', { className: 'muted', text: ` · ${it.role}` }),
            ]),
            el('small', { className: 'muted', text: it.note }),
          ])
        );
      }
      section.append(list);
      this.body.append(section);
    }

    this.body.append(
      el('h3', { className: 'sources-section-title', text: t('sources_section_core') })
    );

    const core = [
      { role: t('source_role_forecast'), name: 'Open-Meteo', note: t('source_note_model'), url: 'https://open-meteo.com/' },
      { role: t('source_role_observed'), name: 'INMET', note: t('source_note_inmet'), url: 'https://portal.inmet.gov.br/' },
      { role: t('source_role_aqi'), name: 'Open-Meteo Air Quality', note: t('source_note_aqi'), url: 'https://open-meteo.com/en/docs/air-quality-api' },
      { role: t('source_role_alerts'), name: t('source_alerts_name'), note: t('source_note_alerts') },
    ];
    const coreList = el('ul', { className: 'sources-list' });
    for (const it of core) {
      coreList.append(
        el('li', {}, [
          el('strong', { text: it.role }),
          it.url
            ? el('a', {
                href: it.url,
                target: '_blank',
                rel: 'noopener noreferrer',
                text: ` — ${it.name}`,
              })
            : el('span', { text: ` — ${it.name}` }),
          el('small', { className: 'muted', text: ` · ${it.note}` }),
        ])
      );
    }
    this.body.append(coreList);

    this.body.append(
      el('p', { className: 'muted sources-footer-note', text: t('sources_trust_note') }),
      el('p', {
        className: 'muted sources-footer-note',
        text: t('sources_proxy_note'),
      })
    );
  }
}
