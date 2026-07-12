/**
 * Provider Open-Meteo (forecast + archive + grid).
 * @module api/providers/openMeteo
 */

import { API } from '../../config.js';
import { fetchRetry } from '../../utils/fetchRetry.js';

const HOURLY_VARS = [
  'temperature_2m',
  'relative_humidity_2m',
  'apparent_temperature',
  'precipitation_probability',
  'precipitation',
  'weather_code',
  'cloud_cover',
  'pressure_msl',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
  'uv_index',
  'visibility',
].join(',');

const DAILY_VARS = [
  'weather_code',
  'temperature_2m_max',
  'temperature_2m_min',
  'sunrise',
  'sunset',
  'uv_index_max',
  'precipitation_sum',
  'precipitation_probability_max',
  'wind_speed_10m_max',
  'wind_gusts_10m_max',
].join(',');

/**
 * Forecast principal: 7 dias passados + 16 futuros (hourly/daily).
 * @param {number} latitude
 * @param {number} longitude
 * @param {AbortSignal} [signal]
 */
export async function fetchForecast(latitude, longitude, signal) {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    timezone: 'auto',
    forecast_days: '16',
    past_days: '7',
    current: [
      'temperature_2m',
      'relative_humidity_2m',
      'apparent_temperature',
      'is_day',
      'precipitation',
      'rain',
      'weather_code',
      'cloud_cover',
      'pressure_msl',
      'surface_pressure',
      'wind_speed_10m',
      'wind_direction_10m',
      'wind_gusts_10m',
    ].join(','),
    hourly: HOURLY_VARS,
    daily: DAILY_VARS,
    wind_speed_unit: 'kmh',
  });

  const res = await fetchRetry(`${API.openMeteo.forecast}?${params}`, {
    signal,
    headers: { Accept: 'application/json' },
    retries: 2,
  });
  if (!res.ok) {
    throw new Error(`Open-Meteo forecast HTTP ${res.status}`);
  }
  return normalizeForecast(await res.json());
}

/**
 * Arquivo diário para 30d / 365d.
 * @param {number} latitude
 * @param {number} longitude
 * @param {number} days
 * @param {AbortSignal} [signal]
 */
export async function fetchArchiveDaily(latitude, longitude, days, signal) {
  const end = new Date();
  const start = new Date();
  start.setUTCDate(end.getUTCDate() - Math.max(1, days - 1));

  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    timezone: 'auto',
    start_date: start.toISOString().slice(0, 10),
    end_date: end.toISOString().slice(0, 10),
    daily: [
      'temperature_2m_max',
      'temperature_2m_min',
      'temperature_2m_mean',
      'precipitation_sum',
      'wind_speed_10m_max',
      'pressure_msl_mean',
      'relative_humidity_2m_mean',
    ].join(','),
    wind_speed_unit: 'kmh',
  });

  const res = await fetchRetry(`${API.openMeteo.archive}?${params}`, {
    signal,
    headers: { Accept: 'application/json' },
    retries: 1,
  });
  if (!res.ok) {
    throw new Error(`Open-Meteo archive HTTP ${res.status}`);
  }
  const raw = await res.json();
  return {
    latitude: raw.latitude,
    longitude: raw.longitude,
    fetchedAt: Date.now(),
    days,
    daily: {
      time: raw.daily?.time || [],
      temperatureMax: raw.daily?.temperature_2m_max || [],
      temperatureMin: raw.daily?.temperature_2m_min || [],
      temperatureMean: raw.daily?.temperature_2m_mean || [],
      precipitationSum: raw.daily?.precipitation_sum || [],
      windSpeedMax: raw.daily?.wind_speed_10m_max || [],
      pressureMean: raw.daily?.pressure_msl_mean || [],
      humidityMean: raw.daily?.relative_humidity_2m_mean || [],
    },
  };
}

/**
 * Grade de pontos no viewport (ou mundo). Aceita centro legado ou lista de pontos.
 * @param {number|Array<{latitude:number,longitude:number}>} latitudeOrPoints
 * @param {number} [longitude]
 * @param {AbortSignal} [signal]
 */
