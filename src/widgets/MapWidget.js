/**
 * Mapa Leaflet: bases, radar animado, grade Open-Meteo, focos INPE+FIRMS, DETER, voos.
 *
 * @module widgets/MapWidget
 */

import { Widget } from './Widget.js';
import { el } from '../utils/dom.js';
import { t } from '../utils/i18n.js';
import { API, CACHE_TTL } from '../config.js';
import { fetchMapGrid } from '../api/providers/openMeteo.js';
import { fetchAirQualityGrid } from '../api/providers/airQuality.js';
import { fetchFireHotspots, bboxAround } from '../api/providers/firms.js';
import {
  fetchDeforestationAlerts,
  bboxAroundPlace,
} from '../api/providers/deforestation.js';
import {
  fetchLiveFlights,
  fetchAircraftDetails,
  fetchFlightRoute,
} from '../api/providers/opensky.js';
import { cacheGet, cacheSet } from '../services/cacheService.js';
import { formatTemp, formatWind, formatPressure } from '../utils/units.js';
import { aqiLevel } from '../utils/weather.js';
import { fireWeatherScore, fireWeatherMeta } from '../utils/weather.js';
import { toastError, toastWarning } from '../services/toastService.js';

const EMPTY_TILE =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/** RainViewer: zoom nativo máximo documentado = 7 */
const RAINVIEWER_NATIVE_ZOOM = 7;
const LIGHTNING_NATIVE_ZOOM = 7;
/** OpenSky: poll de posição real (proxy cacheia ~10s) */
const FLIGHTS_REFRESH_MS = 12000;
/** Máx. segundos a “continuar voando” sem novo fix da API */
const FLIGHTS_MAX_EXTRAPOLATE_S = 28;
/** Remove avião se sumir da API por este tempo */
const FLIGHTS_STALE_MS = 45000;

export class MapWidget extends Widget {
  constructor(data = {}) {
    super({ id: 'map', title: t('nav_map'), icon: '🗺️', className: 'widget-map widget-wide' });
    this.data = data;
    this.map = null;
    this.layers = {};
    this.marker = null;
    this.tempLayer = null;
    this.windLayer = null;
    this.cloudsLayer = null;
    this.precipFcLayer = null;
    this.humidityLayer = null;
    this.feelsLayer = null;
    this.pressureLayer = null;
    this.fireWxLayer = null;
    this.aqiLayer = null;
    this.firesLayer = null;
    this.flightsLayer = null;
    this.deterLayer = null;
    this.prodesLayer = null;
    this._aqiAbort = null;
    this._controls = null;
    this._firesStatus = null;
    this._flightsStatus = null;
    this._firesAbort = null;
    this._flightsAbort = null;
    this._deterAbort = null;
    this._flightsTimer = null;
    this._flightsRaf = null;
    this._flightsMoveHandler = null;
    this._flightsEnabled = false;
    /** @type {Map<string, object>} */
    this._flightTracks = new Map();
    this._flightsSource = 'OpenSky Network';
    this._flightsLastTick = 0;
    /** @type {'all'|'inpe'|'firms'|'both'} */
    this._fireSourceFilter = 'all';
    this._fireDays = 1;
    this._fireFilterBar = null;
    /** @type {{ host: string, frames: object[], index: number, timer: number|null, playing: boolean, layer: object|null }|null} */
    this._radarAnim = null;
    this._radarTimeEl = null;
    this._overlayOpacity = 0.7;
    this._opacityInput = null;
    this._baseKeys = ['osm', 'carto', 'cartoDark', 'opentopo', 'esriSat', 'esriTopo'];
  }

  update(data) {
    this.data = data;
    this.setTitle(t('nav_map'));
    if (!this.map) {
      this.render();
      return;
    }
    this._syncLocation();
  }

  destroy() {
    this._stopFlightsLive();
    this._stopRadarAnim();
    if (this._firesAbort) {
      this._firesAbort.abort();
      this._firesAbort = null;
    }
    if (this._flightsAbort) {
      this._flightsAbort.abort();
      this._flightsAbort = null;
    }
    if (this._deterAbort) {
      this._deterAbort.abort();
      this._deterAbort = null;
    }
    if (this._aqiAbort) {
      this._aqiAbort.abort();
      this._aqiAbort = null;
    }
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
    super.destroy();
  }

  render() {
    if (!this.body) {
      return;
    }
    this.body.innerHTML = '';

    if (typeof L === 'undefined') {
      this.body.append(el('p', { className: 'muted', text: 'Leaflet indisponível' }));
      return;
    }

    const mapEl = el('div', { className: 'leaflet-host', id: `map-host-${this.id}` });
    const controls = el('div', { className: 'map-layer-controls' }, [
      el('span', { className: 'map-layers-label', text: t('map_layers') }),
    ]);
    const gBase = this._addLayerGroup(controls, t('map_group_base'), true);
    const gWeather = this._addLayerGroup(controls, t('map_group_weather'), true);
    const gRisk = this._addLayerGroup(controls, t('map_group_risk'), true);
    const gTerritory = this._addLayerGroup(controls, t('map_group_territory'), false);
    const gTraffic = this._addLayerGroup(controls, t('map_group_traffic'), false);

    const tools = el('div', { className: 'map-tools-bar' });
    this._opacityInput = el('input', {
      type: 'range',
      className: 'map-opacity-range',
      min: '20',
      max: '100',
      value: String(Math.round(this._overlayOpacity * 100)),
      title: t('map_opacity'),
      'aria-label': t('map_opacity'),
    });
    this._opacityInput.addEventListener('input', () => {
      this._overlayOpacity = Number(this._opacityInput.value) / 100;
      this._applyOverlayOpacity();
    });
    tools.append(
      el('label', { className: 'map-tool-label', text: t('map_opacity') }, [this._opacityInput]),
      el('button', {
        type: 'button',
        className: 'btn btn-sm map-tool-btn',
        text: t('map_recenter'),
        onClick: () => this._recenter(),
      }),
      el('button', {
        type: 'button',
        className: 'btn btn-sm map-tool-btn',
        text: t('map_reload_layers'),
        onClick: () => this._reloadActiveLayers(),
      })
    );

    this._radarTimeEl = el('p', { className: 'map-radar-time muted hidden', text: '' });
    this._fireFilterBar = el('div', { className: 'map-fire-filters hidden' });
    this._buildFireFilters(this._fireFilterBar);

    this._firesStatus = el('p', { className: 'map-fires-status muted hidden', text: '' });
    this._flightsStatus = el('p', { className: 'map-flights-status muted hidden', text: '' });
    this._controls = controls;
    this.body.append(
      controls,
      tools,
      this._radarTimeEl,
      this._fireFilterBar,
      this._firesStatus,
      this._flightsStatus,
      mapEl
    );

    const loc = this.data.location;
    const lat = loc?.latitude ?? -23.55;
    const lon = loc?.longitude ?? -46.63;

    this.map = L.map(mapEl, {
      zoomControl: true,
      minZoom: 2,
      maxZoom: 19,
    }).setView([lat, lon], 7);

    try {
      L.control.scale({ imperial: false, metric: true, position: 'bottomleft' }).addTo(this.map);
    } catch {
      /* ignore */
    }

    this._initBaseLayers();

    // Pin CSS (sem PNG) — evita quadrado quebrado do ícone padrão do Leaflet
    this.marker = L.marker([lat, lon], {
      icon: locationPinIcon(loc?.name || t('nav_map')),
      zIndexOffset: 600,
      title: loc?.name || '',
    }).addTo(this.map);
    if (loc?.name) {
      this.marker.bindPopup(loc.name).openPopup();
    }

    this._addLayerToggle(gBase, 'osm', t('layer_osm'), true, async (on) => {
      this._setBaseLayer('osm', on);
    }, t('layer_osm_hint'));
    this._addLayerToggle(gBase, 'carto', t('layer_carto'), false, async (on) => {
      this._setBaseLayer('carto', on);
    }, t('layer_carto_hint'));
    this._addLayerToggle(gBase, 'cartoDark', t('layer_carto_dark'), false, async (on) => {
      this._setBaseLayer('cartoDark', on);
    }, t('layer_carto_dark_hint'));
    this._addLayerToggle(gBase, 'opentopo', t('layer_opentopo'), false, async (on) => {
      this._setBaseLayer('opentopo', on);
    }, t('layer_opentopo_hint'));
    this._addLayerToggle(gBase, 'esriSat', t('layer_sat_basemap'), false, async (on) => {
      this._setBaseLayer('esriSat', on);
    }, t('layer_sat_basemap_hint'));
    this._addLayerToggle(gBase, 'esriTopo', t('layer_esri_topo'), false, async (on) => {
      this._setBaseLayer('esriTopo', on);
    }, t('layer_esri_topo_hint'));
    this._addLayerToggle(
      gBase,
      'esriLabels',
      t('layer_sat_labels'),
      false,
      async (on) => {
        if (!this.map || !this.layers.esriLabels) {
          return;
        }
        if (on) {
          this.layers.esriLabels.addTo(this.map);
        } else {
          this.map.removeLayer(this.layers.esriLabels);
        }
      },
      t('layer_sat_labels_hint')
    );

    this._loadRainViewer(gWeather);
    this._setupClouds(gWeather);
    this._setupTempWind(gWeather);
    this._setupPressure(gWeather);
    this._setupPrecipForecast(gWeather);
    this._setupHumidityFeels(gWeather);
    this._setupLightning(gWeather);
    this._setupFireWeather(gRisk);
    this._setupAqi(gRisk);
    this._setupFires(gRisk);
    this._setupDeforestation(gTerritory);
    this._setupFlights(gTraffic);
    requestAnimationFrame(() => this.map?.invalidateSize());
  }

