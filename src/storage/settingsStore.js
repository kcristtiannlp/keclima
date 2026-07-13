/**
 * Persistência de configurações do usuário.
 * @module storage/settingsStore
 */

import {
  DEFAULT_SETTINGS,
  STORAGE_KEYS,
  WIDGET_CATALOG,
  WIDGET_SIZES,
} from '../config.js';
import { getItem, setItem, removeItem, clearByPrefix } from './Storage.js';
import { EventBus, Events } from '../core/EventBus.js';

/**
 * Clona valor em JSON puro (garante serialização e remove referências).
 * @param {any} value
 * @returns {any}
 */
function toPlain(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Grava settings com retry se o localStorage estiver cheio (limpa caches).
 * Também grava widgetOrder numa chave dedicada (mais resiliente).
 * @param {object} next
 * @returns {boolean}
 */
function persistSettings(next) {
  let plain;
  try {
    plain = toPlain(next);
  } catch (err) {
    console.error('[settings] objeto não serializável:', err);
    return false;
  }

  // Chave dedicada: se o blob de settings falhar, a ordem dos painéis ainda sobrevive
  if (Array.isArray(plain.widgetOrder)) {
    setItem(STORAGE_KEYS.widgetOrder, plain.widgetOrder);
  }

  let ok = setItem(STORAGE_KEYS.settings, plain);
  if (ok) {
    // Confirma leitura (evita “parece ok na sessão, some no F5”)
    const check = getItem(STORAGE_KEYS.settings, null);
    if (!check || !Array.isArray(check.widgetOrder)) {
      ok = false;
    } else if (
      plain.widgetOrder &&
      JSON.stringify(check.widgetOrder) !== JSON.stringify(plain.widgetOrder)
    ) {
      ok = false;
    }
  }

  if (!ok) {
    // Libera espaço de caches de API e tenta de novo
    try {
      clearByPrefix('keclima:cache:');
    } catch {
      /* ignore */
    }
    if (Array.isArray(plain.widgetOrder)) {
      setItem(STORAGE_KEYS.widgetOrder, plain.widgetOrder);
    }
    ok = setItem(STORAGE_KEYS.settings, plain);
  }

  if (!ok) {
    console.error('[settings] falha ao gravar no localStorage');
  }
  return ok;
}

/**
 * Lê ordem dos painéis: chave dedicada tem prioridade (mais confiável).
 * @param {object} stored
 * @returns {string[]|null}
 */
function readStoredWidgetOrder(stored) {
  const dedicated = getItem(STORAGE_KEYS.widgetOrder, null);
  if (Array.isArray(dedicated)) {
    return dedicated;
  }
  if (Array.isArray(stored?.widgetOrder)) {
    return stored.widgetOrder;
  }
  return null;
}

/**
 * @returns {typeof DEFAULT_SETTINGS}
 */
export function getSettings() {
  const stored = getItem(STORAGE_KEYS.settings, {}) || {};
  const rawOrder = readStoredWidgetOrder(stored);
  let widgetOrder = sanitizeWidgetOrder(rawOrder);
  const widgetSizes = sanitizeWidgetSizes(stored.widgetSizes);

  // Migração 0.8.x: ordem antiga sem Previsão recebe forecastHome no topo uma vez.
  // Depois o usuário pode ocultar o painel sem ele voltar sozinho.
  if (!stored.forecastHomeMigrated) {
    if (!widgetOrder.includes('forecastHome')) {
      widgetOrder = ['forecastHome', ...widgetOrder];
    }
    persistSettings({
      ...DEFAULT_SETTINGS,
      ...stored,
      units: {
        ...DEFAULT_SETTINGS.units,
        ...(stored.units || {}),
      },
      widgetOrder,
      widgetSizes,
      forecastHomeMigrated: true,
    });
  }

  // Migração: "Confiança · INMET" deixa de ser padrão — remove uma vez;
  // quem quiser volta em Personalizar painéis.
  if (!stored.inmetDefaultOffMigrated) {
    if (widgetOrder.includes('inmet')) {
      widgetOrder = widgetOrder.filter((id) => id !== 'inmet');
    }
    persistSettings({
      ...DEFAULT_SETTINGS,
      ...stored,
      units: {
        ...DEFAULT_SETTINGS.units,
        ...(stored.units || {}),
      },
      widgetOrder,
      widgetSizes,
      forecastHomeMigrated: true,
      inmetDefaultOffMigrated: true,
    });
  }

  // Migração: mapa deixa de ser padrão no dashboard — remove uma vez;
  // quem quiser volta em Personalizar (ou usa a página Mapa).
  if (!stored.mapDefaultOffMigrated) {
    if (widgetOrder.includes('map')) {
      widgetOrder = widgetOrder.filter((id) => id !== 'map');
    }
    persistSettings({
      ...DEFAULT_SETTINGS,
      ...stored,
      units: {
        ...DEFAULT_SETTINGS.units,
        ...(stored.units || {}),
      },
      widgetOrder,
      widgetSizes,
      forecastHomeMigrated: true,
      inmetDefaultOffMigrated: true,
      mapDefaultOffMigrated: true,
    });
  }

  // Migração: "Fontes de dados" deixa de ser padrão — remove uma vez;
  // quem quiser volta em Personalizar (também na página Sobre).
  if (!stored.sourcesDefaultOffMigrated) {
    if (widgetOrder.includes('sources')) {
      widgetOrder = widgetOrder.filter((id) => id !== 'sources');
    }
    persistSettings({
      ...DEFAULT_SETTINGS,
      ...stored,
      units: {
        ...DEFAULT_SETTINGS.units,
        ...(stored.units || {}),
      },
      widgetOrder,
      widgetSizes,
      forecastHomeMigrated: true,
      inmetDefaultOffMigrated: true,
      mapDefaultOffMigrated: true,
      sourcesDefaultOffMigrated: true,
    });
  }

  // Migração: se só existir no blob de settings, espelha na chave dedicada
  const dedicated = getItem(STORAGE_KEYS.widgetOrder, null);
  if (!Array.isArray(dedicated) && Array.isArray(widgetOrder)) {
    setItem(STORAGE_KEYS.widgetOrder, widgetOrder);
  }

  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    units: {
      ...DEFAULT_SETTINGS.units,
      ...(stored.units || {}),
    },
    widgetOrder,
    widgetSizes,
    forecastHomeMigrated: true,
    inmetDefaultOffMigrated: true,
    mapDefaultOffMigrated: true,
    sourcesDefaultOffMigrated: true,
  };
}

