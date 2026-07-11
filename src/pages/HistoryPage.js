/**
 * Histórico com tabela e gráfico de tendência.
 * @module pages/HistoryPage
 */

import { el, downloadText } from '../utils/dom.js';
import { t } from '../utils/i18n.js';
import {
  getHistory,
  clearHistory,
  exportHistoryCSV,
  exportHistoryJSON,
} from '../storage/historyStore.js';
import {
  formatDateTime,
  formatTemp,
  formatWind,
  formatPressure,
  formatPercent,
  toDisplayTemp,
} from '../utils/units.js';
import { EventBus, Events } from '../core/EventBus.js';
import { getSettings } from '../storage/settingsStore.js';

/**
 * @param {HTMLElement} container
 */
export async function renderHistoryPage(container) {
  const page = el('div', { className: 'page-panel' });
  const title = el('h2', { text: t('nav_history') });
  const actions = el('div', { className: 'panel-actions' });
  const chartHost = el('div', { className: 'history-chart-host' });
  const tableWrap = el('div', { className: 'table-wrap' });
  /** @type {import('chart.js').Chart|null} */
  let chart = null;

  const csvBtn = el('button', {
    type: 'button',
    className: 'btn',
    text: t('export_csv'),
    onClick: () => downloadText('keclima-history.csv', exportHistoryCSV(), 'text/csv'),
  });
  const jsonBtn = el('button', {
    type: 'button',
    className: 'btn',
    text: t('export_json'),
    onClick: () =>
      downloadText('keclima-history.json', exportHistoryJSON(), 'application/json'),
  });
  const clearBtn = el('button', {
    type: 'button',
    className: 'btn btn-danger',
    text: t('clear_history'),
    onClick: () => {
      if (window.confirm(t('confirm_clear_history'))) {
        clearHistory();
      }
    },
  });

  actions.append(csvBtn, jsonBtn, clearBtn);
  page.append(title, actions, el('h3', { className: 'subhead', text: t('history_chart') }), chartHost, tableWrap);
  container.append(page);

  function renderChart(rows) {
    chartHost.innerHTML = '';
    if (chart) {
      chart.destroy();
      chart = null;
    }
    if (!rows.length || typeof Chart === 'undefined') {
      chartHost.append(el('p', { className: 'muted', text: t('no_history') }));
      return;
    }

    const chronological = [...rows].reverse().slice(-60);
    const lang = getSettings().language || 'pt';
    const locale = lang === 'en' ? 'en-US' : lang === 'es' ? 'es-ES' : 'pt-BR';
    const labels = chronological.map((r) =>
      new Date(r.timestamp).toLocaleString(locale, {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    );
    const temps = chronological.map((r) => toDisplayTemp(r.temperatura));
    const canvas = el('canvas');
    chartHost.append(el('div', { className: 'chart-wrap history-chart' }, [canvas]));

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: t('temperature'),
            data: temps,
            borderColor: '#38bdf8',
            backgroundColor: '#38bdf833',
            fill: true,
            tension: 0.3,
            pointRadius: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: {
            ticks: {
              color: isDark ? '#cbd5e1' : '#475569',
              maxTicksLimit: 8,
            },
          },
          y: { ticks: { color: isDark ? '#cbd5e1' : '#475569' } },
        },
      },
    });
  }

  function render() {
    title.textContent = t('nav_history');
    csvBtn.textContent = t('export_csv');
    jsonBtn.textContent = t('export_json');
    clearBtn.textContent = t('clear_history');
    page.querySelector('.subhead').textContent = t('history_chart');

    const rows = getHistory();
    renderChart(rows);

    tableWrap.innerHTML = '';
    if (!rows.length) {
      tableWrap.append(el('p', { className: 'muted', text: t('no_history') }));
      return;
    }

    const table = el('table', { className: 'data-table' });
    table.append(
      el('thead', {}, [
        el('tr', {}, [
          el('th', { text: t('last_update') }),
          el('th', { text: t('settings_default_city') }),
          el('th', { text: t('temperature') }),
          el('th', { text: t('humidity') }),
          el('th', { text: t('pressure') }),
          el('th', { text: t('wind') }),
          el('th', { text: t('uv') }),
          el('th', { text: t('aqi') }),
        ]),
      ])
    );

    const tbody = el('tbody');
    for (const r of rows.slice(0, 100)) {
      tbody.append(
        el('tr', {}, [
          el('td', { text: formatDateTime(r.timestamp) }),
          el('td', { text: r.locationName }),
          el('td', { text: formatTemp(r.temperatura, 0) }),
          el('td', { text: formatPercent(r.umidade) }),
          el('td', { text: formatPressure(r.pressao) }),
          el('td', { text: formatWind(r.vento, 0) }),
          el('td', { text: r.uv != null ? String(r.uv) : '—' }),
          el('td', { text: r.aqi != null ? String(r.aqi) : '—' }),
        ])
      );
    }
    table.append(tbody);
    tableWrap.append(table);
  }

  render();
  const unsubs = [
    EventBus.on(Events.HISTORY_CHANGED, render),
    EventBus.on(Events.SETTINGS_CHANGED, render),
    EventBus.on(Events.THEME_CHANGED, render),
  ];

  container._teardown = () => {
    unsubs.forEach((u) => u());
    if (chart) {
      chart.destroy();
    }
  };
}