export async function fetchMapGrid(latitudeOrPoints, longitude, signal) {
  let coords;
  if (Array.isArray(latitudeOrPoints)) {
    coords = latitudeOrPoints;
  } else {
    // legado: 7×7 ao redor do centro
    const step = 0.35;
    const span = 3;
    coords = [];
    for (let i = -span; i <= span; i++) {
      for (let j = -span; j <= span; j++) {
        coords.push({
          latitude: latitudeOrPoints + i * step,
          longitude: longitude + j * step,
        });
      }
    }
  }

  // Open-Meteo: no máximo ~100 localizações; pedimos até 81
  const limited = coords.slice(0, 81);
  const lats = limited.map((c) => c.latitude);
  const lons = limited.map((c) => c.longitude);

  const params = new URLSearchParams({
    latitude: lats.join(','),
    longitude: lons.join(','),
    current: [
      'temperature_2m',
      'apparent_temperature',
      'relative_humidity_2m',
      'wind_speed_10m',
      'wind_direction_10m',
      'weather_code',
      'cloud_cover',
      'pressure_msl',
      'precipitation',
    ].join(','),
    hourly: 'precipitation,precipitation_probability',
    forecast_days: '1',
    wind_speed_unit: 'kmh',
    timezone: 'auto',
  });

  const res = await fetchRetry(`${API.openMeteo.forecast}?${params}`, {
    signal,
    headers: { Accept: 'application/json' },
    retries: 1,
    timeoutMs: 45000,
  });
  if (!res.ok) {
    throw new Error(`Open-Meteo grid HTTP ${res.status}`);
  }
  const data = await res.json();
  const list = Array.isArray(data) ? data : [data];
  const now = Date.now();
  return list.map((item) => ({
    latitude: item.latitude,
    longitude: item.longitude,
    temperature: item.current?.temperature_2m ?? null,
    apparentTemperature: item.current?.apparent_temperature ?? null,
    humidity: item.current?.relative_humidity_2m ?? null,
    windSpeed: item.current?.wind_speed_10m ?? null,
    windDirection: item.current?.wind_direction_10m ?? null,
    weatherCode: item.current?.weather_code ?? null,
    cloudCover: item.current?.cloud_cover ?? null,
    pressure: item.current?.pressure_msl ?? null,
    precipitation: item.current?.precipitation ?? null,
    precipitationNext6h: sumNextHoursPrecip(item.hourly, now, 6),
  }));
}

/**
 * Soma precipitação horária nas próximas `hours` horas.
 * @param {{ time?: string[], precipitation?: number[] }|null|undefined} hourly
 * @param {number} nowMs
 * @param {number} hours
 */
function sumNextHoursPrecip(hourly, nowMs, hours) {
  if (!hourly?.time?.length || !hourly.precipitation?.length) {
    return null;
  }
  let sum = 0;
  let n = 0;
  for (let i = 0; i < hourly.time.length; i++) {
    const tm = new Date(hourly.time[i]).getTime();
    if (Number.isNaN(tm)) {
      continue;
    }
    // janela: agora até +hours (inclui a hora corrente se ainda relevante)
    if (tm + 60 * 60 * 1000 < nowMs) {
      continue;
    }
    if (tm > nowMs + hours * 60 * 60 * 1000) {
      break;
    }
    const v = hourly.precipitation[i];
    if (v != null && !Number.isNaN(Number(v))) {
      sum += Number(v);
      n += 1;
    }
  }
  return n ? Math.round(sum * 10) / 10 : 0;
}

/**
 * @param {Object} raw
 */
function normalizeForecast(raw) {
  const c = raw.current || {};
  return {
    latitude: raw.latitude,
    longitude: raw.longitude,
    timezone: raw.timezone,
    elevation: raw.elevation,
    fetchedAt: Date.now(),
    current: {
      time: c.time,
      temperature: c.temperature_2m,
      apparentTemperature: c.apparent_temperature,
      humidity: c.relative_humidity_2m,
      isDay: c.is_day,
      precipitation: c.precipitation,
      rain: c.rain,
      weatherCode: c.weather_code,
      cloudCover: c.cloud_cover,
      pressure: c.pressure_msl ?? c.surface_pressure,
      windSpeed: c.wind_speed_10m,
      windDirection: c.wind_direction_10m,
      windGusts: c.wind_gusts_10m,
      uvIndex: null,
    },
    hourly: {
      time: raw.hourly?.time || [],
      temperature: raw.hourly?.temperature_2m || [],
      apparentTemperature: raw.hourly?.apparent_temperature || [],
      humidity: raw.hourly?.relative_humidity_2m || [],
      precipitationProbability: raw.hourly?.precipitation_probability || [],
      precipitation: raw.hourly?.precipitation || [],
      weatherCode: raw.hourly?.weather_code || [],
      cloudCover: raw.hourly?.cloud_cover || [],
      pressure: raw.hourly?.pressure_msl || [],
      windSpeed: raw.hourly?.wind_speed_10m || [],
      windDirection: raw.hourly?.wind_direction_10m || [],
      windGusts: raw.hourly?.wind_gusts_10m || [],
      uvIndex: raw.hourly?.uv_index || [],
      visibility: raw.hourly?.visibility || [],
    },
    daily: {
      time: raw.daily?.time || [],
      weatherCode: raw.daily?.weather_code || [],
      temperatureMax: raw.daily?.temperature_2m_max || [],
      temperatureMin: raw.daily?.temperature_2m_min || [],
      sunrise: raw.daily?.sunrise || [],
      sunset: raw.daily?.sunset || [],
      uvIndexMax: raw.daily?.uv_index_max || [],
      precipitationSum: raw.daily?.precipitation_sum || [],
      precipitationProbabilityMax: raw.daily?.precipitation_probability_max || [],
      windSpeedMax: raw.daily?.wind_speed_10m_max || [],
      windGustsMax: raw.daily?.wind_gusts_10m_max || [],
    },
  };
}
