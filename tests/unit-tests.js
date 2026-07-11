/**
 * Testes unitários (sem framework).
 * Executar: abrir tests/runner.html ou importar runUnitTests().
 */

import { toDisplayTemp, toDisplayWind, toDisplayPressure, windDirectionLabel } from '../src/utils/units.js';
import { pressureTrend, aqiLevel, getMoonPhase, weatherAtmosphere, buildAlerts } from '../src/utils/weather.js';
import { getWeatherMeta } from '../src/utils/weather.js';

/** stub settings via localStorage */
function setUnits(units) {
  localStorage.setItem(
    'keclima:settings',
    JSON.stringify({ language: 'pt', units })
  );
}

/**
 * @returns {{ passed: number, failed: number, results: {name:string, ok:boolean, detail?:string}[] }}
 */
export function runUnitTests() {
  const results = [];
  let passed = 0;
  let failed = 0;

  function assert(name, cond, detail = '') {
    if (cond) {
      passed += 1;
      results.push({ name, ok: true });
    } else {
      failed += 1;
      results.push({ name, ok: false, detail });
    }
  }

  setUnits({ temperature: 'celsius', wind: 'kmh', pressure: 'hpa' });
  assert('temp celsius identity', Math.abs(toDisplayTemp(25) - 25) < 0.001);
  setUnits({ temperature: 'fahrenheit', wind: 'kmh', pressure: 'hpa' });
  assert('temp to fahrenheit', Math.abs(toDisplayTemp(0) - 32) < 0.001);

  setUnits({ temperature: 'celsius', wind: 'ms', pressure: 'hpa' });
  assert('wind kmh to ms', Math.abs(toDisplayWind(36) - 10) < 0.001);
  setUnits({ temperature: 'celsius', wind: 'mph', pressure: 'hpa' });
  assert('wind kmh to mph', Math.abs(toDisplayWind(16.0934) - 10) < 0.2);

  setUnits({ temperature: 'celsius', wind: 'kmh', pressure: 'inhg' });
  assert('pressure hpa to inhg', Math.abs(toDisplayPressure(1013.25) - 29.92) < 0.05);

  assert('wind dir N', windDirectionLabel(0) === 'N');
  assert('wind dir E', windDirectionLabel(90) === 'E');

  assert('pressure rising', pressureTrend([1000, 1001, 1003, 1005]) === 'rising');
  assert('pressure falling', pressureTrend([1010, 1008, 1006, 1004]) === 'falling');
  assert('pressure stable', pressureTrend([1010, 1010.2, 1009.8]) === 'stable');

  assert('aqi good', aqiLevel(40).key === 'good');
  assert('aqi hazardous', aqiLevel(350).key === 'hazardous');
  assert('aqi null', aqiLevel(null).key === 'unknown');

  const moon = getMoonPhase(new Date('2026-01-03T00:00:00Z'));
  assert('moon phase object', moon && typeof moon.illumination === 'number');

  assert('weather meta clear', getWeatherMeta(0).icon === '☀️');
  assert('weather meta unknown', getWeatherMeta(12345).key === 'unknown');

  const stormWeather = {
    current: {
      weatherCode: 95,
      uvIndex: 2,
      windGusts: 10,
      precipitation: 0,
      isDay: 1,
    },
  };
  assert('atmosphere storm', weatherAtmosphere(stormWeather) === 'storm');
  assert('alerts storm', buildAlerts(stormWeather, null).some((a) => a.id === 'storm'));

  const nightWeather = {
    current: { weatherCode: 0, isDay: 0, precipitation: 0, uvIndex: 0, windGusts: 0 },
  };
  assert('atmosphere night', weatherAtmosphere(nightWeather) === 'night');

  return { passed, failed, results };
}
