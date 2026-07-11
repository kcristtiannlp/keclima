/**
 * Motor de consciência situacional / preparação civil (cerne sobrevivencialista).
 * Heurísticas locais — NÃO é alerta oficial de Defesa Civil ou INMET.
 * @module utils/survival
 */

import { t } from './i18n.js';
import { aqiLevel } from './weather.js';
import { SCENARIO_KITS, BASE_72H_KIT } from '../data/survivalKits.js';

/**
 * @typedef {'ok'|'watch'|'alert'|'critical'} SurvivalLevel
 * @typedef {'info'|'warning'|'danger'} Severity
 *
 * @typedef {Object} SurvivalThreat
 * @property {string} id
 * @property {Severity} severity
 * @property {string} title
 * @property {string} summary
 * @property {string[]} actions
 * @property {string} [scenario]
 */

/**
 * @typedef {Object} SurvivalAssessment
 * @property {SurvivalLevel} level
 * @property {string} levelLabel
 * @property {SurvivalThreat[]} threats
 * @property {string[]} scenarios
 * @property {string[]} kitIds
 * @property {Array<{id:string,label:string}>} officialLinks
 * @property {string} disclaimer
 */

const LEVEL_RANK = { ok: 0, watch: 1, alert: 2, critical: 3 };

/**
 * @param {Object} opts
 * @param {Object|null} [opts.weather]
 * @param {Object|null} [opts.airQuality]
 * @param {number|null} [opts.firesNearby] contagem de focos na área (opcional)
 * @returns {SurvivalAssessment}
 */
