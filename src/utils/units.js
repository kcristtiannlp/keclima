/**
 * Conversões e formatação de unidades.
 * @module utils/units
 */

import { getSettings } from '../storage/settingsStore.js';

/**
 * @param {number|null|undefined} celsius
 * @returns {number|null}
 */
export function toDisplayTemp(celsius) {
  if (celsius === null || celsius === undefined || Number.isNaN(celsius)) {
    return null;
  }
  const unit = getSettings().units.temperature;
  if (unit === 'fahrenheit') {
    return (celsius * 9) / 5 + 32;
  }
  return celsius;
}

/**
 * @param {number|null|undefined} celsius
 * @param {number} [digits=0]
 * @returns {string}
 */
export function formatTemp(celsius, digits = 0) {
  const v = toDisplayTemp(celsius);
  if (v === null) {
    return '—';
  }
  const unit = getSettings().units.temperature === 'fahrenheit' ? '°F' : '°C';
  return `${v.toFixed(digits)}${unit}`;
}

/**
 * @param {number|null|undefined} kmh
 * @returns {number|null}
 */
export function toDisplayWind(kmh) {
  if (kmh === null || kmh === undefined || Number.isNaN(kmh)) {
    return null;
  }
  const unit = getSettings().units.wind;
  if (unit === 'ms') {
    return kmh / 3.6;
  }
  if (unit === 'mph') {
    return kmh * 0.621371;
  }
  return kmh;
}

/**
 * @param {number|null|undefined} kmh
 * @param {number} [digits=0]
 * @returns {string}
 */
export function formatWind(kmh, digits = 0) {
  const v = toDisplayWind(kmh);
  if (v === null) {
    return '—';
  }
  const labels = { kmh: 'km/h', ms: 'm/s', mph: 'mph' };
  const unit = labels[getSettings().units.wind] || 'km/h';
  return `${v.toFixed(digits)} ${unit}`;
}

/**
 * @param {number|null|undefined} hpa
 * @returns {number|null}
 */
export function toDisplayPressure(hpa) {
  if (hpa === null || hpa === undefined || Number.isNaN(hpa)) {
    return null;
  }
  if (getSettings().units.pressure === 'inhg') {
    return hpa * 0.02953;
  }
  return hpa;
}

/**
 * @param {number|null|undefined} hpa
 * @param {number} [digits]
 * @returns {string}
 */
export function formatPressure(hpa, digits) {
  const v = toDisplayPressure(hpa);
  if (v === null) {
    return '—';
  }
  const isInhg = getSettings().units.pressure === 'inhg';
  const d = digits !== undefined ? digits : isInhg ? 2 : 0;
  return `${v.toFixed(d)} ${isInhg ? 'inHg' : 'hPa'}`;
}

/**
 * @param {number|null|undefined} degrees
 * @returns {string}
 */
export function windDirectionLabel(degrees) {
  if (degrees === null || degrees === undefined || Number.isNaN(degrees)) {
    return '—';
  }
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const idx = Math.round(((degrees % 360) + 360) % 360 / 45) % 8;
  return dirs[idx];
}

/**
 * @param {number|null|undefined} meters
 * @returns {string}
 */
export function formatVisibility(meters) {
  if (meters === null || meters === undefined || Number.isNaN(meters)) {
    return '—';
  }
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(1)} km`;
  }
  return `${Math.round(meters)} m`;
}

/**
 * @param {number|null|undefined} mm
 * @returns {string}
 */
export function formatPrecip(mm) {
  if (mm === null || mm === undefined || Number.isNaN(mm)) {
    return '—';
  }
  return `${mm.toFixed(1)} mm`;
}

/**
 * @param {number|null|undefined} pct
 * @returns {string}
 */
export function formatPercent(pct) {
  if (pct === null || pct === undefined || Number.isNaN(pct)) {
    return '—';
  }
  return `${Math.round(pct)}%`;
}

/**
 * Converte datas do Open-Meteo sem deslocar o dia no fuso local.
 * Strings só-data (`YYYY-MM-DD`) viram meio-dia local — `new Date("YYYY-MM-DD")`
 * é meia-noite UTC e no Brasil (UTC−3) o dia da semana fica 1 dia errado.
 *
 * @param {string|Date|number|null|undefined} value
 * @returns {Date}
 */
export function parseWeatherDate(value) {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === 'number') {
    return new Date(value);
  }
  if (typeof value === 'string') {
    const s = value.trim();
    // daily: "2026-07-12"
    const dayOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (dayOnly) {
      const y = Number(dayOnly[1]);
      const m = Number(dayOnly[2]);
      const d = Number(dayOnly[3]);
      return new Date(y, m - 1, d, 12, 0, 0);
    }
    // hourly sem Z: "2026-07-12T15:00" (hora local do timezone da API)
    const localHour = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
    if (localHour && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) {
      return new Date(
        Number(localHour[1]),
        Number(localHour[2]) - 1,
        Number(localHour[3]),
        Number(localHour[4]),
        Number(localHour[5]),
        Number(localHour[6] || 0)
      );
    }
    return new Date(s);
  }
  return new Date(NaN);
}

/**
 * @param {string|Date|number} value
 * @param {Intl.DateTimeFormatOptions} [options]
 * @returns {string}
 */
export function formatTime(value, options = { hour: '2-digit', minute: '2-digit' }) {
  if (!value) {
    return '—';
  }
  const d = parseWeatherDate(value);
  if (Number.isNaN(d.getTime())) {
    return '—';
  }
  const lang = getSettings().language || 'pt';
  const locale = lang === 'en' ? 'en-US' : lang === 'es' ? 'es-ES' : 'pt-BR';
  return d.toLocaleTimeString(locale, options);
}

/**
 * @param {string|Date|number} value
 * @returns {string}
 */
export function formatDateTime(value) {
  if (!value) {
    return '—';
  }
  const d = parseWeatherDate(value);
  if (Number.isNaN(d.getTime())) {
    return '—';
  }
  const lang = getSettings().language || 'pt';
  const locale = lang === 'en' ? 'en-US' : lang === 'es' ? 'es-ES' : 'pt-BR';
  return d.toLocaleString(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * @param {string|Date|number} value
 * @returns {string}
 */
export function formatWeekday(value) {
  const d = parseWeatherDate(value);
  if (Number.isNaN(d.getTime())) {
    return '—';
  }
  const lang = getSettings().language || 'pt';
  const locale = lang === 'en' ? 'en-US' : lang === 'es' ? 'es-ES' : 'pt-BR';
  return d.toLocaleDateString(locale, { weekday: 'short', day: '2-digit', month: 'short' });
}