  _initBaseLayers() {
    const tileOpts = {
      maxZoom: 19,
      maxNativeZoom: 19,
      minZoom: 2,
      errorTileUrl: EMPTY_TILE,
    };

    this.layers.osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      ...tileOpts,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(this.map);

    this.layers.carto = L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
      {
        ...tileOpts,
        subdomains: 'abcd',
        attribution: '&copy; OSM &copy; <a href="https://carto.com/">CARTO</a>',
      }
    );

    this.layers.cartoDark = L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      {
        ...tileOpts,
        subdomains: 'abcd',
        attribution: '&copy; OSM &copy; <a href="https://carto.com/">CARTO</a>',
      }
    );

    this.layers.opentopo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      ...tileOpts,
      maxNativeZoom: 17,
      attribution:
        'Map data: &copy; OSM, SRTM | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a>',
    });

    this.layers.esriSat = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        ...tileOpts,
        attribution:
          'Tiles &copy; Esri — Esri, Maxar, Earthstar Geographics, GIS User Community',
      }
    );

    this.layers.esriTopo = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
      {
        ...tileOpts,
        attribution: 'Tiles &copy; Esri — World Topographic Map',
      }
    );

    this.layers.esriLabels = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
      {
        maxZoom: 19,
        maxNativeZoom: 19,
        opacity: 0.95,
        attribution: 'Esri labels',
        errorTileUrl: EMPTY_TILE,
        pane: 'overlayPane',
      }
    );
  }

  /**
   * @param {HTMLElement} parent
   * @param {string} title
   * @param {boolean} [open=true]
   */
  _addLayerGroup(parent, title, open = true) {
    const host = el('div', {
      className: `map-layer-group-toggles${open ? '' : ' is-collapsed'}`,
    });
    const head = el('button', {
      type: 'button',
      className: 'map-layer-group-title',
      text: title,
      'aria-expanded': open ? 'true' : 'false',
    });
    head.addEventListener('click', () => {
      const collapsed = host.classList.toggle('is-collapsed');
      head.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    });
    const block = el('div', { className: `map-layer-group${open ? '' : ' group-collapsed'}` }, [
      head,
      host,
    ]);
    // keep title button styling: re-add class on block title via CSS for button
    parent.append(block);
    return host;
  }

  _buildFireFilters(host) {
    host.append(el('span', { className: 'map-filter-label', text: t('fires_filters') }));

    const srcSel = el('select', {
      className: 'map-filter-select',
      'aria-label': t('fires_filter_source'),
    });
    for (const [val, label] of [
      ['all', t('fires_filter_all')],
      ['both', t('fires_filter_both')],
      ['inpe', 'INPE'],
      ['firms', 'FIRMS'],
    ]) {
      srcSel.append(el('option', { value: val, text: label }));
    }
    srcSel.value = this._fireSourceFilter;
    srcSel.addEventListener('change', () => {
      this._fireSourceFilter = /** @type {any} */ (srcSel.value);
      if (this.map?.hasLayer(this.firesLayer)) {
        this._loadFires();
      }
    });

    const daySel = el('select', {
      className: 'map-filter-select',
      'aria-label': t('fires_filter_days'),
    });
    for (const d of [1, 2, 3, 5, 7]) {
      daySel.append(el('option', { value: String(d), text: `${d}d` }));
    }
    daySel.value = String(this._fireDays);
    daySel.addEventListener('change', () => {
      this._fireDays = Number(daySel.value) || 1;
      if (this.map?.hasLayer(this.firesLayer)) {
        this._loadFires();
      }
    });

    const refresh = el('button', {
      type: 'button',
      className: 'btn btn-sm',
      text: t('fires_refresh'),
      onClick: () => this._loadFires({ force: true }),
    });

    host.append(
      el('label', { className: 'map-filter-field' }, [
        el('span', { text: t('fires_filter_source') }),
        srcSel,
      ]),
      el('label', { className: 'map-filter-field' }, [
        el('span', { text: t('fires_filter_days') }),
        daySel,
      ]),
      refresh
    );
  }

  _recenter() {
    const loc = this.data.location;
    if (!this.map || !loc) {
      return;
    }
    this.map.setView([loc.latitude, loc.longitude], Math.max(this.map.getZoom(), 8));
    this.marker?.setLatLng([loc.latitude, loc.longitude]);
  }

  async _reloadActiveLayers() {
    // limpa cache de grade/focos da sessão (chaves conhecidas)
    if (this.map?.hasLayer(this.tempLayer) || this.map?.hasLayer(this.cloudsLayer)) {
      await this._loadGrid({ force: true });
    }
    if (this.map?.hasLayer(this.aqiLayer)) {
      await this._loadAqiGrid({ force: true });
    }
    if (this.map?.hasLayer(this.firesLayer)) {
      await this._loadFires({ force: true });
    }
    if (this.map?.hasLayer(this.deterLayer)) {
      await this._loadDeter();
    }
    if (this._flightsEnabled) {
      await this._loadFlights({ silent: true });
    }
  }

  _applyOverlayOpacity() {
    const o = this._overlayOpacity;
    for (const key of ['radar', 'satellite', 'lightning', 'prodes']) {
      const layer = this.layers[key];
      if (layer && typeof layer.setOpacity === 'function') {
        layer.setOpacity(o);
      }
    }
  }

  /**
   * Uma base “cheia” por vez (OSM / Carto / Topo / Esri…).
   * @param {string} which
   * @param {boolean} on
   */
  _setBaseLayer(which, on) {
    if (!this.map) {
      return;
    }
    const keys = this._baseKeys;
    const target = this.layers[which];
    if (!target) {
      return;
    }

    if (on) {
      for (const k of keys) {
        if (k === which) continue;
        const lay = this.layers[k];
        if (lay && this.map.hasLayer(lay)) {
          this.map.removeLayer(lay);
        }
        this._setCheckbox(k, false);
      }
      target.addTo(this.map);
      target.bringToBack();
      this._setCheckbox(which, true);
      if (which === 'esriSat' && this.layers.esriLabels && !this.map.hasLayer(this.layers.esriLabels)) {
        this.layers.esriLabels.addTo(this.map);
        this._setCheckbox('esriLabels', true);
      }
    } else {
      this.map.removeLayer(target);
      const anyBase = keys.some((k) => this.layers[k] && this.map.hasLayer(this.layers[k]));
      if (!anyBase) {
        const fallback = this.layers.osm || this.layers.carto;
        if (fallback) {
          fallback.addTo(this.map);
          this._setCheckbox(fallback === this.layers.osm ? 'osm' : 'carto', true);
        }
      }
    }
  }

  /**
   * @param {string} key
   * @param {boolean} checked
   */
  _setCheckbox(key, checked) {
    const input = this._controls?.querySelector(`#layer-${this.id}-${key}`);
    if (input) {
      input.checked = checked;
    }
  }

  /**
   * @param {number} nativeZoom
   * @param {Object} [extra]
   */
  _weatherTileOpts(nativeZoom, extra = {}) {
    return {
      opacity: 0.65,
      maxZoom: 18,
      maxNativeZoom: nativeZoom,
      minZoom: 1,
      minNativeZoom: 1,
      errorTileUrl: EMPTY_TILE,
      keepBuffer: 2,
      ...extra,
    };
  }

  /**
   * @param {HTMLElement} parent
   * @param {string} key
   * @param {string} label
   * @param {boolean} checked
   * @param {((on: boolean) => void|Promise<void>)|null} [onToggle]
   * @param {string} [title]
   */
  _addLayerToggle(parent, key, label, checked, onToggle, title) {
    const id = `layer-${this.id}-${key}`;
    const input = el('input', {
      type: 'checkbox',
      id,
      checked: checked || undefined,
      title: title || label,
    });
    input.addEventListener('change', async (e) => {
      const on = e.target.checked;
      if (onToggle) {
        await onToggle(on);
        return;
      }
      const layer = this.layers[key];
      if (!layer || !this.map) {
        return;
      }
      if (on) {
        layer.addTo(this.map);
        if (typeof layer.setOpacity === 'function' && !this._baseKeys.includes(key)) {
          layer.setOpacity(this._overlayOpacity);
        }
      } else {
        this.map.removeLayer(layer);
      }
    });
    parent.append(
      el(
        'label',
        {
          className: 'layer-toggle',
          for: id,
          title: title || label,
        },
        [input, el('span', { text: label })]
      )
    );
  }

  async _loadRainViewer(controls) {
    try {
      const res = await fetch(API.rainViewer.maps);
      if (!res.ok) {
        return;
      }
      const data = await res.json();
      const host = data.host || API.rainViewer.host;
      const radarPast = data.radar?.past || [];
      const radarNowcast = data.radar?.nowcast || [];
      const radarFrames = [...radarPast, ...radarNowcast];
      const satFrames = data.satellite?.infrared || [];
      const nativeZoom = Number(data?.radar?.max_zoom) || RAINVIEWER_NATIVE_ZOOM;

      if (radarFrames.length) {
        const last = radarFrames[radarFrames.length - 1];
        this.layers.radar = L.tileLayer(
          `${host}${last.path}/256/{z}/{x}/{y}/2/1_1.png`,
          this._weatherTileOpts(nativeZoom, {
            opacity: this._overlayOpacity,
            zIndex: 200,
            attribution: 'Radar &copy; <a href="https://www.rainviewer.com/">RainViewer</a>',
          })
        );
        this._radarAnim = {
          host,
          frames: radarFrames,
          index: radarFrames.length - 1,
          timer: null,
          playing: false,
          layer: this.layers.radar,
          nativeZoom,
        };

        this._addLayerToggle(
          controls,
          'radar',
          t('layer_radar'),
          false,
          async (on) => {
            if (!this.map || !this.layers.radar) return;
            if (on) {
              this.layers.radar.addTo(this.map);
              this.layers.radar.setOpacity(this._overlayOpacity);
              this._showRadarTime();
              this._startRadarAnim();
            } else {
              this._stopRadarAnim();
              this.map.removeLayer(this.layers.radar);
              if (this._radarTimeEl) {
                this._radarTimeEl.classList.add('hidden');
              }
            }
          },
          t('layer_radar_hint')
        );

        // controles play/pause do radar
        const animBar = el('div', { className: 'map-radar-controls' });
        animBar.append(
          el('button', {
            type: 'button',
            className: 'btn btn-sm',
            text: '▶',
            title: t('map_radar_play'),
            onClick: () => {
              if (!this.map?.hasLayer(this.layers.radar)) {
                this._setCheckbox('radar', true);
                this.layers.radar?.addTo(this.map);
              }
              this._startRadarAnim();
            },
          }),
          el('button', {
            type: 'button',
            className: 'btn btn-sm',
            text: '⏸',
            title: t('map_radar_pause'),
            onClick: () => this._stopRadarAnim(false),
          }),
          el('button', {
            type: 'button',
            className: 'btn btn-sm',
            text: '⏭',
            title: t('map_radar_latest'),
            onClick: () => this._setRadarFrame(this._radarAnim.frames.length - 1),
          })
        );
        controls.append(animBar);
      }

      if (satFrames.length) {
        const frame = satFrames[satFrames.length - 1];
        this.layers.satellite = L.tileLayer(
          `${host}${frame.path}/256/{z}/{x}/{y}/0/0_0.png`,
          this._weatherTileOpts(nativeZoom, {
            opacity: this._overlayOpacity,
            zIndex: 150,
            attribution: 'IR &copy; RainViewer',
          })
        );
        this._addLayerToggle(
          controls,
          'satellite',
          t('layer_satellite'),
          false,
          async (on) => {
            if (!this.map || !this.layers.satellite) return;
            if (on) {
              this.layers.satellite.addTo(this.map);
              this.layers.satellite.setOpacity(this._overlayOpacity);
            } else {
              this.map.removeLayer(this.layers.satellite);
            }
          },
          t('layer_satellite_hint')
        );
      }
    } catch (err) {
      console.warn('[MapWidget] RainViewer:', err);
    }
  }

  _showRadarTime() {
    if (!this._radarTimeEl || !this._radarAnim) return;
    const fr = this._radarAnim.frames[this._radarAnim.index];
    const ts = fr?.time ? new Date(fr.time * 1000) : null;
    const label = ts
      ? ts.toLocaleString(undefined, { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })
      : '—';
    this._radarTimeEl.classList.remove('hidden');
    this._radarTimeEl.textContent = `${t('map_radar_frame')}: ${label} (${this._radarAnim.index + 1}/${this._radarAnim.frames.length})`;
  }

  /**
   * @param {number} index
   */
  _setRadarFrame(index) {
    if (!this._radarAnim || !this.map) return;
    const frames = this._radarAnim.frames;
    if (!frames.length) return;
    const i = ((index % frames.length) + frames.length) % frames.length;
    this._radarAnim.index = i;
    const fr = frames[i];
    const url = `${this._radarAnim.host}${fr.path}/256/{z}/{x}/{y}/2/1_1.png`;
    const wasOn = this.map.hasLayer(this.layers.radar);
    if (wasOn) {
      this.map.removeLayer(this.layers.radar);
    }
    this.layers.radar = L.tileLayer(
      url,
      this._weatherTileOpts(this._radarAnim.nativeZoom, {
        opacity: this._overlayOpacity,
        zIndex: 200,
        attribution: 'Radar &copy; RainViewer',
      })
    );
    this._radarAnim.layer = this.layers.radar;
    if (wasOn) {
      this.layers.radar.addTo(this.map);
    }
    this._showRadarTime();
  }

  _startRadarAnim() {
    if (!this._radarAnim) return;
    this._stopRadarAnim(false);
    this._radarAnim.playing = true;
    this._showRadarTime();
    this._radarAnim.timer = window.setInterval(() => {
      if (!this._radarAnim) return;
      const next = (this._radarAnim.index + 1) % this._radarAnim.frames.length;
      this._setRadarFrame(next);
    }, 700);
  }

  /**
   * @param {boolean} [hideTime=true]
   */
  _stopRadarAnim(hideTime = true) {
    if (this._radarAnim?.timer) {
      clearInterval(this._radarAnim.timer);
      this._radarAnim.timer = null;
    }
    if (this._radarAnim) {
      this._radarAnim.playing = false;
    }
    if (hideTime && this._radarTimeEl) {
      this._radarTimeEl.classList.add('hidden');
    }
  }

  _setupClouds(controls) {
    // NUVENS = % de cobertura (Open-Meteo), visual totalmente diferente do radar
    this.cloudsLayer = L.layerGroup();
    this.layers.clouds = this.cloudsLayer;

    this._addLayerToggle(
      controls,
      'clouds',
      t('layer_clouds'),
      false,
      async (on) => {
        if (!this.map) {
          return;
        }
        if (on) {
          await this._loadGrid();
          this.cloudsLayer.addTo(this.map);
        } else {
          this.map.removeLayer(this.cloudsLayer);
        }
      },
      t('layer_clouds_hint')
    );
  }

  _setupTempWind(controls) {
    this.tempLayer = L.layerGroup();
    this.windLayer = L.layerGroup();
    this.layers.temperature = this.tempLayer;
    this.layers.wind = this.windLayer;

    this._addLayerToggle(controls, 'temperature', t('layer_temperature'), false, async (on) => {
      if (!this.map) {
        return;
      }
      if (on) {
        await this._loadGrid();
        this.tempLayer.addTo(this.map);
      } else {
        this.map.removeLayer(this.tempLayer);
      }
    });

    this._addLayerToggle(controls, 'wind', t('layer_wind'), false, async (on) => {
      if (!this.map) {
        return;
      }
      if (on) {
        await this._loadGrid();
        this.windLayer.addTo(this.map);
      } else {
        this.map.removeLayer(this.windLayer);
      }
    });
  }

  _setupPrecipForecast(controls) {
    this.precipFcLayer = L.layerGroup();
    this.layers.precipForecast = this.precipFcLayer;

    this._addLayerToggle(
      controls,
      'precipForecast',
      t('layer_precip_forecast'),
      false,
      async (on) => {
        if (!this.map) {
          return;
        }
        if (on) {
          await this._loadGrid();
          this.precipFcLayer.addTo(this.map);
        } else {
          this.map.removeLayer(this.precipFcLayer);
        }
      },
      t('layer_precip_forecast_hint')
    );
  }

  _setupPressure(controls) {
    this.pressureLayer = L.layerGroup();
    this.layers.pressureMap = this.pressureLayer;

    this._addLayerToggle(
      controls,
      'pressureMap',
      t('layer_pressure_map'),
      false,
      async (on) => {
        if (!this.map) return;
        if (on) {
          await this._loadGrid();
          this.pressureLayer.addTo(this.map);
        } else {
          this.map.removeLayer(this.pressureLayer);
        }
      },
      t('layer_pressure_map_hint')
    );
  }

  _setupHumidityFeels(controls) {
    this.humidityLayer = L.layerGroup();
    this.feelsLayer = L.layerGroup();
    this.layers.humidityMap = this.humidityLayer;
    this.layers.feelsLike = this.feelsLayer;

    this._addLayerToggle(
      controls,
      'humidityMap',
      t('layer_humidity_map'),
      false,
      async (on) => {
        if (!this.map) {
          return;
        }
        if (on) {
          await this._loadGrid();
          this.humidityLayer.addTo(this.map);
        } else {
          this.map.removeLayer(this.humidityLayer);
        }
      },
      t('layer_humidity_map_hint')
    );

    this._addLayerToggle(
      controls,
      'feelsLike',
      t('layer_feels_map'),
      false,
      async (on) => {
        if (!this.map) {
          return;
        }
        if (on) {
          await this._loadGrid();
          this.feelsLayer.addTo(this.map);
        } else {
          this.map.removeLayer(this.feelsLayer);
        }
      },
      t('layer_feels_map_hint')
    );
  }

  _setupFireWeather(controls) {
    this.fireWxLayer = L.layerGroup();
    this.layers.fireWeather = this.fireWxLayer;

    this._addLayerToggle(
      controls,
      'fireWeather',
      t('layer_fire_weather'),
      false,
      async (on) => {
        if (!this.map) {
          return;
        }
        if (on) {
          await this._loadGrid();
          this.fireWxLayer.addTo(this.map);
        } else {
          this.map.removeLayer(this.fireWxLayer);
        }
      },
      t('layer_fire_weather_hint')
    );
  }

  _setupAqi(controls) {
    this.aqiLayer = L.layerGroup();
    this.layers.aqi = this.aqiLayer;

    this._addLayerToggle(
      controls,
      'aqi',
      t('layer_aqi'),
      false,
      async (on) => {
        if (!this.map) {
          return;
        }
        if (on) {
          await this._loadAqiGrid();
          this.aqiLayer.addTo(this.map);
        } else {
          this.map.removeLayer(this.aqiLayer);
        }
      },
      t('layer_aqi_hint')
    );
  }

  /**
   * @param {{ force?: boolean }} [opts]
   */
  async _loadAqiGrid(opts = {}) {
    const loc = this.data.location;
    if (!loc || !this.aqiLayer) {
      return;
    }
    if (this._aqiAbort) {
      this._aqiAbort.abort();
    }
    this._aqiAbort = new AbortController();
    const key = `mapaqi:v2:${loc.latitude.toFixed(2)},${loc.longitude.toFixed(2)}`;
    let points = opts.force ? null : cacheGet(key);
    if (!points) {
      try {
        points = await fetchAirQualityGrid(
          loc.latitude,
          loc.longitude,
          this._aqiAbort.signal
        );
        cacheSet(key, points, CACHE_TTL.airQuality || 15 * 60 * 1000);
      } catch (err) {
        if (err?.name === 'AbortError') {
          return;
        }
        console.warn('[MapWidget] AQI grid', err);
        toastError(t('layer_aqi_error'));
        return;
      }
    }

    this.aqiLayer.clearLayers();
    for (const p of points) {
      if (p.usAqi == null) {
        continue;
      }
      const level = aqiLevel(p.usAqi);
      const circle = L.circleMarker([p.latitude, p.longitude], {
        radius: 12 + Math.min(14, p.usAqi / 20),
        color: '#fff',
        weight: 1,
        fillColor: level.color,
        fillOpacity: 0.72,
      });
      circle.bindTooltip(
        `AQI ${Math.round(p.usAqi)} · ${level.label}${p.pm25 != null ? ` · PM2.5 ${Math.round(p.pm25)}` : ''}`,
        { direction: 'top', className: 'aqi-tip' }
      );
      this.aqiLayer.addLayer(circle);
    }
  }

  _setupFires(controls) {
    this.firesLayer = L.layerGroup();
    this.layers.fires = this.firesLayer;

    this._addLayerToggle(
      controls,
      'fires',
      t('layer_fires'),
      false,
      async (on) => {
        if (!this.map) {
          return;
        }
        if (on) {
          this._fireFilterBar?.classList.remove('hidden');
          await this._loadFires();
          this.firesLayer.addTo(this.map);
        } else {
          this.map.removeLayer(this.firesLayer);
          this._fireFilterBar?.classList.add('hidden');
          if (this._firesStatus) {
            this._firesStatus.classList.add('hidden');
          }
        }
      },
      t('layer_fires_merged_hint')
    );
  }

  /**
   * @param {{ force?: boolean }} [opts]
   */
  async _loadFires(opts = {}) {
    if (this._firesAbort) {
      this._firesAbort.abort();
    }
    this._firesAbort = new AbortController();
    this.firesLayer.clearLayers();

    if (this._firesStatus) {
      this._firesStatus.classList.remove('hidden');
      this._firesStatus.textContent = t('fires_loading');
    }

    const loc = this.data.location;
    const lat = loc?.latitude ?? this.map.getCenter().lat;
    const lon = loc?.longitude ?? this.map.getCenter().lng;

    // Área ao redor da cidade + bounds do mapa (o que for mais útil)
    const box = bboxAround(lat, lon, 5);
    try {
      const b = this.map.getBounds();
      if (b) {
        box.west = Math.min(box.west, b.getWest());
        box.south = Math.min(box.south, b.getSouth());
        box.east = Math.max(box.east, b.getEast());
        box.north = Math.max(box.north, b.getNorth());
      }
    } catch {
      /* ignore */
    }

    try {
      if (opts.force) {
        // força bypass de cache alterando levemente o bbox
        box.west -= 0.001;
      }
      const result = await fetchFireHotspots({
        ...box,
        lat,
        lon,
        days: this._fireDays,
        sourceFilter: this._fireSourceFilter,
        signal: this._firesAbort.signal,
      });

      for (const p of result.points) {
        const provider = p.provider || (p.sources || []).join('+') || 'firms';
        const sources = p.sources || [provider];
        const icon = fireIconFor(provider);
        const conf = p.confidence != null ? String(p.confidence) : '—';
        const when = [p.date, p.time].filter(Boolean).join(' ');
        const frp = p.frp != null ? `${Number(p.frp).toFixed(1)} MW` : '—';
        const srcLabel = sources
          .map((s) => (s === 'inpe' || String(s).startsWith('inpe') ? 'INPE' : s === 'firms' ? 'FIRMS' : s))
          .join(' + ');
        const place = [p.municipio, p.estado].filter(Boolean).join(' / ');
        const popup = `
          <strong>${t('layer_fires')}</strong><br/>
          <b>${t('fires_source')}:</b> ${srcLabel}<br/>
          ${place ? `<b>${t('fires_place')}:</b> ${place}<br/>` : ''}
          ${p.bioma ? `<b>${t('fires_biome')}:</b> ${p.bioma}<br/>` : ''}
          ${t('fires_when')}: ${when || '—'}<br/>
          ${t('fires_confidence')}: ${conf}<br/>
          FRP: ${frp}<br/>
          ${t('fires_satellite')}: ${p.satellite || '—'}<br/>
          <small>${t('fires_disclaimer')}</small>
        `;
        const marker = L.marker([p.latitude, p.longitude], { icon });
        marker.bindPopup(popup);
        this.firesLayer.addLayer(marker);
      }

      const parts = [];
      if (result.countInpe != null) {
        parts.push(`INPE ${result.countInpe}`);
      }
      if (result.countFirms != null) {
        parts.push(`FIRMS ${result.countFirms}`);
      }
      if (result.countBoth != null && result.countBoth > 0) {
        parts.push(`${t('fires_both')} ${result.countBoth}`);
      }
      if (this._firesStatus) {
        const filt =
          this._fireSourceFilter !== 'all'
            ? ` · ${t('fires_filter_source')}: ${this._fireSourceFilter}`
            : '';
        this._firesStatus.textContent =
          result.count === 0
            ? `${t('fires_none')}${filt} · ${this._fireDays}d`
            : `${t('fires_count')}: ${result.count}${parts.length ? ` (${parts.join(' · ')})` : ''}${filt} · ${this._fireDays}d · ${result.source}`;
      }
    } catch (err) {
      if (err?.name === 'AbortError') {
        return;
      }
      console.warn('[MapWidget] fires', err);
      if (this._firesStatus) {
        this._firesStatus.textContent = t('fires_error');
      }
      if (err?.code === 'firms_key_or_quota') {
        toastWarning(t('fires_error_key'));
      } else if (String(err?.message || '').includes('Failed') || err?.message === 'timeout') {
        toastError(t('fires_error_proxy'));
      } else {
        toastError(t('fires_error'));
      }
    }
  }

  _setupFlights(controls) {
    this.flightsLayer = L.layerGroup();
    this.layers.flights = this.flightsLayer;

    this._addLayerToggle(
      controls,
      'flights',
      t('layer_flights'),
      false,
      async (on) => {
        if (!this.map) {
          return;
        }
        if (on) {
          this._flightsEnabled = true;
          this.flightsLayer.addTo(this.map);
          await this._loadFlights();
          this._startFlightsLive();
        } else {
          this._stopFlightsLive();
          this._flightsEnabled = false;
          this.map.removeLayer(this.flightsLayer);
          this._clearFlightTracks();
          if (this._flightsStatus) {
            this._flightsStatus.classList.add('hidden');
          }
        }
      },
      t('layer_flights_hint')
    );
  }

  _startFlightsLive() {
    this._stopFlightsLive();
    if (!this.map) {
      return;
    }
    this._flightsTimer = setInterval(() => {
      if (this._flightsEnabled) {
        this._loadFlights({ silent: true });
      }
    }, FLIGHTS_REFRESH_MS);

    this._flightsMoveHandler = () => {
      if (this._flightsEnabled) {
        this._loadFlights({ silent: true });
      }
    };
    this.map.on('moveend', this._flightsMoveHandler);
    this._flightsLastTick = performance.now();
    this._tickFlightsAnimation();
  }

  _stopFlightsLive() {
    if (this._flightsTimer) {
      clearInterval(this._flightsTimer);
      this._flightsTimer = null;
    }
    if (this._flightsRaf) {
      cancelAnimationFrame(this._flightsRaf);
      this._flightsRaf = null;
    }
    if (this.map && this._flightsMoveHandler) {
      this.map.off('moveend', this._flightsMoveHandler);
      this._flightsMoveHandler = null;
    }
  }

  _clearFlightTracks() {
    for (const tr of this._flightTracks.values()) {
      if (tr.routeLine && this.flightsLayer) {
        this.flightsLayer.removeLayer(tr.routeLine);
      }
      if (tr.marker && this.flightsLayer) {
        this.flightsLayer.removeLayer(tr.marker);
      }
    }
    this._flightTracks.clear();
    this.flightsLayer?.clearLayers();
  }

  /**
   * Anima posição entre polls da API (extrapolação por velocidade + rumo),
   * no estilo FlightRadar24 — não fica “teleportando” a cada 12s.
   */
  _tickFlightsAnimation = () => {
    this._flightsRaf = null;
    if (!this._flightsEnabled || !this.map) {
      return;
    }
    const now = performance.now();
    const dt = Math.min(0.25, (now - this._flightsLastTick) / 1000);
    this._flightsLastTick = now;

    for (const tr of this._flightTracks.values()) {
      if (tr.onGround || !tr.velocityMs || tr.velocityMs < 1) {
        continue;
      }
      const ageS = (Date.now() - tr.fixMs) / 1000;
      if (ageS > FLIGHTS_MAX_EXTRAPOLATE_S) {
        continue;
      }
      const moved = extrapolateLatLon(tr.lat, tr.lon, tr.trackDeg, tr.velocityMs, dt);
      tr.lat = moved.lat;
      tr.lon = moved.lon;
      tr.marker.setLatLng([tr.lat, tr.lon]);
      // proa segue o rumo (só o SVG, não o rótulo)
      setPlaneHeading(tr.marker, tr.trackDeg);
    }

    this._flightsRaf = requestAnimationFrame(this._tickFlightsAnimation);
  };

  /**
   * @param {object} f
   * @param {string} source
   */
  _upsertFlightTrack(f, source) {
    const id = f.icao24 || `${f.latitude},${f.longitude}`;
    if (!id || f.latitude == null || f.longitude == null) {
      return;
    }
    const track = Number.isFinite(f.trackDeg) ? f.trackDeg : 0;
    const label = (f.callsign || f.icao24 || '—').trim();
    const now = Date.now();
    let tr = this._flightTracks.get(id);

    if (!tr) {
      const marker = L.marker([f.latitude, f.longitude], {
        icon: planeIcon(track, f.onGround, label, f),
        title: label,
        zIndexOffset: 400,
        riseOnHover: true,
      });
      marker.bindPopup(flightPopupHtml({ data: f, label, source, aircraft: null, route: null, loading: false }), {
        maxWidth: 320,
        className: 'flight-popup',
      });
      marker.on('popupopen', () => {
        this._enrichFlightPopup(id);
      });
      this.flightsLayer.addLayer(marker);
      tr = {
        id,
        marker,
        lat: f.latitude,
        lon: f.longitude,
        trackDeg: track,
        velocityMs: f.velocityMs ?? 0,
        onGround: !!f.onGround,
        fixMs: now,
        seenMs: now,
        callsign: label,
        data: f,
        source,
        aircraft: null,
        route: null,
        enriching: false,
        enriched: false,
      };
      this._flightTracks.set(id, tr);
    } else {
      const errM = haversineMeters(tr.lat, tr.lon, f.latitude, f.longitude);
      if (errM > 2500) {
        tr.lat = f.latitude;
        tr.lon = f.longitude;
      } else if (errM > 120) {
        tr.lat = tr.lat * 0.4 + f.latitude * 0.6;
        tr.lon = tr.lon * 0.4 + f.longitude * 0.6;
      } else {
        // confia no vetor animado; só atualiza rumo/velocidade
      }
      tr.trackDeg = track;
      tr.velocityMs = f.velocityMs ?? tr.velocityMs ?? 0;
      tr.onGround = !!f.onGround;
      tr.fixMs = now;
      tr.seenMs = now;
      tr.callsign = label;
      tr.data = f;
      tr.source = source;
      tr.marker.setLatLng([tr.lat, tr.lon]);
      // atualiza rótulo (altitude) sem recriar o DOM inteiro se possível
      updatePlaneLabel(tr.marker, label, f, tr.onGround);
      setPlaneHeading(tr.marker, track);
      setPlaneGround(tr.marker, tr.onGround);
    }

    // se o popup está aberto, refresca dados live
    if (tr.marker.isPopupOpen && tr.marker.isPopupOpen()) {
      tr.marker.setPopupContent(
        flightPopupHtml({
          data: tr.data,
          label: tr.callsign,
          source: tr.source,
          aircraft: tr.aircraft,
          route: tr.route,
          loading: tr.enriching,
        })
      );
    }
  }

  /**
   * Carrega tipo/matrícula/rota ao abrir o popup (estilo FR24).
   * @param {string} id
   */
  async _enrichFlightPopup(id) {
    const tr = this._flightTracks.get(id);
    if (!tr || tr.enriching) {
      return;
    }
    if (tr.enriched && (tr.aircraft || tr.route)) {
      tr.marker.setPopupContent(
        flightPopupHtml({
          data: tr.data,
          label: tr.callsign,
          source: tr.source,
          aircraft: tr.aircraft,
          route: tr.route,
          loading: false,
        })
      );
      return;
    }
    tr.enriching = true;
    tr.marker.setPopupContent(
      flightPopupHtml({
        data: tr.data,
        label: tr.callsign,
        source: tr.source,
        aircraft: tr.aircraft,
        route: tr.route,
        loading: true,
      })
    );
    try {
      const tasks = [
        tr.aircraft ? Promise.resolve(tr.aircraft) : fetchAircraftDetails(tr.id),
        tr.route
          ? Promise.resolve(tr.route)
          : tr.callsign && tr.callsign !== tr.id
            ? fetchFlightRoute(tr.callsign)
            : Promise.resolve(null),
      ];
      const [aircraft, route] = await Promise.all(tasks);
      if (!this._flightTracks.has(id)) {
        return;
      }
      if (aircraft) {
        tr.aircraft = aircraft;
      }
      if (route) {
        tr.route = route;
      }
      tr.enriched = true;
      tr.enriching = false;
      if (tr.marker.isPopupOpen && tr.marker.isPopupOpen()) {
        tr.marker.setPopupContent(
          flightPopupHtml({
            data: tr.data,
            label: tr.callsign,
            source: tr.source,
            aircraft: tr.aircraft,
            route: tr.route,
            loading: false,
          })
        );
      }
      // desenha linha origem→destino se tiver coords
      this._drawRouteLine(tr);
    } catch (err) {
      console.warn('[MapWidget] flight enrich', err);
      tr.enriching = false;
      tr.enriched = true;
      if (tr.marker.isPopupOpen && tr.marker.isPopupOpen()) {
        tr.marker.setPopupContent(
          flightPopupHtml({
            data: tr.data,
            label: tr.callsign,
            source: tr.source,
            aircraft: tr.aircraft,
            route: tr.route,
            loading: false,
          })
        );
      }
    }
  }

  /**
   * @param {object} tr
   */
  _drawRouteLine(tr) {
    if (!this.map || !tr?.route) {
      return;
    }
    const oLat = tr.route.originLat;
    const oLon = tr.route.originLon;
    const dLat = tr.route.destLat;
    const dLon = tr.route.destLon;
    if (oLat == null || oLon == null || dLat == null || dLon == null) {
      return;
    }
    if (tr.routeLine) {
      this.flightsLayer.removeLayer(tr.routeLine);
    }
    tr.routeLine = L.polyline(
      [
        [oLat, oLon],
        [tr.lat, tr.lon],
        [dLat, dLon],
      ],
      {
        color: '#3b82f6',
        weight: 2,
        opacity: 0.55,
        dashArray: '6 6',
        interactive: false,
      }
    );
    this.flightsLayer.addLayer(tr.routeLine);
  }

  _pruneStaleFlights() {
    const now = Date.now();
    for (const [id, tr] of this._flightTracks) {
      if (now - tr.seenMs > FLIGHTS_STALE_MS) {
        if (tr.routeLine) {
          this.flightsLayer?.removeLayer(tr.routeLine);
        }
        this.flightsLayer?.removeLayer(tr.marker);
        this._flightTracks.delete(id);
      }
    }
  }

  _updateFlightsStatusCount() {
    if (!this._flightsStatus) {
      return;
    }
    this._flightsStatus.classList.remove('hidden');
    const n = this._flightTracks.size;
    this._flightsStatus.textContent =
      n === 0
        ? t('flights_none')
        : `${t('flights_count')}: ${n} · ${this._flightsSource} · ${t('flights_live_motion')}`;
  }

  /**
   * @param {{ silent?: boolean }} [opts]
   */
  async _loadFlights(opts = {}) {
    if (!this.map || !this.flightsLayer || !this._flightsEnabled) {
      return;
    }
    // gera id da requisição — respostas antigas abortadas são ignoradas
    this._flightsLoadGen = (this._flightsLoadGen || 0) + 1;
    const gen = this._flightsLoadGen;
    if (this._flightsAbort) {
      this._flightsAbort.abort();
    }
    this._flightsAbort = new AbortController();

    if (this._flightsStatus && !opts.silent) {
      this._flightsStatus.classList.remove('hidden');
      this._flightsStatus.textContent = t('flights_loading');
    }

    let box;
    try {
      const b = this.map.getBounds();
      // margem + área mínima (zoom muito aberto/fechado)
      let padLat = (b.getNorth() - b.getSouth()) * 0.15;
      let padLon = (b.getEast() - b.getWest()) * 0.15;
      padLat = Math.max(padLat, 0.35);
      padLon = Math.max(padLon, 0.35);
      box = {
        west: b.getWest() - padLon,
        south: b.getSouth() - padLat,
        east: b.getEast() + padLon,
        north: b.getNorth() + padLat,
      };
    } catch {
      const c = this.map.getCenter();
      const d = 2;
      box = {
        west: c.lng - d,
        south: c.lat - d,
        east: c.lng + d,
        north: c.lat + d,
      };
    }

    try {
      const result = await fetchLiveFlights({
        ...box,
        signal: this._flightsAbort.signal,
      });
      if (gen !== this._flightsLoadGen || !this._flightsEnabled) {
        return;
      }

      this._flightsSource = result.source || 'OpenSky Network';
      const seen = new Set();
      for (const f of result.flights) {
        if (!f.icao24 || f.latitude == null || f.longitude == null) {
          continue;
        }
        seen.add(f.icao24);
        this._upsertFlightTrack(f, this._flightsSource);
      }
      const now = Date.now();
      for (const [id, tr] of this._flightTracks) {
        if (seen.has(id)) {
          tr.seenMs = now;
        }
      }
      this._pruneStaleFlights();
      this._updateFlightsStatusCount();
      // garante camada no mapa (caso tenha sido removida por engano)
      if (this.flightsLayer && !this.map.hasLayer(this.flightsLayer)) {
        this.flightsLayer.addTo(this.map);
      }
    } catch (err) {
      if (err?.name === 'AbortError' || gen !== this._flightsLoadGen) {
        return;
      }
      console.warn('[MapWidget] flights', err);
      if (this._flightsStatus) {
        this._flightsStatus.classList.remove('hidden');
        this._flightsStatus.textContent =
          err?.code === 'flights_proxy_missing' || err?.code === 'rate_limited'
            ? t(err.code === 'rate_limited' ? 'flights_rate_limited' : 'flights_error_proxy')
            : t('flights_error');
      }
      if (!opts.silent) {
        if (err?.code === 'flights_proxy_missing' || String(err?.message || '').includes('Failed')) {
          toastError(t('flights_error_proxy'));
        } else if (err?.code === 'rate_limited') {
          toastWarning(t('flights_rate_limited'));
        } else {
          toastError(t('flights_error'));
        }
      }
    }
  }

  _setupDeforestation(controls) {
    this.deterLayer = L.layerGroup();
    this.layers.deter = this.deterLayer;

    // PRODES WMS (contexto acumulado — visual, bioma cerrado/amazônia)
    try {
      this.prodesLayer = L.tileLayer.wms('https://terrabrasilis.dpi.inpe.br/geoserver/wms', {
        layers: 'prodes-cerrado-nb:accumulated_deforestation_2000,prodes-legal-amz:accumulated_deforestation_2007',
        format: 'image/png',
        transparent: true,
        version: '1.1.1',
        opacity: 0.45,
        attribution: 'PRODES/INPE · TerraBrasilis',
        maxZoom: 12,
        errorTileUrl: EMPTY_TILE,
      });
      this.layers.prodes = this.prodesLayer;
    } catch {
      this.prodesLayer = null;
    }

    this._addLayerToggle(
      controls,
      'deter',
      t('layer_deter'),
      false,
      async (on) => {
        if (!this.map) {
          return;
        }
        if (on) {
          await this._loadDeter();
          this.deterLayer.addTo(this.map);
        } else {
          this.map.removeLayer(this.deterLayer);
        }
      },
      t('layer_deter_hint')
    );

    if (this.prodesLayer) {
      this._addLayerToggle(
        controls,
        'prodes',
        t('layer_prodes'),
        false,
        async (on) => {
          if (!this.map || !this.prodesLayer) {
            return;
          }
          if (on) {
            this.prodesLayer.addTo(this.map);
          } else {
            this.map.removeLayer(this.prodesLayer);
          }
        },
        t('layer_prodes_hint')
      );
    }
  }

  async _loadDeter() {
    if (this._deterAbort) {
      this._deterAbort.abort();
    }
    this._deterAbort = new AbortController();
    this.deterLayer.clearLayers();

    const loc = this.data.location;
    const lat = loc?.latitude ?? this.map.getCenter().lat;
    const lon = loc?.longitude ?? this.map.getCenter().lng;
    let box = bboxAroundPlace(lat, lon, 2.5);
    try {
      const b = this.map.getBounds();
      if (b) {
        box = {
          west: b.getWest(),
          south: b.getSouth(),
          east: b.getEast(),
          north: b.getNorth(),
          lat,
          lon,
        };
      }
    } catch {
      /* ignore */
    }

    try {
      const data = await fetchDeforestationAlerts({
        ...box,
        signal: this._deterAbort.signal,
      });
      const alerts = data.alerts || [];
      for (const a of alerts) {
        if (a.geometry) {
          const layer = L.geoJSON(a.geometry, {
            style: {
              color: '#dc2626',
              weight: 1.5,
              fillColor: '#f97316',
              fillOpacity: 0.35,
            },
          });
          layer.bindPopup(
            `<strong>DETER · ${a.classname || ''}</strong><br/>
             ${a.municipality || ''} ${a.uf || ''}<br/>
             ${a.viewDate || ''}<br/>
             ${a.areaKm2 != null ? a.areaKm2.toFixed(3) + ' km²' : ''}<br/>
             <small>${a.biome || ''} · ${a.satellite || ''}</small>`
          );
          this.deterLayer.addLayer(layer);
        } else {
          const m = L.circleMarker([a.latitude, a.longitude], {
            radius: 7,
            color: '#b91c1c',
            fillColor: '#f97316',
            fillOpacity: 0.8,
            weight: 1,
          });
          m.bindPopup(`${a.classname} · ${a.municipality || ''} ${a.uf || ''}`);
          this.deterLayer.addLayer(m);
        }
      }
      if (this._firesStatus) {
        // reutiliza linha de status do mapa se estiver visível
      }
    } catch (err) {
      if (err?.name === 'AbortError') {
        return;
      }
      console.warn('[MapWidget] DETER', err);
      toastError(t('deforestation_error'));
    }
  }

  _setupLightning(controls) {
    try {
      this.layers.lightning = L.tileLayer(API.tiles.lightning, {
        ...this._weatherTileOpts(LIGHTNING_NATIVE_ZOOM, {
          opacity: 0.85,
          zIndex: 220,
          attribution: 'Lightning maps',
        }),
      });
      // Se tiles falharem (404/CORS), não poluir o mapa com erros infinitos
      this.layers.lightning.on('tileerror', () => {
        /* silencioso — fonte de raios é opcional/instável */
      });
      this._addLayerToggle(
        controls,
        'lightning',
        t('layer_lightning'),
        false,
        async (on) => {
          if (!this.map || !this.layers.lightning) {
            return;
          }
          if (on) {
            this.layers.lightning.addTo(this.map);
          } else {
            this.map.removeLayer(this.layers.lightning);
          }
        },
        t('layer_lightning_hint')
      );
    } catch {
      /* ignore */
    }
  }

  /**
   * @param {{ force?: boolean }} [opts]
   */
  async _loadGrid(opts = {}) {
    const loc = this.data.location;
    if (!loc) {
      return;
    }
    const key = `mapgrid:v4:${loc.latitude.toFixed(2)},${loc.longitude.toFixed(2)}`;
    let points = opts.force ? null : cacheGet(key);
    if (!points) {
      try {
        points = await fetchMapGrid(loc.latitude, loc.longitude);
        cacheSet(key, points, CACHE_TTL.mapGrid);
      } catch (err) {
        console.warn('[MapWidget] grid', err);
        toastError(t('map_grid_error'));
        return;
      }
    }

    this.tempLayer?.clearLayers();
    this.windLayer?.clearLayers();
    this.cloudsLayer?.clearLayers();
    this.precipFcLayer?.clearLayers();
    this.humidityLayer?.clearLayers();
    this.feelsLayer?.clearLayers();
    this.pressureLayer?.clearLayers();
    this.fireWxLayer?.clearLayers();

    for (const p of points) {
      if (p.temperature != null) {
        const color = tempColor(p.temperature);
        const circle = L.circleMarker([p.latitude, p.longitude], {
          radius: 14,
          color: '#fff',
          weight: 1,
          fillColor: color,
          fillOpacity: 0.75,
        });
        circle.bindTooltip(`${formatTemp(p.temperature, 0)}`, {
          permanent: true,
          direction: 'center',
          className: 'temp-tip',
        });
        this.tempLayer.addLayer(circle);
      }

      if (p.cloudCover != null && this.cloudsLayer) {
        const cover = Math.max(0, Math.min(100, p.cloudCover));
        const circle = L.circleMarker([p.latitude, p.longitude], {
          radius: 10 + cover / 12,
          color: '#94a3b8',
          weight: 1,
          fillColor: cloudColor(cover),
          fillOpacity: 0.25 + cover / 140,
        });
        circle.bindTooltip(`${t('cloud_cover')}: ${Math.round(cover)}%`, {
          direction: 'top',
          className: 'cloud-tip',
        });
        this.cloudsLayer.addLayer(circle);
      }

      if (p.windSpeed != null) {
        const icon = L.divIcon({
          className: 'wind-marker',
          html: `<div style="transform:rotate(${(p.windDirection ?? 0) + 180}deg)">➤</div><small>${formatWind(p.windSpeed, 0)}</small>`,
          iconSize: [48, 32],
        });
        this.windLayer.addLayer(L.marker([p.latitude, p.longitude], { icon }));
      }

      if (p.precipitationNext6h != null && this.precipFcLayer) {
        const mm = Math.max(0, p.precipitationNext6h);
        if (mm < 0.05) {
          const dry = L.circleMarker([p.latitude, p.longitude], {
            radius: 5,
            color: '#94a3b8',
            weight: 1,
            fillColor: '#e2e8f0',
            fillOpacity: 0.35,
          });
          dry.bindTooltip(`${t('layer_precip_forecast')}: 0 mm / 6h`, {
            direction: 'top',
            className: 'precip-tip',
          });
          this.precipFcLayer.addLayer(dry);
        } else {
          const circle = L.circleMarker([p.latitude, p.longitude], {
            radius: 8 + Math.min(18, mm * 1.8),
            color: '#1e3a8a',
            weight: 1,
            fillColor: precipColor(mm),
            fillOpacity: 0.55 + Math.min(0.35, mm / 40),
          });
          circle.bindTooltip(
            `${t('layer_precip_forecast')}: ${mm.toFixed(1)} mm / 6h`,
            { direction: 'top', className: 'precip-tip' }
          );
          this.precipFcLayer.addLayer(circle);
        }
      }

      if (p.humidity != null && this.humidityLayer) {
        const h = Math.max(0, Math.min(100, p.humidity));
        const circle = L.circleMarker([p.latitude, p.longitude], {
          radius: 10 + h / 14,
          color: '#fff',
          weight: 1,
          fillColor: humidityColor(h),
          fillOpacity: 0.65,
        });
        circle.bindTooltip(`${t('humidity')}: ${Math.round(h)}%`, {
          direction: 'top',
          className: 'humidity-tip',
        });
        this.humidityLayer.addLayer(circle);
      }

      if (p.apparentTemperature != null && this.feelsLayer) {
        const at = p.apparentTemperature;
        const circle = L.circleMarker([p.latitude, p.longitude], {
          radius: 12,
          color: '#fff',
          weight: 1,
          fillColor: tempColor(at),
          fillOpacity: 0.72,
        });
        circle.bindTooltip(`${t('feels_like')}: ${formatTemp(at, 0)}`, {
          permanent: true,
          direction: 'center',
          className: 'temp-tip',
        });
        this.feelsLayer.addLayer(circle);
      }

      if (this.fireWxLayer && (p.temperature != null || p.humidity != null)) {
        const score = fireWeatherScore(p.temperature, p.humidity, p.windSpeed);
        const meta = fireWeatherMeta(score);
        const circle = L.circleMarker([p.latitude, p.longitude], {
          radius: 9 + score / 12,
          color: '#1f2937',
          weight: 1,
          fillColor: meta.color,
          fillOpacity: 0.55 + Math.min(0.35, score / 120),
        });
        circle.bindTooltip(
          `${t('layer_fire_weather')}: ${score}/100 · ${t(meta.labelKey)}`,
          { direction: 'top', className: 'firewx-tip' }
        );
        this.fireWxLayer.addLayer(circle);
      }

      if (p.pressure != null && this.pressureLayer) {
        const pr = p.pressure;
        const circle = L.circleMarker([p.latitude, p.longitude], {
          radius: 10,
          color: '#fff',
          weight: 1,
          fillColor: pressureColor(pr),
          fillOpacity: 0.7,
        });
        circle.bindTooltip(`${t('pressure')}: ${formatPressure(pr, 0)}`, {
          permanent: true,
          direction: 'center',
          className: 'temp-tip',
        });
        this.pressureLayer.addLayer(circle);
      }
    }
  }

  _syncLocation() {
    const loc = this.data.location;
    if (!loc || !this.map) {
      return;
    }
    this.map.setView([loc.latitude, loc.longitude], this.map.getZoom());
    if (this.marker) {
      this.marker.setLatLng([loc.latitude, loc.longitude]);
      this.marker.setIcon(locationPinIcon(loc.name || t('nav_map')));
      if (loc.name) {
        this.marker.bindPopup(loc.name);
      }
    }
    this.tempLayer?.clearLayers();
    this.windLayer?.clearLayers();
    this.cloudsLayer?.clearLayers();
    this.precipFcLayer?.clearLayers();
    this.humidityLayer?.clearLayers();
    this.feelsLayer?.clearLayers();
    this.fireWxLayer?.clearLayers();
    this.aqiLayer?.clearLayers();
    // Focos: limpa; usuário religa a camada para recarregar na nova cidade
    this.firesLayer?.clearLayers();
    if (this._firesStatus) {
      this._firesStatus.classList.add('hidden');
    }
    // Voos: se a camada estiver ligada, recarrega na nova área
    if (this._flightsEnabled) {
      this._loadFlights({ silent: true });
    } else {
      this.flightsLayer?.clearLayers();
      if (this._flightsStatus) {
        this._flightsStatus.classList.add('hidden');
      }
    }
  }
}

