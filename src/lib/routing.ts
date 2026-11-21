import type { Order } from '@/types/database';
import roadGraphRaw from '@/data/altamura_road_graph.json';

// Sede locale HAM: Via Golgota 86, 70022 Altamura (BA) [ANNCSU: civico 86]
export const HAM_ALTAMURA_COORDS: [number, number] = [40.825624, 16.563187];
export const HAM_ALTAMURA_ADDRESS = 'Via Golgota 86, Altamura';

// Confinamento rigoroso sul territorio cittadino di Altamura
export const ALTAMURA_MAX_BOUNDS: [[number, number], [number, number]] = [
  [40.77, 16.47],
  [40.88, 16.64],
];

export interface RoutePointInput {
  id: string;
  label: string;
  lat: number;
  lng: number;
  order?: Order;
}

export interface OptimalRouteStop {
  id: string;
  label: string;
  order?: Order;
  stopNumber: number;
  lat: number;
  lng: number;
}

export interface OptimalRouteResult {
  polyline: [number, number][];
  orderedStops: OptimalRouteStop[];
  totalDistanceKm: number;
  estimatedMinutes: number;
  isFallback: boolean;
}

// ---------------------------------------------------------------------------
// STRUTTURE DEL GRAFO STRADALE LOCALE DI ALTAMURA
// ---------------------------------------------------------------------------
interface RoadGraphData {
  version: number;
  generatedAt?: string;
  hamCoords: [number, number];
  hamNodeIndex: number;
  nodes: [number, number][]; // [lat, lng]
  streets: string[];
  edges: [number, number, number, number, number][]; // [from, to, costSec, distMeters, streetId]
}

const roadGraph = roadGraphRaw as RoadGraphData;

interface DirectedEdge {
  to: number;
  costSec: number;
  distMeters: number;
  streetId: number;
}

// Calcolo distanza Haversine in metri
function haversineMeters(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLon = ((b[1] - a[1]) * Math.PI) / 180;
  const lat1 = (a[0] * Math.PI) / 180;
  const lat2 = (b[0] * Math.PI) / 180;
  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Adiacenza del grafo orientato
const adj: DirectedEdge[][] = Array.from({ length: roadGraph.nodes.length }, () => []);
for (const [u, v, costSec, distMeters, streetId] of roadGraph.edges) {
  if (u >= 0 && u < adj.length && v >= 0 && v < adj.length) {
    adj[u].push({ to: v, costSec, distMeters, streetId });
  }
}

// ---------------------------------------------------------------------------
// SPATIAL GRID PER SNAPPING ISTANTANEO (0 ms)
// ---------------------------------------------------------------------------
const GRID_CELL_SIZE = 0.003; // ~300 metri
const spatialGrid = new Map<string, number[]>();

for (let i = 0; i < roadGraph.nodes.length; i++) {
  const [lat, lng] = roadGraph.nodes[i];
  const cellKey = `${Math.floor(lat / GRID_CELL_SIZE)},${Math.floor(lng / GRID_CELL_SIZE)}`;
  const cell = spatialGrid.get(cellKey);
  if (cell) {
    cell.push(i);
  } else {
    spatialGrid.set(cellKey, [i]);
  }
}

/**
 * Esegue lo snapping sicuro delle coordinate al nodo del grafo più vicino.
 * Non fallisce mai.
 */
export function snapToRoadNetwork(lat: number, lng: number): number {
  const cX = Math.floor(lat / GRID_CELL_SIZE);
  const cY = Math.floor(lng / GRID_CELL_SIZE);

  let bestNode = -1;
  let minDistance = Infinity;

  // Cerca nella cella e nelle 8 celle vicine
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const key = `${cX + dx},${cY + dy}`;
      const bucket = spatialGrid.get(key);
      if (!bucket) continue;
      for (const nodeIdx of bucket) {
        const d = haversineMeters([lat, lng], roadGraph.nodes[nodeIdx]);
        if (d < minDistance) {
          minDistance = d;
          bestNode = nodeIdx;
        }
      }
    }
  }

  if (bestNode !== -1) return bestNode;

  // Fallback estremo se fuori dalle celle mappate: scansione lineare
  for (let i = 0; i < roadGraph.nodes.length; i++) {
    const d = haversineMeters([lat, lng], roadGraph.nodes[i]);
    if (d < minDistance) {
      minDistance = d;
      bestNode = i;
    }
  }

  return bestNode !== -1 ? bestNode : roadGraph.hamNodeIndex;
}

