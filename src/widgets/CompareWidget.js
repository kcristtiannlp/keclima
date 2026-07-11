/**
 * Comparação entre cidade atual e um favorito.
 * @module widgets/CompareWidget
 */

import { Widget } from './Widget.js';
import { el } from '../utils/dom.js';
import { t, weatherLabel } from '../utils/i18n.js';
import { formatTemp, formatWind, formatPercent } from '../utils/units.js';
import { getFavorites } from '../storage/favoritesStore.js';
import { loadCompareWeather } from '../services/weatherService.js';
import { getWeatherMeta } from '../utils/weather.js';
import { getSettings, updateSettings } from '../storage/settingsStore.js';

export class CompareWidget extends Widget {
  constructor(data = {}) {
    super({ id: 'compare', title: t('compare'), icon: '⚖️', className: 'widget-wide' });
    this.data = data;
  }

  update(data) {
    this.data = data;
    this.setTitle(t('compare'));
    this.render();
  }

  render() {
    if (!this.body) {
      return;
    }
    this.body.innerHTML = '';
    const favs = getFavorites();
    const settings = getSettings();
    const compareLoc = this.data.compareLocation || settings.compareCity;
    const a = this.data.weather;
    const b = this.data.compareWeather;
    const locA = this.data.location;
    const locB = compareLoc;

    if (!favs.length) {
      this.body.append(el('p', { className: 'muted', text: t('compare_none') }));
      return;
    }

    const sel = el('select', {
      className: 'settings-select',
      onChange: async (e) => {
        const id = e.target.value;
        if (!id) {
          updateSettings({ compareCity: null });
          await loadCompareWeather(null);
          return;
        }
        const f = favs.find((x) => x.id === id);
        if (f) {
          const loc = {
            name: f.name,
            country: f.country,
            latitude: f.latitude,
            longitude: f.longitude,
          };
          updateSettings({ compareCity: loc });
          await loadCompareWeather(loc);
        }
      },
    });
    sel.append(el('option', { value: '', text: t('compare_select') }));
    for (const f of favs) {
      const o = el('option', {
        value: f.id,
        text: `${f.name}${f.country ? ` — ${f.country}` : ''}`,
      });
      if (
        compareLoc &&
        Math.abs(compareLoc.latitude - f.latitude) < 0.01 &&
        Math.abs(compareLoc.longitude - f.longitude) < 0.01
      ) {
        o.selected = true;
      }
      sel.append(o);
    }

    this.body.append(el('div', { className: 'compare-select-row' }, [sel]));

    if (!a?.current || !b?.current) {
      this.body.append(el('p', { className: 'muted', text: t('compare_select') }));
      return;
    }

    const metaA = getWeatherMeta(a.current.weatherCode);
    const metaB = getWeatherMeta(b.current.weatherCode);

    this.body.append(
      el('div', { className: 'compare-grid' }, [
        col(locA?.name || 'A', metaA.icon, a),
        col(locB?.name || 'B', metaB.icon, b),
      ]),
      el('div', { className: 'compare-deltas' }, [
        delta(t('temperature'), a.current.temperature, b.current.temperature, (v) =>
          formatTemp(v, 0)
        ),
        delta(t('humidity'), a.current.humidity, b.current.humidity, (v) => formatPercent(v)),
        delta(t('wind'), a.current.windSpeed, b.current.windSpeed, (v) => formatWind(v, 0)),
      ])
    );
  }
}

function col(name, icon, weather) {
  return el('div', { className: 'compare-col' }, [
    el('strong', { text: name }),
    el('div', { className: 'compare-main' }, [
      el('span', { text: icon }),
      el('span', { className: 'metric-value small', text: formatTemp(weather.current.temperature, 0) }),
    ]),
    el('p', { className: 'muted', text: weatherLabel(weather.current.weatherCode) }),
  ]);
}

function delta(label, a, b, fmt) {
  if (a == null || b == null) {
    return el('span', { text: `${label}: —` });
  }
  const d = a - b;
  const sign = d > 0 ? '+' : '';
  return el('span', {
    className: d > 0.3 ? 'delta-pos' : d < -0.3 ? 'delta-neg' : '',
    text: `${label}: ${fmt(a)} vs ${fmt(b)} (${sign}${typeof a === 'number' && Math.abs(d) < 50 ? d.toFixed(1) : Math.round(d)})`,
  });
}