export function assessSurvivalThreats(opts = {}) {
  const weather = opts.weather || null;
  const airQuality = opts.airQuality || null;
  const firesNearby = opts.firesNearby;
  /** @type {SurvivalThreat[]} */
  const threats = [];
  const scenarios = new Set();

  const c = weather?.current;
  if (c) {
    const tAir = num(c.temperature);
    const tApp = num(c.apparentTemperature ?? c.temperature);
    const rh = num(c.humidity);
    const wind = num(c.windSpeed);
    const gust = num(c.windGusts ?? c.windSpeed);
    const uv = num(c.uvIndex);
    const code = c.weatherCode;

    // Calor
    if (tApp != null && tApp >= 40) {
      threats.push(
        threat('heat', 'danger', 'surv_heat', 'surv_heat_extreme', ['surv_act_shade', 'surv_act_water', 'surv_act_avoid_midday'], 'heat')
      );
      scenarios.add('heat');
    } else if (tApp != null && tApp >= 35) {
      threats.push(
        threat('heat', 'warning', 'surv_heat', 'surv_heat_high', ['surv_act_shade', 'surv_act_water'], 'heat')
      );
      scenarios.add('heat');
    } else if (tAir != null && tAir >= 32) {
      threats.push(
        threat('heat', 'info', 'surv_heat', 'surv_heat_watch', ['surv_act_water'], 'heat')
      );
    }

    // Frio
    if (tApp != null && tApp <= 5) {
      threats.push(
        threat('cold', 'warning', 'surv_cold', 'surv_cold_low', ['surv_act_layers', 'surv_act_dry'], 'cold')
      );
      scenarios.add('cold');
    } else if (tApp != null && tApp <= 12 && wind != null && wind >= 25) {
      threats.push(
        threat('cold', 'info', 'surv_cold', 'surv_cold_wind', ['surv_act_layers'], 'cold')
      );
    }

    // Tempestade / raios
    if ([95, 96, 99].includes(code)) {
      threats.push(
        threat('storm', 'danger', 'surv_storm', 'surv_storm_now', ['surv_act_shelter', 'surv_act_avoid_trees', 'surv_act_official'], 'storm')
      );
      scenarios.add('storm');
    }

    // Rajadas
    if (gust != null && gust >= 90) {
      threats.push(
        threat('wind', 'danger', 'surv_wind', 'surv_wind_extreme', ['surv_act_shelter', 'surv_act_secure'], 'storm')
      );
      scenarios.add('storm');
    } else if (gust != null && gust >= 70) {
      threats.push(
        threat('wind', 'warning', 'surv_wind', 'surv_wind_high', ['surv_act_secure'], 'storm')
      );
    }

    // Chuva forte / cheia (agora + próximas horas)
    const rainSignal = assessRain(weather);
    if (rainSignal) {
      threats.push(rainSignal.threat);
      if (rainSignal.scenario) {
        scenarios.add(rainSignal.scenario);
      }
    }

    // Nevoeiro / visibilidade
    if ([45, 48].includes(code)) {
      threats.push(
        threat('fog', 'info', 'surv_fog', 'surv_fog_body', ['surv_act_slow_travel'])
      );
    }

    // UV
    if (uv != null && uv >= 11) {
      threats.push(
        threat('uv', 'danger', 'surv_uv', 'surv_uv_extreme', ['surv_act_cover', 'surv_act_avoid_midday'])
      );
    } else if (uv != null && uv >= 8) {
      threats.push(
        threat('uv', 'warning', 'surv_uv', 'surv_uv_high', ['surv_act_cover'])
      );
    }

    // Fogo-meteorológico (heurística local — não é índice INPE)
    const fw = fireWeatherScore(tAir, rh, wind);
    if (fw >= 75) {
      threats.push(
        threat(
          'fire_weather',
          'danger',
          'surv_fire_weather',
          'surv_fire_weather_extreme',
          ['surv_act_no_burn', 'surv_act_water_reserve', 'surv_act_official'],
          'fire_weather'
        )
      );
      scenarios.add('fire_weather');
    } else if (fw >= 55) {
      threats.push(
        threat(
          'fire_weather',
          'warning',
          'surv_fire_weather',
          'surv_fire_weather_high',
          ['surv_act_no_burn', 'surv_act_water_reserve'],
          'fire_weather'
        )
      );
      scenarios.add('fire_weather');
    } else if (fw >= 40) {
      threats.push(
        threat(
          'fire_weather',
          'info',
          'surv_fire_weather',
          'surv_fire_weather_watch',
          ['surv_act_no_burn'],
          'fire_weather'
        )
      );
    }
  }

  // Ar / fumaça
  if (airQuality?.usAqi != null) {
    const aqi = airQuality.usAqi;
    const level = aqiLevel(aqi);
    if (aqi > 200) {
      threats.push(
        threat(
          'smoke_air',
          'danger',
          'surv_air',
          'surv_air_hazard',
          ['surv_act_mask', 'surv_act_indoors', 'surv_act_sensitive'],
          'smoke'
        )
      );
      scenarios.add('smoke');
    } else if (aqi > 150) {
      threats.push(
        threat(
          'smoke_air',
          'warning',
          'surv_air',
          'surv_air_unhealthy',
          ['surv_act_mask', 'surv_act_indoors'],
          'smoke'
        )
      );
      scenarios.add('smoke');
    } else if (aqi > 100) {
      threats.push({
        id: 'smoke_air',
        severity: 'info',
        title: t('surv_air'),
        summary: `${t('surv_air_sensitive')} · ${level.label}`,
        actions: [t('surv_act_sensitive')],
        scenario: 'smoke',
      });
    }
  }

  // Focos na área (se o app souber a contagem)
  if (firesNearby != null && firesNearby > 0) {
    if (firesNearby >= 15) {
      threats.push(
        threat(
          'wildfire_nearby',
          'danger',
          'surv_fires_near',
          'surv_fires_many',
          ['surv_act_routes', 'surv_act_gobag', 'surv_act_official'],
          'wildfire'
        )
      );
      scenarios.add('wildfire');
    } else if (firesNearby >= 3) {
      threats.push(
        threat(
          'wildfire_nearby',
          'warning',
          'surv_fires_near',
          'surv_fires_some',
          ['surv_act_routes', 'surv_act_official'],
          'wildfire'
        )
      );
      scenarios.add('wildfire');
    } else {
      threats.push(
        threat(
          'wildfire_nearby',
          'info',
          'surv_fires_near',
          'surv_fires_few',
          ['surv_act_monitor_map'],
          'wildfire'
        )
      );
    }
  }

  // Ordena por severidade
  const sevRank = { danger: 0, warning: 1, info: 2 };
  threats.sort((a, b) => (sevRank[a.severity] ?? 9) - (sevRank[b.severity] ?? 9));

  const level = overallLevel(threats);
  const scenarioList = [...scenarios];
  const kitIds = uniqueKits(scenarioList);

  return {
    level,
    levelLabel: t(`surv_level_${level}`),
    threats,
    scenarios: scenarioList,
    kitIds,
    officialLinks: officialLinks(),
    disclaimer: t('surv_disclaimer'),
  };
}

/**
 * Índice 0–100 estimativo (NÃO oficial).
 * Baseado em calor + ar seco + vento (regra prática de campo).
 * @param {number|null} tempC
 * @param {number|null} rh
 * @param {number|null} windKmh
 */
export function fireWeatherScore(tempC, rh, windKmh) {
  if (tempC == null && rh == null && windKmh == null) {
    return 0;
  }
  const t = tempC ?? 20;
  const h = rh ?? 50;
  const w = windKmh ?? 5;
  // calor
  let s = Math.max(0, (t - 18) * 2.2);
  // secura
  s += Math.max(0, (55 - h) * 1.1);
  // vento
  s += Math.min(25, w * 0.45);
  return Math.max(0, Math.min(100, Math.round(s)));
}

/**
 * @param {number} score
 * @returns {{ color: string, labelKey: string }}
 */
