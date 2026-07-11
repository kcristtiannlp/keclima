/**
 * Catálogo de camadas e fontes do mapa (atribuição, docs, papel).
 * @module data/mapCatalog
 */

/**
 * @typedef {Object} MapSourceEntry
 * @property {string} id
 * @property {'base'|'weather'|'risk'|'territory'|'traffic'|'geocode'} group
 * @property {string} name
 * @property {string} provider
 * @property {string} role
 * @property {string} note
 * @property {string} [url]
 * @property {string} [layerKey] chave no MapWidget
 * @property {boolean} [needsProxy]
 */

/** @type {MapSourceEntry[]} */
export const MAP_SOURCES = [
  {
    id: 'osm',
    group: 'base',
    name: 'OpenStreetMap',
    provider: 'OSM contributors',
    role: 'Mapa base de ruas',
    note: 'Tiles comunitários · uso justo',
    url: 'https://www.openstreetmap.org/copyright',
    layerKey: 'osm',
  },
  {
    id: 'carto',
    group: 'base',
    name: 'Carto Voyager',
    provider: 'CARTO / OSM',
    role: 'Base clara legível',
    note: 'Estilo limpo para painéis',
    url: 'https://carto.com/basemaps/',
    layerKey: 'carto',
  },
  {
    id: 'cartoDark',
    group: 'base',
    name: 'Carto Dark Matter',
    provider: 'CARTO / OSM',
    role: 'Base escura',
    note: 'Bom com radar e focos',
    url: 'https://carto.com/basemaps/',
    layerKey: 'cartoDark',
  },
  {
    id: 'opentopo',
    group: 'base',
    name: 'OpenTopoMap',
    provider: 'OTM / SRTM / OSM',
    role: 'Relevo e topografia',
    note: 'Curvas de nível e terreno',
    url: 'https://opentopomap.org/',
    layerKey: 'opentopo',
  },
  {
    id: 'esriSat',
    group: 'base',
    name: 'Esri World Imagery',
    provider: 'Esri / Maxar / Earthstar',
    role: 'Satélite óptico',
    note: 'Imagem real · ToS Esri',
    url: 'https://www.esri.com/',
    layerKey: 'esriSat',
  },
  {
    id: 'esriLabels',
    group: 'base',
    name: 'Esri Boundaries & Places',
    provider: 'Esri',
    role: 'Rótulos no satélite',
    note: 'Híbrido nomes/limites',
    url: 'https://www.esri.com/',
    layerKey: 'esriLabels',
  },
  {
    id: 'esriTopo',
    group: 'base',
    name: 'Esri World Topo',
    provider: 'Esri',
    role: 'Topo + referências',
    note: 'Mapa topográfico',
    url: 'https://www.esri.com/',
    layerKey: 'esriTopo',
  },
  {
    id: 'radar',
    group: 'weather',
    name: 'RainViewer Radar',
    provider: 'RainViewer',
    role: 'Precipitação agora',
    note: 'Tiles de radar (últimas horas, animável)',
    url: 'https://www.rainviewer.com/api.html',
    layerKey: 'radar',
  },
  {
    id: 'satelliteIR',
    group: 'weather',
    name: 'RainViewer Infrared',
    provider: 'RainViewer',
    role: 'Nuvens IV',
    note: 'Satélite infravermelho (não é foto óptica)',
    url: 'https://www.rainviewer.com/api.html',
    layerKey: 'satellite',
  },
  {
    id: 'openMeteoGrid',
    group: 'weather',
    name: 'Open-Meteo (grade)',
    provider: 'Open-Meteo',
    role: 'Temp, vento, nuvens, umidade, sensação, chuva 6h',
    note: 'Modelo global · pontos em grade',
    url: 'https://open-meteo.com/',
    layerKey: 'temperature',
  },
  {
    id: 'lightning',
    group: 'weather',
    name: 'Lightning maps',
    provider: 'tiles.lightningmaps.org',
    role: 'Raios',
    note: 'Cobertura irregular · opcional',
    url: 'https://www.lightningmaps.org/',
    layerKey: 'lightning',
  },
  {
    id: 'aqi',
    group: 'risk',
    name: 'Open-Meteo Air Quality',
    provider: 'Open-Meteo / CAMS',
    role: 'US AQI e PM2.5',
    note: 'Grade ao redor do local',
    url: 'https://open-meteo.com/en/docs/air-quality-api',
    layerKey: 'aqi',
  },
  {
    id: 'fireWeather',
    group: 'risk',
    name: 'Fogo-meteo (KeClima)',
    provider: 'KeClima + Open-Meteo',
    role: 'Índice local calor+seco+vento',
    note: 'Estimativa do app · não é índice oficial INPE',
    layerKey: 'fireWeather',
  },
  {
    id: 'fires',
    group: 'risk',
    name: 'INPE Queimadas + NASA FIRMS',
    provider: 'INPE / NASA',
    role: 'Focos de calor',
    note: 'Cruzamento satélite · use serve.py',
    url: 'https://queimadas.dgi.inpe.br/queimadas/portal',
    layerKey: 'fires',
    needsProxy: true,
  },
  {
    id: 'firmsNasa',
    group: 'risk',
    name: 'NASA FIRMS',
    provider: 'NASA MODAPS',
    role: 'Focos VIIRS/MODIS',
    note: 'CSV público 24h ou MAP_KEY',
    url: 'https://firms.modaps.eosdis.nasa.gov/',
    needsProxy: true,
  },
  {
    id: 'deter',
    group: 'territory',
    name: 'INPE DETER',
    provider: 'INPE / TerraBrasilis',
    role: 'Alertas de desmate',
    note: 'Amazônia + Cerrado · WFS via proxy',
    url: 'https://terrabrasilis.dpi.inpe.br/',
    layerKey: 'deter',
    needsProxy: true,
  },
  {
    id: 'prodes',
    group: 'territory',
    name: 'INPE PRODES',
    provider: 'INPE / TerraBrasilis',
    role: 'Desmate acumulado',
    note: 'WMS histórico (contexto)',
    url: 'https://terrabrasilis.dpi.inpe.br/',
    layerKey: 'prodes',
  },
  {
    id: 'flights',
    group: 'traffic',
    name: 'OpenSky Network',
    provider: 'OpenSky',
    role: 'Voos ao vivo',
    note: 'ADS-B · proxy + metadados hexdb',
    url: 'https://opensky-network.org/',
    layerKey: 'flights',
    needsProxy: true,
  },
  {
    id: 'nominatim',
    group: 'geocode',
    name: 'Nominatim',
    provider: 'OpenStreetMap',
    role: 'Busca e reverse geocode',
    note: 'Política de uso · 1 req/s',
    url: 'https://nominatim.org/',
  },
  {
    id: 'inmet',
    group: 'weather',
    name: 'INMET',
    provider: 'INMET',
    role: 'Estação observada (BR)',
    note: 'Estação mais próxima · API pública',
    url: 'https://portal.inmet.gov.br/',
    needsProxy: true,
  },
];

export const MAP_SOURCE_GROUPS = [
  { id: 'base', titleKey: 'map_group_base' },
  { id: 'weather', titleKey: 'map_group_weather' },
  { id: 'risk', titleKey: 'map_group_risk' },
  { id: 'territory', titleKey: 'map_group_territory' },
  { id: 'traffic', titleKey: 'map_group_traffic' },
  { id: 'geocode', titleKey: 'map_group_geocode' },
];

/**
 * @param {string} group
 * @returns {MapSourceEntry[]}
 */
export function sourcesByGroup(group) {
  return MAP_SOURCES.filter((s) => s.group === group);
}
