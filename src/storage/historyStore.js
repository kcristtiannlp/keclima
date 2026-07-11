/**
 * Histórico local de atualizações meteorológicas.
 * @module storage/historyStore
 */

import { HISTORY_MAX_ENTRIES, STORAGE_KEYS } from '../config.js';
import { getItem, setItem } from './Storage.js';
import { EventBus, Events } from '../core/EventBus.js';

/**
 * @typedef {Object} HistoryEntry
 * @property {number} timestamp
 * @property {string} locationName
 * @property {number} latitude
 * @property {number} longitude
 * @property {number|null} temperatura
 * @property {number|null} umidade
 * @property {number|null} pressao
 * @property {number|null} vento
 * @property {number|null} uv
 * @property {number|null} aqi
 * @property {number|null} weatherCode
 */

/**
 * @returns {HistoryEntry[]}
 */
export function getHistory() {
  return getItem(STORAGE_KEYS.history, []);
}

/**
 * @param {Omit<HistoryEntry, 'timestamp'>} data
 * @returns {HistoryEntry[]}
 */
export function addHistoryEntry(data) {
  const entry = {
    timestamp: Date.now(),
    locationName: data.locationName,
    latitude: data.latitude,
    longitude: data.longitude,
    temperatura: data.temperatura ?? null,
    umidade: data.umidade ?? null,
    pressao: data.pressao ?? null,
    vento: data.vento ?? null,
    uv: data.uv ?? null,
    aqi: data.aqi ?? null,
    weatherCode: data.weatherCode ?? null,
  };

  let list = [entry, ...getHistory()];
  if (list.length > HISTORY_MAX_ENTRIES) {
    list = list.slice(0, HISTORY_MAX_ENTRIES);
  }
  setItem(STORAGE_KEYS.history, list);
  EventBus.emit(Events.HISTORY_CHANGED, list);
  return list;
}

/**
 * Limpa o histórico.
 * @returns {HistoryEntry[]}
 */
export function clearHistory() {
  setItem(STORAGE_KEYS.history, []);
  EventBus.emit(Events.HISTORY_CHANGED, []);
  return [];
}

/**
 * Exporta histórico como JSON string.
 * @returns {string}
 */
export function exportHistoryJSON() {
  return JSON.stringify(getHistory(), null, 2);
}

/**
 * Exporta histórico como CSV.
 * @returns {string}
 */
export function exportHistoryCSV() {
  const rows = getHistory();
  const header = [
    'timestamp',
    'datetime',
    'locationName',
    'latitude',
    'longitude',
    'temperatura',
    'umidade',
    'pressao',
    'vento',
    'uv',
    'aqi',
    'weatherCode',
  ];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.timestamp,
        new Date(r.timestamp).toISOString(),
        `"${(r.locationName || '').replace(/"/g, '""')}"`,
        r.latitude,
        r.longitude,
        r.temperatura ?? '',
        r.umidade ?? '',
        r.pressao ?? '',
        r.vento ?? '',
        r.uv ?? '',
        r.aqi ?? '',
        r.weatherCode ?? '',
      ].join(',')
    );
  }
  return lines.join('\n');
}
