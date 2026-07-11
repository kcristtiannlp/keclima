/**
 * Transparência de fontes de dados.
 * @module widgets/SourcesWidget
 */

import { Widget } from './Widget.js';
import { el } from '../utils/dom.js';
import { t } from '../utils/i18n.js';

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

    const items = [
      { role: t('source_role_forecast'), name: 'Open-Meteo', note: t('source_note_model') },
      { role: t('source_role_observed'), name: 'INMET', note: t('source_note_inmet') },
      { role: t('source_role_aqi'), name: 'Open-Meteo Air Quality', note: t('source_note_aqi') },
      { role: t('source_role_map'), name: 'OSM / RainViewer', note: t('source_note_map') },
      { role: t('source_role_fires'), name: 'INPE Queimadas + NASA FIRMS', note: t('source_note_fires') },
      {
        role: t('source_role_deforestation'),
        name: 'INPE DETER / PRODES (TerraBrasilis)',
        note: t('source_note_deforestation'),
      },
      { role: t('source_role_alerts'), name: t('source_alerts_name'), note: t('source_note_alerts') },
    ];

    const list = el('ul', { className: 'sources-list' });
    for (const it of items) {
      list.append(
        el('li', {}, [
          el('strong', { text: it.role }),
          el('span', { text: ` — ${it.name}` }),
          el('small', { className: 'muted', text: ` · ${it.note}` }),
        ])
      );
    }
    this.body.append(list);
    this.body.append(
      el('p', { className: 'muted sources-footer-note', text: t('sources_trust_note') })
    );
  }
}
