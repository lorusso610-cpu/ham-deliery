import type { Order, QualityLog, RiderShift, Shift, User } from '@/types/database';

export interface AppDatabaseState {
  users: User[];
  shifts: Shift[];
  riderShifts: RiderShift[];
  orders: Order[];
  qualityLogs: QualityLog[];
}

const todayIso = () => new Date().toISOString().slice(0, 10);

export function createInitialSeedState(): AppDatabaseState {
  const shiftId = '20000000-0000-0000-0000-000000000001';

  const users: User[] = [
    {
      id: '10000000-0000-0000-0000-000000000001',
      name: 'Cassa HAM (Admin)',
      email: 'admin@hamlocale.it',
      pin_code: '0000',
      role: 'admin',
      rider_number: null,
      is_active: true,
    },
    {
      id: '10000000-0000-0000-0000-000000000002',
      name: 'MarcoGrande',
      email: 'marcogrande@hamlocale.it',
      pin_code: '1111',
      role: 'rider',
      rider_number: 1,
      is_active: true,
    },
    {
      id: '10000000-0000-0000-0000-000000000003',
      name: 'Lil Marco',
      email: 'lilmarco@hamlocale.it',
      pin_code: '2222',
      role: 'rider',
      rider_number: 2,
      is_active: true,
    },
    {
      id: '10000000-0000-0000-0000-000000000004',
      name: 'AntoLor',
      email: 'antolor@hamlocale.it',
      pin_code: '3333',
      role: 'rider',
      rider_number: 3,
      is_active: true,
    },
    {
      id: '10000000-0000-0000-0000-000000000005',
      name: 'Carlo',
      email: 'carlo@hamlocale.it',
      pin_code: '4444',
      role: 'rider',
      rider_number: 4,
      is_active: true,
    },
  ];

  // Nessun ordine di prova / finto pre-caricato
  const orders: Order[] = [];

  // Tutti i rider partono con il fondo cassa fisso di default a € 50,00 e Round 1 attivo
  const riderShifts: RiderShift[] = [
    {
      id: '40000000-0000-0000-0000-000000000001',
      shift_id: shiftId,
      rider_id: '10000000-0000-0000-0000-000000000002',
      initial_float: 50,
      cash_collected: 0,
      pos_collected: 0,
      platform_prepaid: 0,
      expected_cash_return: 50,
      actual_cash_returned: null,
      discrepancy: null,
      is_settled: false,
      current_round: 1,
    },
    {
      id: '40000000-0000-0000-0000-000000000002',
      shift_id: shiftId,
      rider_id: '10000000-0000-0000-0000-000000000003',
      initial_float: 50,
      cash_collected: 0,
      pos_collected: 0,
      platform_prepaid: 0,
      expected_cash_return: 50,
      actual_cash_returned: null,
      discrepancy: null,
      is_settled: false,
      current_round: 1,
    },
    {
      id: '40000000-0000-0000-0000-000000000003',
      shift_id: shiftId,
      rider_id: '10000000-0000-0000-0000-000000000004',
      initial_float: 50,
      cash_collected: 0,
      pos_collected: 0,
      platform_prepaid: 0,
      expected_cash_return: 50,
      actual_cash_returned: null,
      discrepancy: null,
      is_settled: false,
      current_round: 1,
    },
    {
      id: '40000000-0000-0000-0000-000000000004',
      shift_id: shiftId,
      rider_id: '10000000-0000-0000-0000-000000000005',
      initial_float: 50,
      cash_collected: 0,
      pos_collected: 0,
      platform_prepaid: 0,
      expected_cash_return: 50,
      actual_cash_returned: null,
      discrepancy: null,
      is_settled: false,
      current_round: 1,
    },
  ];

  const shifts: Shift[] = [
    {
      id: shiftId,
      date: todayIso(),
      status: 'open',
      total_revenue: 0,
      notes: '',
      created_at: new Date().toISOString(),
      closed_at: null,
      current_round: 1,
    },
  ];

  const qualityLogs: QualityLog[] = [];

  return {
    users,
    shifts,
    riderShifts,
    orders,
    qualityLogs,
  };
}
