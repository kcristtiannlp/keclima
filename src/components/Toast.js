/**
 * Host de toasts.
 * @module components/Toast
 */

import { el } from '../utils/dom.js';
import { EventBus, Events } from '../core/EventBus.js';

/**
 * @param {HTMLElement} root
 */
export function mountToastHost(root) {
  const host = el('div', {
    className: 'toast-host',
    role: 'region',
    'aria-live': 'polite',
    'aria-relevant': 'additions',
  });
  root.append(host);

  const unsub = EventBus.on(Events.TOAST, (payload) => {
    const item = el('div', {
      className: `toast toast-${payload.type || 'info'}`,
      role: 'status',
    }, [
      el('span', { className: 'toast-msg', text: payload.message }),
      el('button', {
        type: 'button',
        className: 'toast-close',
        'aria-label': 'Close',
        text: '×',
        onClick: () => item.remove(),
      }),
    ]);
    host.append(item);
    requestAnimationFrame(() => item.classList.add('show'));
    const ms = payload.duration ?? 3800;
    setTimeout(() => {
      item.classList.remove('show');
      setTimeout(() => item.remove(), 280);
    }, ms);
  });

  return {
    destroy() {
      unsub();
      host.remove();
    },
  };
}