/**
 * @param {string[]|null} saved
 * @returns {string[]}
 */
export function sanitizeWidgetOrder(saved) {
  const catalog = WIDGET_CATALOG;
  // null/undefined → default; [] vazio é válido (usuário ocultou todos)
  if (saved == null) {
    return [...DEFAULT_SETTINGS.widgetOrder];
  }
  if (!Array.isArray(saved)) {
    return [...DEFAULT_SETTINGS.widgetOrder];
  }
  const seen = new Set();
  const out = [];
  for (const id of saved) {
    if (typeof id === 'string' && catalog.includes(id) && !seen.has(id)) {
      out.push(id);
      seen.add(id);
    }
  }
  return out;
}

/**
 * @param {Record<string, string>|null|undefined} saved
 * @returns {Record<string, 's'|'m'|'l'>}
 */
export function sanitizeWidgetSizes(saved) {
  const defaults = { ...DEFAULT_SETTINGS.widgetSizes };
  if (!saved || typeof saved !== 'object') {
    return defaults;
  }
  const out = { ...defaults };
  for (const id of WIDGET_CATALOG) {
    const v = saved[id];
    if (WIDGET_SIZES.includes(/** @type {any} */ (v))) {
      out[id] = /** @type {'s'|'m'|'l'} */ (v);
    }
  }
  return out;
}

/**
 * @param {string} id
 * @returns {'s'|'m'|'l'}
 */
export function getWidgetSize(id) {
  const sizes = getSettings().widgetSizes || DEFAULT_SETTINGS.widgetSizes;
  const v = sizes[id];
  if (WIDGET_SIZES.includes(/** @type {any} */ (v))) {
    return /** @type {'s'|'m'|'l'} */ (v);
  }
  return DEFAULT_SETTINGS.widgetSizes[id] || 's';
}

/**
 * @param {string} id
 * @param {'s'|'m'|'l'} size
 */
export function setWidgetSize(id, size) {
  if (!WIDGET_CATALOG.includes(id) || !WIDGET_SIZES.includes(size)) {
    return getSettings();
  }
  const widgetSizes = {
    ...getSettings().widgetSizes,
    [id]: size,
  };
  return updateSettings({ widgetSizes });
}

/**
 * Cicla S → M → L → S.
 * @param {string} id
 */
export function cycleWidgetSize(id) {
  const cur = getWidgetSize(id);
  const idx = WIDGET_SIZES.indexOf(cur);
  const next = WIDGET_SIZES[(idx + 1) % WIDGET_SIZES.length];
  return setWidgetSize(id, next);
}