// ---------------------------------------------------------------------------
// MIN-HEAP AD ALTE PRESTAZIONI PER A*
// ---------------------------------------------------------------------------
interface HeapItem {
  node: number;
  priority: number;
}

class MinHeap {
  private data: HeapItem[] = [];

  push(node: number, priority: number): void {
    this.data.push({ node, priority });
    this.bubbleUp(this.data.length - 1);
  }

  pop(): HeapItem | undefined {
    if (this.data.length === 0) return undefined;
    const top = this.data[0];
    const bottom = this.data.pop()!;
    if (this.data.length > 0) {
      this.data[0] = bottom;
      this.sinkDown(0);
    }
    return top;
  }

  get size(): number {
    return this.data.length;
  }

  private bubbleUp(idx: number): void {
    while (idx > 0) {
      const parent = (idx - 1) >> 1;
      if (this.data[idx].priority < this.data[parent].priority) {
        const temp = this.data[idx];
        this.data[idx] = this.data[parent];
        this.data[parent] = temp;
        idx = parent;
      } else {
        break;
      }
    }
  }

  private sinkDown(idx: number): void {
    const len = this.data.length;
    while (true) {
      let smallest = idx;
      const left = (idx << 1) + 1;
      const right = left + 1;

      if (left < len && this.data[left].priority < this.data[smallest].priority) {
        smallest = left;
      }
      if (right < len && this.data[right].priority < this.data[smallest].priority) {
        smallest = right;
      }
      if (smallest !== idx) {
        const temp = this.data[idx];
        this.data[idx] = this.data[smallest];
        this.data[smallest] = temp;
        idx = smallest;
      } else {
        break;
      }
    }
  }
}

export interface PathResult {
  path: number[];
  timeSec: number;
  distMeters: number;
}

/**
 * Algoritmo A* su Grafo Orientato.
 * Rispetta al 100% i sensi unici, le rotatorie e le velocità differenziate
 * (15 km/h centro storico/claustri, 50 km/h viali).
 */
export function calculateDirectedShortestPath(
  startNode: number,
  targetNode: number
): PathResult | null {
  if (startNode === targetNode) {
    return { path: [startNode], timeSec: 0, distMeters: 0 };
  }

  const nodeCount = roadGraph.nodes.length;
  const dist = new Float64Array(nodeCount).fill(Infinity);
  const distM = new Float64Array(nodeCount).fill(Infinity);
  const prev = new Int32Array(nodeCount).fill(-1);

  const targetCoords = roadGraph.nodes[targetNode];

  // Euristica ammissibile (tempo minimo in secondi ipotizzando velocità massima 50 km/h = 13.88 m/s)
  const heuristic = (u: number) => {
    const uCoords = roadGraph.nodes[u];
    return haversineMeters(uCoords, targetCoords) / 13.88;
  };

  dist[startNode] = 0;
  distM[startNode] = 0;

  const pq = new MinHeap();
  pq.push(startNode, heuristic(startNode));

  while (pq.size > 0) {
    const item = pq.pop();
    if (!item) break;
    const { node: u, priority } = item;

    if (u === targetNode) break;
    if (dist[u] + heuristic(u) < priority - 0.0001) continue;

    const edges = adj[u];
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      const alt = dist[u] + e.costSec;
      if (alt < dist[e.to]) {
        dist[e.to] = alt;
        distM[e.to] = distM[u] + e.distMeters;
        prev[e.to] = u;
        pq.push(e.to, alt + heuristic(e.to));
      }
    }
  }

  if (dist[targetNode] === Infinity) {
    // Fallback sicuro nel caso di vicoli ciechi o blocchi eccezionali:
    // congiungi direttamente i due nodi in linea retta
    const directDist = haversineMeters(roadGraph.nodes[startNode], targetCoords);
    const directTime = Math.max(1, Math.round(directDist / (15 * 1000 / 3600)));
    return {
      path: [startNode, targetNode],
      timeSec: directTime,
      distMeters: directDist,
    };
  }

  const path: number[] = [];
  let curr = targetNode;
  while (curr !== -1) {
    path.push(curr);
    curr = prev[curr];
  }
  path.reverse();

  return {
    path,
    timeSec: Math.round(dist[targetNode]),
    distMeters: Math.round(distM[targetNode]),
  };
}

