import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.resolve(__dirname, '../src/data/altamura_road_graph.json');

// Coordinate della sede HAM (Via Golgota 86, Altamura)
const HAM_COORDS = [40.825624, 16.563187];

// Bounding box estesa del territorio di Altamura
const BBOX = '40.77,16.48,40.88,16.63';

const OVERPASS_ENDPOINTS = [
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

const OVERPASS_QUERY = `
[out:json][timeout:90];
(
  way["highway"~"^(primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|residential|unclassified|living_street|pedestrian|service)$"]["area"!~"yes"](${BBOX});
);
out body geom;
`;

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

async function fetchFromOverpass() {
  let lastError;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    console.log(`Interrogazione Overpass su: ${endpoint} ...`);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'User-Agent': 'HAM-Delivery-Graph-Builder/1.0',
        },
        body: `data=${encodeURIComponent(OVERPASS_QUERY)}`,
        signal: AbortSignal.timeout(75000),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }

      const data = await res.json();
      if (data && Array.isArray(data.elements) && data.elements.length > 0) {
        console.log(`Successo! Scaricati ${data.elements.length} segmenti stradali da ${endpoint}`);
        return data;
      }
      throw new Error('Risposta vuota da Overpass');
    } catch (err) {
      console.warn(`Fallito ${endpoint}: ${err.message}`);
      lastError = err;
    }
  }
  throw lastError;
}

function getHighwaySpeed(highway) {
  switch (highway) {
    case 'primary':
    case 'primary_link':
    case 'secondary':
    case 'secondary_link':
    case 'tertiary':
    case 'tertiary_link':
      return 50; // 50 km/h per i grandi viali di scorrimento (Via Bari, Viale Martiri, ecc.)
    case 'residential':
    case 'unclassified':
      return 30; // 30 km/h nelle vie residenziali urbane
    case 'service':
      return 20; // 20 km/h nelle strade di servizio
    case 'living_street':
    case 'pedestrian':
      return 15; // 15 km/h nel centro storico e nei claustri (motorini a passo d'uomo)
    default:
      return 25;
  }
}

