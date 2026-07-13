/**
 * Dashboard: painéis com tamanho S/M/L, ocultar e reordenar com setas.
 * (Sem drag-and-drop — falhava na grade CSS.)
 * @module pages/DashboardPage
 */

import { el } from '../utils/dom.js';
import { getState } from '../core/State.js';
import { EventBus, Events } from '../core/EventBus.js';
import {
  getSettings,
  updateSettings,
  setVisibleWidgets,
  getWidgetSize,
  cycleWidgetSize,
  verifyWidgetOrderPersisted,
} from '../storage/settingsStore.js';
import { DEFAULT_SETTINGS, WIDGET_CATALOG, WIDGET_SIZES } from '../config.js';
import { toastError, toastSuccess } from '../services/toastService.js';
import { ForecastHomeWidget } from '../widgets/ForecastHomeWidget.js';
import { TemperatureWidget } from '../widgets/TemperatureWidget.js';
import { PressureWidget } from '../widgets/PressureWidget.js';
import { HumidityWidget } from '../widgets/HumidityWidget.js';
import { WindWidget } from '../widgets/WindWidget.js';
import { UVWidget } from '../widgets/UVWidget.js';
import { AQIWidget } from '../widgets/AQIWidget.js';
import { ForecastWidget } from '../widgets/ForecastWidget.js';
import { SunWidget } from '../widgets/SunWidget.js';
import { MoonWidget } from '../widgets/MoonWidget.js';
import { AlertWidget } from '../widgets/AlertWidget.js';
import { ConditionsWidget } from '../widgets/ConditionsWidget.js';
import { CompareWidget } from '../widgets/CompareWidget.js';
import { InmetWidget } from '../widgets/InmetWidget.js';
import { SourcesWidget } from '../widgets/SourcesWidget.js';
import { MapWidget } from '../widgets/MapWidget.js';
import { DeforestationWidget } from '../widgets/DeforestationWidget.js';
import { t } from '../utils/i18n.js';
import { loadCompareWeather } from '../services/weatherService.js';

const FACTORY = {
  forecastHome: () => new ForecastHomeWidget(),
  temperature: () => new TemperatureWidget(),
  inmet: () => new InmetWidget(),
  conditions: () => new ConditionsWidget(),
  humidity: () => new HumidityWidget(),
  pressure: () => new PressureWidget(),
  wind: () => new WindWidget(),
  uv: () => new UVWidget(),
  aqi: () => new AQIWidget(),
  sun: () => new SunWidget(),
  moon: () => new MoonWidget(),
  alerts: () => new AlertWidget(),
  forecast: () => new ForecastWidget(),
  map: () => {
    const w = new MapWidget();
    w.className = 'widget-map widget-map-dash';
    return w;
  },
  deforestation: () => new DeforestationWidget(),
  compare: () => new CompareWidget(),
  sources: () => new SourcesWidget(),
};

const LABEL_KEYS = {
  forecastHome: 'forecast_home_title',
  temperature: 'temperature',
  inmet: 'inmet_title',
  conditions: 'condition',
  humidity: 'humidity',
  pressure: 'pressure',
  wind: 'wind',
  uv: 'uv',
  aqi: 'aqi',
  sun: 'sunrise',
  moon: 'moon',
  alerts: 'alerts',
  forecast: 'forecast_hourly',
  map: 'widget_map',
  deforestation: 'deforestation_title',
  compare: 'compare',
  sources: 'sources_title',
};

/**
 * @param {HTMLElement} container
 */