export function fireWeatherMeta(score) {
  if (score >= 75) {
    return { color: '#7f1d1d', labelKey: 'surv_fw_extreme' };
  }
  if (score >= 55) {
    return { color: '#ef4444', labelKey: 'surv_fw_high' };
  }
  if (score >= 40) {
    return { color: '#f97316', labelKey: 'surv_fw_moderate' };
  }
  if (score >= 25) {
    return { color: '#eab308', labelKey: 'surv_fw_elevated' };
  }
  return { color: '#22c55e', labelKey: 'surv_fw_low' };
}

/**
 * Itens de checklist para a página / widget.
 * @param {string[]} kitIds
 */
export function resolveKits(kitIds) {
  const ids = kitIds?.length ? kitIds : ['base72'];
  const out = [];
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    if (id === 'base72') {
      out.push({ id, titleKey: 'surv_kit_base72', items: BASE_72H_KIT });
      continue;
    }
    const kit = SCENARIO_KITS[id];
    if (kit) {
      out.push({ id, titleKey: kit.titleKey, items: kit.items });
    }
  }
  if (!seen.has('base72')) {
    out.push({ id: 'base72', titleKey: 'surv_kit_base72', items: BASE_72H_KIT });
  }
  return out;
}

/**
 * @param {SurvivalThreat[]} threats
 * @returns {SurvivalLevel}
 */
function overallLevel(threats) {
  if (threats.some((x) => x.severity === 'danger')) {
    return threats.filter((x) => x.severity === 'danger').length >= 2 ? 'critical' : 'alert';
  }
  if (threats.some((x) => x.severity === 'warning')) {
    return 'alert';
  }
  if (threats.some((x) => x.severity === 'info')) {
    return 'watch';
  }
  return 'ok';
}

/**
 * @param {Object|null} weather
 */
function assessRain(weather) {
  const c = weather?.current;
  const code = c?.weatherCode;
  if ([65, 82].includes(code) || (c?.precipitation != null && c.precipitation >= 5)) {
    return {
      scenario: 'flood_rain',
      threat: threat(
        'flood_rain',
        'danger',
        'surv_rain',
        'surv_rain_heavy_now',
        ['surv_act_high_ground', 'surv_act_docs_dry', 'surv_act_official'],
        'flood_rain'
      ),
    };
  }
  if ([63, 81].includes(code) || (c?.precipitation != null && c.precipitation >= 2)) {
    return {
      scenario: 'flood_rain',
      threat: threat(
        'flood_rain',
        'warning',
        'surv_rain',
        'surv_rain_moderate',
        ['surv_act_high_ground', 'surv_act_monitor_map'],
        'flood_rain'
      ),
    };
  }
  if (weather?.hourly?.time?.length) {
    const now = Date.now();
    let maxP = 0;
    let maxPr = 0;
    for (let i = 0; i < weather.hourly.time.length; i++) {
      const tm = new Date(weather.hourly.time[i]).getTime();
      if (tm < now || tm > now + 12 * 3600 * 1000) {
        continue;
      }
      maxP = Math.max(maxP, weather.hourly.precipitation?.[i] ?? 0);
      maxPr = Math.max(maxPr, weather.hourly.precipitationProbability?.[i] ?? 0);
    }
    if (maxP >= 8 || maxPr >= 85) {
      return {
        scenario: 'flood_rain',
        threat: threat(
          'flood_rain',
          'warning',
          'surv_rain',
          'surv_rain_soon',
          ['surv_act_high_ground', 'surv_act_power'],
          'flood_rain'
        ),
      };
    }
  }
  return null;
}

/**
 * @param {string} id
 * @param {Severity} severity
 * @param {string} titleKey
 * @param {string} summaryKeyOrText
 * @param {string[]} actionKeys
 * @param {string} [scenario]
 * @returns {SurvivalThreat}
 */
function threat(id, severity, titleKey, summaryKeyOrText, actionKeys, scenario) {
  const summary = summaryKeyOrText.startsWith('surv_') ? t(summaryKeyOrText) : summaryKeyOrText;
  return {
    id,
    severity,
    title: t(titleKey),
    summary,
    actions: actionKeys.map((k) => t(k)),
    scenario,
  };
}

/** @param {string[]} scenarios */
function uniqueKits(scenarios) {
  const ids = ['base72'];
  for (const s of scenarios) {
    if (SCENARIO_KITS[s]) {
      ids.push(s);
    }
  }
  return ids;
}

function officialLinks() {
  return [
    { id: 'inmet_alerts', label: t('surv_link_inmet'), href: 'https://alertas2.inmet.gov.br/' },
    { id: 'defesa', label: t('surv_link_defesa'), href: 'https://www.gov.br/mdr/pt-br/assuntos/protecao-e-defesa-civil' },
    { id: 'inmet_portal', label: t('surv_link_inmet_portal'), href: 'https://portal.inmet.gov.br/' },
    { id: 'queimadas', label: t('surv_link_queimadas'), href: 'https://queimadas.dgi.inpe.br/queimadas/portal' },
  ];
}

/** @param {unknown} v */
function num(v) {
  if (v == null || v === '') {
    return null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export { LEVEL_RANK };