function tempColor(c) {
  if (c <= 0) {
    return '#3b82f6';
  }
  if (c <= 10) {
    return '#22d3ee';
  }
  if (c <= 18) {
    return '#4ade80';
  }
  if (c <= 26) {
    return '#facc15';
  }
  if (c <= 32) {
    return '#fb923c';
  }
  return '#ef4444';
}

/** 0% céu limpo → 100% nublado */
function cloudColor(cover) {
  if (cover < 20) {
    return '#e0f2fe';
  }
  if (cover < 40) {
    return '#bae6fd';
  }
  if (cover < 60) {
    return '#94a3b8';
  }
  if (cover < 80) {
    return '#64748b';
  }
  return '#334155';
}

/** mm acumulados nas próximas 6 h */
function precipColor(mm) {
  if (mm < 1) {
    return '#bfdbfe';
  }
  if (mm < 3) {
    return '#60a5fa';
  }
  if (mm < 8) {
    return '#2563eb';
  }
  if (mm < 20) {
    return '#1d4ed8';
  }
  return '#7c3aed';
}

/** Umidade relativa % */
function humidityColor(h) {
  if (h < 25) {
    return '#b45309';
  }
  if (h < 40) {
    return '#f59e0b';
  }
  if (h < 60) {
    return '#84cc16';
  }
  if (h < 80) {
    return '#22d3ee';
  }
  return '#2563eb';
}

