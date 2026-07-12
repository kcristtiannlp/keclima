/**
 * Gráficos multi-período (24h / 7d / 30d / 365d).
 * @module widgets/ChartWidget
 */

import { Widget } from './Widget.js';
import { el } from '../utils/dom.js';
import { t } from '../utils/i18n.js';
import { toDisplayTemp, toDisplayPressure, toDisplayWind } from '../utils/units.js';
import { getSettings, updateSettings } from '../storage/settingsStore.js';
import { loadArchive } from '../services/weatherService.js';

/**
 * @typedef {'temperature'|'pressure'|'humidity'|'precipitation'|'wind'} ChartType
 */

export class ChartWidget extends Widget {
  /**
   * @param {ChartType} chartType
   * @param {Object} [data]
   */
  constructor(chartType = 'temperature', data = {}) {
    const titles = {
      temperature: () => t('chart_temp'),
      pressure: () => t('chart_pressure'),
      humidity: () => t('chart_humidity'),
      precipitation: () => t('chart_precip'),
      wind: () => t('chart_wind'),
      uv: () => t('chart_uv'),
    };
    super({
      id: `chart-${chartType}`,
      title: titles[chartType](),
      icon: '📊',
      className: 'widget-chart',
    });
    this.chartType = chartType;
    this.data = data;
    this.chart = null;
    this._titleFn = titles[chartType];
    this.range = getSettings().chartRange || '24h';
  }

  update(data) {
    this.data = data;
    this.range = getSettings().chartRange || this.range;
    this.setTitle(this._titleFn());
    this.render();
  }

  destroy() {
    if (this.chart) {
      this.chart.destroy();
      this.chart = null;
    }
    super.destroy();
  }