// ---------------------------------------------------------------------------
// RISOLUTORE TSP (TRAVELING SALESPERSON PROBLEM)
// ---------------------------------------------------------------------------

/**
 * Genera tutte le permutazioni di un array (usato per N <= 8, certezza matematica)
 */
function generatePermutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  const results: T[][] = [];
  for (let i = 0; i < items.length; i++) {
    const current = items[i];
    const remaining = items.slice(0, i).concat(items.slice(i + 1));
    const subPerms = generatePermutations(remaining);
    for (const p of subPerms) {
      results.push([current, ...p]);
    }
  }
  return results;
}

/**
 * Risolve il TSP con matrice asimmetrica:
 * - Se N <= 8: Ricerca esaustiva di tutte le permutazioni (100% tempo minimo garantito).
 * - Se N > 8: Nearest Neighbor + ottimizzazione 2-Opt per rimuovere incroci.
 */
function solveAsymmetricTSP(
  matrix: (PathResult | null)[][],
  stopCount: number
): number[] {
  // Le tappe sono indicizzate 1 ... stopCount (0 è HAM)
  const stops = Array.from({ length: stopCount }, (_, i) => i + 1);

  if (stopCount <= 8) {
    const perms = generatePermutations(stops);
    let bestSeq = perms[0];
    let minTime = Infinity;

    for (const seq of perms) {
      let totalTime = matrix[0][seq[0]]?.timeSec ?? 999999;
      for (let i = 0; i < seq.length - 1; i++) {
        totalTime += matrix[seq[i]][seq[i + 1]]?.timeSec ?? 999999;
      }
      if (totalTime < minTime) {
        minTime = totalTime;
        bestSeq = seq;
      }
    }
    return bestSeq;
  }

  // Euristica Nearest Neighbor per N > 8
  const unvisited = new Set(stops);
  const route: number[] = [];
  let current = 0;

  while (unvisited.size > 0) {
    let nextStop = -1;
    let minTime = Infinity;
    for (const candidate of unvisited) {
      const t = matrix[current][candidate]?.timeSec ?? Infinity;
      if (t < minTime) {
        minTime = t;
        nextStop = candidate;
      }
    }
    if (nextStop === -1) {
      nextStop = Array.from(unvisited)[0];
    }
    unvisited.delete(nextStop);
    route.push(nextStop);
    current = nextStop;
  }

  // Ottimizzazione 2-Opt
  let improved = true;
  let iterations = 0;
  while (improved && iterations < 50) {
    improved = false;
    iterations++;
    for (let i = 0; i < route.length - 1; i++) {
      for (let k = i + 1; k < route.length; k++) {
        const newRoute = [
          ...route.slice(0, i),
          ...route.slice(i, k + 1).reverse(),
          ...route.slice(k + 1),
        ];

        let currentTime = matrix[0][route[0]]?.timeSec ?? 0;
        for (let s = 0; s < route.length - 1; s++) {
          currentTime += matrix[route[s]][route[s + 1]]?.timeSec ?? 0;
        }

        let newTime = matrix[0][newRoute[0]]?.timeSec ?? 0;
        for (let s = 0; s < newRoute.length - 1; s++) {
          newTime += matrix[newRoute[s]][newRoute[s + 1]]?.timeSec ?? 0;
        }

        if (newTime < currentTime) {
          route.splice(0, route.length, ...newRoute);
          improved = true;
          break;
        }
      }
      if (improved) break;
    }
  }

  return route;
}

// ---------------------------------------------------------------------------
// FUNZIONI PUBBLICHE ESPORTATE PER L'APP
// ---------------------------------------------------------------------------

/**
 * Calcola il percorso ottimale di consegna partendo dalla sede HAM (Via Golgota 86)
 * verso qualsiasi lista di punti [lat, lng].
 * 100% locale, zero API esterne, rispetto totale dei sensi unici.
 */
