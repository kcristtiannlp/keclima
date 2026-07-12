/**
 * Dashboard com painéis reordenáveis, exclusão/inclusão e tamanho S/M/L.
 * @module pages/DashboardPage
 */

import { el } from '../utils/dom.js';
import { getState } from '../core/State.js';
import { EventBus, Events } from '../core/EventBus.js';
import {
  getSettings,
  updateSettings,
  hideWidget,
  setVisibleWidgets,
  getWidgetSize,
  cycleWidgetSize,
} from '../storage/settingsStore.js';
import { DEFAULT_SETTINGS, WIDGET_CATALOG, WIDGET_SIZES } from '../config.js';
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

  const customizeBtn = el('button', {
    type: 'button',
    className: 'btn btn-sm',
    text: t('customize_panels'),
    onClick: () => openCustomize(customizeHost, () => rebuild()),
  });
  toolbar.append(customizeBtn);

  function teardownWidgets() {
    widgets.forEach((w) => w.destroy());
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

  function mountWidgets() {
    teardownWidgets();
    const order = getSettings().widgetOrder || [];

    if (!order.length) {
      grid.append(el('p', { className: 'muted', text: t('no_panels') }));
      return;
    }

    for (const id of order) {
      if (!FACTORY[id]) {
        continue;
      }
      const w = FACTORY[id]();
      widgets.push(w);
      const node = w.mount();
      node.draggable = true;
      node.dataset.widgetId = id;
      applySizeClass(node, id);

      const header = node.querySelector('.widget-header');
      if (header) {
        header.classList.add('widget-header-actions');

        const sizeBtn = el('button', {
          type: 'button',
          className: 'widget-size-btn',
          title: t('widget_size_cycle'),
          'aria-label': t('widget_size_cycle'),
          text: getWidgetSize(id).toUpperCase(),
          onClick: (e) => {
            e.preventDefault();
            e.stopPropagation();
            const next = cycleWidgetSize(id);
            applySizeClass(node, id);
            sizeBtn.textContent = getWidgetSize(id).toUpperCase();
            // mapa precisa recalcular tiles
            if (w.map && typeof w.map.invalidateSize === 'function') {
              setTimeout(() => w.map.invalidateSize(), 50);
            }
            void next;
          },
        });
        sizeBtn.draggable = false;
        sizeBtn.addEventListener('mousedown', (e) => e.stopPropagation());

        const removeBtn = el('button', {
          type: 'button',
          className: 'widget-remove',
          title: t('widget_hide'),
          'aria-label': t('widget_hide'),
          text: '×',
          onClick: (e) => {
            e.preventDefault();
            e.stopPropagation();
            hideWidget(id);
            rebuild();
          },
        });
        removeBtn.draggable = false;
        removeBtn.addEventListener('mousedown', (e) => e.stopPropagation());

        header.append(sizeBtn, removeBtn);
      }

      grid.append(node);
      w.update(payload());
    }

    requestAnimationFrame(() => {
      widgets.forEach((w) => {
        if (w.map && typeof w.map.invalidateSize === 'function') {
          w.map.invalidateSize();
        }
      });
    });
  }

  function sync() {
    const p = payload();
    widgets.forEach((w) => w.update(p));
  }

  function rebuild() {
    hint.textContent = t('reorder_hint');
    customizeBtn.textContent = t('customize_panels');
    mountWidgets();
  }

  enableReorder(grid);

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
    EventBus.on(Events.SETTINGS_CHANGED, (s) => {
      document.documentElement.classList.toggle(
        'compact-mode',
        s?.compactMode ?? getSettings().compactMode
      );
      hint.textContent = t('reorder_hint');
      customizeBtn.textContent = t('customize_panels');
      // unidades/idioma: re-render dos widgets; ordem/tamanho: quem mudou já chama rebuild
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
 * @param {() => void} onDone
 */
function openCustomize(host, onDone) {
  host.innerHTML = '';
  const visible = new Set(getSettings().widgetOrder);
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
    if (!FACTORY[id]) {
      continue;
    }
    const input = el('input', {
      type: 'checkbox',
      checked: visible.has(id) || undefined,
      id: `cust-${id}`,
    });
    checks.set(id, input);

    const sizeSel = el('select', {
      className: 'customize-size-select',
      title: t('widget_size'),
      onClick: (e) => e.stopPropagation(),
      onChange: () => {
        /* applied on save */
      },
    });
    for (const s of WIDGET_SIZES) {
      const opt = el('option', {
        value: s,
        text: t(`widget_size_${s}`),
      });
      if ((sizes[id] || 's') === s) {
        opt.selected = true;
      }
      sizeSel.append(opt);
    }
    sizeSelects.set(id, sizeSel);

    list.append(
      el('div', { className: 'customize-row' }, [
        el('label', { className: 'customize-item', for: `cust-${id}` }, [
          input,
          el('span', { text: t(LABEL_KEYS[id] || id) }),
        ]),
        sizeSel,
      ])
    );
  }

  panel.append(list);

  panel.append(
    el('div', { className: 'customize-actions' }, [
      el('button', {
        type: 'button',
        className: 'btn btn-primary',
        text: t('save'),
        onClick: () => {
          const ids = [...checks.entries()].filter(([, inp]) => inp.checked).map(([id]) => id);
          if (!ids.length) {
            ids.push('temperature');
          }
          const nextSizes = { ...getSettings().widgetSizes };
          for (const [id, sel] of sizeSelects) {
            const v = sel.value;
            if (WIDGET_SIZES.includes(/** @type {any} */ (v))) {
              nextSizes[id] = v;
            }
          }
          setVisibleWidgets(ids, nextSizes);
          host.innerHTML = '';
          onDone();
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
          host.innerHTML = '';
          onDone();
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

/**
 * @param {HTMLElement} grid
 */
function enableReorder(grid) {
  grid.addEventListener('dragstart', (e) => {
    const card = e.target.closest('[data-widget-id]');
    if (!card || e.target.closest('.widget-remove, .widget-size-btn')) {
      return;
    }
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  grid.addEventListener('dragend', (e) => {
    const card = e.target.closest('[data-widget-id]');
    card?.classList.remove('dragging');
    const order = [...grid.querySelectorAll('[data-widget-id]')].map((n) => n.dataset.widgetId);
    if (order.length) {
      updateSettings({ widgetOrder: order });
    }
  });

  grid.addEventListener('dragover', (e) => {
    e.preventDefault();
    const after = getDragAfterElement(grid, e.clientY, e.clientX);
    const dragging = grid.querySelector('.dragging');
    if (!dragging) {
      return;
    }
    if (after == null) {
      grid.append(dragging);
    } else {
      grid.insertBefore(dragging, after);
    }
  });
}

/**
 * @param {HTMLElement} container
 * @param {number} y
 * @param {number} x
 */
function getDragAfterElement(container, y, x) {
  const els = [...container.querySelectorAll('[data-widget-id]:not(.dragging)')];
  let closest = { offset: Number.NEGATIVE_INFINITY, element: null };
  for (const child of els) {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2 + (x - box.left - box.width / 2) * 0.01;
    if (offset < 0 && offset > closest.offset) {
      closest = { offset, element: child };
    }
  }
  return closest.element;
}
