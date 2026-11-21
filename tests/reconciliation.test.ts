import assert from 'node:assert/strict';
import { formatEuro, parseEuroInput, sumEuro, diffEuro } from '../src/lib/currency';
import { computeRiderLiveMetrics, evaluateDiscrepancy } from '../src/lib/reconciliation';
import {
  ALTAMURA_MAX_BOUNDS,
  HAM_ALTAMURA_COORDS,
  calculateOptimalPointsRoute,
} from '../src/lib/routing';
import {
  formatOrderMovedOrigin,
  getOrderRound,
  getPlatformTheme,
  type Order,
} from '../src/types/database';
import { parseVoiceOrderTranscript } from '../src/lib/voiceOrderParser';

// 1. Test parsing valuta (virgola e punto) e formattazione
assert.equal(parseEuroInput('24,50'), 24.5);
assert.equal(parseEuroInput('24.50'), 24.5);
assert.equal(parseEuroInput('€ 12,30'), 12.3);
assert.equal(parseEuroInput('-2,50'), -2.5);
assert.ok(Number.isNaN(parseEuroInput('abc')));

// Nota: toLocaleString('it-IT') formatta '0,00' o '1.234,50'
assert.equal(formatEuro(0), '€ 0,00');
assert.equal(formatEuro(28.5), '€ 28,50');
assert.equal(formatEuro(-5.25), '-€ 5,25');

// 2. Precisione algebrica in centesimi (zero errori floating point)
assert.equal(sumEuro(0.1, 0.2), 0.3);
assert.equal(diffEuro(100.1, 99.9), 0.2);

// 3. Motore riconciliazione cassa rider
const sampleOrders: Order[] = [
  {
    id: '1',
    shift_id: 's1',
    rider_id: 'r1',
    customer_address: 'Via Roma 1',
    platform: 'Diretto/Telefono',
    order_total: 28.5,
    payment_method: 'cash',
    change_needed: 1.5,
    status: 'delivered',
    created_at: '2026-11-11T19:00:00Z',
    delivered_at: '2026-11-11T19:20:00Z',
  },
  {
    id: '2',
    shift_id: 's1',
    rider_id: 'r1',
    customer_address: 'Via Golgota 86',
    platform: 'JustEat',
    order_total: 34.0,
    payment_method: 'prepaid_platform',
    change_needed: 0,
    status: 'delivered',
    created_at: '2026-11-11T19:05:00Z',
    delivered_at: '2026-11-11T19:25:00Z',
  },
  {
    id: '3',
    shift_id: 's1',
    rider_id: 'r1',
    customer_address: 'Piazza Duomo 8',
    platform: 'Gestionale',
    order_total: 22.0,
    payment_method: 'pos_rider',
    change_needed: 0,
    status: 'delivered',
    created_at: '2026-11-11T19:10:00Z',
    delivered_at: '2026-11-11T19:30:00Z',
  },
  {
    id: '4',
    shift_id: 's1',
    rider_id: 'r1',
    customer_address: 'Corso Federico II di Svevia 15',
    platform: 'App',
    order_total: 15.0,
    payment_method: 'cash',
    change_needed: 0,
    status: 'in_transit',
    created_at: '2026-11-11T19:35:00Z',
    delivered_at: null,
  },
  {
    id: '5',
    shift_id: 's1',
    rider_id: 'r1',
    customer_address: 'Via Annullata 9',
    platform: 'JustEat',
    order_total: 99.0,
    payment_method: 'cash',
    change_needed: 0,
    status: 'cancelled',
    created_at: '2026-11-11T19:12:00Z',
    delivered_at: null,
  },
];

const metrics = computeRiderLiveMetrics(sampleOrders, 50.0);
assert.equal(metrics.cashCollected, 28.5);
assert.equal(metrics.posCollected, 22.0);
assert.equal(metrics.platformPrepaid, 34.0);
assert.equal(metrics.gestPlusResto, 100.5); // 50 + 28.5 + 22.0
assert.equal(diffEuro(metrics.gestPlusResto, metrics.posCollected), metrics.expectedCashReturn);
assert.equal(metrics.expectedCashReturn, 78.5); // (50 + 28.5 + 22.0) - 22.0 = 78.5
assert.equal(metrics.totalRiderRevenue, 84.5); // 28.5 + 34 + 22
assert.equal(metrics.deliveredCount, 3);
assert.equal(metrics.inFlightCount, 1);
assert.equal(metrics.inFlightCashExpected, 15.0);

// 3b. Codifica colori canali (App = Blu, Gestionale = Giallo, JustEat = Arancione)
assert.equal(getPlatformTheme('App').badgeVariant, 'blue');
assert.equal(getPlatformTheme('Glovo').badgeVariant, 'blue');
assert.equal(getPlatformTheme('Gestionale').badgeVariant, 'yellow');
assert.equal(getPlatformTheme('Diretto/Telefono').badgeVariant, 'yellow');
assert.equal(getPlatformTheme('JustEat').badgeVariant, 'orange');