/**
 * @param {Partial<typeof DEFAULT_SETTINGS>} partial
 * @returns {typeof DEFAULT_SETTINGS}
 */
export function updateSettings(partial) {
  const current = getSettings();
  const next = {
    ...current,
    ...partial,
    units: {
      ...current.units,
      ...(partial.units || {}),
    },
  };
  if (Object.prototype.hasOwnProperty.call(partial, 'widgetOrder')) {
    next.widgetOrder = sanitizeWidgetOrder(partial.widgetOrder);
  } else {
    // garante array limpo mesmo em updates parciais
    next.widgetOrder = sanitizeWidgetOrder(current.widgetOrder);
  }
  if (partial.widgetSizes) {
    next.widgetSizes = sanitizeWidgetSizes({
      ...current.widgetSizes,
      ...partial.widgetSizes,
    });
  } else {
    next.widgetSizes = sanitizeWidgetSizes(current.widgetSizes);
  }

  persistSettings(next);
  EventBus.emit(Events.SETTINGS_CHANGED, next);
  return getSettings();
}

/**
 * Oculta um painel do dashboard (pode zerar a lista — tela “nenhum painel”).
 * @param {string} id
 */
export function hideWidget(id) {
  const order = getSettings().widgetOrder.filter((w) => w !== id);
  return updateSettings({ widgetOrder: order });
}

/**
 * @param {string} id
 */
export function showWidget(id) {
  if (!WIDGET_CATALOG.includes(id)) {
    return getSettings();
  }
  const order = [...getSettings().widgetOrder];
  if (!order.includes(id)) {
    order.push(id);
  }
  return updateSettings({ widgetOrder: order });
}

/**
 * Define quais painéis ficam visíveis.
 * Mantém a ordem dos que já estavam; novos vão ao topo (Previsão) ou ao fim.
 * @param {string[]} ids
 * @param {Record<string, 's'|'m'|'l'>} [sizes]
 */
export function setVisibleWidgets(ids, sizes) {
  const catalog = new Set(WIDGET_CATALOG);
  const wanted = [];
  const seen = new Set();
  for (const id of ids || []) {
    if (catalog.has(id) && !seen.has(id)) {
      wanted.push(id);
      seen.add(id);
    }
  }

  // Sempre pelo menos Previsão se a lista vier vazia
  if (!wanted.length) {
    wanted.push('forecastHome');
  }

  const current = getSettings().widgetOrder || [];
  const ordered = [];
  const remaining = new Set(wanted);

  // 1) mantém ordem atual dos que continuam marcados
  for (const id of current) {
    if (remaining.has(id)) {
      ordered.push(id);
      remaining.delete(id);
    }
  }

  // 2) novos painéis: Previsão no topo; demais no fim (ordem do catálogo)
  const newcomers = wanted.filter((id) => remaining.has(id));
  const head = [];
  const tail = [];
  for (const id of newcomers) {
    if (id === 'forecastHome') head.push(id);
    else tail.push(id);
  }
  const finalOrder = [...head, ...ordered, ...tail];

  /** @type {Record<string, unknown>} */
  const partial = {
    widgetOrder: finalOrder,
  };
  if (sizes) {
    partial.widgetSizes = sizes;
  }
  return updateSettings(partial);
}

/**
 * @returns {typeof DEFAULT_SETTINGS}
 */
export function resetSettings() {
  const next = {
    ...DEFAULT_SETTINGS,
    units: { ...DEFAULT_SETTINGS.units },
    widgetOrder: [...DEFAULT_SETTINGS.widgetOrder],
    widgetSizes: { ...DEFAULT_SETTINGS.widgetSizes },
  };
  try {
    removeItem(STORAGE_KEYS.widgetOrder);
  } catch {
    /* ignore */
  }
  persistSettings(next);
  EventBus.emit(Events.SETTINGS_CHANGED, next);
  return getSettings();
}

/**
 * Confere se a ordem gravada inclui os ids pedidos (debug / UI).
 * @param {string[]} expected
 * @returns {boolean}
 */
export function verifyWidgetOrderPersisted(expected) {
  const dedicated = getItem(STORAGE_KEYS.widgetOrder, null);
  const stored = getItem(STORAGE_KEYS.settings, null);
  const fromDedicated = Array.isArray(dedicated) ? dedicated : null;
  const fromSettings = Array.isArray(stored?.widgetOrder) ? stored.widgetOrder : null;
  const actual = fromDedicated || fromSettings || [];
  const want = new Set(expected || []);
  for (const id of want) {
    if (!actual.includes(id)) return false;
  }
  return true;
}
