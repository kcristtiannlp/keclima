/**
 * KeClima Service Worker – shell completo + runtime inteligente.
 */

const CACHE_VERSION = 'keclima-v0.8.12';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const API_CACHE = `${CACHE_VERSION}-api`;

const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './src/api/providers/airQuality.js',
  './src/api/providers/deforestation.js',
  './src/api/providers/firms.js',
  './src/api/providers/inmet.js',
  './src/api/providers/nominatim.js',
  './src/api/providers/openMeteo.js',
  './src/api/providers/opensky.js',
  './src/api/providers/ships.js',
  './src/api/providers/disasters.js',
  './src/api/providers/satellite.js',
  './src/widgets/SatelliteWidget.js',
  './src/app.js',
  './src/components/Header.js',
  './src/components/Nav.js',
  './src/components/OfflineBanner.js',
  './src/components/Onboarding.js',
  './src/components/Toast.js',
  './src/config.js',
  './src/core/EventBus.js',
  './src/core/State.js',
  './src/data/mapCatalog.js',
  './src/main.js',
  './src/pages/AboutPage.js',
  './src/pages/ChartsPage.js',
  './src/pages/DashboardPage.js',
  './src/pages/FavoritesPage.js',
  './src/pages/HistoryPage.js',
  './src/pages/MapPage.js',
  './src/pages/SettingsPage.js',
  './src/router.js',
  './src/services/cacheService.js',
  './src/services/locationService.js',
  './src/services/notificationService.js',
  './src/services/themeService.js',
  './src/services/toastService.js',
  './src/services/weatherService.js',
  './src/storage/Storage.js',
  './src/storage/favoritesStore.js',
  './src/storage/historyStore.js',
  './src/storage/settingsStore.js',
  './src/styles/main.css',
  './src/utils/dom.js',
  './src/utils/fetchRetry.js',
  './src/utils/i18n.js',
  './src/utils/mapBounds.js',
  './src/utils/units.js',
  './src/utils/weather.js',
  './src/utils/forecastSummary.js',
  './src/widgets/AQIWidget.js',
  './src/widgets/AlertWidget.js',
  './src/widgets/ChartWidget.js',
  './src/widgets/CompareWidget.js',
  './src/widgets/ConditionsWidget.js',
  './src/widgets/DeforestationWidget.js',
  './src/widgets/ForecastHomeWidget.js',
  './src/widgets/ForecastWidget.js',
  './src/widgets/HumidityWidget.js',
  './src/widgets/InmetWidget.js',
  './src/widgets/MapWidget.js',
  './src/widgets/MoonWidget.js',
  './src/widgets/PressureWidget.js',
  './src/widgets/SourcesWidget.js',
  './src/widgets/SunWidget.js',
  './src/widgets/TemperatureWidget.js',
  './src/widgets/UVWidget.js',
  './src/widgets/Widget.js',
  './src/widgets/WindWidget.js',
  './public/assets/icons/icon-192.png',
  './public/assets/icons/icon-512.png',
  './public/assets/icons/icon.svg',
  './public/vendor/chartjs/chart.umd.min.js',
  './public/vendor/leaflet/leaflet.css',
  './public/vendor/leaflet/leaflet.js',
  './public/vendor/leaflet/marker-icon-2x.png',
  './public/vendor/leaflet/marker-icon.png',
  './public/vendor/leaflet/marker-shadow.png',
  './public/vendor/leaflet/images/layers.png',
  './public/vendor/leaflet/images/layers-2x.png',
  './public/vendor/leaflet/images/marker-icon.png',
  './public/vendor/leaflet/images/marker-icon-2x.png',
  './public/vendor/leaflet/images/marker-shadow.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(async (cache) => {
      await Promise.all(
        SHELL_ASSETS.map((url) =>
          cache.add(url).catch((err) => console.warn('[SW] cache skip', url, err))
        )
      );
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('keclima-') && ![SHELL_CACHE, RUNTIME_CACHE, API_CACHE].includes(key))
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

function isApiRequest(url) {
  return (
    url.includes('api.open-meteo.com') ||
    url.includes('air-quality-api.open-meteo.com') ||
    url.includes('archive-api.open-meteo.com') ||
    url.includes('nominatim.openstreetmap.org') ||
    url.includes('api.rainviewer.com') ||
    url.includes('tilecache.rainviewer.com') ||
    url.includes('tile.openstreetmap.org') ||
    url.includes('basemaps.cartocdn.com') ||
    url.includes('tiles.lightningmaps.org')
  );
}

function isCdn(url) {
  return (
    url.includes('unpkg.com') ||
    url.includes('jsdelivr.net') ||
    url.includes('cdn.')
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  if (isCdn(request.url)) {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
    return;
  }

  if (isApiRequest(request.url)) {
    event.respondWith(networkFirst(request, API_CACHE));
    return;
  }

  if (url.origin === self.location.origin) {
    // Nunca cachear o proxy FIRMS / APIs locais
    if (url.pathname.startsWith('/api/')) {
      event.respondWith(
        fetch(request).catch(() => new Response(JSON.stringify({ error: 'offline' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        }))
      );
      return;
    }
    // JS/CSS da app: network-first para personalização e correções não sumirem no F5
    // (cache-first servia código antigo e a ordem dos painéis parecia “não gravar”)
    if (
      url.pathname.endsWith('.js') ||
      url.pathname.endsWith('.css') ||
      url.pathname.endsWith('service-worker.js')
    ) {
      event.respondWith(networkFirst(request, SHELL_CACHE));
      return;
    }
    event.respondWith(cacheFirst(request, SHELL_CACHE));
  }
});

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) {
    // revalidate in background
    fetch(request)
      .then((response) => {
        if (response && response.status === 200) {
          caches.open(cacheName).then((c) => c.put(request, response));
        }
      })
      .catch(() => undefined);
    return cached;
  }
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      const clone = response.clone();
      caches.open(cacheName).then((c) => c.put(request, clone));
    }
    return response;
  } catch {
    if (request.mode === 'navigate') {
      return caches.match('./index.html');
    }
    return cached;
  }
}

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      const clone = response.clone();
      caches.open(cacheName).then((c) => c.put(request, clone));
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || Response.error();
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then((response) => {
      if (response && response.status === 200) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => cached);
  return cached || networkPromise;
}
