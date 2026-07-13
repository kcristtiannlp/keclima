/**
 * Home de previsão: agora + alertas + resumo + 48 h + 7–10 dias.
 * @module widgets/ForecastHomeWidget
 */

import { Widget } from './Widget.js';
import { el } from '../utils/dom.js';
import { t, weatherLabel } from '../utils/i18n.js';
import { formatTemp, formatTime, formatWeekday, formatWind, formatPrecip } from '../utils/units.js';
import { getWeatherMeta, buildAlerts } from '../utils/weather.js';
import { getState } from '../core/State.js';
import {
  buildForecastBlurb,
  findHourlyStartIndex,
  findTodayDailyIndex,
  nextHoursPrecip,
} from '../utils/forecastSummary.js';

export class ForecastHomeWidget extends Widget {
  constructor(data = {}) {
    super({
      id: 'forecastHome',
      title: t('forecast_home_title'),
      icon: '⛅',
      className: 'widget-wide widget-forecast-home',
    });
    this.data = data;
    /** @type {boolean} */
    this._alertsOpen = false;
  }

  update(data) {
    this.data = data;
    this.setTitle(t('forecast_home_title'));
    this.render();
  }

  render() {
    if (!this.body) return;
    this.body.innerHTML = '';

    const weather = this.data.weather;
    const loc = this.data.location;

    if (this.data.loading && !weather?.current) {
      this.body.append(skeleton());
      return;
    }

    if (!weather?.current) {
      this.body.append(el('p', { className: 'muted', text: '—' }));
      return;
    }

    const c = weather.current;
    const meta = getWeatherMeta(c.weatherCode);
    const dayIdx = findTodayDailyIndex(weather.daily?.time || [], weather.timezone);
    const tmax = weather.daily?.temperatureMax?.[dayIdx];
    const tmin = weather.daily?.temperatureMin?.[dayIdx];
    const rain6 = nextHoursPrecip(weather, 6);
    const blurb = buildForecastBlurb(weather, t);

    // —— Hero ——
    const place = loc?.name
      ? el('p', { className: 'fh-place muted', text: loc.name })
      : null;

    const alertsBlock = this._buildAlertsStrip();

    const hero = el('div', { className: 'fh-hero' }, [
      el('div', { className: 'fh-hero-main' }, [
        el('span', { className: 'fh-icon pulse-soft', text: meta.icon }),
        el('div', { className: 'fh-hero-temps' }, [
          el('span', { className: 'fh-temp', text: formatTemp(c.temperature, 0) }),
          el('p', { className: 'fh-condition', text: weatherLabel(c.weatherCode) }),
        ]),
      ]),
      el('div', { className: 'fh-hero-chips' }, [
        el('div', { className: 'fh-chip' }, [
          el('span', { className: 'fh-chip-label', text: t('feels_like') }),
          el('strong', { text: formatTemp(c.apparentTemperature, 0) }),
        ]),
        tmax != null
          ? el('div', { className: 'fh-chip' }, [
              el('span', { className: 'fh-chip-label', text: t('max_temp') }),
              el('strong', { text: formatTemp(tmax, 0) }),
            ])
          : null,
        tmin != null
          ? el('div', { className: 'fh-chip' }, [
              el('span', { className: 'fh-chip-label', text: t('min_temp') }),
              el('strong', { text: formatTemp(tmin, 0) }),
            ])
          : null,
        c.windSpeed != null
          ? el('div', { className: 'fh-chip' }, [
              el('span', { className: 'fh-chip-label', text: t('wind') }),
              el('strong', { text: formatWind(c.windSpeed, 0) }),
            ])
          : null,
        rain6.pop != null
          ? el('div', { className: 'fh-chip fh-chip-rain' }, [
              el('span', { className: 'fh-chip-label', text: t('forecast_home_rain_6h') }),
              el(
                'strong',
                {
                  text:
                    rain6.mm > 0
                      ? `${rain6.pop}% · ${formatPrecip(rain6.mm)}`
                      : `${rain6.pop}%`,
                }
              ),
            ])
          : null,
      ].filter(Boolean)),
    ]);

    // —— Resumo textual ——
    const summary = el('p', { className: 'fh-blurb', text: blurb });

    // —— 48 h ——
    const hourlySection = el('section', { className: 'fh-section' }, [
      el('h4', { className: 'fh-section-title', text: t('forecast_home_48h') }),
    ]);
    const hourlyScroll = el('div', {
      className: 'fh-scroll fh-hourly',
      role: 'list',
      'aria-label': t('forecast_home_48h'),
    });

    const hStart = findHourlyStartIndex(weather.hourly.time);
    const hEnd = Math.min(hStart + 48, weather.hourly.time.length);
    for (let i = hStart; i < hEnd; i++) {
      const code = weather.hourly.weatherCode[i];
      const im = getWeatherMeta(code);
      const pop = weather.hourly.precipitationProbability[i];
      const precip = weather.hourly.precipitation[i];
      const isNow = i === hStart;
      const popN = pop != null ? Math.round(pop) : null;
      const wet = (popN != null && popN >= 40) || (precip != null && precip >= 0.2);

      hourlyScroll.append(
        el(
          'div',
          {
            className: `fh-hour${isNow ? ' is-now' : ''}${wet ? ' is-wet' : ''}`,
            role: 'listitem',
            title: weatherLabel(code),
          },
          [
            el('span', {
              className: 'fh-h-time',
              text: isNow ? t('forecast_home_now') : formatTime(weather.hourly.time[i]),
            }),
            el('span', { className: 'fh-h-icon', text: im.icon }),
            el('span', {
              className: 'fh-h-temp',
              text: formatTemp(weather.hourly.temperature[i], 0),
            }),
            el('span', {
              className: 'fh-h-pop',
              text: popN != null ? `${popN}%` : '·',
            }),
            precip != null && precip >= 0.1
              ? el('span', {
                  className: 'fh-h-mm',
                  text: `${precip.toFixed(1)}`,
                })
              : el('span', { className: 'fh-h-mm muted', text: ' ' }),
          ]
        )
      );
    }
    hourlySection.append(
      el('div', { className: 'fh-scroll-hint muted', text: t('forecast_home_scroll_hint') }),
      hourlyScroll
    );

    // —— 10 dias (a partir de hoje) ——
    const dailySection = el('section', { className: 'fh-section' }, [
      el('h4', { className: 'fh-section-title', text: t('forecast_home_10d') }),
    ]);
    const dailyScroll = el('div', {
      className: 'fh-scroll fh-daily',
      role: 'list',
      'aria-label': t('forecast_home_10d'),
    });

    const dStart = dayIdx;
    const dEnd = Math.min(dStart + 10, weather.daily.time.length);
    for (let i = dStart; i < dEnd; i++) {
      const code = weather.daily.weatherCode[i];
      const im = getWeatherMeta(code);
      // pop diário do Open-Meteo = máximo horário do dia (não “chance de chover no dia”)
      const pop = weather.daily.precipitationProbabilityMax?.[i];
      const sum = weather.daily.precipitationSum?.[i];
      const isToday = i === dayIdx;
      const dayLabel = isToday
        ? t('forecast_home_today')
        : formatWeekday(weather.daily.time[i]);
      const popN = pop != null ? Math.round(pop) : null;
      // Com mm previsto: mostra % + volume. Só % = pico horário do modelo (Open-Meteo).
      let rainText = '·';
      if (sum != null && sum >= 0.1) {
        rainText =
          popN != null ? `${popN}% · ${formatPrecip(sum)}` : formatPrecip(sum);
      } else if (popN != null && popN > 0) {
        rainText = `${popN}%`;
      }

      dailyScroll.append(
        el(
          'div',
          {
            className: `fh-day${isToday ? ' is-today' : ''}`,
            role: 'listitem',
            title: [
              weatherLabel(code),
              popN != null ? t('forecast_home_pop_max_hint', { pop: popN }) : '',
            ]
              .filter(Boolean)
              .join(' · '),
          },
          [
            el('span', { className: 'fh-d-name', text: dayLabel }),
            el('span', { className: 'fh-d-icon', text: im.icon }),
            el('span', {
              className: 'fh-d-temps',
              text: `${formatTemp(weather.daily.temperatureMax[i], 0)} / ${formatTemp(weather.daily.temperatureMin[i], 0)}`,
            }),
            el('span', {
              className: 'fh-d-pop',
              text: rainText,
            }),
          ]
        )
      );
    }
    dailySection.append(dailyScroll);

    if (place) this.body.append(place);
    if (alertsBlock) this.body.append(alertsBlock);
    this.body.append(hero, summary, hourlySection, dailySection);
  }