/** Pressão msl hPa */
function pressureColor(hpa) {
  if (hpa < 1000) {
    return '#7c3aed';
  }
  if (hpa < 1010) {
    return '#3b82f6';
  }
  if (hpa < 1020) {
    return '#22c55e';
  }
  if (hpa < 1030) {
    return '#eab308';
  }
  return '#f97316';
}

/**
 * Marcador de localização sem PNG (evita ícone quebrado / path errado).
 * @param {string} [title]
 */
function locationPinIcon(title = '') {
  const safe = String(title || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
  return L.divIcon({
    className: 'loc-pin-marker',
    html: `<div class="loc-pin" title="${safe}" aria-hidden="true"><span class="loc-pin-dot"></span></div>`,
    iconSize: [28, 40],
    iconAnchor: [14, 38],
    popupAnchor: [0, -34],
  });
}

/**
 * Ícone por fonte: INPE, FIRMS ou ambas (cruzamento = maior confiança).
 * @param {string} provider
 */
function fireIconFor(provider) {
  const p = provider || 'firms';
  let cls = 'fire-dot fire-firms';
  let emoji = '🔥';
  if (p === 'both') {
    cls = 'fire-dot fire-both';
    emoji = '⭕';
  } else if (p === 'inpe' || String(p).startsWith('inpe')) {
    cls = 'fire-dot fire-inpe';
    emoji = '🟠';
  }
  return L.divIcon({
    className: 'fire-marker',
    html: `<span class="${cls}" title="${p}">${emoji}</span>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

/**
 * Silhueta SVG com proa para o NORTE (0°). Roda só o .plane-rot = true track.
 * Rótulo (callsign + FL) fica fixo embaixo, estilo FlightRadar24.
 * @param {number} trackDeg
 * @param {boolean} [onGround]
 * @param {string} [label]
 * @param {object} [f]
 */
function planeIcon(trackDeg, onGround = false, label = '', f = {}) {
  const rot = Number.isFinite(trackDeg) ? trackDeg : 0;
  const groundCls = onGround ? ' plane-ground' : '';
  const altLabel = formatFlightAlt(f);
  const cs = escapeHtml((label || '').slice(0, 10));
  // Material-style flight: nose at top of viewBox (north)
  const svg = `
    <svg class="plane-svg" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>
    </svg>`;
  return L.divIcon({
    className: 'flight-marker',
    html: `
      <div class="flight-marker-wrap">
        <div class="plane-rot${groundCls}" style="transform:rotate(${rot}deg)">${svg}</div>
        <div class="flight-label"><span class="fl-cs">${cs}</span>${altLabel ? `<span class="fl-alt">${escapeHtml(altLabel)}</span>` : ''}</div>
      </div>`,
    iconSize: [76, 42],
    iconAnchor: [38, 14],
  });
}

/**
 * @param {L.Marker} marker
 * @param {number} trackDeg
 */
function setPlaneHeading(marker, trackDeg) {
  const el = marker?.getElement?.()?.querySelector?.('.plane-rot');
  if (el) {
    const rot = Number.isFinite(trackDeg) ? trackDeg : 0;
    el.style.transform = `rotate(${rot}deg)`;
  }
}

/**
 * @param {L.Marker} marker
 * @param {boolean} onGround
 */
function setPlaneGround(marker, onGround) {
  const el = marker?.getElement?.()?.querySelector?.('.plane-rot');
  if (el) {
    el.classList.toggle('plane-ground', !!onGround);
  }
}

/**
 * @param {L.Marker} marker
 * @param {string} label
 * @param {object} f
 * @param {boolean} onGround
 */
function updatePlaneLabel(marker, label, f, onGround) {
  const root = marker?.getElement?.();
  if (!root) {
    // DOM ainda não montado — recria ícone
    marker.setIcon(planeIcon(f.trackDeg ?? 0, onGround, label, f));
    return;
  }
  const cs = root.querySelector('.fl-cs');
  const alt = root.querySelector('.fl-alt');
  if (cs) {
    cs.textContent = (label || '').slice(0, 10);
  }
  const altLabel = formatFlightAlt(f);
  if (alt) {
    alt.textContent = altLabel || '';
  } else if (altLabel) {
    const lab = root.querySelector('.flight-label');
    if (lab) {
      const span = document.createElement('span');
      span.className = 'fl-alt';
      span.textContent = altLabel;
      lab.appendChild(span);
    }
  }
}

/** @param {object} f */
function formatFlightAlt(f) {
  if (f?.onGround) {
    return 'GND';
  }
  const altM = f?.geoAltitudeM ?? f?.altitudeM;
  if (altM == null) {
    return '';
  }
  const ft = Math.round(altM * 3.28084);
  if (ft >= 18000) {
    return `FL${String(Math.round(ft / 100)).padStart(3, '0')}`;
  }
  return `${ft} ft`;
}

/**
 * Avança lat/lon por velocidade (m/s) e rumo verdadeiro (graus).
 * @param {number} lat
 * @param {number} lon
 * @param {number} trackDeg
 * @param {number} velocityMs
 * @param {number} dtSec
 */
function extrapolateLatLon(lat, lon, trackDeg, velocityMs, dtSec) {
  if (!velocityMs || dtSec <= 0) {
    return { lat, lon };
  }
  const rad = ((Number.isFinite(trackDeg) ? trackDeg : 0) * Math.PI) / 180;
  const dist = velocityMs * dtSec;
  const north = dist * Math.cos(rad);
  const east = dist * Math.sin(rad);
  const dLat = north / 111320;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const dLon = east / (111320 * Math.max(0.2, cosLat));
  return { lat: lat + dLat, lon: lon + dLon };
}

/** @param {number} lat1 @param {number} lon1 @param {number} lat2 @param {number} lon2 */
function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toR = (d) => (d * Math.PI) / 180;
  const dLat = toR(lat2 - lat1);
  const dLon = toR(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Popup estilo FR24: live + aeronave + rota.
 * @param {{ data: object, label: string, source: string, aircraft?: object|null, route?: object|null, loading?: boolean }} opts
 */
function flightPopupHtml(opts) {
  const f = opts.data || {};
  const label = opts.label || '—';
  const source = opts.source || 'OpenSky';
  const ac = opts.aircraft;
  const rt = opts.route;
  const altM = f.geoAltitudeM ?? f.altitudeM;
  const altFt = altM != null ? Math.round(altM * 3.28084) : null;
  const spdKmh = f.velocityMs != null ? f.velocityMs * 3.6 : null;
  const spdKt = f.velocityMs != null ? f.velocityMs * 1.94384 : null;
  const vs = f.verticalRateMs;
  let vsTxt = '—';
  if (vs != null) {
    const fpm = Math.round(vs * 196.85);
    if (Math.abs(fpm) < 100) {
      vsTxt = t('flights_level');
    } else if (fpm > 0) {
      vsTxt = `↑ ${fpm} fpm`;
    } else {
      vsTxt = `↓ ${Math.abs(fpm)} fpm`;
    }
  }

  let routeBlock = '';
  if (opts.loading) {
    routeBlock = `<p class="flight-pop-muted">${t('flights_loading_details')}</p>`;
  } else if (rt) {
    const oCode = rt.originIata || rt.originIcao || '?';
    const dCode = rt.destIata || rt.destIcao || '?';
    const oName = [rt.originCity, rt.originName].filter(Boolean).join(' · ') || oCode;
    const dName = [rt.destCity, rt.destName].filter(Boolean).join(' · ') || dCode;
    routeBlock = `
      <div class="flight-route">
        <div class="flight-route-airports">
          <span class="flight-ap">${escapeHtml(oCode)}</span>
          <span class="flight-route-arrow">→</span>
          <span class="flight-ap">${escapeHtml(dCode)}</span>
        </div>
        <div class="flight-route-cities muted">${escapeHtml(oName)} → ${escapeHtml(dName)}</div>
        ${rt.airline ? `<div class="flight-airline">${escapeHtml(rt.airline)}${rt.callsignIata ? ` · ${escapeHtml(rt.callsignIata)}` : ''}</div>` : ''}
      </div>`;
  } else {
    routeBlock = `<p class="flight-pop-muted">${t('flights_no_route')}</p>`;
  }

  let acBlock = '';
  if (ac) {
    const typeLine = [ac.manufacturer, ac.type || ac.icaoType].filter(Boolean).join(' ');
    acBlock = `
      <div class="flight-ac">
        ${ac.photo ? `<img class="flight-photo" src="${escapeHtml(ac.photo)}" alt="" loading="lazy" referrerpolicy="no-referrer"/>` : ''}
        <div>
          ${ac.registration ? `<div><b>${t('flights_registration')}:</b> ${escapeHtml(ac.registration)}</div>` : ''}
          ${typeLine ? `<div><b>${t('flights_type')}:</b> ${escapeHtml(typeLine)}</div>` : ''}
          ${ac.operator ? `<div><b>${t('flights_operator')}:</b> ${escapeHtml(ac.operator)}</div>` : ''}
        </div>
      </div>`;
  }

  return `
    <div class="flight-pop">
      <div class="flight-pop-title">${escapeHtml(label)}</div>
      ${routeBlock}
      ${acBlock}
      <div class="flight-pop-grid">
        <div><b>${t('flights_altitude')}</b><br/>${altFt != null ? `${formatFlightAlt(f)} · ${altFt} ft` : '—'}</div>
        <div><b>${t('flights_speed')}</b><br/>${spdKmh != null ? `${spdKmh.toFixed(0)} km/h · ${spdKt.toFixed(0)} kt` : '—'}</div>
        <div><b>${t('flights_heading')}</b><br/>${f.trackDeg != null ? `${Math.round(f.trackDeg)}°` : '—'}</div>
        <div><b>${t('flights_vrate')}</b><br/>${vsTxt}</div>
      </div>
      <div class="flight-pop-meta">
        ${t('flights_icao')}: ${escapeHtml(f.icao24 || '—')}
        · ${escapeHtml(f.originCountry || '—')}
        ${f.squawk ? ` · sq ${escapeHtml(String(f.squawk))}` : ''}
        ${f.onGround ? ` · ${t('flights_on_ground')}` : ''}
      </div>
      <small class="flight-pop-src">${escapeHtml(source)}${ac?.source || rt?.source ? ` · ${escapeHtml(ac?.source || rt?.source)}` : ''}</small>
    </div>
  `;
}

/** @param {string} s */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export class RadarWidget extends MapWidget {
  constructor(data = {}) {
    super(data);
    this.id = 'radar';
    this.className = 'widget-map widget-wide widget-radar';
  }
}
