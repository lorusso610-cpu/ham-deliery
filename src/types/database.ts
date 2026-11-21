export type UserRole = 'admin' | 'rider';

export type ShiftStatus = 'open' | 'closed';

export type OrderPlatform =
  | 'App'
  | 'Gestionale'
  | 'JustEat'
  | 'Diretto/Telefono'
  | 'Glovo'
  | 'Deliveroo'
  | 'Altro';

export type CanonicalOrderPlatform = 'App' | 'Gestionale' | 'JustEat';

export type PaymentMethod = 'cash' | 'pos_rider' | 'prepaid_platform';

export type OrderStatus = 'pending' | 'in_transit' | 'delivered' | 'cancelled';

export interface User {
  id: string;
  name: string;
  email: string | null;
  pin_code: string;
  role: UserRole;
  rider_number: number | null;
  is_active: boolean;
  created_at?: string;
}

export interface Shift {
  id: string;
  date: string;
  status: ShiftStatus;
  total_revenue: number;
  notes: string;
  created_at: string;
  closed_at: string | null;
  current_round?: number;
}

export interface RiderShift {
  id: string;
  shift_id: string;
  rider_id: string;
  initial_float: number;
  cash_collected: number;
  pos_collected: number;
  platform_prepaid: number;
  expected_cash_return: number;
  actual_cash_returned: number | null;
  discrepancy: number | null;
  is_settled: boolean;
  current_round?: number;
}

export interface Order {
  id: string;
  shift_id: string;
  rider_id: string;
  customer_address: string;
  lat?: number | null;
  lng?: number | null;
  platform: OrderPlatform;
  order_total: number;
  payment_method: PaymentMethod;
  change_needed: number;
  status: OrderStatus;
  created_at: string;
  delivered_at: string | null;
  round_number?: number;
  is_moved?: boolean;
  moved_from_rider_id?: string | null;
  moved_from_rider_name?: string | null;
  moved_from_round?: number | null;
  moved_at?: string | null;
}

export function getOrderRound(order: Pick<Order, 'round_number'>): number {
  const r = Number(order.round_number);
  return Number.isFinite(r) && r >= 1 ? Math.floor(r) : 1;
}

export function formatOrderMovedOrigin(order: Order): string | null {
  if (!order.is_moved) return null;
  const currentRound = getOrderRound(order);
  const fromRider = order.moved_from_rider_name?.trim();
  const fromRound = order.moved_from_round;

  if (fromRider && fromRound && fromRound !== currentRound) {
    return `Da ${fromRider} • R${fromRound} → R${currentRound}`;
  }
  if (fromRider) {
    return `Da ${fromRider}`;
  }
  if (fromRound && fromRound !== currentRound) {
    return `Da Round ${fromRound} → Round ${currentRound}`;
  }
  return 'Comanda Spostata';
}

export interface QualityLog {
  id: string;
  shift_id: string;
  rider_id: string;
  rating: number;
  packaging_check: boolean;
  notes: string;
  bonus_malus_amount: number;
  created_at: string;
}

export const ORDER_PLATFORMS: CanonicalOrderPlatform[] = [
  'App',
  'Gestionale',
  'JustEat',
];

export interface ChannelTheme {
  canonical: CanonicalOrderPlatform;
  label: string;
  fullName: string;
  badgeVariant: 'blue' | 'yellow' | 'orange';
  rowBg: string;
  cardBorder: string;
  textClass: string;
  dotClass: string;
  barClass: string;
  activeButtonClass: string;
  hexColor: string;
}

export function normalizePlatform(platform: OrderPlatform | string): CanonicalOrderPlatform {
  if (platform === 'App' || platform === 'Glovo' || platform === 'Deliveroo') {
    return 'App';
  }
  if (platform === 'JustEat' || platform === 'Just Eat') {
    return 'JustEat';
  }
  return 'Gestionale';
}

export function getPlatformTheme(platform: OrderPlatform | string): ChannelTheme {
  const canonical = normalizePlatform(platform);

  if (canonical === 'App') {
    return {
      canonical: 'App',
      label: 'App',
      fullName: 'App Proprietaria',
      badgeVariant: 'blue',
      rowBg:
        'bg-blue-500/10 dark:bg-blue-500/15 border-blue-500/40 border-l-4 border-l-blue-500 hover:bg-blue-500/15',
      cardBorder:
        'border-l-4 border-l-blue-500 border-blue-500/40 bg-blue-500/5 dark:bg-blue-500/10',
      textClass: 'text-blue-700 dark:text-blue-300',
      dotClass: 'bg-blue-500',
      barClass: 'bg-blue-500',
      activeButtonClass: 'bg-blue-600 text-white border-blue-600 shadow-sm',
      hexColor: '#3b82f6',
    };
  }

  if (canonical === 'JustEat') {
    return {
      canonical: 'JustEat',
      label: 'Just Eat',
      fullName: 'Just Eat',
      badgeVariant: 'orange',
      rowBg:
        'bg-orange-500/10 dark:bg-orange-500/15 border-orange-500/40 border-l-4 border-l-orange-500 hover:bg-orange-500/15',
      cardBorder:
        'border-l-4 border-l-orange-500 border-orange-500/40 bg-orange-500/5 dark:bg-orange-500/10',
      textClass: 'text-orange-700 dark:text-orange-300',
      dotClass: 'bg-orange-500',
      barClass: 'bg-orange-500',
      activeButtonClass: 'bg-orange-500 text-zinc-950 border-orange-500 shadow-sm',
      hexColor: '#f97316',
    };
  }

  return {
    canonical: 'Gestionale',
    label: 'Gestionale',
    fullName: 'Gestionale',
    badgeVariant: 'yellow',
    rowBg:
      'bg-yellow-400/15 dark:bg-yellow-500/15 border-yellow-500/45 border-l-4 border-l-yellow-400 hover:bg-yellow-400/20',
    cardBorder:
      'border-l-4 border-l-yellow-400 border-yellow-500/45 bg-yellow-400/10 dark:bg-yellow-500/10',
    textClass: 'text-yellow-800 dark:text-yellow-300',
    dotClass: 'bg-yellow-400',
    barClass: 'bg-yellow-400',
    activeButtonClass: 'bg-yellow-400 text-zinc-950 border-yellow-500 shadow-sm',
    hexColor: '#eab308',
  };
}

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Contanti',
  pos_rider: 'POS Mobile',
  prepaid_platform: 'Già Pagato Online',
};

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'In Attesa',
  in_transit: 'In Consegna',
  delivered: 'Consegnato',
  cancelled: 'Annullato',
};
