import type { Order, RiderShift } from '@/types/database';
import { diffEuro, fromCents, toCents } from '@/lib/currency';

export interface RiderLiveMetrics {
  cashCollected: number;
  posCollected: number;
  platformPrepaid: number;
  gestPlusResto: number;
  expectedCashReturn: number;
  deliveredCount: number;
  inFlightCount: number;
  inFlightCashExpected: number;
  inFlightPosExpected: number;
  inFlightPlatformExpected: number;
  totalRiderRevenue: number;
}

/**
 * Motore di Riconciliazione Cassa Automatico (Zero errori algebrici):
 * - prepaid_platform -> incrementa fatturato locale + platform_prepaid, somma 0 € al contante dovuto
 * - pos_rider        -> incrementa pos_collected (da verificare con scontrino POS), somma 0 € al contante dovuto
 * - cash             -> incrementa cash_collected e quindi expected_cash_return
 * - Da versare in contanti = Fondo Cassa Iniziale (initial_float) + Contanti Incassati (cash_collected)
 */
export function computeRiderLiveMetrics(
  orders: Order[],
  initialFloat: number
): RiderLiveMetrics {
  let cashCents = 0;
  let posCents = 0;
  let prepaidCents = 0;
  let deliveredCount = 0;

  let inFlightCount = 0;
  let inFlightCashCents = 0;
  let inFlightPosCents = 0;
  let inFlightPrepaidCents = 0;

  for (const order of orders) {
    if (order.status === 'cancelled') continue;

    const totalCents = toCents(order.order_total);

    if (order.status === 'delivered') {
      deliveredCount += 1;
      if (order.payment_method === 'cash') {
        cashCents += totalCents;
      } else if (order.payment_method === 'pos_rider') {
        posCents += totalCents;
      } else if (order.payment_method === 'prepaid_platform') {
        prepaidCents += totalCents;
      }
    } else {
      // pending o in_transit
      inFlightCount += 1;
      if (order.payment_method === 'cash') {
        inFlightCashCents += totalCents;
      } else if (order.payment_method === 'pos_rider') {
        inFlightPosCents += totalCents;
      } else if (order.payment_method === 'prepaid_platform') {
        inFlightPrepaidCents += totalCents;
      }
    }
  }

  const floatCents = toCents(initialFloat);
  const gestPlusRestoCents = floatCents + cashCents + posCents;
  const expectedCashReturnCents = gestPlusRestoCents - posCents;
  const totalRevenueCents = cashCents + posCents + prepaidCents;

  return {
    cashCollected: fromCents(cashCents),
    posCollected: fromCents(posCents),
    platformPrepaid: fromCents(prepaidCents),
    gestPlusResto: fromCents(gestPlusRestoCents),
    expectedCashReturn: fromCents(expectedCashReturnCents),
    deliveredCount,
    inFlightCount,
    inFlightCashExpected: fromCents(inFlightCashCents),
    inFlightPosExpected: fromCents(inFlightPosCents),
    inFlightPlatformExpected: fromCents(inFlightPrepaidCents),
    totalRiderRevenue: fromCents(totalRevenueCents),
  };
}

export type DiscrepancyLevel = 'pending' | 'exact' | 'shortage' | 'surplus';

export interface DiscrepancyBadgeInfo {
  level: DiscrepancyLevel;
  discrepancy: number | null;
  label: string;
}

/**
 * Calcola stato badge riconciliazione:
 * - Verde se discrepancy == 0 ("Quadra")
 * - Rosso se discrepancy < 0 ("Mancano € X,XX")
 * - Giallo se discrepancy > 0 ("Eccedenza / Mancia +€ X,XX")
 */
export function evaluateDiscrepancy(
  expectedCashReturn: number,
  actualCashReturned: number | null | undefined
): DiscrepancyBadgeInfo {
  if (actualCashReturned === null || actualCashReturned === undefined || Number.isNaN(actualCashReturned)) {
    return {
      level: 'pending',
      discrepancy: null,
      label: 'Da contare',
    };
  }

  const diff = diffEuro(actualCashReturned, expectedCashReturn);
  const diffCents = toCents(diff);

  if (diffCents === 0) {
    return {
      level: 'exact',
      discrepancy: 0,
      label: 'Quadra',
    };
  }
  if (diffCents < 0) {
    return {
      level: 'shortage',
      discrepancy: diff,
      label: 'Ammanco',
    };
  }
  return {
    level: 'surplus',
    discrepancy: diff,
    label: 'Eccedenza / Mancia',
  };
}

/**
 * Ricalcola un record RiderShift dagli ordini del turno in modo deterministico.
 */
export function recalculateRiderShiftRecord(
  riderShift: RiderShift,
  riderOrders: Order[]
): RiderShift {
  const metrics = computeRiderLiveMetrics(riderOrders, riderShift.initial_float);
  const discrepancy =
    riderShift.actual_cash_returned !== null
      ? diffEuro(riderShift.actual_cash_returned, metrics.expectedCashReturn)
      : null;

  return {
    ...riderShift,
    cash_collected: metrics.cashCollected,
    pos_collected: metrics.posCollected,
    platform_prepaid: metrics.platformPrepaid,
    expected_cash_return: metrics.expectedCashReturn,
    discrepancy,
  };
}
