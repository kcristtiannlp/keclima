/**
 * Nominatim — nomes locais (distrito/vila) prioritários sobre município/cidade.
 * @module api/providers/nominatim
 */

import { API } from '../../config.js';
import { fetchRetry } from '../../utils/fetchRetry.js';

const headers = {
  Accept: 'application/json',
  'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.5',
};

/** @type {Promise<void>} */
let chain = Promise.resolve();
let lastAt = 0;

const LOCAL_TYPES = new Set([
  'village',
  'hamlet',
  'suburb',
  'neighbourhood',
  'neighborhood',
  'city_district',
  'district',
  'quarter',
  'locality',
  'residential',
  'croft',
  'isolated_dwelling',
  'borough',
  'city_block',
]);

/**
 * @template T
 * @param {() => Promise<T>} fn
 */
function enqueue(fn) {
  const run = async () => {
    const wait = Math.max(0, API.nominatim.minIntervalMs - (Date.now() - lastAt));
    if (wait) {
      await new Promise((r) => setTimeout(r, wait));
    }
    lastAt = Date.now();
    return fn();
  };
  const next = chain.then(run, run);
  chain = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

/**
 * @param {string} query
 * @param {AbortSignal} [signal]
 */
export async function searchPlaces(query, signal) {
  const q = query.trim();
  if (q.length < 2) {
    return [];
  }

  return enqueue(async () => {
    const params = new URLSearchParams({
      q,
      format: 'json',
      addressdetails: '1',
      namedetails: '1',
      limit: '10',
      countrycodes: 'br',
    });
    let res = await fetchRetry(`${API.nominatim.search}?${params}`, {
      signal,
      headers,
      retries: 1,
    });
    if (res.status === 429) {
      const err = new Error('rate_limit');
      err.code = 'rate_limit';
      throw err;
    }
    if (!res.ok) {
      throw new Error(`Nominatim search HTTP ${res.status}`);
    }
    let data = await res.json();
    if (!data.length) {
      const paramsWorld = new URLSearchParams({
        q,
        format: 'json',
        addressdetails: '1',
        namedetails: '1',
        limit: '8',
      });
      res = await fetchRetry(`${API.nominatim.search}?${paramsWorld}`, {
        signal,
        headers,
        retries: 1,
      });
      if (res.ok) {
        data = await res.json();
      }
    }
    return data.map(mapResult);
  });
}

/**
 * @param {number} latitude
 * @param {number} longitude
 * @param {AbortSignal} [signal]
 */
export async function reverseGeocode(latitude, longitude, signal) {
  return enqueue(async () => {
    // zoom 18 = nível de rua/bairro — evita “só a capital”
    const params = new URLSearchParams({
      lat: String(latitude),
      lon: String(longitude),
      format: 'json',
      addressdetails: '1',
      namedetails: '1',
      zoom: '18',
    });
    const res = await fetchRetry(`${API.nominatim.reverse}?${params}`, {
      signal,
      headers,
      retries: 1,
    });
    if (!res.ok) {
      throw new Error(`Nominatim reverse HTTP ${res.status}`);
    }
    return mapResult(await res.json());
  });
}

/**
 * @param {Object} item
 */
function mapResult(item) {
  const addr = item.address || {};
  const type = String(item.addresstype || item.type || '').toLowerCase();
  const osmName = (item.name || item.namedetails?.name || '').trim();
  const displayFirst = (item.display_name || '').split(',')[0].trim();

  // 1) Tipo local explícito no OSM (village, city_district, etc.)
  let localName = '';
  if (osmName && LOCAL_TYPES.has(type)) {
    localName = osmName;
  }

  // 2) Campos de endereço locais (nunca pular para town antes)
  if (!localName) {
    localName = firstPresent(addr, [
      'village',
      'hamlet',
      'suburb',
      'neighbourhood',
      'neighborhood',
      'city_district',
      'district',
      'quarter',
      'locality',
      'city_block',
      'residential',
      'croft',
      'isolated_dwelling',
      'borough',
    ]);
  }

  // 3) Primeiro pedaço do display_name se for mais local que a cidade
  if (!localName && displayFirst) {
    localName = displayFirst;
  }

  // 4) Nome OSM genérico
  if (!localName && osmName && type !== 'road' && type !== 'highway') {
    localName = osmName;
  }

  // 5) Município / cidade (só se nada mais local existir)
  if (!localName) {
    localName = firstPresent(addr, ['town', 'city', 'municipality', 'county', 'state']);
  }
  if (!localName) {
    localName = displayFirst || 'Local';
  }

  // Não usar nome de rua como "cidade" se houver distrito/vila no endereço
  const betterLocal = firstPresent(addr, [
    'village',
    'hamlet',
    'suburb',
    'neighbourhood',
    'neighborhood',
    'city_district',
    'district',
    'quarter',
    'locality',
  ]);
  if (betterLocal && (type === 'road' || type === 'highway' || localName === addr.road)) {
    localName = betterLocal;
  }

  const parentCity = firstPresent(addr, ['city', 'town', 'municipality']);
  const state = addr.state || '';
  const country = addr.country || '';

  // Linha secundária: "Ouro Preto · MG" (município, não o nome principal)
  const parts = [];
  if (parentCity && !sameName(parentCity, localName)) {
    parts.push(parentCity);
  }
  if (state) {
    parts.push(shortState(state));
  } else if (country) {
    parts.push(country);
  }
  const regionLabel = parts.join(' · ');

  // Coordenadas: centro do resultado (busca) — reverse sobrescreve com GPS depois
  let lat = parseFloat(item.lat);
  let lon = parseFloat(item.lon);
  // Se tiver boundingbox, use o centro (melhor para distritos grandes)
  if (Array.isArray(item.boundingbox) && item.boundingbox.length === 4) {
    const south = parseFloat(item.boundingbox[0]);
    const north = parseFloat(item.boundingbox[1]);
    const west = parseFloat(item.boundingbox[2]);
    const east = parseFloat(item.boundingbox[3]);
    if ([south, north, west, east].every((n) => !Number.isNaN(n))) {
      lat = (south + north) / 2;
      lon = (west + east) / 2;
    }
  }

  return {
    name: localName,
    country: regionLabel,
    latitude: lat,
    longitude: lon,
    displayName: item.display_name || localName,
    parentCity: parentCity && !sameName(parentCity, localName) ? parentCity : '',
    state,
    placeType: type,
    timezone: undefined,
  };
}

/**
 * @param {Object} addr
 * @param {string[]} keys
 */
function firstPresent(addr, keys) {
  for (const k of keys) {
    const v = addr[k];
    if (v && String(v).trim()) {
      return String(v).trim();
    }
  }
  return '';
}

/**
 * @param {string} a
 * @param {string} b
 */
function sameName(a, b) {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * @param {string} state
 */
function shortState(state) {
  const map = {
    'Minas Gerais': 'MG',
    'São Paulo': 'SP',
    'Rio de Janeiro': 'RJ',
    'Rio Grande do Sul': 'RS',
    'Rio Grande do Norte': 'RN',
    Bahia: 'BA',
    Paraná: 'PR',
    'Santa Catarina': 'SC',
    Goiás: 'GO',
    Pernambuco: 'PE',
    Ceará: 'CE',
    Pará: 'PA',
    'Mato Grosso': 'MT',
    'Mato Grosso do Sul': 'MS',
    'Espírito Santo': 'ES',
    'Distrito Federal': 'DF',
  };
  return map[state] || state;
}
