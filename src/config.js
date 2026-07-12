/**
 * Configuração central do KeClima.
 * @module config
 */

/** @typedef {'celsius' | 'fahrenheit'} TemperatureUnit */
/** @typedef {'kmh' | 'ms' | 'mph'} WindUnit */
/** @typedef {'hpa' | 'inhg'} PressureUnit */
/** @typedef {'light' | 'dark' | 'auto'} ThemeMode */
/** @typedef {'pt' | 'en' | 'es'} LanguageCode */
/** @typedef {'24h' | '7d' | '30d' | '365d'} ChartRange */

export const APP_NAME = 'KeClima';
export const APP_VERSION = '0.7.4';

export const API = {
  openMeteo: {
    forecast: 'https://api.open-meteo.com/v1/forecast',
    airQuality: 'https://air-quality-api.open-meteo.com/v1/air-quality',
    archive: 'https://archive-api.open-meteo.com/v1/archive',
  },
  nominatim: {
    search: 'https://nominatim.openstreetmap.org/search',
    reverse: 'https://nominatim.openstreetmap.org/reverse',
    userAgent: 'KeClima/0.6 (weather-pwa; contact: local)',
    minIntervalMs: 1100,
  },
  rainViewer: {
    maps: 'https://api.rainviewer.com/public/weather-maps.json',
    host: 'https://tilecache.rainviewer.com',
  },
  /** Camadas gratuitas sem chave (quando disponíveis) */
  tiles: {
    lightning: 'https://tiles.lightningmaps.org/?x={x}&y={y}&z={z}&s=256',
  },
  /** Focos de incêndio — proxy local evita CORS da NASA FIRMS */
  firms: {
    proxyPath: '/api/firms/hotspots',
    mapKeySignup: 'https://firms.modaps.eosdis.nasa.gov/api/map_key/',
    source: 'VIIRS_SNPP_NRT',
  },
  ships: {
    aisStreamSignup: 'https://aisstream.io/apikeys',
    aisStreamDocs: 'https://aisstream.io/documentation',
    aisHubSignup: 'https://www.aishub.net/api',
  },
  disasters: {
    usgs: 'https://earthquake.usgs.gov/',
    eonet: 'https://eonet.gsfc.nasa.gov/',
  },
};

/** TTL de cache em milissegundos */
export const CACHE_TTL = {
  weather: 10 * 60 * 1000,
  airQuality: 15 * 60 * 1000,
  geocode: 24 * 60 * 60 * 1000,
  reverse: 60 * 60 * 1000,
  archive: 60 * 60 * 1000,
  mapGrid: 20 * 60 * 1000,
  fires: 15 * 60 * 1000,
  inmet: 10 * 60 * 1000,
  /** Avisos oficiais INMET Alert-AS */
  inmetAlerts: 5 * 60 * 1000,
  deforestation: 30 * 60 * 1000,
  /** OpenSky: dados mudam rápido; cache curto + proxy no serve.py */
  flights: 10 * 1000,
  /** Tipo/rota de aeronave (hexdb/adsbdb) — muda pouco */
  flightMeta: 24 * 60 * 60 * 1000,
  /** AIS navios (Digitraffic) */
  ships: 30 * 1000,
  /** ISS */
  iss: 8 * 1000,
  /** USGS terremotos */
  earthquakes: 90 * 1000,
  /** NASA EONET */
  eonet: 180 * 1000,
  /** GOES IR frames list */
  satellite: 90 * 1000,
};

export const DEFAULT_LOCATION = {
  name: 'São Paulo',
  country: 'Brasil',
  latitude: -23.5505,
  longitude: -46.6333,
  timezone: 'America/Sao_Paulo',
};

export const DEFAULT_SETTINGS = {
  theme: /** @type {ThemeMode} */ ('auto'),
  language: /** @type {LanguageCode} */ ('pt'),
  defaultCity: null,
  autoUpdate: true,
  autoUpdateInterval: 10 * 60 * 1000,
  units: {
    temperature: /** @type {TemperatureUnit} */ ('celsius'),
    wind: /** @type {WindUnit} */ ('kmh'),
    pressure: /** @type {PressureUnit} */ ('hpa'),
  },
  dataSource: 'open-meteo',
  compactMode: false,
  onboardingDone: false,
  rainNotifications: false,
  chartRange: /** @type {ChartRange} */ ('24h'),
  compareCity: null,
  /** MAP_KEY gratuita da NASA FIRMS (opcional — sem chave usa CSV público 24h) */
  firmsMapKey: '',
  firmsDayRange: 1,
  /** Chave grátis AISStream (navios) — opcional; sem chave usa Digitraffic (Europa) */
  aisStreamKey: '',
  /**
   * Painéis visíveis no dashboard (ordem).
   * O usuário pode excluir/incluir — lista completa em WIDGET_CATALOG.
   */
  /** Default enxuto — mapa/compare/sources opcionais via Personalizar */
  widgetOrder: [
    'temperature',
    'inmet',
    'conditions',
    'map',
    'humidity',
    'pressure',
    'wind',
    'uv',
    'aqi',
    'alerts',
    'forecast',
    'sources',
  ],
  /**
   * Tamanho de cada painel no dashboard: s | m | l
   * s = 1 coluna, m = 2 colunas, l = largura total (+ altura maior no mapa)
   */
  widgetSizes: {
    temperature: 'm',
    inmet: 'l',
    conditions: 'm',
    humidity: 's',
    pressure: 's',
    wind: 's',
    uv: 's',
    aqi: 's',
    sun: 's',
    moon: 's',
    alerts: 'm',
    forecast: 'l',
    map: 'l',
    compare: 'l',
    sources: 'l',
    deforestation: 'l',
  },
};