export async function renderDashboardPage(container) {
  const toolbar = el('div', { className: 'dash-toolbar' });
  const hint = el('p', { className: 'reorder-hint muted', text: t('reorder_hint') });
  const grid = el('div', { className: 'dashboard-grid' });
  const customizeHost = el('div', { className: 'customize-host' });
  container.append(toolbar, hint, customizeHost, grid);

  /** @type {import('../widgets/Widget.js').Widget[]} */
  let widgets = [];
  /** Ordem visível (fonte de verdade na sessão) */
  let visibleOrder = [...(getSettings().widgetOrder || [])];

  const customizeBtn = el('button', {
    type: 'button',
    className: 'btn btn-sm',
    text: t('customize_panels'),
    onClick: () =>
      openCustomize(customizeHost, (newOrder) => {
        visibleOrder = Array.isArray(newOrder)
          ? [...newOrder]
          : [...(getSettings().widgetOrder || [])];
        rebuild();
      }),
  });
  toolbar.append(customizeBtn);

  function teardownWidgets() {
    for (const w of widgets) {
      try {
        w.destroy();
      } catch {
        /* ignore */
      }
    }
    widgets = [];
    grid.innerHTML = '';
  }

  function payload() {
    const state = getState();
    return {
      weather: state.weather,
      airQuality: state.airQuality,
      location: state.location,
      loading: state.loading,
      compareWeather: state.compareWeather,
      compareLocation: state.compareLocation,
      archive: state.archive,
      officialAlerts: state.officialAlerts,
    };
  }

  function applySizeClass(node, id) {
    const size = getWidgetSize(id);
    node.classList.remove('widget-size-s', 'widget-size-m', 'widget-size-l', 'widget-wide');
    node.classList.add(`widget-size-${size}`);
    node.dataset.size = size;
    return size;
  }

  function persistOrder() {
    updateSettings({ widgetOrder: [...visibleOrder] });
  }

  /** Atualiza estado disabled das setas de todos os cards */
  function refreshMoveButtons() {
    const cards = [...grid.querySelectorAll('[data-widget-id]')];
    cards.forEach((card, i) => {
      const up = card.querySelector('.widget-move-up');
      const down = card.querySelector('.widget-move-down');
      if (up instanceof HTMLButtonElement) up.disabled = i === 0;
      if (down instanceof HTMLButtonElement) down.disabled = i === cards.length - 1;
    });
  }

  /**
   * Move painel uma posição (−1 sobe, +1 desce).
   * @param {string} id
   * @param {-1|1} dir
   */
  function movePanel(id, dir) {
    const i = visibleOrder.indexOf(id);
    if (i < 0) return;
    const j = i + dir;
    if (j < 0 || j >= visibleOrder.length) return;

    const neighborId = visibleOrder[j];
    visibleOrder[i] = neighborId;
    visibleOrder[j] = id;

    const card = grid.querySelector(`[data-widget-id="${id}"]`);
    const neighbor = grid.querySelector(`[data-widget-id="${neighborId}"]`);
    if (!card || !neighbor) {
      persistOrder();
      rebuild();
      return;
    }

    if (dir === -1) {
      grid.insertBefore(card, neighbor);
    } else if (neighbor.nextElementSibling) {
      grid.insertBefore(card, neighbor.nextElementSibling);
    } else {
      grid.appendChild(card);
    }

    const wi = widgets.findIndex((w) => w.id === id);
    const wj = widgets.findIndex((w) => w.id === neighborId);
    if (wi >= 0 && wj >= 0) {
      const tw = widgets[wi];
      widgets[wi] = widgets[wj];
      widgets[wj] = tw;
    }

    persistOrder();
    refreshMoveButtons();
  }

  function mountWidgets() {
    teardownWidgets();

    if (!visibleOrder.length) {
      grid.append(
        el('div', { className: 'no-panels' }, [
          el('p', { className: 'muted', text: t('no_panels') }),
          el('button', {
            type: 'button',
            className: 'btn btn-sm',
            text: t('customize_panels'),
            onClick: () =>
              openCustomize(customizeHost, (newOrder) => {
                visibleOrder = Array.isArray(newOrder)
                  ? [...newOrder]
                  : [...(getSettings().widgetOrder || [])];
                rebuild();
              }),
          }),
        ])
      );
      return;
    }

    for (const id of visibleOrder) {
      if (!FACTORY[id]) continue;

      const w = FACTORY[id]();
      widgets.push(w);
      const node = w.mount();
      node.draggable = false;
      node.dataset.widgetId = id;
      applySizeClass(node, id);

      const header = node.querySelector('.widget-header');
      if (header) {
        header.classList.add('widget-header-actions');
        const actions = el('div', { className: 'widget-actions' });

        const upBtn = document.createElement('button');
        upBtn.type = 'button';
        upBtn.className = 'widget-move-up';
        upBtn.title = t('widget_move_up');
        upBtn.setAttribute('aria-label', t('widget_move_up'));
        upBtn.textContent = '▲';
        upBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          movePanel(id, -1);
        });

        const downBtn = document.createElement('button');
        downBtn.type = 'button';
        downBtn.className = 'widget-move-down';
        downBtn.title = t('widget_move_down');
        downBtn.setAttribute('aria-label', t('widget_move_down'));
        downBtn.textContent = '▼';
        downBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          movePanel(id, 1);
        });

        const sizeBtn = document.createElement('button');
        sizeBtn.type = 'button';
        sizeBtn.className = 'widget-size-btn';
        sizeBtn.title = t('widget_size_cycle');
        sizeBtn.setAttribute('aria-label', t('widget_size_cycle'));
        sizeBtn.textContent = getWidgetSize(id).toUpperCase();
        sizeBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          cycleWidgetSize(id);
          applySizeClass(node, id);
          sizeBtn.textContent = getWidgetSize(id).toUpperCase();
          if (w.map && typeof w.map.invalidateSize === 'function') {
            setTimeout(() => w.map.invalidateSize(), 50);
          }
        });

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'widget-remove';
        removeBtn.title = t('widget_hide');
        removeBtn.setAttribute('aria-label', t('widget_hide'));
        removeBtn.textContent = '×';
        removeBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          hidePanel(id);
        });

        actions.append(upBtn, downBtn, sizeBtn, removeBtn);
        header.append(actions);
      }

      grid.append(node);
      w.update(payload());
    }

    refreshMoveButtons();

    requestAnimationFrame(() => {
      for (const w of widgets) {
        if (w.map && typeof w.map.invalidateSize === 'function') {
          w.map.invalidateSize();
        }
      }
    });
  }

  function sync() {
    const p = payload();
    for (const w of widgets) w.update(p);
  }

  function rebuild() {
    hint.textContent = t('reorder_hint');
    customizeBtn.textContent = t('customize_panels');
    mountWidgets();
  }

  /**
   * @param {string} id
   */
  function hidePanel(id) {
    if (!id) return;
    visibleOrder = visibleOrder.filter((w) => w !== id);

    const idx = widgets.findIndex((w) => w.id === id);
    if (idx >= 0) {
      try {
        widgets[idx].destroy();
      } catch {
        grid.querySelector(`[data-widget-id="${id}"]`)?.remove();
      }
      widgets.splice(idx, 1);
    } else {
      grid.querySelector(`[data-widget-id="${id}"]`)?.remove();
    }

    updateSettings({ widgetOrder: [...visibleOrder] });
    if (!visibleOrder.length) mountWidgets();
    else refreshMoveButtons();
  }

  const compareCity = getSettings().compareCity;
  if (compareCity && !getState().compareWeather) {
    loadCompareWeather(compareCity);
  }

  mountWidgets();

  const unsubs = [
    EventBus.on(Events.WEATHER_UPDATED, sync),
    EventBus.on(Events.AIR_QUALITY_UPDATED, sync),
    EventBus.on(Events.OFFICIAL_ALERTS_UPDATED, sync),
    EventBus.on(Events.COMPARE_UPDATED, sync),
    EventBus.on(Events.LOADING, sync),
    EventBus.on(Events.SETTINGS_CHANGED, () => {
      document.documentElement.classList.toggle('compact-mode', getSettings().compactMode);
      hint.textContent = t('reorder_hint');
      customizeBtn.textContent = t('customize_panels');
      for (const w of widgets) {
        const node = w.root;
        if (node && w.id) applySizeClass(node, w.id);
        const sizeBtn = node?.querySelector?.('.widget-size-btn');
        if (sizeBtn) sizeBtn.textContent = getWidgetSize(w.id).toUpperCase();
      }
      sync();
    }),
  ];

  document.documentElement.classList.toggle('compact-mode', getSettings().compactMode);

  container._teardown = () => {
    unsubs.forEach((u) => u());
    teardownWidgets();
  };
}

