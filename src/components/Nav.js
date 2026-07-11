/**
 * Navegação principal — 4 itens principais + menu "Mais" no mobile.
 * @module components/Nav
 */

import { el } from '../utils/dom.js';
import { t } from '../utils/i18n.js';
import { ROUTES, navigate, getCurrentPath } from '../router.js';
import { EventBus, Events } from '../core/EventBus.js';

const PRIMARY = [
  { path: ROUTES.dashboard, key: 'nav_dashboard', icon: '🏠' },
  { path: ROUTES.map, key: 'nav_map', icon: '🗺️' },
  { path: ROUTES.charts, key: 'nav_charts', icon: '📊' },
  { path: ROUTES.settings, key: 'nav_settings', icon: '⚙️' },
];

const MORE = [
  { path: ROUTES.favorites, key: 'nav_favorites', icon: '⭐' },
  { path: ROUTES.history, key: 'nav_history', icon: '📜' },
  { path: ROUTES.about, key: 'nav_about', icon: 'ℹ️' },
];

const ALL = [...PRIMARY, ...MORE];

/**
 * @param {HTMLElement} container
 */
export function mountNav(container) {
  const nav = el('nav', {
    className: 'app-nav',
    'aria-label': 'Main',
  });
  let moreOpen = false;
  /** @type {HTMLElement|null} */
  let morePanel = null;

  function isMorePath(path) {
    return MORE.some((i) => i.path === path);
  }

  function closeMore() {
    moreOpen = false;
    morePanel?.classList.add('hidden');
    nav.querySelector('.nav-item-more')?.classList.remove('active', 'open');
    nav.querySelector('.nav-item-more')?.setAttribute('aria-expanded', 'false');
  }

  function build() {
    const path = getCurrentPath();
    nav.innerHTML = '';
    morePanel = null;

    const primaryRow = el('div', { className: 'nav-primary' });

    for (const item of PRIMARY) {
      primaryRow.append(navButton(item, path === item.path));
    }

    // Botão "Mais"
    const moreActive = isMorePath(path);
    const moreBtn = el(
      'button',
      {
        type: 'button',
        className: `nav-item nav-item-more ${moreActive || moreOpen ? 'active' : ''} ${moreOpen ? 'open' : ''}`,
        'aria-expanded': moreOpen ? 'true' : 'false',
        'aria-haspopup': 'true',
        onClick: (e) => {
          e.stopPropagation();
          moreOpen = !moreOpen;
          if (morePanel) {
            morePanel.classList.toggle('hidden', !moreOpen);
          }
          moreBtn.classList.toggle('open', moreOpen);
          moreBtn.classList.toggle('active', moreOpen || isMorePath(getCurrentPath()));
          moreBtn.setAttribute('aria-expanded', moreOpen ? 'true' : 'false');
        },
      },
      [
        el('span', { className: 'nav-icon', text: '⋯' }),
        el('span', { className: 'nav-label', text: t('nav_more') }),
      ]
    );
    primaryRow.append(moreBtn);

    // Desktop: todos os itens em linha (classe CSS controla)
    const desktopRow = el('div', { className: 'nav-desktop' });
    for (const item of ALL) {
      desktopRow.append(navButton(item, path === item.path));
    }

    morePanel = el('div', {
      className: `nav-more-panel ${moreOpen ? '' : 'hidden'}`,
      role: 'menu',
    });
    for (const item of MORE) {
      const btn = el(
        'button',
        {
          type: 'button',
          className: `nav-more-item ${path === item.path ? 'active' : ''}`,
          role: 'menuitem',
          onClick: () => {
            closeMore();
            navigate(item.path);
          },
        },
        [
          el('span', { className: 'nav-icon', text: item.icon }),
          el('span', { text: t(item.key) }),
        ]
      );
      morePanel.append(btn);
    }

    nav.append(primaryRow, desktopRow, morePanel);
  }

  function navButton(item, active) {
    return el(
      'button',
      {
        type: 'button',
        className: `nav-item ${active ? 'active' : ''}`,
        dataset: { nav: item.path },
        onClick: () => {
          closeMore();
          navigate(item.path);
        },
      },
      [
        el('span', { className: 'nav-icon', text: item.icon }),
        el('span', { className: 'nav-label', text: t(item.key) }),
      ]
    );
  }

  function onDocClick(e) {
    if (!nav.contains(e.target)) {
      closeMore();
    }
  }

  build();
  container.append(nav);
  document.addEventListener('click', onDocClick);

  const unsub = EventBus.on(Events.ROUTE_CHANGED, () => {
    closeMore();
    build();
  });
  const unsubSettings = EventBus.on(Events.SETTINGS_CHANGED, build);

  return {
    destroy() {
      unsub();
      unsubSettings();
      document.removeEventListener('click', onDocClick);
      nav.remove();
    },
    refreshLabels: build,
  };
}
