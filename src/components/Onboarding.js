/**
 * Onboarding da primeira visita.
 * @module components/Onboarding
 */

import { el } from '../utils/dom.js';
import { t } from '../utils/i18n.js';
import { updateSettings, getSettings } from '../storage/settingsStore.js';
import { DEFAULT_LOCATION, STORAGE_KEYS } from '../config.js';
import { getBrowserPosition, resolvePlace } from '../services/locationService.js';
import { loadWeatherFor } from '../services/weatherService.js';
import { toastError } from '../services/toastService.js';
import { getItem } from '../storage/Storage.js';

/**
 * @param {HTMLElement} root
 * @returns {Promise<void>}
 */
export function maybeShowOnboarding(root) {
  if (getSettings().onboardingDone) {
    return Promise.resolve();
  }
  // Usuários que já usaram o app (pré-0.2) não veem onboarding de novo
  const last = getItem(STORAGE_KEYS.lastLocation, null);
  if (last?.latitude != null) {
    updateSettings({ onboardingDone: true });
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const backdrop = el('div', { className: 'onboarding-backdrop', role: 'dialog', 'aria-modal': 'true' });
    const card = el('div', { className: 'onboarding-card' }, [
      el('div', { className: 'onboarding-logo', text: '⛅' }),
      el('h2', { text: t('onboarding_title') }),
      el('p', { className: 'muted', text: t('onboarding_sub') }),
    ]);

    const actions = el('div', { className: 'onboarding-actions' });

    const finish = async (loader) => {
      actions.querySelectorAll('button').forEach((b) => {
        b.disabled = true;
      });
      try {
        await loader();
      } finally {
        updateSettings({ onboardingDone: true });
        backdrop.classList.add('hide');
        setTimeout(() => {
          backdrop.remove();
          resolve();
        }, 280);
      }
    };

    actions.append(
      el('button', {
        type: 'button',
        className: 'btn btn-primary',
        text: t('onboarding_geo'),
        onClick: () =>
          finish(async () => {
            try {
              const pos = await getBrowserPosition();
              const place = await resolvePlace(pos.latitude, pos.longitude);
              await loadWeatherFor(
                {
                  ...place,
                  latitude: pos.latitude,
                  longitude: pos.longitude,
                },
                { silent: true }
              );
            } catch {
              toastError(t('error_location'));
              await loadWeatherFor({ ...DEFAULT_LOCATION }, { silent: true });
            }
          }),
      }),
      el('button', {
        type: 'button',
        className: 'btn',
        text: t('onboarding_default'),
        onClick: () =>
          finish(async () => {
            await loadWeatherFor({ ...DEFAULT_LOCATION }, { silent: true });
          }),
      }),
      el('button', {
        type: 'button',
        className: 'btn btn-ghost',
        text: t('onboarding_search'),
        onClick: () =>
          finish(async () => {
            await loadWeatherFor({ ...DEFAULT_LOCATION }, { silent: true });
            const input = document.querySelector('.search-input');
            input?.focus();
          }),
      }),
      el('button', {
        type: 'button',
        className: 'btn btn-ghost muted',
        text: t('onboarding_skip'),
        onClick: () =>
          finish(async () => {
            /* keep whatever loadApp will do */
          }),
      })
    );

    card.append(actions);
    backdrop.append(card);
    root.append(backdrop);
  });
}
