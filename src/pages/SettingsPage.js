/**
 * Configurações expandidas.
 * @module pages/SettingsPage
 */

import { el } from '../utils/dom.js';
import { t } from '../utils/i18n.js';
import { getSettings, updateSettings } from '../storage/settingsStore.js';
import { getState } from '../core/State.js';
import { APP_VERSION, API } from '../config.js';
import { EventBus, Events } from '../core/EventBus.js';
import { ensureNotificationPermission } from '../services/notificationService.js';
import { toast, toastWarning } from '../services/toastService.js';

/**
 * @param {HTMLElement} container
 */
export async function renderSettingsPage(container) {
  const page = el('div', { className: 'page-panel settings-page' });
  container.append(page);

  function render() {
    const s = getSettings();
    page.innerHTML = '';
    page.append(el('h2', { text: t('nav_settings') }));

    page.append(
      field(
        t('settings_theme'),
        select(
          'theme',
          s.theme,
          [
            { value: 'light', label: t('theme_light') },
            { value: 'dark', label: t('theme_dark') },
            { value: 'auto', label: t('theme_auto') },
          ],
          (v) => updateSettings({ theme: v })
        )
      )
    );

    page.append(
      field(
        t('settings_language'),
        select(
          'language',
          s.language,
          [
            { value: 'pt', label: 'Português' },
            { value: 'en', label: 'English' },
            { value: 'es', label: 'Español' },
          ],
          (v) => updateSettings({ language: v })
        )
      )
    );

    page.append(
      field(
        t('settings_auto_update'),
        el('label', { className: 'switch-label' }, [
          el('input', {
            type: 'checkbox',
            checked: s.autoUpdate || undefined,
            onChange: (e) => updateSettings({ autoUpdate: e.target.checked }),
          }),
          el('span', { text: s.autoUpdate ? 'ON' : 'OFF' }),
        ])
      )
    );

    page.append(
      field(
        t('settings_compact'),
        el('label', { className: 'switch-label' }, [
          el('input', {
            type: 'checkbox',
            checked: s.compactMode || undefined,
            onChange: (e) => {
              updateSettings({ compactMode: e.target.checked });
              document.documentElement.classList.toggle('compact-mode', e.target.checked);
            },
          }),
          el('span', { text: s.compactMode ? 'ON' : 'OFF' }),
        ])
      )
    );

    page.append(
      field(
        t('settings_notifications'),
        el('div', {}, [
          el('label', { className: 'switch-label' }, [
            el('input', {
              type: 'checkbox',
              checked: s.rainNotifications || undefined,
              onChange: async (e) => {
                if (e.target.checked) {
                  const ok = await ensureNotificationPermission();
                  if (!ok) {
                    e.target.checked = false;
                    toastWarning(t('error_generic'));
                    return;
                  }
                  toast(t('settings_notifications'), { type: 'success' });
                }
                updateSettings({ rainNotifications: e.target.checked });
              },
            }),
            el('span', { text: s.rainNotifications ? 'ON' : 'OFF' }),
          ]),
          el('p', { className: 'muted field-hint', text: t('settings_notifications_hint') }),
        ])
      )
    );

    page.append(
      field(
        t('settings_units'),
        el('div', { className: 'units-grid' }, [
          select(
            'temp',
            s.units.temperature,
            [
              { value: 'celsius', label: t('unit_celsius') },
              { value: 'fahrenheit', label: t('unit_fahrenheit') },
            ],
            (v) => updateSettings({ units: { temperature: v } })
          ),
          select(
            'wind',
            s.units.wind,
            [
              { value: 'kmh', label: t('unit_kmh') },
              { value: 'ms', label: t('unit_ms') },
              { value: 'mph', label: t('unit_mph') },
            ],
            (v) => updateSettings({ units: { wind: v } })
          ),
          select(
            'pressure',
            s.units.pressure,
            [
              { value: 'hpa', label: t('unit_hpa') },
              { value: 'inhg', label: t('unit_inhg') },
            ],
            (v) => updateSettings({ units: { pressure: v } })
          ),
        ])
      )
    );

    const loc = getState().location || s.defaultCity;
    page.append(
      field(
        t('settings_default_city'),
        el('div', { className: 'default-city-row' }, [
          el('span', {
            className: 'muted',
            text: loc ? `${loc.name}${loc.country ? `, ${loc.country}` : ''}` : '—',
          }),
          el('button', {
            type: 'button',
            className: 'btn btn-sm',
            text: t('save'),
            onClick: () => {
              const current = getState().location;
              if (current) {
                updateSettings({ defaultCity: current });
                toast(t('save'), { type: 'success' });
                render();
              }
            },
          }),
        ])
      )
    );

    page.append(
      field(t('settings_data_source'), el('p', { className: 'muted', text: t('open_source') }))
    );

    // NASA FIRMS MAP_KEY (opcional)
    const keyInput = el('input', {
      type: 'password',
      className: 'settings-select firms-key-input',
      autocomplete: 'off',
      placeholder: t('settings_firms_key_placeholder'),
      value: s.firmsMapKey || '',
    });
    page.append(
      field(
        t('settings_firms_key'),
        el('div', { className: 'firms-settings' }, [
          keyInput,
          el('div', { className: 'default-city-row', style: { marginTop: '0.5rem' } }, [
            el('button', {
              type: 'button',
              className: 'btn btn-sm',
              text: t('save'),
              onClick: () => {
                updateSettings({ firmsMapKey: keyInput.value.trim() });
                toast(t('save'), { type: 'success' });
              },
            }),
            el('a', {
              className: 'btn btn-sm btn-ghost',
              href: API.firms.mapKeySignup,
              target: '_blank',
              rel: 'noopener noreferrer',
              text: t('settings_firms_get_key'),
            }),
          ]),
          el('p', { className: 'muted field-hint', text: t('settings_firms_hint') }),
          select(
            'firmsDays',
            String(s.firmsDayRange || 1),
            [
              { value: '1', label: t('firms_days_1') },
              { value: '2', label: t('firms_days_2') },
              { value: '3', label: t('firms_days_3') },
            ],
            (v) => updateSettings({ firmsDayRange: Number(v) })
          ),
        ])
      )
    );

    // AISStream API key (opcional — navios com cobertura maior)
    const aisKeyInput = el('input', {
      type: 'password',
      className: 'settings-select firms-key-input',
      autocomplete: 'off',
      placeholder: t('settings_ais_key_placeholder'),
      value: s.aisStreamKey || '',
    });
    page.append(
      field(
        t('settings_ais_key'),
        el('div', { className: 'firms-settings' }, [
          aisKeyInput,
          el('div', { className: 'default-city-row', style: { marginTop: '0.5rem' } }, [
            el('button', {
              type: 'button',
              className: 'btn btn-sm',
              text: t('save'),
              onClick: () => {
                updateSettings({ aisStreamKey: aisKeyInput.value.trim() });
                toast(t('save'), { type: 'success' });
              },
            }),
            el('a', {
              className: 'btn btn-sm btn-ghost',
              href: API.ships?.aisStreamSignup || 'https://aisstream.io/apikeys',
              target: '_blank',
              rel: 'noopener noreferrer',
              text: t('settings_ais_get_key'),
            }),
          ]),
          el('p', { className: 'muted field-hint', text: t('settings_ais_hint') }),
        ])
      )
    );

    page.append(el('p', { className: 'version-line muted', text: `KeClima v${APP_VERSION}` }));
  }

  render();
  const unsub = EventBus.on(Events.SETTINGS_CHANGED, render);
  container._teardown = () => unsub();
}

function field(label, control) {
  return el('div', { className: 'settings-field' }, [
    el('label', { className: 'settings-label', text: label }),
    control,
  ]);
}

function select(name, value, options, onChange) {
  const sel = el('select', {
    className: 'settings-select',
    name,
    onChange: (e) => onChange(e.target.value),
  });
  for (const opt of options) {
    const o = el('option', { value: opt.value, text: opt.label });
    if (opt.value === value) {
      o.selected = true;
    }
    sel.append(o);
  }
  return sel;
}
