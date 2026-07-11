/**
 * Utilitários meteorológicos.
 * @module utils/weather
 */

import { WMO_CODES, AQI_LEVELS } from '../config.js';
import { t } from './i18n.js';
import { formatTime } from './units.js';

/**
 * @param {number} code
 */
export function getWeatherMeta(code) {
  return WMO_CODES[code] || { key: 'unknown', icon: '🌡️' };
}

/**
 * @param {Date} [date]
 */
export function getMoonPhase(date = new Date()) {
  const lp = 2551443;
  const now = date.getTime() / 1000;
  const newMoon = new Date('2001-01-01T00:00:00Z').getTime() / 1000;
  const phase = ((now - newMoon) % lp) / lp;
  const illumination = Math.round(((1 - Math.cos(2 * Math.PI * phase)) / 2) * 100);

  let key = 'moon_new';
  let icon = '🌑';
  if (phase < 0.03 || phase > 0.97) {
    key = 'moon_new';
    icon = '🌑';
  } else if (phase < 0.22) {
    key = 'moon_waxing_crescent';
    icon = '🌒';
  } else if (phase < 0.28) {
    key = 'moon_first_quarter';
    icon = '🌓';
  } else if (phase < 0.47) {
    key = 'moon_waxing_gibbous';
    icon = '🌔';
  } else if (phase < 0.53) {
    key = 'moon_full';
    icon = '🌕';
  } else if (phase < 0.72) {
    key = 'moon_waning_gibbous';
    icon = '🌖';
  } else if (phase < 0.78) {
    key = 'moon_last_quarter';
    icon = '🌗';
  } else {
    key = 'moon_waning_crescent';
    icon = '🌘';
  }

  return { phase, key, icon, illumination };
}

/**
 * @param {number[]} pressures
 */
export function pressureTrend(pressures) {
  if (!pressures || pressures.length < 2) {
    return 'stable';
  }
  const recent = pressures.slice(-6);
  const first = recent[0];
  const last = recent[recent.length - 1];
  const delta = last - first;
  if (delta > 1) {
    return 'rising';
  }
  if (delta < -1) {
    return 'falling';
  }
  return 'stable';
}

/**
 * @param {number|null} aqi
 */
export function aqiLevel(aqi) {
  if (aqi === null || aqi === undefined || Number.isNaN(aqi)) {
    return { key: 'unknown', color: '#94a3b8', label: '—' };
  }
  for (const level of AQI_LEVELS.us) {
    if (aqi <= level.max) {
      return {
        key: level.key,
        color: level.color,
        label: t(`aqi_${level.key}`),
      };
    }
  }
  return { key: 'hazardous', color: '#7f1d1d', label: t('aqi_hazardous') };
}

/**
 * Alertas do dashboard — reutiliza o motor sobrevivencialista + sinais clássicos.
 * @param {Object} weather
 * @param {Object|null} airQuality
 * @param {{ firesNearby?: number|null }} [extra]
 */
