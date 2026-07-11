/**
 * Roteador hash simples com teardown de páginas.
 * @module router
 */

import { ROUTES } from './config.js';
import { EventBus, Events } from './core/EventBus.js';

/** @type {Map<string, (container: HTMLElement) => void | Promise<void>>} */
const routes = new Map();

/** @type {HTMLElement|null} */
let outlet = null;

/** @type {string} */
let currentPath = '/';

/** @type {(() => void)|null} */
let currentTeardown = null;

/**
 * @param {string} path
 * @param {(container: HTMLElement) => void | Promise<void>} handler
 */
export function registerRoute(path, handler) {
  routes.set(path, handler);
}

/**
 * @param {HTMLElement} el
 */
export function setOutlet(el) {
  outlet = el;
}

/**
 * @returns {string}
 */
export function getPath() {
  const hash = window.location.hash.replace(/^#/, '') || '/';
  return hash.startsWith('/') ? hash : `/${hash}`;
}

/**
 * @param {string} path
 */
export function navigate(path) {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  if (window.location.hash === `#${normalized}`) {
    render(normalized);
    return;
  }
  window.location.hash = normalized;
}

/**
 * @param {string} [path]
 */
export async function render(path) {
  if (!outlet) {
    return;
  }

  if (typeof currentTeardown === 'function') {
    try {
      currentTeardown();
    } catch (err) {
      console.warn('[Router] teardown:', err);
    }
    currentTeardown = null;
  }

  const p = path || getPath();
  currentPath = p;
  const handler = routes.get(p) || routes.get(ROUTES.dashboard);

  outlet.innerHTML = '';
  outlet.classList.add('page-loading');

  try {
    if (handler) {
      await handler(outlet);
      if (typeof outlet._teardown === 'function') {
        currentTeardown = outlet._teardown;
        outlet._teardown = null;
      }
    }
  } finally {
    outlet.classList.remove('page-loading');
  }

  EventBus.emit(Events.ROUTE_CHANGED, p);
  updateNavActive(p);
  // sobe a página ao trocar de rota (mobile)
  try {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch {
    window.scrollTo(0, 0);
  }
}

/**
 * @param {string} path
 */
function updateNavActive(path) {
  document.querySelectorAll('[data-nav]').forEach((link) => {
    const href = link.getAttribute('data-nav');
    link.classList.toggle('active', href === path);
  });
}

/**
 * Inicializa o roteador.
 */
export function startRouter() {
  window.addEventListener('hashchange', () => render());
  render(getPath());
}

export function getCurrentPath() {
  return currentPath;
}

export { ROUTES };
