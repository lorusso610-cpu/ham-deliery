import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.resolve(__dirname, '../src/data/altamura_streets.json');

// Bounding box Altamura (BA) - ISTAT 072004
const BBOX = '40.75,16.45,40.90,16.65';

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const OVERPASS_QUERY = `
[out:json][timeout:60];
(
  way["highway"]["name"](${BBOX});
  node["place"~"square|neighbourhood|quarter|suburb|hamlet|locality"]["name"](${BBOX});
  way["place"~"square|neighbourhood|quarter|suburb|hamlet|locality"]["name"](${BBOX});
  node["addr:street"]["addr:housenumber"](${BBOX});
  way["addr:street"]["addr:housenumber"](${BBOX});
);
out geom;
`;

// Query di fallback solo strade
const OVERPASS_BBOX_QUERY = `
[out:json][timeout:60];
way["highway"]["name"](${BBOX});
out geom;
`;

function roundCoord(n) {
  return Math.round(n * 1_000_000) / 1_000_000;
}

function normalizeKey(str) {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function queryOverpass(query) {
  let lastErr;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      console.log(`Interrogazione Overpass: ${endpoint} ...`);
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'User-Agent': 'HAM-Altamura-Delivery-App/1.0',
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(75000),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      const data = await res.json();
      if (data && Array.isArray(data.elements) && data.elements.length > 0) {
        return data;
      }
      throw new Error('Risposta vuota da Overpass');
    } catch (err) {
      lastErr = err;
      console.warn(`Tentativo fallito su ${endpoint}: ${err.message}`);
    }
  }
  throw lastErr;
}

function getElementLatLng(el) {
  if (typeof el.lat === 'number' && typeof el.lon === 'number') {
    return [el.lat, el.lon];
  }
  if (el.center && typeof el.center.lat === 'number' && typeof el.center.lon === 'number') {
    return [el.center.lat, el.center.lon];
  }
  if (Array.isArray(el.geometry) && el.geometry.length > 0) {
    let latSum = 0;
    let lonSum = 0;
    let valid = 0;
    for (const pt of el.geometry) {
      if (pt && typeof pt.lat === 'number' && typeof pt.lon === 'number') {
        latSum += pt.lat;
        lonSum += pt.lon;
        valid += 1;
      }
    }
    if (valid > 0) {
      return [latSum / valid, lonSum / valid];
    }
  }
  if (el.bounds) {
    return [
      (el.bounds.minlat + el.bounds.maxlat) / 2,
      (el.bounds.minlon + el.bounds.maxlon) / 2,
    ];
  }
  return null;
}

async function main() {
  let data;
  try {
    data = await queryOverpass(OVERPASS_QUERY);
  } catch {
    console.log('Uso fallback Bounding Box Altamura...');
    data = await queryOverpass(OVERPASS_BBOX_QUERY);
  }

  const streetsMap = new Map();
  const houseNumbersByStreet = new Map();
  const pois = [];

  for (const el of data.elements) {
    const tags = el.tags || {};
    const coords = getElementLatLng(el);
    if (!coords) continue;
    const [lat, lng] = coords;

    // 1. Numeri civici
    if (tags['addr:street'] && tags['addr:housenumber']) {
      const streetKey = normalizeKey(tags['addr:street']);
      if (!houseNumbersByStreet.has(streetKey)) {
        houseNumbersByStreet.set(streetKey, {});
      }
      const numMap = houseNumbersByStreet.get(streetKey);
      const rawNum = String(tags['addr:housenumber']).trim();
      if (rawNum && !numMap[rawNum]) {
        numMap[rawNum] = [roundCoord(lat), roundCoord(lng)];
      }
    }

    // 2. Strade (highway=* con tag name)
    if (el.type === 'way' && tags.highway && tags.name) {
      const cleanName = String(tags.name).trim();
      const key = normalizeKey(cleanName);
      const minLat = el.bounds?.minlat ?? lat;
      const minLng = el.bounds?.minlon ?? lng;
      const maxLat = el.bounds?.maxlat ?? lat;
      const maxLng = el.bounds?.maxlon ?? lng;

      if (!streetsMap.has(key)) {
        streetsMap.set(key, {
          street: cleanName,
          type: tags.highway,
          latSum: lat,
          lngSum: lng,
          count: 1,
          minLat,
          minLng,
          maxLat,
          maxLng,
        });
      } else {
        const entry = streetsMap.get(key);
        entry.latSum += lat;
        entry.lngSum += lng;
        entry.count += 1;
        entry.minLat = Math.min(entry.minLat, minLat);
        entry.minLng = Math.min(entry.minLng, minLng);
        entry.maxLat = Math.max(entry.maxLat, maxLat);
        entry.maxLng = Math.max(entry.maxLng, maxLng);
      }
      continue;
    }

    // 3. Piazze, claustri, luoghi di interesse
    if (tags.name && (tags.place || tags.amenity || tags.historic)) {
      const cleanName = String(tags.name).trim();
      const type = tags.place || tags.amenity || tags.historic || 'poi';
      pois.push({
        street: cleanName,
        type,
        lat: roundCoord(lat),
        lng: roundCoord(lng),
        bounds: [
          [roundCoord(lat), roundCoord(lng)],
          [roundCoord(lat), roundCoord(lng)],
        ],
      });
    }
  }

  const results = [];
  const seenKeys = new Set();

  for (const [key, s] of streetsMap.entries()) {
    seenKeys.add(key);
    const nums = houseNumbersByStreet.get(key);
    const item = {
      street: s.street,
      type: s.type,
      lat: roundCoord(s.latSum / s.count),
      lng: roundCoord(s.lngSum / s.count),
      bounds: [
        [roundCoord(s.minLat), roundCoord(s.minLng)],
        [roundCoord(s.maxLat), roundCoord(s.maxLng)],
      ],
    };
    if (nums && Object.keys(nums).length > 0) {
      item.housenumbers = nums;
    }
    results.push(item);
  }

  for (const poi of pois) {
    const key = normalizeKey(poi.street);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    results.push(poi);
  }

  results.sort((a, b) => a.street.localeCompare(b.street, 'it'));

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(results), 'utf-8');

  const totalHouseNumbers = results.reduce(
    (acc, r) => acc + (r.housenumbers ? Object.keys(r.housenumbers).length : 0),
    0
  );
  const stat = await fs.stat(OUTPUT_PATH);

  console.log(`Stradario Altamura generato con successo!`);
  console.log(`- File: ${OUTPUT_PATH}`);
  console.log(`- Voci totali (strade + claustri/piazze/POI): ${results.length}`);
  console.log(`- Civici indicizzati: ${totalHouseNumbers}`);
  console.log(`- Dimensione file: ${(stat.size / 1024).toFixed(1)} KB`);
}

main().catch((err) => {
  console.error('Errore estrazione stradario Altamura:', err);
  process.exit(1);
});