export function buildAlerts(weather, airQuality, extra = {}) {
  const alerts = [];

  // Sinais clássicos + calor/frio/fogo-meteo (sem import de survival — evita ciclo)
  if (weather?.current) {
    const c = weather.current;
    const code = c.weatherCode;

    if ([95, 96, 99].includes(code)) {
      alerts.push({ id: 'storm', severity: 'danger', message: t('weather_thunderstorm') });
    }
    if ([65, 82].includes(code)) {
      alerts.push({ id: 'heavy_rain', severity: 'warning', message: t('weather_rain_heavy') });
    }
    if ([75, 86].includes(code)) {
      alerts.push({ id: 'heavy_snow', severity: 'warning', message: t('weather_snow_heavy') });
    }
    if (c.uvIndex != null && c.uvIndex >= 8) {
      const uv = uvLevel(c.uvIndex);
      alerts.push({
        id: 'uv',
        severity: c.uvIndex >= 11 ? 'danger' : 'warning',
        message: `${t('uv')}: ${c.uvIndex.toFixed(1)} · ${t(uv.labelKey)}`,
      });
    }
    if (c.windGusts != null && c.windGusts >= 80) {
      alerts.push({
        id: 'wind',
        severity: 'warning',
        message: `${t('gusts')}: ${Math.round(c.windGusts)} km/h`,
      });
    }

    if (weather.hourly?.time?.length) {
      const now = Date.now();
      for (let i = 0; i < weather.hourly.time.length; i++) {
        const tm = new Date(weather.hourly.time[i]).getTime();
        if (tm < now || tm > now + 6 * 3600 * 1000) {
          continue;
        }
        const p = weather.hourly.precipitation?.[i] ?? 0;
        const pr = weather.hourly.precipitationProbability?.[i] ?? 0;
        if (p >= 3 || pr >= 80) {
          alerts.push({
            id: 'rain_soon',
            severity: 'warning',
            message: `${t('precipitation')} · ${formatTime(weather.hourly.time[i])}`,
          });
          break;
        }
      }
    }
  }

  if (airQuality?.usAqi != null && airQuality.usAqi > 150) {
    const level = aqiLevel(airQuality.usAqi);
    alerts.push({
      id: 'aqi',
      severity: airQuality.usAqi > 200 ? 'danger' : 'warning',
      message: `${t('aqi')}: ${level.label}`,
    });
  }

  // Calor / frio / fogo-meteo extras (sem circular import — thresholds inline)
  const c = weather?.current;
  if (c) {
    const app = c.apparentTemperature ?? c.temperature;
    if (app != null && app >= 38) {
      alerts.push({
        id: 'heat',
        severity: app >= 40 ? 'danger' : 'warning',
        message: `${t('surv_heat')}: ${Math.round(app)}°`,
      });
    }
    if (app != null && app <= 5) {
      alerts.push({
        id: 'cold',
        severity: 'warning',
        message: `${t('surv_cold')}: ${Math.round(app)}°`,
      });
    }
    // fogo-meteo simples
    const tAir = c.temperature;
    const rh = c.humidity;
    const wind = c.windSpeed;
    if (tAir != null && rh != null) {
      let fw = Math.max(0, (tAir - 18) * 2.2) + Math.max(0, (55 - rh) * 1.1);
      fw += Math.min(25, (wind ?? 0) * 0.45);
      if (fw >= 55) {
        alerts.push({
          id: 'fire_weather',
          severity: fw >= 75 ? 'danger' : 'warning',
          message: t('surv_fire_weather_high'),
        });
      }
    }
  }

  if (extra.firesNearby != null && extra.firesNearby >= 3) {
    alerts.push({
      id: 'fires',
      severity: extra.firesNearby >= 15 ? 'danger' : 'warning',
      message: t('surv_fires_some'),
    });
  }

  // dedupe by id
  const seen = new Set();
  return alerts.filter((a) => {
    if (seen.has(a.id)) {
      return false;
    }
    seen.add(a.id);
    return true;
  });
}

/**
 * @param {Object|null} weather
 * @returns {'day'|'night'|'rain'|'storm'}
 */
export function weatherAtmosphere(weather) {
  if (!weather?.current) {
    return 'day';
  }
  const code = weather.current.weatherCode;
  if ([95, 96, 99, 82].includes(code)) {
    return 'storm';
  }
  if (
    [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code) ||
    (weather.current.precipitation || 0) > 0.2
  ) {
    return 'rain';
  }
  if (weather.current.isDay === 0 || weather.current.isDay === false) {
    return 'night';
  }
  return 'day';
}

/**
 * @param {Object} weather
 * @param {string} field
 * @returns {number|null}
 */
function nearestHourly(weather, field) {
  if (!weather?.hourly?.time?.length || !weather.hourly[field]) {
    return null;
  }
  const now = Date.now();
  let best = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < weather.hourly.time.length; i++) {
    const diff = Math.abs(new Date(weather.hourly.time[i]).getTime() - now);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  }
  const v = weather.hourly[field][best];
  return v === undefined || v === null ? null : v;
}

export function currentUv(weather) {
  const uv = nearestHourly(weather, 'uvIndex');
  if (uv !== null) {
    return uv;
  }
  return weather?.daily?.uvIndexMax?.[0] ?? null;
}

