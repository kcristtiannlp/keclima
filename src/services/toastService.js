/**
 * Toasts de feedback.
 * @module services/toastService
 */

import { EventBus, Events } from '../core/EventBus.js';

/**
 * @typedef {'info'|'success'|'warning'|'error'} ToastType
 */

/**
 * @param {string} message
 * @param {{ type?: ToastType, duration?: number }} [opts]
 */
export function toast(message, opts = {}) {
  EventBus.emit(Events.TOAST, {
    message,
    type: opts.type || 'info',
    duration: opts.duration ?? 3800,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  });
}

export function toastError(message) {
  toast(message, { type: 'error', duration: 5200 });
}

export function toastSuccess(message) {
  toast(message, { type: 'success' });
}

export function toastWarning(message) {
  toast(message, { type: 'warning' });
}
