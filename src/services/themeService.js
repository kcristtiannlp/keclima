/**
 * Gerenciamento de temas (claro, escuro, automático por atmosfera).
 * @module services/themeService
 */

import { getSettings, updateSettings } from '../storage/settingsStore.js';
import { getState } from '../core/State.js';
import { weatherAtmosphere } from '../utils/weather.js';
import { EventBus, Events } from '../core/EventBus.js';

/**
 * Aplica o tema no documento.
 */
export function applyTheme() {
  const settings = getSettings();
  const root = document.documentElement;
  const weather = getState().weather;
  let theme = settings.theme;
  let atmosphere = 'day';

  if (theme === 'auto') {
    atmosphere = weatherAtmosphere(weather);
    if (atmosphere === 'night' || atmosphere === 'storm') {
      theme = 'dark';
    } else {
      theme = 'light';
    }
  } else {
    atmosphere = weatherAtmosphere(weather);
  }

  root.setAttribute('data-theme', theme);
  root.setAttribute('data-atmosphere', atmosphere);
  EventBus.emit(Events.THEME_CHANGED, { theme, atmosphere });
}

/**
 * @param {'light'|'dark'|'auto'} mode
 */
export function setThemeMode(mode) {
  updateSettings({ theme: mode });
  applyTheme();
}

/**
 * Observa preferência do sistema quando tema é auto e sem dados.
 */
export function initTheme() {
  applyTheme();
  EventBus.on(Events.WEATHER_UPDATED, () => applyTheme());
  EventBus.on(Events.SETTINGS_CHANGED, () => applyTheme());

  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (getSettings().theme === 'auto' && !getState().weather) {
        applyTheme();
      }
    });
  }
}