/** Todos os painéis que podem ir no dashboard (incluir/excluir). */
export const WIDGET_CATALOG = [
  'temperature',
  'inmet',
  'conditions',
  'humidity',
  'pressure',
  'wind',
  'uv',
  'aqi',
  'sun',
  'moon',
  'alerts',
  'forecast',
  'map',
  'deforestation',
  'compare',
  'sources',
];

/** @typedef {'s'|'m'|'l'} WidgetSize */
export const WIDGET_SIZES = /** @type {const} */ (['s', 'm', 'l']);

export const STORAGE_KEYS = {
  settings: 'keclima:settings',
  favorites: 'keclima:favorites',
  history: 'keclima:history',
  lastWeather: 'keclima:lastWeather',
  lastLocation: 'keclima:lastLocation',
  lastAirQuality: 'keclima:lastAirQuality',
  compareWeather: 'keclima:compareWeather',
};

export const HISTORY_MAX_ENTRIES = 500;

export const ROUTES = {
  dashboard: '/',
  map: '/mapa',
  charts: '/graficos',
  favorites: '/favoritos',
  history: '/historico',
  settings: '/configuracoes',
  about: '/sobre',
};

export const WMO_CODES = {
  0: { key: 'clear', icon: '☀️' },
  1: { key: 'mainly_clear', icon: '🌤️' },
  2: { key: 'partly_cloudy', icon: '⛅' },
  3: { key: 'overcast', icon: '☁️' },
  45: { key: 'fog', icon: '🌫️' },
  48: { key: 'rime_fog', icon: '🌫️' },
  51: { key: 'drizzle_light', icon: '🌦️' },
  53: { key: 'drizzle_moderate', icon: '🌦️' },
  55: { key: 'drizzle_dense', icon: '🌧️' },
  56: { key: 'freezing_drizzle_light', icon: '🌧️' },
  57: { key: 'freezing_drizzle_dense', icon: '🌧️' },
  61: { key: 'rain_slight', icon: '🌧️' },
  63: { key: 'rain_moderate', icon: '🌧️' },
  65: { key: 'rain_heavy', icon: '🌧️' },
  66: { key: 'freezing_rain_light', icon: '🌧️' },
  67: { key: 'freezing_rain_heavy', icon: '🌧️' },
  71: { key: 'snow_slight', icon: '🌨️' },
  73: { key: 'snow_moderate', icon: '🌨️' },
  75: { key: 'snow_heavy', icon: '❄️' },
  77: { key: 'snow_grains', icon: '❄️' },
  80: { key: 'rain_showers_slight', icon: '🌦️' },
  81: { key: 'rain_showers_moderate', icon: '🌧️' },
  82: { key: 'rain_showers_violent', icon: '⛈️' },
  85: { key: 'snow_showers_slight', icon: '🌨️' },
  86: { key: 'snow_showers_heavy', icon: '❄️' },
  95: { key: 'thunderstorm', icon: '⛈️' },
  96: { key: 'thunderstorm_hail_slight', icon: '⛈️' },
  99: { key: 'thunderstorm_hail_heavy', icon: '⛈️' },
};

export const AQI_LEVELS = {
  us: [
    { max: 50, key: 'good', color: '#22c55e' },
    { max: 100, key: 'moderate', color: '#eab308' },
    { max: 150, key: 'unhealthy_sensitive', color: '#f97316' },
    { max: 200, key: 'unhealthy', color: '#ef4444' },
    { max: 300, key: 'very_unhealthy', color: '#a855f7' },
    { max: Infinity, key: 'hazardous', color: '#7f1d1d' },
  ],
};

/** Shell assets for service worker pre-cache (relative to root) */
export const SW_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './src/main.js',
  './src/app.js',
  './src/config.js',
  './src/router.js',
  './src/styles/main.css',
  './public/assets/icons/icon.svg',
  './public/assets/icons/icon-192.png',
  './public/assets/icons/icon-512.png',
];
