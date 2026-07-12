/**
 * Provider Open-Meteo Air Quality.
 * @module api/providers/airQuality
 */

import { API } from '../../config.js';
import { fetchRetry } from '../../utils/fetchRetry.js';

/**
 * Grade de AQI no viewport (ou ao redor do centro — legado).
 * @param {number|Array<{latitude:number,longitude:number}>} latitudeOrPoints
 * @param {number} [longitude]
 * @param {AbortSignal} [signal]
 * @returns {Promise<Array<{ latitude: number, longitude: number, usAqi: number|null, pm25: number|null }>>}
 */
export async function fetchAirQualityGrid(latitudeOrPoints, longitude, signal) {
  let coords;
  if (Array.isArray(latitudeOrPoints)) {
    coords = latitudeOrPoints.slice(0, 64);
  } else {
    const step = 0.5;
    coords = [];
    for (let i = -2; i <= 2; i++) {
      for (let j = -2; j <= 2; j++) {
        coords.push({
          latitude: latitudeOrPoints + i * step,
          longitude: longitude + j * step,
        });
      }
    }
  }
  const params = new URLSearchParams({
    latitude: coords.map((c) => c.latitude).join(','),
    longitude: coords.map((c) => c.longitude).join(','),
    current: 'us_aqi,pm2_5,european_aqi',
    timezone: 'auto',
  });
  const res = await fetchRetry(`${API.openMeteo.airQuality}?${params}`, {
    signal,
    headers: { Accept: 'application/json' },
    retries: 1,
    timeoutMs: 35000,
  });
  if (!res.ok) {
    throw new Error(`Open-Meteo AQI grid HTTP ${res.status}`);
  }
  const data = await res.json();
  const list = Array.isArray(data) ? data : [data];
  return list.map((item) => ({
    latitude: item.latitude,
    longitude: item.longitude,
    usAqi: item.current?.us_aqi ?? null,
    pm25: item.current?.pm2_5 ?? null,
    europeanAqi: item.current?.european_aqi ?? null,
  }));
}

/**
 * @param {number} latitude
 * @param {number} longitude
 * @param {AbortSignal} [signal]
 */
export async function fetchAirQuality(latitude, longitude, signal) {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    timezone: 'auto',
    current: [
      'pm10',
      'pm2_5',
      'carbon_monoxide',
      'nitrogen_dioxide',
      'sulphur_dioxide',
      'ozone',
      'us_aqi',
      'european_aqi',
    ].join(','),
    hourly: ['pm10', 'pm2_5', 'us_aqi', 'european_aqi'].join(','),
  });

  const res = await fetchRetry(`${API.openMeteo.airQuality}?${params}`, {
    signal,
    headers: { Accept: 'application/json' },
    retries: 2,
  });
  if (!res.ok) {
    throw new Error(`Open-Meteo air quality HTTP ${res.status}`);
  }
  const data = await res.json();
  const c = data.current || {};
  return {
    latitude: data.latitude,
    longitude: data.longitude,
    timezone: data.timezone,
    fetchedAt: Date.now(),
    pm10: c.pm10 ?? null,
    pm25: c.pm2_5 ?? null,
    co: c.carbon_monoxide ?? null,
    no2: c.nitrogen_dioxide ?? null,
    so2: c.sulphur_dioxide ?? null,
    ozone: c.ozone ?? null,
    usAqi: c.us_aqi ?? null,
    europeanAqi: c.european_aqi ?? null,
    time: c.time ?? null,
    hourly: {
      time: data.hourly?.time || [],
      pm10: data.hourly?.pm10 || [],
      pm25: data.hourly?.pm2_5 || [],
      usAqi: data.hourly?.us_aqi || [],
      europeanAqi: data.hourly?.european_aqi || [],
    },
  };
}