// 3c. Parser Comando Vocale (Via, Importo, Metodo di pagamento, Canale)
const voice1 = parseVoiceOrderTranscript('Via Roma 15, 18 euro contanti, Just Eat');
assert.ok(voice1.resolvedAddress.fullAddress.toLowerCase().includes('roma'));
assert.equal(voice1.resolvedAddress.housenumber, '15');
assert.equal(voice1.amountFormatted, '18,00');
assert.equal(voice1.paymentMethod, 'cash');
assert.equal(voice1.platform, 'JustEat');

const voice2 = parseVoiceOrderTranscript('Via Bari 42, 24 euro e 50 pos, gestionale');
assert.ok(voice2.resolvedAddress.fullAddress.toLowerCase().includes('via bari'));
assert.equal(voice2.resolvedAddress.housenumber, '42');
assert.equal(voice2.amountFormatted, '24,50');
assert.equal(voice2.paymentMethod, 'pos_rider');
assert.equal(voice2.platform, 'Gestionale');

const voice3 = parseVoiceOrderTranscript('Piazza Duomo 8, 32,00 euro pagato app');
assert.ok(voice3.resolvedAddress.fullAddress.toLowerCase().includes('duomo'));
assert.equal(voice3.amountFormatted, '32,00');
assert.equal(voice3.paymentMethod, 'prepaid_platform');
assert.equal(voice3.platform, 'App');

// 4. Valutazione discrepanze cassa (Verde / Rosso / Giallo)
assert.equal(evaluateDiscrepancy(78.5, 78.5).level, 'exact');
assert.equal(evaluateDiscrepancy(78.5, 75.0).level, 'shortage');
assert.equal(evaluateDiscrepancy(78.5, 75.0).discrepancy, -3.5);
assert.equal(evaluateDiscrepancy(78.5, 80.5).level, 'surplus');
assert.equal(evaluateDiscrepancy(78.5, 80.5).discrepancy, 2.0);
assert.equal(evaluateDiscrepancy(78.5, null).level, 'pending');

// 5. Vincoli geografici Altamura e Routing Locale Offline
assert.deepEqual(HAM_ALTAMURA_COORDS, [40.825624, 16.563187]);
assert.ok(
  HAM_ALTAMURA_COORDS[0] >= ALTAMURA_MAX_BOUNDS[0][0] &&
    HAM_ALTAMURA_COORDS[0] <= ALTAMURA_MAX_BOUNDS[1][0] &&
    HAM_ALTAMURA_COORDS[1] >= ALTAMURA_MAX_BOUNDS[0][1] &&
    HAM_ALTAMURA_COORDS[1] <= ALTAMURA_MAX_BOUNDS[1][1]
);

// 6. Test routing locale multi-consegna con A* e TSP
const testStops = [
  { id: 'stop-1', label: 'Via Bari 40', lat: 40.835, lng: 16.55 },
  { id: 'stop-2', label: 'Piazza Duomo', lat: 40.828, lng: 16.554 },
  { id: 'stop-3', label: 'Via Matera 15', lat: 40.821, lng: 16.549 },
];

const routeRes = await calculateOptimalPointsRoute(HAM_ALTAMURA_COORDS, testStops);
assert.ok(routeRes !== null);
assert.equal(routeRes.orderedStops.length, 3);
assert.equal(routeRes.isFallback, false);
assert.ok(routeRes.totalDistanceKm > 0);
assert.ok(routeRes.estimatedMinutes > 0);
assert.ok(routeRes.polyline.length > 5);
assert.equal(routeRes.orderedStops[0].stopNumber, 1);
assert.equal(routeRes.orderedStops[1].stopNumber, 2);
assert.equal(routeRes.orderedStops[2].stopNumber, 3);

// 7. Test Gestione Giri (Round) & Sposta Comanda senza duplicazione importi
const movedOrder: Order = {
  ...sampleOrders[0],
  rider_id: 'r2',
  round_number: 2,
  is_moved: true,
  moved_from_rider_id: 'r1',
  moved_from_rider_name: 'MarcoGrande',
  moved_from_round: 1,
};
assert.equal(getOrderRound(movedOrder), 2);
assert.equal(formatOrderMovedOrigin(movedOrder), 'Da MarcoGrande • R1 → R2');

// Verifica non-duplicazione: l'ordine spostato a r2 non compare più nei totali di r1
const allShiftOrdersAfterMove: Order[] = [
  movedOrder,
  ...sampleOrders.slice(1),
];
const r1MetricsAfterMove = computeRiderLiveMetrics(
  allShiftOrdersAfterMove.filter((o) => o.rider_id === 'r1'),
  50
);
const r2MetricsAfterMove = computeRiderLiveMetrics(
  allShiftOrdersAfterMove.filter((o) => o.rider_id === 'r2'),
  0
);
// Somma totale incassi r1 + r2 = 28.50 contanti (senza alcuna duplicazione)
assert.equal(sumEuro(r1MetricsAfterMove.cashCollected, r2MetricsAfterMove.cashCollected), 28.5);

console.log('ALL RECONCILIATION, CURRENCY & LOCAL ROUTING ASSERTIONS PASSED');