async function main() {
  console.log('Avvio estrazione rete stradale Altamura con sensi unici e viabilità motorini...');
  const data = await fetchFromOverpass();

  // 1. Mappatura nodi originali OSM -> coordinate
  const rawNodeCoords = new Map();
  for (const w of data.elements) {
    if (!w.nodes || !w.geometry || w.nodes.length !== w.geometry.length) continue;
    for (let i = 0; i < w.nodes.length; i++) {
      const nid = w.nodes[i];
      if (!rawNodeCoords.has(nid)) {
        rawNodeCoords.set(nid, [
          Math.round(w.geometry[i].lat * 1_000_000) / 1_000_000,
          Math.round(w.geometry[i].lon * 1_000_000) / 1_000_000,
        ]);
      }
    }
  }

  // 2. Costruzione adiacenza provvisoria e identificazione della componente connessa di HAM
  const rawAdj = new Map();
  for (const nid of rawNodeCoords.keys()) {
    rawAdj.set(nid, new Set());
  }

  const rawEdges = [];
  const streetsList = ['Senza Nome'];
  const streetMap = new Map([['Senza Nome', 0]]);

  function getStreetId(name) {
    const clean = (name || '').trim();
    if (!clean) return 0;
    if (streetMap.has(clean)) return streetMap.get(clean);
    const id = streetsList.length;
    streetsList.push(clean);
    streetMap.set(clean, id);
    return id;
  }

  for (const w of data.elements) {
    if (!w.nodes || !w.geometry || w.nodes.length !== w.geometry.length) continue;
    const h = w.tags?.highway || 'residential';
    // Esclusione tassativa sentieri, scalinate, marciapiedi
    if (['steps', 'track', 'path', 'footway', 'cycleway', 'bridleway', 'corridor', 'proposed', 'construction'].includes(h)) {
      continue;
    }

    const speed = getHighwaySpeed(h);
    const streetId = getStreetId(w.tags?.name);
    const isOneway = w.tags?.oneway === 'yes' || w.tags?.oneway === '1' || w.tags?.junction === 'roundabout';
    const isReverseOneway = w.tags?.oneway === '-1';

    for (let i = 0; i < w.nodes.length - 1; i++) {
      const u = w.nodes[i];
      const v = w.nodes[i + 1];
      const uCoords = rawNodeCoords.get(u);
      const vCoords = rawNodeCoords.get(v);
      if (!uCoords || !vCoords) continue;

      const dist = haversineMeters(uCoords[0], uCoords[1], vCoords[0], vCoords[1]);
      if (dist === 0) continue; // ignora nodi sovrapposti identici

      const costSec = Math.max(1, Math.round((dist / (speed * 1000 / 3600))));

      // Per la connettività topologica (grafo non orientato provvisorio per BFS)
      rawAdj.get(u).add(v);
      rawAdj.get(v).add(u);

      // Archi orientati effettivi
      if (!isReverseOneway) {
        rawEdges.push({ from: u, to: v, cost: costSec, dist, streetId, speed });
      }
      if (!isOneway) {
        rawEdges.push({ from: v, to: u, cost: costSec, dist, streetId, speed });
      }
    }
  }

  // 3. Trova il nodo più vicino a HAM (Via Golgota 8)
  let hamRawNode = null;
  let minHamDist = Infinity;
  for (const [nid, coords] of rawNodeCoords.entries()) {
    const d = haversineMeters(coords[0], coords[1], HAM_COORDS[0], HAM_COORDS[1]);
    if (d < minHamDist) {
      minHamDist = d;
      hamRawNode = nid;
    }
  }

  console.log(`Nodo HAM trovato: ID ${hamRawNode} a ${minHamDist} metri da Via Golgota 8`);

  // 4. BFS per estrarre la Componente Connessa Principale contenente HAM
  const mainComponentNodes = new Set();
  const queue = [hamRawNode];
  mainComponentNodes.add(hamRawNode);

  while (queue.length > 0) {
    const curr = queue.shift();
    const neighbors = rawAdj.get(curr) || [];
    for (const next of neighbors) {
      if (!mainComponentNodes.has(next)) {
        mainComponentNodes.add(next);
        queue.push(next);
      }
    }
  }

  console.log(
    `Nodi componente connessa HAM: ${mainComponentNodes.size} su ${rawNodeCoords.size} (${(
      (mainComponentNodes.size / rawNodeCoords.size) *
      100
    ).toFixed(1)}%)`
  );

  // 5. Re-indicizzazione densa dei nodi (0 ... N-1)
  const nodeIndexMap = new Map();
  const denseNodes = [];
  let hamDenseIndex = 0;

  for (const nid of mainComponentNodes) {
    const newIdx = denseNodes.length;
    nodeIndexMap.set(nid, newIdx);
    denseNodes.push(rawNodeCoords.get(nid));
    if (nid === hamRawNode) {
      hamDenseIndex = newIdx;
    }
  }

  // 6. Filtraggio archi appartenenti alla componente connessa
  const denseEdges = [];
  for (const e of rawEdges) {
    if (nodeIndexMap.has(e.from) && nodeIndexMap.has(e.to)) {
      const u = nodeIndexMap.get(e.from);
      const v = nodeIndexMap.get(e.to);
      denseEdges.push([u, v, e.cost, e.dist, e.streetId]);
    }
  }

  console.log(`Archi orientati validi nel grafo finale: ${denseEdges.length}`);

  // 7. Salvataggio del file finale compatto
  const outputGraph = {
    version: 1,
    generatedAt: new Date().toISOString(),
    hamCoords: HAM_COORDS,
    hamNodeIndex: hamDenseIndex,
    nodes: denseNodes, // array di [lat, lng]
    streets: streetsList, // array dei nomi delle vie
    edges: denseEdges, // array di [from, to, costSec, distMeters, streetId]
  };

  const jsonContent = JSON.stringify(outputGraph);
  await fs.writeFile(OUTPUT_PATH, jsonContent, 'utf-8');

  console.log(`File salvato con successo in: ${OUTPUT_PATH}`);
  console.log(`Dimensione totale file: ${(jsonContent.length / 1024).toFixed(1)} KB`);
}

main().catch((err) => {
  console.error('Errore durante la generazione del grafo:', err);
  process.exit(1);
});