  /**
   * Faixa compacta de alertas (INMET + heurísticas locais).
   * @returns {HTMLElement|null}
   */
  _buildAlertsStrip() {
    const state = getState();
    const official = this.data.officialAlerts || state.officialAlerts;
    const inmetList = official?.alerts || [];
    const local = buildAlerts(this.data.weather, this.data.airQuality);

    if (!inmetList.length && !local.length) {
      return null;
    }

    // Prioriza oficiais; senão o local mais grave
    const primary =
      inmetList[0] ||
      local.slice().sort((a, b) => severityRank(b.severity) - severityRank(a.severity))[0];

    const isOfficial = Boolean(inmetList[0]);
    const sev = primary.severity || 'warning';
    const title = isOfficial
      ? primary.title || primary.event || t('alerts_inmet_section')
      : primary.message || t('alerts');
    const badge = isOfficial
      ? primary.severityLabel || sev
      : sev === 'danger'
        ? t('forecast_home_alert_high')
        : t('forecast_home_alert_warn');

    const total = inmetList.length + local.length;
    const moreLabel =
      total > 1
        ? t('forecast_home_alert_more', { n: total })
        : t('forecast_home_alert_details');

    const strip = el('div', {
      className: `fh-alerts severity-${sev}${this._alertsOpen ? ' is-open' : ''}`,
      role: 'region',
      'aria-label': t('alerts'),
    });

    const head = el('button', {
      type: 'button',
      className: 'fh-alerts-head',
      'aria-expanded': this._alertsOpen ? 'true' : 'false',
      onClick: () => {
        this._alertsOpen = !this._alertsOpen;
        this.render();
      },
    });
    head.append(
      el('span', { className: 'fh-alerts-ico', text: '⚠️' }),
      el('span', { className: 'fh-alerts-title', text: title }),
      el('span', {
        className: 'fh-alerts-badge',
        text: badge,
        style:
          isOfficial && primary.color
            ? `border-color:${primary.color};color:${primary.color}`
            : undefined,
      }),
      el('span', { className: 'fh-alerts-toggle muted', text: moreLabel })
    );
    strip.append(head);

    if (this._alertsOpen) {
      const detail = el('div', { className: 'fh-alerts-detail' });

      if (inmetList.length) {
        detail.append(
          el('p', { className: 'fh-alerts-section', text: t('alerts_inmet_section') })
        );
        for (const a of inmetList.slice(0, 4)) {
          detail.append(renderOfficialBrief(a));
        }
        detail.append(
          el('a', {
            className: 'fh-alerts-link',
            href: official?.sourceUrl || 'https://alertas2.inmet.gov.br/',
            target: '_blank',
            rel: 'noopener noreferrer',
            text: t('alerts_inmet_open'),
            onClick: (e) => e.stopPropagation(),
          })
        );
      }

      if (local.length) {
        detail.append(
          el('p', { className: 'fh-alerts-section', text: t('alerts_local_section') })
        );
        const ul = el('ul', { className: 'fh-alerts-local' });
        for (const a of local.slice(0, 5)) {
          ul.append(
            el('li', { className: `severity-${a.severity}`, text: a.message })
          );
        }
        detail.append(ul);
      }

      strip.append(detail);
    }

    return strip;
  }
}

/**
 * @param {object} a
 */
function renderOfficialBrief(a) {
  const when =
    a.when === 'futuro' ? t('alerts_when_future') : t('alerts_when_today');
  const lines = [a.message || a.title || ''].filter(Boolean);
  if (a.start || a.end) {
    lines.push(`${t('alerts_valid')}: ${a.start || '—'} → ${a.end || '—'} · ${when}`);
  }
  return el('div', { className: `fh-alert-item severity-${a.severity || 'warning'}` }, [
    el('strong', { text: a.title || a.event || t('alerts') }),
    ...lines.map((line) => el('p', { className: 'muted', text: line })),
  ]);
}

/**
 * @param {string} sev
 */
function severityRank(sev) {
  if (sev === 'danger') return 3;
  if (sev === 'warning') return 2;
  return 1;
}

function skeleton() {
  return el('div', { className: 'skeleton-stack fh-skeleton' }, [
    el('div', { className: 'skeleton sk-line lg' }),
    el('div', { className: 'skeleton sk-line' }),
    el('div', { className: 'skeleton sk-line sm' }),
    el('div', { className: 'skeleton sk-line' }),
  ]);
}
