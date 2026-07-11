/**
 * @module widgets/ForecastWidget
 */

import { Widget } from './Widget.js';
import { el } from '../utils/dom.js';
import { t, weatherLabel } from '../utils/i18n.js';
import { formatTemp, formatTime, formatWeekday } from '../utils/units.js';
import { getWeatherMeta } from '../utils/weather.js';

export class ForecastWidget extends Widget {
  constructor(data = {}) {
    super({ id: 'forecast', title: t('forecast_hourly'), icon: '📅', className: 'widget-wide' });
    this.data = data;
    this.mode = 'hourly';
  }

  update(data) {
    this.data = data;
    this.setTitle(this.mode === 'hourly' ? t('forecast_hourly') : t('forecast_daily'));
    this.render();
  }

  render() {
    if (!this.body) {
      return;
    }
    this.body.innerHTML = '';
    const weather = this.data.weather;
    if (!weather) {
      this.body.append(el('p', { className: 'muted', text: '—' }));
      return;
    }

    const tabs = el('div', { className: 'forecast-tabs' }, [
      el('button', {
        type: 'button',
        className: `tab ${this.mode === 'hourly' ? 'active' : ''}`,
        text: t('forecast_hourly'),
        onClick: () => {
          this.mode = 'hourly';
          this.update(this.data);
        },
      }),
      el('button', {
        type: 'button',
        className: `tab ${this.mode === 'daily' ? 'active' : ''}`,
        text: t('forecast_daily'),
        onClick: () => {
          this.mode = 'daily';
          this.update(this.data);
        },
      }),
    ]);

    const scroller = el('div', { className: 'forecast-scroll' });

    if (this.mode === 'hourly') {
      const now = Date.now();
      let start = 0;
      for (let i = 0; i < weather.hourly.time.length; i++) {
        if (new Date(weather.hourly.time[i]).getTime() >= now - 30 * 60 * 1000) {
          start = i;
          break;
        }
      }
      const end = Math.min(start + 24, weather.hourly.time.length);
      for (let i = start; i < end; i++) {
        const code = weather.hourly.weatherCode[i];
        const meta = getWeatherMeta(code);
        scroller.append(
          el('div', { className: 'forecast-item', title: weatherLabel(code) }, [
            el('span', { className: 'fi-time', text: formatTime(weather.hourly.time[i]) }),
            el('span', { className: 'fi-icon', text: meta.icon }),
            el('span', {
              className: 'fi-temp',
              text: formatTemp(weather.hourly.temperature[i], 0),
            }),
            el('span', {
              className: 'fi-extra',
              text: weather.hourly.precipitationProbability[i] != null
                ? `${Math.round(weather.hourly.precipitationProbability[i])}%`
                : '',
            }),
          ])
        );
      }
    } else {
      for (let i = 0; i < weather.daily.time.length; i++) {
        const code = weather.daily.weatherCode[i];
        const meta = getWeatherMeta(code);
        scroller.append(
          el('div', { className: 'forecast-item daily', title: weatherLabel(code) }, [
            el('span', { className: 'fi-time', text: formatWeekday(weather.daily.time[i]) }),
            el('span', { className: 'fi-icon', text: meta.icon }),
            el('span', {
              className: 'fi-temp',
              text: `${formatTemp(weather.daily.temperatureMax[i], 0)} / ${formatTemp(weather.daily.temperatureMin[i], 0)}`,
            }),
            el('span', {
              className: 'fi-extra',
              text: weather.daily.precipitationProbabilityMax[i] != null
                ? `${Math.round(weather.daily.precipitationProbabilityMax[i])}%`
                : '',
            }),
          ])
        );
      }
    }

    this.body.append(tabs, scroller);
  }
}
