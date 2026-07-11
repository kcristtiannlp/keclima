/**
 * Índice UV com escala linear 0–11+ e recomendações.
 * @module widgets/UVWidget
 */

import { Widget } from './Widget.js';
import { el } from '../utils/dom.js';
import { t } from '../utils/i18n.js';
import { bestOutdoorSlot, dailyUvPeak, uvLevel } from '../utils/weather.js';
import { formatTime } from '../utils/units.js';

/** Faixas oficiais da escala (para legenda) */
const UV_BANDS = [
  { key: 'low', min: 0, max: 2, color: '#22c55e', labelKey: 'uv_level_low', range: '0–2' },
  { key: 'moderate', min: 3, max: 5, color: '#eab308', labelKey: 'uv_level_moderate', range: '3–5' },
  { key: 'high', min: 6, max: 7, color: '#f97316', labelKey: 'uv_level_high', range: '6–7' },
  {
    key: 'very_high',
    min: 8,
    max: 10,
    color: '#ef4444',
    labelKey: 'uv_level_very_high',
    range: '8–10',
  },
  {
    key: 'extreme',
    min: 11,
    max: 15,
    color: '#7c3aed',
    labelKey: 'uv_level_extreme',
    range: '11+',
  },
];

export class UVWidget extends Widget {
  constructor(data = {}) {
    super({ id: 'uv', title: t('uv'), icon: '☀️', className: 'widget-uv' });
    this.data = data;
  }

  update(data) {
    this.data = data;
    this.setTitle(t('uv'));
    this.render();
  }

  render() {
    if (!this.body) {
      return;
    }
    this.body.innerHTML = '';
    if (this.data.loading && !this.data.weather) {
      this.body.append(el('div', { className: 'skeleton sk-line lg' }));
      return;
    }

    const weather = this.data.weather;
    const uv = weather?.current?.uvIndex;
    const peak = dailyUvPeak(weather);
    const best = bestOutdoorSlot(weather);
    const level = uvLevel(uv);
    const peakLevel = peak != null ? uvLevel(peak) : null;

    // Valor principal + classificação
    this.body.append(
      el('div', { className: 'uv-main' }, [
        el('p', {
          className: 'metric-value',
          style: { color: level.color },
          text: uv == null ? '—' : formatUv(uv),
        }),
        el('span', {
          className: 'uv-badge',
          style: {
            background: `${level.color}22`,
            color: level.color,
            borderColor: `${level.color}55`,
          },
          text: uv == null ? '—' : `${t(level.labelKey)} (${level.range})`,
        }),
      ])
    );

    if (uv != null) {
      this.body.append(
        el('p', { className: 'uv-advice', text: t(level.adviceKey) })
      );
    }

    // Barra 0–11+ com marca
    this.body.append(
      el('div', { className: 'uv-scale', title: t('uv_scale_title') }, [
        el('div', { className: 'uv-scale-track' }, UV_BANDS.map((b) => segment(b))),
        el('div', {
          className: 'uv-scale-marker',
          style: { left: `${uvPosition(uv)}%` },
        }),
      ]),
      el('div', { className: 'uv-scale-labels' }, [
        el('span', { text: '0' }),
        el('span', { text: '3' }),
        el('span', { text: '6' }),
        el('span', { text: '8' }),
        el('span', { text: '11+' }),
      ])
    );

    // Legenda compacta
    const legend = el('div', { className: 'uv-legend' });
    for (const b of UV_BANDS) {
      legend.append(
        el('span', { className: 'uv-legend-item', title: t(b.labelKey) }, [
          el('i', { className: 'uv-legend-dot', style: { background: b.color } }),
          el('span', { text: `${b.range}` }),
        ])
      );
    }
    this.body.append(legend);

    if (peak != null) {
      this.body.append(
        el('p', {
          className: 'metric-sub',
          text: `${t('uv_peak_hint')}: ${formatUv(peak)}${
            peakLevel ? ` · ${t(peakLevel.labelKey)}` : ''
          }`,
        })
      );
    }
    if (best) {
      this.body.append(
        el('p', {
          className: 'metric-sub',
          text: `${t('best_outdoor')}: ${formatTime(best.time)} (UV ${formatUv(best.uv)})`,
        })
      );
    }
  }
}

/**
 * @param {number|null|undefined} uv
 */
function formatUv(uv) {
  if (uv == null || Number.isNaN(uv)) {
    return '—';
  }
  return uv >= 11 ? `${uv.toFixed(1)}+` : uv.toFixed(1);
}

/**
 * Posição na barra 0–12 (11+ no fim).
 * @param {number|null|undefined} uv
 */
function uvPosition(uv) {
  if (uv == null || Number.isNaN(uv)) {
    return 0;
  }
  return Math.min(100, Math.max(0, (uv / 12) * 100));
}

/**
 * @param {{ color: string, min: number, max: number }} band
 */
function segment(band) {
  // Proporções visuais ~ 0–2, 3–5, 6–7, 8–10, 11+
  const widths = { low: 25, moderate: 25, high: 16.67, very_high: 25, extreme: 8.33 };
  return el('div', {
    className: 'uv-scale-seg',
    style: {
      background: band.color,
      flex: `0 0 ${widths[band.key] || 20}%`,
    },
    title: `${band.range}`,
  });
}
