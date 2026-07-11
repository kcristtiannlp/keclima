/**
 * Notificações locais de chuva forte.
 * @module services/notificationService
 */

import { getSettings } from '../storage/settingsStore.js';
import { t } from '../utils/i18n.js';

const NOTIFY_KEY = 'keclima:lastRainNotify';

/**
 * @returns {Promise<boolean>}
 */
export async function ensureNotificationPermission() {
  if (!('Notification' in window)) {
    return false;
  }
  if (Notification.permission === 'granted') {
    return true;
  }
  if (Notification.permission === 'denied') {
    return false;
  }
  const result = await Notification.requestPermission();
  return result === 'granted';
}

/**
 * Avalia previsão e notifica se houver risco (no máximo 1x / 3h).
 * @param {Object|null} weather
 * @param {{ name?: string }} [location]
 */
export async function maybeNotifyRain(weather, location) {
  const settings = getSettings();
  if (!settings.rainNotifications || !weather?.hourly) {
    return;
  }
  if (!('Notification' in window) || Notification.permission !== 'granted') {
    return;
  }

  const last = Number(localStorage.getItem(NOTIFY_KEY) || 0);
  if (Date.now() - last < 3 * 60 * 60 * 1000) {
    return;
  }

  const now = Date.now();
  const times = weather.hourly.time || [];
  const precip = weather.hourly.precipitation || [];
  const prob = weather.hourly.precipitationProbability || [];
  const codes = weather.hourly.weatherCode || [];

  let risk = false;
  for (let i = 0; i < times.length; i++) {
    const tMs = new Date(times[i]).getTime();
    if (tMs < now || tMs > now + 6 * 60 * 60 * 1000) {
      continue;
    }
    if (
      (precip[i] ?? 0) >= 2.5 ||
      (prob[i] ?? 0) >= 70 ||
      [65, 82, 95, 96, 99].includes(codes[i])
    ) {
      risk = true;
      break;
    }
  }

  if (!risk) {
    return;
  }

  const place = location?.name || '';
  try {
    // eslint-disable-next-line no-new
    new Notification(t('notify_rain_title'), {
      body: `${t('notify_rain_body')} ${place}`.trim(),
      icon: './public/assets/icons/icon-192.png',
      tag: 'keclima-rain',
    });
    localStorage.setItem(NOTIFY_KEY, String(Date.now()));
  } catch (err) {
    console.warn('[notify]', err);
  }
}