export function currentVisibility(weather) {
  return nearestHourly(weather, 'visibility');
}

export function currentPrecipProb(weather) {
  const p = nearestHourly(weather, 'precipitationProbability');
  if (p !== null) {
    return p;
  }
  return weather?.daily?.precipitationProbabilityMax?.[0] ?? null;
}

/**
 * Melhor horário com UV baixo nas próximas 12h diurnas.
 * @param {Object} weather
 * @returns {{ time: string, uv: number }|null}
 */
export function bestOutdoorSlot(weather) {
  if (!weather?.hourly?.time?.length) {
    return null;
  }
  const now = Date.now();
  let best = null;
  for (let i = 0; i < weather.hourly.time.length; i++) {
    const tm = new Date(weather.hourly.time[i]).getTime();
    if (tm < now || tm > now + 12 * 3600 * 1000) {
      continue;
    }
    const uv = weather.hourly.uvIndex?.[i];
    if (uv === null || uv === undefined) {
      continue;
    }
    // prefer daylight-ish hours with low UV but not night (uv often 0 at night)
    const hour = new Date(weather.hourly.time[i]).getHours();
    if (hour < 7 || hour > 18) {
      continue;
    }
    if (!best || uv < best.uv) {
      best = { time: weather.hourly.time[i], uv };
    }
  }
  return best;
}

/**
 * Escala UV linear 0–11+ (OMS / prática comum).
 * @param {number|null|undefined} uv
 * @returns {{ key: string, labelKey: string, adviceKey: string, color: string, range: string, min: number, max: number }}
 */
export function uvLevel(uv) {
  if (uv === null || uv === undefined || Number.isNaN(uv)) {
    return {
      key: 'unknown',
      labelKey: 'uv_level_unknown',
      adviceKey: 'uv_advice_unknown',
      color: '#94a3b8',
      range: '—',
      min: 0,
      max: 0,
    };
  }
  if (uv < 3) {
    return {
      key: 'low',
      labelKey: 'uv_level_low',
      adviceKey: 'uv_advice_low',
      color: '#22c55e',
      range: '0–2',
      min: 0,
      max: 2,
    };
  }
  if (uv < 6) {
    return {
      key: 'moderate',
      labelKey: 'uv_level_moderate',
      adviceKey: 'uv_advice_moderate',
      color: '#eab308',
      range: '3–5',
      min: 3,
      max: 5,
    };
  }
  if (uv < 8) {
    return {
      key: 'high',
      labelKey: 'uv_level_high',
      adviceKey: 'uv_advice_high',
      color: '#f97316',
      range: '6–7',
      min: 6,
      max: 7,
    };
  }
  if (uv < 11) {
    return {
      key: 'very_high',
      labelKey: 'uv_level_very_high',
      adviceKey: 'uv_advice_very_high',
      color: '#ef4444',
      range: '8–10',
      min: 8,
      max: 10,
    };
  }
  return {
    key: 'extreme',
    labelKey: 'uv_level_extreme',
    adviceKey: 'uv_advice_extreme',
    color: '#7c3aed',
    range: '11+',
    min: 11,
    max: 15,
  };
}

/**
 * Cor da escala UV (0–11+).
 * @param {number|null|undefined} uv
 */
export function uvColor(uv) {
  return uvLevel(uv).color;
}

/**
 * Pico UV do dia (daily ou max hourly).
 * @param {Object} weather
 */
export function dailyUvPeak(weather) {
  if (weather?.daily?.uvIndexMax?.[0] != null) {
    return weather.daily.uvIndexMax[0];
  }
  if (!weather?.hourly?.uvIndex?.length) {
    return null;
  }
  const today = new Date().toDateString();
  let max = null;
  for (let i = 0; i < weather.hourly.time.length; i++) {
    if (new Date(weather.hourly.time[i]).toDateString() !== today) {
      continue;
    }
    const uv = weather.hourly.uvIndex[i];
    if (uv != null && (max === null || uv > max)) {
      max = uv;
    }
  }
  return max;
}