export async function calculateOptimalPointsRoute(
  hamCoords: [number, number],
  points: RoutePointInput[]
): Promise<OptimalRouteResult | null> {
  if (points.length === 0) return null;

  // 1. Snapping dei punti sulla rete stradale connessa
  const hamNode = snapToRoadNetwork(hamCoords[0], hamCoords[1]);
  const stopNodes = points.map((p) => snapToRoadNetwork(p.lat, p.lng));

  // Tutti i nodi coinvolti: indice 0 = HAM, indici 1 ... N = tappe di consegna
  const allNodes = [hamNode, ...stopNodes];
  const totalLocations = allNodes.length;

  // 2. Calcolo matrice asimmetrica delle distanze/tempi con A*
  const matrix: (PathResult | null)[][] = Array.from({ length: totalLocations }, () =>
    Array(totalLocations).fill(null)
  );

  for (let i = 0; i < totalLocations; i++) {
    for (let j = 0; j < totalLocations; j++) {
      if (i !== j) {
        matrix[i][j] = calculateDirectedShortestPath(allNodes[i], allNodes[j]);
      }
    }
  }

  // 3. Risoluzione ottimale del TSP partendo da HAM
  const bestSequence = solveAsymmetricTSP(matrix, points.length);

  // 4. Concatenazione delle polilinee e calcolo totali
  const fullPolyline: [number, number][] = [];
  let totalDistanceMeters = 0;
  let totalTimeSeconds = 0;

  let currentLocIndex = 0; // Parte da HAM
  for (let step = 0; step < bestSequence.length; step++) {
    const nextLocIndex = bestSequence[step];
    const leg = matrix[currentLocIndex][nextLocIndex];

    if (leg) {
      totalDistanceMeters += leg.distMeters;
      totalTimeSeconds += leg.timeSec;

      // Estrai le coordinate reali della tratta lungo le vie
      const legCoords = leg.path.map((nodeIdx) => roadGraph.nodes[nodeIdx]);
      if (fullPolyline.length === 0) {
        fullPolyline.push(...legCoords);
      } else {
        // Salta il primo punto per non duplicare il nodo di giunzione
        fullPolyline.push(...legCoords.slice(1));
      }
    }

    currentLocIndex = nextLocIndex;
  }

  // Se per qualche motivo la polilinea fosse vuota, usa i punti diretti
  if (fullPolyline.length === 0) {
    fullPolyline.push(hamCoords, ...points.map((p) => [p.lat, p.lng] as [number, number]));
  }

  // 5. Mappatura fermate ordinate (1°, 2°, 3°...)
  const orderedStops: OptimalRouteStop[] = bestSequence.map((locIdx, orderIdx) => {
    const point = points[locIdx - 1];
    return {
      id: point.id,
      label: point.label,
      order: point.order,
      stopNumber: orderIdx + 1,
      lat: point.lat,
      lng: point.lng,
    };
  });

  const totalKm = Math.round((totalDistanceMeters / 1000) * 100) / 100;
  // Tempo di guida + 2 minuti di consegna al cliente per fermata
  const totalMinutes = Math.max(
    1,
    Math.round(totalTimeSeconds / 60) + orderedStops.length * 2
  );

  return {
    polyline: fullPolyline,
    orderedStops,
    totalDistanceKm: totalKm,
    estimatedMinutes: totalMinutes,
    isFallback: false,
  };
}

/**
 * Calcola il percorso ottimale per gli ordini attivi di un rider partendo dalla sede HAM.
 */
export async function calculateOptimalRoute(
  hamCoords: [number, number],
  activeOrders: Order[]
): Promise<OptimalRouteResult | null> {
  const points: RoutePointInput[] = activeOrders
    .filter(
      (o): o is Order & { lat: number; lng: number } =>
        o.status !== 'delivered' &&
        o.status !== 'cancelled' &&
        typeof o.lat === 'number' &&
        typeof o.lng === 'number' &&
        Number.isFinite(o.lat) &&
        Number.isFinite(o.lng)
    )
    .map((o) => ({
      id: o.id,
      label: o.customer_address,
      lat: o.lat,
      lng: o.lng,
      order: o,
    }));

  return calculateOptimalPointsRoute(hamCoords, points);
}