/**
 * @param {HTMLElement} host
 * @param {(order?: string[]) => void} onDone
 */
function openCustomize(host, onDone) {
  host.innerHTML = '';
  const visible = new Set(getSettings().widgetOrder || []);
  const sizes = { ...getSettings().widgetSizes };

  const panel = el('div', { className: 'customize-panel' }, [
    el('div', { className: 'customize-panel-head' }, [
      el('strong', { text: t('customize_panels') }),
      el('button', {
        type: 'button',
        className: 'icon-btn',
        text: '×',
        'aria-label': t('cancel'),
        onClick: () => {
          host.innerHTML = '';
        },
      }),
    ]),
    el('p', { className: 'muted customize-help', text: t('customize_help') }),
    el('p', { className: 'muted customize-help', text: t('customize_size_help') }),
  ]);

  const list = el('div', { className: 'customize-list customize-list-sized' });
  /** @type {Map<string, HTMLInputElement>} */
  const checks = new Map();
  /** @type {Map<string, HTMLSelectElement>} */
  const sizeSelects = new Map();

  for (const id of WIDGET_CATALOG) {
    if (!FACTORY[id]) continue;

    // createElement + .checked (evita bug do el() com atributo checked)
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = `cust-${id}`;
    input.checked = visible.has(id);
    input.dataset.widgetId = id;
    checks.set(id, input);

    const sizeSel = document.createElement('select');
    sizeSel.className = 'customize-size-select';
    sizeSel.title = t('widget_size');
    sizeSel.addEventListener('click', (e) => e.stopPropagation());
    for (const s of WIDGET_SIZES) {
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = t(`widget_size_${s}`);
      if ((sizes[id] || getWidgetSize(id) || 's') === s) opt.selected = true;
      sizeSel.append(opt);
    }
    sizeSelects.set(id, sizeSel);

    const label = document.createElement('label');
    label.className = 'customize-item';
    label.htmlFor = `cust-${id}`;
    label.append(input, document.createTextNode(' ' + t(LABEL_KEYS[id] || id)));

    const row = document.createElement('div');
    row.className = 'customize-row';
    row.append(label, sizeSel);
    list.append(row);
  }

  panel.append(list);
  panel.append(
    el('div', { className: 'customize-actions' }, [
      el('button', {
        type: 'button',
        className: 'btn btn-primary',
        text: t('save'),
        onClick: () => {
          const ids = [];
          for (const [id, inp] of checks) {
            if (inp.checked) ids.push(id);
          }
          if (!ids.length) ids.push('forecastHome');

          const nextSizes = { ...getSettings().widgetSizes };
          for (const [id, sel] of sizeSelects) {
            if (WIDGET_SIZES.includes(/** @type {any} */ (sel.value))) {
              nextSizes[id] = /** @type {'s'|'m'|'l'} */ (sel.value);
            }
          }

          // Garante tamanho L para a home de previsão quando reativada
          if (ids.includes('forecastHome') && !nextSizes.forecastHome) {
            nextSizes.forecastHome = 'l';
          }

          const saved = setVisibleWidgets(ids, nextSizes);
          // Re-lê do storage (não confiar só na memória da sessão)
          const order = [...(getSettings().widgetOrder || saved?.widgetOrder || ids)];
          host.innerHTML = '';

          if (!verifyWidgetOrderPersisted(order)) {
            toastError(t('settings_save_failed'));
          } else {
            toastSuccess(t('settings_saved'));
          }
          onDone(order);
        },
      }),
      el('button', {
        type: 'button',
        className: 'btn',
        text: t('customize_reset'),
        onClick: () => {
          updateSettings({
            widgetOrder: [...DEFAULT_SETTINGS.widgetOrder],
            widgetSizes: { ...DEFAULT_SETTINGS.widgetSizes },
          });
          const order = [...(getSettings().widgetOrder || DEFAULT_SETTINGS.widgetOrder)];
          host.innerHTML = '';
          onDone(order);
        },
      }),
      el('button', {
        type: 'button',
        className: 'btn btn-ghost',
        text: t('cancel'),
        onClick: () => {
          host.innerHTML = '';
        },
      }),
    ])
  );

  host.append(panel);
}
