/**
 * Card de desmatamento (INPE DETER) + links oficiais.
 * @module widgets/DeforestationWidget
 */

import { Widget } from './Widget.js';
import { el } from '../utils/dom.js';
import { t } from '../utils/i18n.js';
import {
  fetchDeforestationAlerts,
  bboxAroundPlace,
} from '../api/providers/deforestation.js';
import { isLikelyBrazil } from '../api/providers/inmet.js';

export class DeforestationWidget extends Widget {
  constructor(data = {}) {
    super({
      id: 'deforestation',
      title: t('deforestation_title'),
      icon: '🌲',
      className: 'widget-wide widget-deforestation',
    });
    this.data = data;
    this._payload = null;
    this._loading = false;
    this._error = null;
    this._abort = null;
    this._lastKey = '';
  }

  update(data) {
    this.data = data;
    this.setTitle(t('deforestation_title'));
    const loc = data.location;
    const key = loc ? `${loc.latitude.toFixed(2)},${loc.longitude.toFixed(2)}` : '';
    if (key && key !== this._lastKey) {
      this._lastKey = key;
      this._load(loc);
    } else {
      this.render();
    }
  }

  destroy() {
    this._abort?.abort();
    super.destroy();
  }

  async _load(loc) {
    if (!loc || !isLikelyBrazil(loc.latitude, loc.longitude)) {
      this._payload = { inBrazil: false, count: 0, alerts: [], links: defaultLinks() };
      this.render();
      return;
    }
    this._abort?.abort();
    this._abort = new AbortController();
    this._loading = true;
    this._error = null;
    this.render();
    try {
      const box = bboxAroundPlace(loc.latitude, loc.longitude, 2.2);
      this._payload = await fetchDeforestationAlerts({
        ...box,
        signal: this._abort.signal,
      });
    } catch (err) {
      if (err?.name === 'AbortError') {
        return;
      }
      this._error = err?.message || 'error';
      this._payload = null;
    } finally {
      this._loading = false;
      this.render();
    }
  }

  render() {
    if (!this.body) {
      return;
    }
    this.body.innerHTML = '';

    if (this._loading) {
      this.body.append(
        el('div', { className: 'skeleton-stack' }, [
          el('div', { className: 'skeleton sk-line lg' }),
          el('div', { className: 'skeleton sk-line' }),
        ])
      );
      return;
    }

    if (this._error) {
      this.body.append(
        el('p', { className: 'muted', text: t('deforestation_error') }),
        el('p', { className: 'metric-sub', text: t('deforestation_proxy_hint') }),
        linksBlock(defaultLinks(this.data.location), false)
      );
      return;
    }

    const d = this._payload;
    if (!d) {
      this.body.append(el('p', { className: 'muted', text: '—' }));
      return;
    }

    if (d.inBrazil === false) {
      this.body.append(
        el('p', { className: 'muted', text: t('deforestation_outside') }),
        linksBlock(d.links || defaultLinks(this.data.location), false)
      );
      return;
    }

    const nearest = d.nearest;
    this.body.append(
      el('p', { className: 'defor-disclaimer muted', text: t('deforestation_disclaimer') })
    );

    this.body.append(
      el('div', { className: 'defor-stats' }, [
        el('div', { className: 'defor-stat' }, [
          el('span', { className: 'label', text: t('deforestation_alerts') }),
          el('strong', { text: String(d.count ?? 0) }),
        ]),
        el('div', { className: 'defor-stat' }, [
          el('span', { className: 'label', text: t('deforestation_area') }),
          el('strong', {
            text: d.areaKm2 != null ? `${Number(d.areaKm2).toFixed(2)} km²` : '—',
          }),
        ]),
      ])
    );

    if (nearest) {
      this.body.append(
        el('div', { className: 'defor-nearest' }, [
          el('strong', { text: t('deforestation_nearest') }),
          el('p', {
            text: [
              nearest.classname,
              nearest.municipality,
              nearest.uf,
              nearest.viewDate,
              nearest.distanceKm != null ? `${nearest.distanceKm} km` : null,
              nearest.areaKm2 != null ? `${Number(nearest.areaKm2).toFixed(3)} km²` : null,
            ]
              .filter(Boolean)
              .join(' · '),
          }),
        ])
      );
    } else {
      this.body.append(el('p', { className: 'muted', text: t('deforestation_none') }));
    }

    // lista curta
    const list = el('ul', { className: 'defor-list' });
    for (const a of (d.alerts || []).slice(0, 5)) {
      list.append(
        el('li', {
          text: [
            a.viewDate || '—',
            a.classname,
            a.municipality,
            a.uf,
            a.distanceKm != null ? `${a.distanceKm} km` : null,
          ]
            .filter(Boolean)
            .join(' · '),
        })
      );
    }
    if ((d.alerts || []).length) {
      this.body.append(list);
    }

    this.body.append(
      el('p', { className: 'metric-sub', text: d.source || 'INPE DETER' }),
      linksBlock(d.links || defaultLinks(this.data.location), true)
    );
  }
}

function linksBlock(links, isBrazil = true) {
  const L = links || defaultLinks();
  return el('div', { className: 'official-links' }, [
    el('p', { className: 'official-links-title', text: t('deforestation_links') }),
    el('div', { className: 'official-links-row' }, [
      isBrazil ? link(L.terrabrasilis, t('link_terrabrasilis')) : null,
      isBrazil ? link(L.deterAmazon || L.deterCerrado || L.deter, t('link_deter')) : null,
      isBrazil ? link(L.prodes, t('link_prodes')) : null,
      isBrazil ? link(L.mapbiomas, 'MapBiomas Alerta') : null,
      link(L.gfw, 'Global Forest Watch'),
    ].filter(Boolean)),
  ]);
}

function link(href, label) {
  if (!href) {
    return null;
  }
  return el('a', {
    className: 'btn btn-sm',
    href,
    target: '_blank',
    rel: 'noopener noreferrer',
    text: label,
  });
}

function defaultLinks(loc) {
  const base = {
    terrabrasilis: 'https://terrabrasilis.dpi.inpe.br/',
    deterAmazon: 'https://terrabrasilis.dpi.inpe.br/app/dashboard/alerts/legal/amazon/daily/',
    prodes: 'https://terrabrasilis.dpi.inpe.br/app/map/deforestation/',
    mapbiomas: 'https://plataforma.alerta.mapbiomas.org/',
  };
  if (loc) {
    base.gfw = `https://www.globalforestwatch.org/map/?map=8/${loc.latitude.toFixed(2)}/${loc.longitude.toFixed(2)}`;
  } else {
    base.gfw = 'https://www.globalforestwatch.org/map/';
  }
  return base;
}