  render() {
    if (!this.body) {
      return;
    }
    if (this.chart) {
      this.chart.destroy();
      this.chart = null;
    }
    this.body.innerHTML = '';

    const rangeBar = el('div', { className: 'chart-range-bar' });
    for (const r of ['24h', '7d', '30d', '365d']) {
      rangeBar.append(
        el('button', {
          type: 'button',
          className: `tab ${this.range === r ? 'active' : ''}`,
          text: t(`range_${r}`),
          onClick: async () => {
            this.range = r;
            updateSettings({ chartRange: r });
            if ((r === '30d' || r === '365d') && this.data.location) {
              await loadArchive(this.data.location, r === '30d' ? 30 : 365);
            }
            this.render();
          },
        })
      );
    }
    this.body.append(rangeBar);

    const weather = this.data.weather;
    if (!weather || typeof Chart === 'undefined') {
      this.body.append(el('p', { className: 'muted', text: '—' }));
      return;
    }

    const series = this._series(weather, this.data.archive);
    if (!series.labels.length) {
      this.body.append(el('p', { className: 'muted', text: t('loading') }));
      return;
    }

    const canvas = el('canvas', { className: 'chart-canvas' });
    this.body.append(el('div', { className: 'chart-wrap' }, [canvas]));

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const grid = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
    const tick = isDark ? '#cbd5e1' : '#475569';

    this.chart = new Chart(canvas, {
      type: this.chartType === 'precipitation' ? 'bar' : 'line',
      data: {
        labels: series.labels,
        datasets: [
          {
            label: series.label,
            data: series.values,
            borderColor: series.color,
            backgroundColor:
              this.chartType === 'precipitation' ? series.color : `${series.color}33`,
            fill: this.chartType !== 'precipitation',
            tension: 0.35,
            pointRadius: series.labels.length > 48 ? 0 : 2,
            pointHoverRadius: 4,
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { mode: 'index', intersect: false },
        },
        scales: {
          x: {
            ticks: { color: tick, maxRotation: 0, autoSkipPadding: 10, maxTicksLimit: 10 },
            grid: { color: grid },
          },
          y: {
            ticks: { color: tick },
            grid: { color: grid },
          },
        },
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
      },
    });
  }

  /**
   * @param {Object} weather
   * @param {Object|null} archive
   */
  _series(weather, archive) {
    const lang = getSettings().language || 'pt';
    const locale = lang === 'en' ? 'en-US' : lang === 'es' ? 'es-ES' : 'pt-BR';
    const meta = {
      temperature: { label: t('chart_temp'), color: '#38bdf8' },
      pressure: { label: t('chart_pressure'), color: '#a78bfa' },
      humidity: { label: t('chart_humidity'), color: '#34d399' },
      precipitation: { label: t('chart_precip'), color: '#60a5fa' },
      wind: { label: t('chart_wind'), color: '#fbbf24' },
      uv: { label: t('chart_uv'), color: '#f97316' },
    };

    const labels = [];
    const values = [];

    if (this.range === '24h' || this.range === '7d') {
      const hours = this.range === '24h' ? 24 : 24 * 7;
      const now = Date.now();
      let start = 0;
      for (let i = 0; i < weather.hourly.time.length; i++) {
        if (new Date(weather.hourly.time[i]).getTime() >= now - 30 * 60 * 1000) {
          start = i;
          break;
        }
      }
      // include past for context when 7d (past_days loaded)
      if (this.range === '7d') {
        start = Math.max(0, weather.hourly.time.length - hours);
      }
      const end = Math.min(start + hours, weather.hourly.time.length);
      const step = this.range === '7d' ? 3 : 1;
      for (let i = start; i < end; i += step) {
        const d = new Date(weather.hourly.time[i]);
        labels.push(
          this.range === '7d'
            ? d.toLocaleString(locale, { weekday: 'short', hour: '2-digit' })
            : d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
        );
        values.push(this._valueHourly(weather, i));
      }
    } else if (this.range === '30d' || this.range === '365d') {
      // Prefer archive; fallback to daily forecast slice
      const daily =
        archive?.daily && archive.days >= (this.range === '30d' ? 30 : 100)
          ? archive.daily
          : null;

      if (daily?.time?.length) {
        for (let i = 0; i < daily.time.length; i++) {
          const d = new Date(daily.time[i]);
          labels.push(
            d.toLocaleDateString(locale, {
              day: '2-digit',
              month: this.range === '365d' ? 'short' : '2-digit',
            })
          );
          values.push(this._valueArchive(daily, i));
        }
      } else if (weather.daily?.time?.length) {
        for (let i = 0; i < weather.daily.time.length; i++) {
          const d = new Date(weather.daily.time[i]);
          labels.push(d.toLocaleDateString(locale, { day: '2-digit', month: 'short' }));
          values.push(this._valueDaily(weather, i));
        }
      }
    }

    return {
      labels,
      values,
      label: meta[this.chartType].label,
      color: meta[this.chartType].color,
    };
  }

  _valueHourly(weather, i) {
    switch (this.chartType) {
      case 'temperature':
        return toDisplayTemp(weather.hourly.temperature[i]);
      case 'pressure':
        return toDisplayPressure(weather.hourly.pressure[i]);
      case 'humidity':
        return weather.hourly.humidity[i];
      case 'precipitation':
        return weather.hourly.precipitation[i];
      case 'wind':
        return toDisplayWind(weather.hourly.windSpeed[i]);
      case 'uv':
        return weather.hourly.uvIndex?.[i] ?? 0;
      default:
        return null;
    }
  }

  _valueDaily(weather, i) {
    switch (this.chartType) {
      case 'temperature':
        return toDisplayTemp(
          ((weather.daily.temperatureMax[i] ?? 0) + (weather.daily.temperatureMin[i] ?? 0)) / 2
        );
      case 'precipitation':
        return weather.daily.precipitationSum[i];
      case 'wind':
        return toDisplayWind(weather.daily.windSpeedMax[i]);
      case 'uv':
        return weather.daily.uvIndexMax?.[i] ?? 0;
      case 'humidity':
        return null;
      case 'pressure':
        return null;
      default:
        return null;
    }
  }

  _valueArchive(daily, i) {
    switch (this.chartType) {
      case 'temperature':
        return toDisplayTemp(daily.temperatureMean?.[i] ?? daily.temperatureMax?.[i]);
      case 'pressure':
        return toDisplayPressure(daily.pressureMean?.[i]);
      case 'humidity':
        return daily.humidityMean?.[i];
      case 'precipitation':
        return daily.precipitationSum?.[i];
      case 'wind':
        return toDisplayWind(daily.windSpeedMax?.[i]);
      case 'uv':
        return null;
      default:
        return null;
    }
  }
}
