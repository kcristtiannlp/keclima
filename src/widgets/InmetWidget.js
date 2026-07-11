/**
 * Observado INMET + comparação com modelo Open-Meteo + links oficiais.
 * @module widgets/InmetWidget
 */

import { Widget } from './Widget.js';
import { el } from '../utils/dom.js';
import { t } from '../utils/i18n.js';
import { formatTemp, formatWind, formatPressure, formatPercent, formatPrecip } from '../utils/units.js';
import { fetchNearestInmet, isLikelyBrazil } from '../api/providers/inmet.js';

export class InmetWidget extends Widget {
  constructor(data = {}) {
    super({
      id: 'inmet',
      title: t('inmet_title'),
      icon: '🇧🇷',
      className: 'widget-wide widget-inmet',
    });
    this.data = data;
    /** @type {any} */
    this.inmet = null;
    this._loading = false;
    this._error = null;
    this._abort = null;
    this._lastKey = '';
  }

  update(data) {
    this.data = data;
    this.setTitle(t('inmet_title'));
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
    if (this._abort) {
      this._abort.abort();
    }
    super.destroy();
  }

  async _load(loc) {
    if (!loc) {
      this.inmet = null;
      this.render();
      return;
    }
    if (!isLikelyBrazil(loc.latitude, loc.longitude)) {
      this.inmet = { inBrazil: false, links: defaultLinks() };
      this.render();
      return;
    }

    if (this._abort) {
      this._abort.abort();
    }
    this._abort = new AbortController();
    this._loading = true;
    this._error = null;
    this.render();

    try {
      this.inmet = await fetchNearestInmet(loc.latitude, loc.longitude, this._abort.signal);
      this._error = null;
    } catch (err) {
      if (err?.name === 'AbortError') {
        return;
      }
      this._error = err?.message || 'error';
      this.inmet = null;
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
          el('div', { className: 'skeleton sk-line sm' }),
        ])
      );
      return;
    }

    if (this._error) {
      this.body.append(
        el('p', { className: 'muted', text: t('inmet_error') }),
        el('p', { className: 'metric-sub', text: t('inmet_proxy_hint') }),
        linksBlock(defaultLinks())
      );
      return;
    }

    if (!this.inmet) {
      this.body.append(el('p', { className: 'muted', text: '—' }));
      return;
    }

    if (this.inmet.inBrazil === false) {
      this.body.append(
        el('p', { className: 'muted', text: t('inmet_outside') }),
        el('p', { className: 'metric-sub', text: t('inmet_outside_hint') }),
        linksBlock(this.inmet.links || defaultLinks())
      );
      return;
    }

    const st = this.inmet.station;
    const obs = this.inmet.observation;
    const model = this.data.weather?.current;

    // Cabeçalho da estação
    this.body.append(
      el('div', { className: 'inmet-head' }, [
        el('div', {}, [
          el('strong', { text: st?.name || '—' }),
          el('span', {
            className: 'muted',
            text: ` · ${st?.code || ''} · ${st?.state || ''} · ${st?.distanceKm ?? '—'} km`,
          }),
        ]),
        el('span', {
          className: `inmet-badge ${obs?.available ? 'ok' : 'partial'}`,
          text: obs?.available ? t('inmet_observed') : t('inmet_station_only'),
        }),
      ])
    );

    this.body.append(
      el('p', { className: 'inmet-disclaimer muted', text: t('inmet_disclaimer') })
    );

    // Grid: Modelo vs INMET
    const rows = [
      {
        label: t('temperature'),
        model: model ? formatTemp(model.temperature, 0) : '—',
        inmet: obs?.available && obs.temperature != null ? formatTemp(obs.temperature, 0) : '—',
        delta:
          obs?.available && obs.temperature != null && model?.temperature != null
            ? deltaText(model.temperature, obs.temperature, (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}°`)
            : null,
      },
      {
        label: t('humidity'),
        model: model ? formatPercent(model.humidity) : '—',
        inmet: obs?.available && obs.humidity != null ? formatPercent(obs.humidity) : '—',
        delta: null,
      },
      {
        label: t('wind'),
        model: model ? formatWind(model.windSpeed, 0) : '—',
        inmet:
          obs?.available && obs.windSpeedKmh != null
            ? formatWind(obs.windSpeedKmh, 0)
            : obs?.available && obs.windSpeedMs != null
              ? formatWind(obs.windSpeedMs * 3.6, 0)
              : '—',
        delta: null,
      },
      {
        label: t('pressure'),
        model: model ? formatPressure(model.pressure) : '—',
        inmet: obs?.available && obs.pressure != null ? formatPressure(obs.pressure) : '—',
        delta: null,
      },
      {
        label: t('precipitation'),
        model: model ? formatPrecip(model.precipitation) : '—',
        inmet: obs?.available && obs.precipitation != null ? formatPrecip(obs.precipitation) : '—',
        delta: null,
      },
    ];

    const table = el('div', { className: 'inmet-compare' }, [
      el('div', { className: 'inmet-compare-head' }, [
        el('span', { text: '' }),
        el('span', { text: t('inmet_col_model') }),
        el('span', { text: t('inmet_col_station') }),
      ]),
    ]);

    for (const r of rows) {
      table.append(
        el('div', { className: 'inmet-compare-row' }, [
          el('span', { className: 'label', text: r.label }),
          el('span', { text: r.model }),
          el('span', {}, [
            el('strong', { text: r.inmet }),
            r.delta ? el('small', { className: 'delta-tag', text: ` ${r.delta}` }) : null,
          ]),
        ])
      );
    }
    this.body.append(table);

    if (obs?.available && obs.rawTime) {
      this.body.append(
        el('p', {
          className: 'metric-sub',
          text: `${t('inmet_obs_time')}: ${obs.rawTime}`,
        })
      );
    } else {
      this.body.append(
        el('p', { className: 'metric-sub', text: t('inmet_no_hourly') })
      );
    }

    this.body.append(linksBlock(this.inmet.links || defaultLinks()));
  }
}

function deltaText(model, station, fmt) {
  const d = model - station;
  if (Math.abs(d) < 0.15) {
    return '≈';
  }
  return fmt(d);
}

function linksBlock(links) {
  const L = links || defaultLinks();
  return el('div', { className: 'official-links' }, [
    el('p', { className: 'official-links-title', text: t('official_links') }),
    el('div', { className: 'official-links-row' }, [
      link(L.inmetPortal, t('link_inmet')),
      link(L.inmetAlerts, t('link_inmet_alerts')),
      link(L.inmetTempo, t('link_inmet_tempo')),
      link(L.defesaCivil, t('link_defesa_civil')),
    ]),
  ]);
}

function link(href, label) {
  return el('a', {
    className: 'btn btn-sm',
    href: href || '#',
    target: '_blank',
    rel: 'noopener noreferrer',
    text: label,
  });
}

function defaultLinks() {
  return {
    inmetPortal: 'https://portal.inmet.gov.br/',
    inmetTempo: 'https://tempo.inmet.gov.br/',
    inmetAlerts: 'https://alertas2.inmet.gov.br/',
    defesaCivil: 'https://www.gov.br/mdr/pt-br/assuntos/protecao-e-defesa-civil/defesa-civil-alerta',
  };
}
