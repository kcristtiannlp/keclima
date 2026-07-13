/**
 * Textos curtos de previsão a partir dos dados normalizados do Open-Meteo.
 * @module utils/forecastSummary
 */

import { weatherLabel } from './i18n.js';
import { getWeatherMeta } from './weather.js';

/**
 * "Hoje" no fuso da cidade (ou do navegador).
 * @param {string} [timeZone] — ex. America/Sao_Paulo
 * @returns {string} YYYY-MM-DD
 */
export function todayKeyInZone(timeZone) {
  if (timeZone) {
    try {
      // en-CA → YYYY-MM-DD
      return new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
    } catch {
      /* fuso inválido */
    }
  }
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Índice do dia de hoje no array daily.time (YYYY-MM-DD ou ISO).
 * @param {string[]} dailyTimes
 * @param {string} [timeZone] — timezone da previsão (Open-Meteo)
 * @returns {number}
 */
export function findTodayDailyIndex(dailyTimes, timeZone) {
  if (!dailyTimes?.length) return 0;
  const key = todayKeyInZone(timeZone);
  const idx = dailyTimes.findIndex((t) => String(t).slice(0, 10) === key);
  return idx >= 0 ? idx : 0;
}

/**
 * Primeiro índice hourly com hora >= agora - 30 min.
 * @param {string[]} times
 * @returns {number}
 */
export function findHourlyStartIndex(times) {
  if (!times?.length) return 0;
  const now = Date.now() - 30 * 60 * 1000;
  for (let i = 0; i < times.length; i++) {
    if (new Date(times[i]).getTime() >= now) return i;
  }
  return Math.max(0, times.length - 1);
}

/**
 * Gera 1–2 frases sobre as próximas horas / o dia.
 * @param {object} weather — forecast normalizado
 * @param {(key: string, params?: object) => string} t
 * @returns {string}
 */
export function buildForecastBlurb(weather, t) {
  if (!weather?.hourly?.time?.length) {
    return t('forecast_home_blurb_empty');
  }

  const start = findHourlyStartIndex(weather.hourly.time);
  const end = Math.min(start + 12, weather.hourly.time.length);

  let maxPop = 0;
  let maxPopI = start;
  let rainMm = 0;
  let rainHours = 0;
  let maxTemp = -Infinity;
  let minTemp = Infinity;

  for (let i = start; i < end; i++) {
    const pop = weather.hourly.precipitationProbability[i];
    const precip = weather.hourly.precipitation[i];
    const temp = weather.hourly.temperature[i];
    if (pop != null && pop > maxPop) {
      maxPop = pop;
      maxPopI = i;
    }
    if (precip != null && precip > 0.05) {
      rainMm += precip;
      rainHours += 1;
    }
    if (temp != null) {
      maxTemp = Math.max(maxTemp, temp);
      minTemp = Math.min(minTemp, temp);
    }
  }

  const dayIdx = findTodayDailyIndex(weather.daily?.time || [], weather.timezone);
  const dayCode = weather.daily?.weatherCode?.[dayIdx] ?? weather.current?.weatherCode;
  const dayLabel = weatherLabel(dayCode);

  const parts = [];

  // Condição do dia
  if (dayLabel) {
    parts.push(t('forecast_home_blurb_day', { condition: dayLabel }));
  }

  // Chuva nas próximas 12 h
  if (maxPop >= 60 || rainMm >= 1) {
    const when = formatHourOnly(weather.hourly.time[maxPopI]);
    if (rainMm >= 2) {
      parts.push(
        t('forecast_home_blurb_rain_mm', {
          when,
          mm: rainMm.toFixed(1),
          pop: Math.round(maxPop),
        })
      );
    } else {
      parts.push(
        t('forecast_home_blurb_rain', {
          when,
          pop: Math.round(maxPop),
        })
      );
    }
  } else if (maxPop >= 35) {
    parts.push(t('forecast_home_blurb_rain_maybe', { pop: Math.round(maxPop) }));
  } else {
    parts.push(t('forecast_home_blurb_dry'));
  }

  // Variação de temperatura nas próximas horas
  if (Number.isFinite(maxTemp) && Number.isFinite(minTemp) && maxTemp - minTemp >= 4) {
    // só se ainda não for muito longo
    if (parts.length < 3) {
      parts.push(
        t('forecast_home_blurb_range', {
          min: Math.round(minTemp),
          max: Math.round(maxTemp),
        })
      );
    }
  }

  return parts.filter(Boolean).join(' ');
}

/**
 * @param {string} iso
 */
function formatHourOnly(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '—';
  }
}

/**
 * Chance de chuva “nas próximas N horas” (máx de probabilidade).
 * @param {object} weather
 * @param {number} hours
 * @returns {{ pop: number|null, mm: number }}
 */
export function nextHoursPrecip(weather, hours = 6) {
  if (!weather?.hourly?.time?.length) return { pop: null, mm: 0 };
  const start = findHourlyStartIndex(weather.hourly.time);
  const end = Math.min(start + hours, weather.hourly.time.length);
  let maxPop = 0;
  let mm = 0;
  let hasPop = false;
  for (let i = start; i < end; i++) {
    const pop = weather.hourly.precipitationProbability[i];
    const precip = weather.hourly.precipitation[i];
    if (pop != null) {
      hasPop = true;
      maxPop = Math.max(maxPop, pop);
    }
    if (precip != null && precip > 0) mm += precip;
  }
  return { pop: hasPop ? Math.round(maxPop) : null, mm: Math.round(mm * 10) / 10 };
}

/**
 * @param {number|null|undefined} code
 */
export function weatherIcon(code) {
  return getWeatherMeta(code).icon;
}
