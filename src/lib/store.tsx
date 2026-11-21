import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  getOrderRound,
  normalizePlatform,
  type Order,
  type OrderPlatform,
  type OrderStatus,
  type PaymentMethod,
  type QualityLog,
  type RiderShift,
  type Shift,
  type User,
} from '@/types/database';
import { createInitialSeedState, type AppDatabaseState } from '@/lib/seedData';
import { recalculateRiderShiftRecord } from '@/lib/reconciliation';
import { diffEuro, fromCents, sumEuro, toCents } from '@/lib/currency';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

const STORAGE_KEY = 'ham_delivery_db_clean_v5';
const LEGACY_STORAGE_KEYS = [
  'ham_delivery_db_v1',
  'ham_delivery_db_clean_v2',
  'ham_delivery_db_clean_v3',
  'ham_delivery_db_clean_v4',
];
const CLEAN_RESET_VERSION_KEY = 'ham_clean_reset_version';
const CLEAN_RESET_VERSION = 'ham_clean_altamura_v5_float50';
const AUTH_STORAGE_KEY = 'ham_delivery_auth_user_v1';
const THEME_STORAGE_KEY = 'ham_delivery_theme_minimal_v2';
const CHANNEL_NAME = 'ham_delivery_realtime_sync';

function hasLegacyOrDemoData(state: AppDatabaseState): boolean {
  if (!state) return true;
  if (
    Array.isArray(state.orders) &&
    state.orders.some(
      (o) =>
        o.id.startsWith('30000000-') ||
        /,\s*bari\b/i.test(o.customer_address) ||
        /\b(sparano|nazario\s+sauro)\b/i.test(o.customer_address)
    )
  ) {
    return true;
  }
  if (
    Array.isArray(state.shifts) &&
    state.shifts.some((s) => s.id === '20000000-0000-0000-0000-000000000000')
  ) {
    return true;
  }
  if (
    Array.isArray(state.qualityLogs) &&
    state.qualityLogs.some((q) => q.id.startsWith('40000000-'))
  ) {
    return true;
  }
  return false;
}

export interface CreateOrderInput {
  shift_id: string;
  rider_id: string;
  customer_address: string;
  lat?: number | null;
  lng?: number | null;
  platform: OrderPlatform;
  order_total: number;
  payment_method: PaymentMethod;
  change_needed: number;
  round_number?: number;
}

export interface MoveOrderOptions {
  targetRiderId?: string;
  targetRound?: number;
}

export interface AddQualityLogInput {
  shift_id: string;
  rider_id: string;
  rating: number;
  packaging_check: boolean;
  notes: string;
  bonus_malus_amount: number;
}

export interface ToastItem {
  id: string;
  title: string;
  description?: string;
  variant?: 'default' | 'success' | 'warning' | 'danger';
}

interface AppContextValue {
  db: AppDatabaseState;
  currentUser: User | null;
  activeShift: Shift | null;
  riders: User[];
  theme: 'dark' | 'light';
  isRealtimeSupabase: boolean;
  isLoading: boolean;
  toasts: ToastItem[];
  dismissToast: (id: string) => void;
  pushToast: (toast: Omit<ToastItem, 'id'>) => void;
  toggleTheme: () => void;
  loginWithPin: (pin: string) => Promise<{ ok: boolean; error?: string; user?: User }>;
  loginAsUser: (userId: string) => Promise<{ ok: boolean; error?: string; user?: User }>;
  loginWithEmail: (
    email: string,
    password: string
  ) => Promise<{ ok: boolean; error?: string; user?: User }>;
  logout: () => Promise<void>;
  openNewShift: (
    date: string,
    notes: string,
    initialFloats: Record<string, number>
  ) => Promise<void>;
  updateRiderFloat: (shiftId: string, riderId: string, initialFloat: number) => Promise<void>;
  createOrder: (input: CreateOrderInput) => Promise<void>;
  updateOrderStatus: (
    orderId: string,
    status: OrderStatus,
    actualPaymentMethod?: PaymentMethod
  ) => Promise<void>;
  deleteOrCancelOrder: (orderId: string) => Promise<void>;
  reassignOrder: (orderId: string, newRiderId: string) => Promise<void>;
  moveOrder: (orderId: string, options: MoveOrderOptions) => Promise<void>;
  getRiderCurrentRound: (shiftId: string, riderId: string) => number;
  advanceRiderRound: (shiftId: string, riderId: string) => Promise<number>;
  advanceShiftRound: (shiftId: string) => Promise<number>;
  settleSingleRider: (
    shiftId: string,
    riderId: string,
    actualCashReturned: number
  ) => Promise<void>;
  closeShiftWithSettlement: (
    shiftId: string,
    actualCashByRider: Record<string, number>,
    notes?: string
  ) => Promise<void>;
  addQualityLog: (input: AddQualityLogInput) => Promise<void>;
  resetDemoData: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

function loadLocalDb(): AppDatabaseState {
  try {
    for (const oldKey of LEGACY_STORAGE_KEYS) {
      localStorage.removeItem(oldKey);
    }
    const resetVersion = localStorage.getItem(CLEAN_RESET_VERSION_KEY);
    if (resetVersion !== CLEAN_RESET_VERSION) {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.setItem(CLEAN_RESET_VERSION_KEY, CLEAN_RESET_VERSION);
    }
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AppDatabaseState;
      if (
        parsed &&
        Array.isArray(parsed.users) &&
        Array.isArray(parsed.shifts) &&
        !hasLegacyOrDemoData(parsed)
      ) {
        return {
          ...parsed,
          orders: Array.isArray(parsed.orders)
            ? parsed.orders.map((o) => ({
                ...o,
                platform: normalizePlatform(o.platform),
              }))
            : [],
        };
      }
    }
  } catch {
    // ignore storage errors
  }
  const seed = createInitialSeedState();
  try {
    localStorage.setItem(CLEAN_RESET_VERSION_KEY, CLEAN_RESET_VERSION);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
  } catch {
    // ignore
  }
  return seed;
}

function recomputeShiftState(state: AppDatabaseState, shiftId: string): AppDatabaseState {
  const shiftOrders = state.orders.filter((o) => o.shift_id === shiftId);
  const shiftRiders = state.users.filter((u) => u.role === 'rider' && u.is_active);

  const existingRiderShifts = state.riderShifts.filter((rs) => rs.shift_id === shiftId);
  const otherRiderShifts = state.riderShifts.filter((rs) => rs.shift_id !== shiftId);

  const updatedShiftRiderShifts: RiderShift[] = [];
  const seenRiders = new Set<string>();

  for (const rs of existingRiderShifts) {
    seenRiders.add(rs.rider_id);
    const riderOrders = shiftOrders.filter((o) => o.rider_id === rs.rider_id);
    updatedShiftRiderShifts.push(recalculateRiderShiftRecord(rs, riderOrders));
  }

  for (const r of shiftRiders) {
    if (!seenRiders.has(r.id)) {
      const riderOrders = shiftOrders.filter((o) => o.rider_id === r.id);
      const created: RiderShift = {
        id: crypto.randomUUID(),
        shift_id: shiftId,
        rider_id: r.id,
        initial_float: 50,
        cash_collected: 0,
        pos_collected: 0,
        platform_prepaid: 0,
        expected_cash_return: 50,
        actual_cash_returned: null,
        discrepancy: null,
        is_settled: false,
      };
      updatedShiftRiderShifts.push(recalculateRiderShiftRecord(created, riderOrders));
    }
  }

  const totalRevenue = sumEuro(
    ...shiftOrders.filter((o) => o.status === 'delivered').map((o) => o.order_total)
  );

  return {
    ...state,
    riderShifts: [...otherRiderShifts, ...updatedShiftRiderShifts],
    shifts: state.shifts.map((s) =>
      s.id === shiftId ? { ...s, total_revenue: totalRevenue } : s
    ),
  };
}

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [db, setDb] = useState<AppDatabaseState>(() => loadLocalDb());
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    try {
      const raw = sessionStorage.getItem(AUTH_STORAGE_KEY) || localStorage.getItem(AUTH_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as User) : null;
    } catch {
      return null;
    }
  });
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      return saved === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });
  const [isLoading, setIsLoading] = useState<boolean>(isSupabaseConfigured);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const channelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    try {
      if (!localStorage.getItem(THEME_STORAGE_KEY)) {
        setTheme('light');
        localStorage.setItem(THEME_STORAGE_KEY, 'light');
      }
    } catch {
      // ignore
    }
  }, []);

  // Purge any stale HMR / localStorage demo or Bari data immediately in open browser tabs
  useEffect(() => {
    try {
      const resetVersion = localStorage.getItem(CLEAN_RESET_VERSION_KEY);
      if (resetVersion !== CLEAN_RESET_VERSION || hasLegacyOrDemoData(db)) {
        for (const oldKey of LEGACY_STORAGE_KEYS) {
          localStorage.removeItem(oldKey);
        }
        const cleanSeed = createInitialSeedState();
        localStorage.setItem(CLEAN_RESET_VERSION_KEY, CLEAN_RESET_VERSION);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cleanSeed));
        setDb(cleanSeed);
        channelRef.current?.postMessage({ type: 'SYNC_DB', payload: cleanSeed });
      }
    } catch {
      // ignore storage errors
    }
  }, [db]);

  const pushToast = useCallback((toast: Omit<ToastItem, 'id'>) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev.slice(-3), { ...toast, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3800);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Theme application
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // ignore
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  // Local-first real-time BroadcastChannel + storage sync across browser tabs
  const commitLocalDb = useCallback(
    (updater: (prev: AppDatabaseState) => AppDatabaseState, notifyEvent?: string) => {
      setDb((prev) => {
        const next = updater(prev);
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
          channelRef.current?.postMessage({ type: 'SYNC_DB', payload: next, notifyEvent });
        } catch {
          // ignore
        }
        return next;
      });
    },
    []
  );

  // Controllo orario notturno automatico alle 01:00:
  // Salva e archivia il turno corrente nello storico e predispone la nuova giornata
  // azzerando le liste attive ma preservando il fondo cassa fisso di default a 50,00€
  useEffect(() => {
    const LAST_MIDNIGHT_RESET_KEY = 'ham_last_auto_archive_date';

    const checkMidnightReset = () => {
      const now = new Date();
      // Scatta se siamo nell'intervallo tra le 01:00 e le 01:59 di notte
      if (now.getHours() === 1) {
        const todayDateStr = now.toISOString().slice(0, 10);
        let lastReset = '';
        try {
          lastReset = localStorage.getItem(LAST_MIDNIGHT_RESET_KEY) || '';
        } catch {
          // ignore
        }

        if (lastReset !== todayDateStr) {
          try {
            localStorage.setItem(LAST_MIDNIGHT_RESET_KEY, todayDateStr);
          } catch {
            // ignore
          }

          commitLocalDb((prev) => {
            const openShift = prev.shifts.find((s) => s.status === 'open');
            if (!openShift) return prev;

            const closedAtIso = new Date().toISOString();
            // 1. Archivia il turno corrente chiudendolo
            const updatedShifts = prev.shifts.map((s) =>
              s.id === openShift.id
                ? {
                    ...s,
                    status: 'closed' as const,
                    closed_at: closedAtIso,
                    notes: s.notes
                      ? `${s.notes} [Archiviazione automatica ore 01:00]`
                      : '[Archiviazione automatica ore 01:00]',
                  }
                : s
            );

            // Storicizza i rider_shifts del turno appena chiuso
            const updatedRiderShifts = prev.riderShifts.map((rs) =>
              rs.shift_id === openShift.id
                ? {
                    ...rs,
                    actual_cash_returned:
                      rs.actual_cash_returned ?? rs.expected_cash_return,
                    discrepancy: rs.discrepancy ?? 0,
                    is_settled: true,
                  }
                : rs
            );

            // 2. Crea il nuovo turno per la nuova giornata con fondo cassa di 50,00€ intatto
            const newShiftId = crypto.randomUUID();
            const activeRiders = prev.users.filter(
              (u) => u.role === 'rider' && u.is_active
            );
            const nextShift: Shift = {
              id: newShiftId,
              date: todayDateStr,
              status: 'open',
              total_revenue: 0,
              notes: 'Apertura automatica notturna 01:00 (Fondo cassa 50,00 €)',
              created_at: new Date().toISOString(),
              closed_at: null,
              current_round: 1,
            };

            const freshRiderShifts: RiderShift[] = activeRiders.map((r) => ({
              id: crypto.randomUUID(),
              shift_id: newShiftId,
              rider_id: r.id,
              initial_float: 50,
              cash_collected: 0,
              pos_collected: 0,
              platform_prepaid: 0,
              expected_cash_return: 50,
              actual_cash_returned: null,
              discrepancy: null,
              is_settled: false,
              current_round: 1,
            }));

            return {
              ...prev,
              shifts: [nextShift, ...updatedShifts],
              riderShifts: [...updatedRiderShifts, ...freshRiderShifts],
            };
          }, 'Archiviazione automatica ore 01:00 completata');

          pushToast({
            title: 'Archiviazione Notturna 01:00',
            description:
              'Dati della serata archiviati nello storico. Nuova giornata pronta con fondo cassa 50€.',
            variant: 'success',
          });
        }
      }
    };

    // Controllo immediato al mount + ogni 30 secondi
    checkMidnightReset();
    const timer = setInterval(checkMidnightReset, 30_000);
    return () => clearInterval(timer);
  }, [commitLocalDb, pushToast]);

  useEffect(() => {
    if (isSupabaseConfigured) return;

    const bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL_NAME) : null;
    channelRef.current = bc;

    const handleBcMessage = (event: MessageEvent) => {
      if (event.data?.type === 'SYNC_DB' && event.data.payload) {
        setDb(event.data.payload as AppDatabaseState);
        if (event.data.notifyEvent) {
          pushToast({
            title: 'Aggiornamento Real-Time',
            description: String(event.data.notifyEvent),
            variant: 'success',
          });
        }
      }
    };

    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        try {
          setDb(JSON.parse(e.newValue) as AppDatabaseState);
        } catch {
          // ignore
        }
      }
    };

    bc?.addEventListener('message', handleBcMessage);
    window.addEventListener('storage', handleStorage);

    return () => {
      bc?.removeEventListener('message', handleBcMessage);
      bc?.close();
      window.removeEventListener('storage', handleStorage);
    };
  }, [pushToast]);

  // Supabase loader & real-time subscriptions when configured
  const refreshFromSupabase = useCallback(async () => {
    if (!supabase) return;
    setIsLoading(true);
    try {
      const [usersRes, shiftsRes, riderShiftsRes, ordersRes, qualityRes] = await Promise.all([
        supabase.from('users').select('*').order('rider_number', { ascending: true, nullsFirst: true }),
        supabase.from('shifts').select('*').order('created_at', { ascending: false }),
        supabase.from('rider_shifts').select('*'),
        supabase.from('orders').select('*').order('created_at', { ascending: false }),
        supabase.from('quality_logs').select('*').order('created_at', { ascending: false }),
      ]);

      setDb({
        users: (usersRes.data ?? []) as User[],
        shifts: (shiftsRes.data ?? []) as Shift[],
        riderShifts: (riderShiftsRes.data ?? []) as RiderShift[],
        orders: (ordersRes.data ?? []) as Order[],
        qualityLogs: (qualityRes.data ?? []) as QualityLog[],
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;

    void refreshFromSupabase();

    const channel = supabase
      .channel('ham-realtime-all')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        void refreshFromSupabase();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rider_shifts' }, () => {
        void refreshFromSupabase();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shifts' }, () => {
        void refreshFromSupabase();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quality_logs' }, () => {
        void refreshFromSupabase();
      })
      .subscribe();

    return () => {
      void supabase?.removeChannel(channel);
    };
  }, [refreshFromSupabase]);

  const persistSessionUser = (user: User | null) => {
    setCurrentUser(user);
    try {
      if (user) {
        const serialized = JSON.stringify(user);
        localStorage.setItem(AUTH_STORAGE_KEY, serialized);
        sessionStorage.setItem(AUTH_STORAGE_KEY, serialized);
      } else {
        sessionStorage.removeItem(AUTH_STORAGE_KEY);
        localStorage.removeItem(AUTH_STORAGE_KEY);
      }
    } catch {
      // ignore
    }
  };

  const loginAsUser = useCallback(
    async (userId: string) => {
      const found = db.users.find((u) => u.id === userId && u.is_active);
      if (!found) {
        return { ok: false, error: 'Seleziona un profilo valido dal menu a tendina.' };
      }
      persistSessionUser(found);
      return { ok: true, user: found };
    },
    [db.users]
  );

  const loginWithPin = useCallback(
    async (pin: string) => {
      const cleanPin = pin.trim();
      if (!/^\d{4}$/.test(cleanPin)) {
        return { ok: false, error: 'Inserisci un PIN valido a 4 cifre.' };
      }

      if (isSupabaseConfigured && supabase) {
        const { data, error } = await supabase.rpc('login_with_pin', { p_pin: cleanPin });
        if (error || !data || data.length === 0) {
          return { ok: false, error: 'PIN non riconosciuto o utente disattivato.' };
        }
        const user = data[0] as User;
        persistSessionUser(user);
        return { ok: true, user };
      }

      const found = db.users.find((u) => u.pin_code === cleanPin && u.is_active);
      if (!found) {
        return { ok: false, error: 'PIN errato. Verifica le 4 cifre.' };
      }
      persistSessionUser(found);
      return { ok: true, user: found };
    },
    [db.users]
  );

  const loginWithEmail = useCallback(
    async (email: string, password: string) => {
      const cleanEmail = email.trim().toLowerCase();
      if (!cleanEmail || !password) {
        return { ok: false, error: 'Inserisci email e password.' };
      }

      if (isSupabaseConfigured && supabase) {
        const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        });
        if (authErr || !authData.user) {
          return { ok: false, error: authErr?.message || 'Credenziali non valide.' };
        }
        const { data: profile } = await supabase
          .from('users')
          .select('*')
          .eq('auth_user_id', authData.user.id)
          .single();
        if (!profile) {
          return { ok: false, error: 'Profilo utente non trovato in public.users.' };
        }
        persistSessionUser(profile as User);
        return { ok: true, user: profile as User };
      }

      // Modalità Demo Locale: la password demo è il PIN dell'utente oppure "ham2026"
      const found = db.users.find(
        (u) => u.email?.toLowerCase() === cleanEmail && u.is_active
      );
      if (!found) {
        return { ok: false, error: 'Email non trovata tra gli operatori HAM.' };
      }
      if (password !== found.pin_code && password !== 'ham2026') {
        return { ok: false, error: 'Password errata (in demo usa il PIN a 4 cifre o "ham2026").' };
      }
      persistSessionUser(found);
      return { ok: true, user: found };
    },
    [db.users]
  );

  const logout = useCallback(async () => {
    if (isSupabaseConfigured && supabase) {
      await supabase.auth.signOut();
    }
    persistSessionUser(null);
  }, []);

  const openNewShift = useCallback(
    async (date: string, notes: string, initialFloats: Record<string, number>) => {
      if (isSupabaseConfigured && supabase) {
        const { data: createdShift, error } = await supabase
          .from('shifts')
          .insert({ date, notes, status: 'open', total_revenue: 0 })
          .select()
          .single();
        if (error || !createdShift) {
          pushToast({ title: 'Errore apertura turno', description: error?.message, variant: 'danger' });
          return;
        }
        const activeRiders = db.users.filter((u) => u.role === 'rider' && u.is_active);
        await supabase.from('rider_shifts').insert(
          activeRiders.map((r) => ({
            shift_id: createdShift.id,
            rider_id: r.id,
            initial_float: initialFloats[r.id] ?? 0,
          }))
        );
        await refreshFromSupabase();
        pushToast({ title: 'Nuovo turno aperto', description: `Data: ${date}`, variant: 'success' });
        return;
      }

      const newShiftId = crypto.randomUUID();
      commitLocalDb((prev) => {
        const activeRiders = prev.users.filter((u) => u.role === 'rider' && u.is_active);
        const newShift: Shift = {
          id: newShiftId,
          date,
          status: 'open',
          total_revenue: 0,
          notes,
          created_at: new Date().toISOString(),
          closed_at: null,
        };
        const newRiderShifts: RiderShift[] = activeRiders.map((r) => {
          const floatAmt = fromCents(toCents(initialFloats[r.id] ?? 50));
          return {
            id: crypto.randomUUID(),
            shift_id: newShiftId,
            rider_id: r.id,
            initial_float: floatAmt,
            cash_collected: 0,
            pos_collected: 0,
            platform_prepaid: 0,
            expected_cash_return: floatAmt,
            actual_cash_returned: null,
            discrepancy: null,
            is_settled: false,
          };
        });
        return {
          ...prev,
          shifts: [newShift, ...prev.shifts],
          riderShifts: [...prev.riderShifts, ...newRiderShifts],
        };
      }, 'Nuovo turno aperto dalla cassa');

      pushToast({ title: 'Turno aperto!', description: `Turno del ${date} pronto`, variant: 'success' });
    },
    [commitLocalDb, db.users, pushToast, refreshFromSupabase]
  );

  const updateRiderFloat = useCallback(
    async (shiftId: string, riderId: string, initialFloat: number) => {
      const cleanFloat = fromCents(toCents(Math.max(0, initialFloat)));
      if (isSupabaseConfigured && supabase) {
        await supabase
          .from('rider_shifts')
          .upsert(
            { shift_id: shiftId, rider_id: riderId, initial_float: cleanFloat },
            { onConflict: 'shift_id,rider_id' }
          );
        await refreshFromSupabase();
        pushToast({ title: 'Fondo cassa aggiornato', variant: 'success' });
        return;
      }

      commitLocalDb((prev) => {
        const exists = prev.riderShifts.some(
          (rs) => rs.shift_id === shiftId && rs.rider_id === riderId
        );
        const updated = exists
          ? prev.riderShifts.map((rs) =>
              rs.shift_id === shiftId && rs.rider_id === riderId
                ? { ...rs, initial_float: cleanFloat }
                : rs
            )
          : [
              ...prev.riderShifts,
              {
                id: crypto.randomUUID(),
                shift_id: shiftId,
                rider_id: riderId,
                initial_float: cleanFloat,
                cash_collected: 0,
                pos_collected: 0,
                platform_prepaid: 0,
                expected_cash_return: cleanFloat,
                actual_cash_returned: null,
                discrepancy: null,
                is_settled: false,
              },
            ];
        return recomputeShiftState({ ...prev, riderShifts: updated }, shiftId);
      });
      pushToast({ title: 'Fondo cassa aggiornato', variant: 'success' });
    },
    [commitLocalDb, pushToast, refreshFromSupabase]
  );

  const getRiderCurrentRound = useCallback(
    (shiftId: string, riderId: string): number => {
      const rs = db.riderShifts.find(
        (x) => x.shift_id === shiftId && x.rider_id === riderId
      );
      if (rs?.current_round && rs.current_round >= 1) {
        return Math.floor(rs.current_round);
      }
      const s = db.shifts.find((x) => x.id === shiftId);
      if (s?.current_round && s.current_round >= 1) {
        return Math.floor(s.current_round);
      }
      const riderOrders = db.orders.filter(
        (o) => o.shift_id === shiftId && o.rider_id === riderId && o.status !== 'cancelled'
      );
      if (riderOrders.length === 0) return 1;
      return Math.max(1, ...riderOrders.map((o) => getOrderRound(o)));
    },
    [db.orders, db.riderShifts, db.shifts]
  );

  const createOrder = useCallback(
    async (input: CreateOrderInput) => {
      const cleanTotal = fromCents(toCents(input.order_total));
      const cleanChange = fromCents(toCents(input.change_needed));
      const assignedRound =
        input.round_number && input.round_number >= 1
          ? Math.floor(input.round_number)
          : getRiderCurrentRound(input.shift_id, input.rider_id);

      if (isSupabaseConfigured && supabase) {
        const { error } = await supabase.from('orders').insert({
          shift_id: input.shift_id,
          rider_id: input.rider_id,
          customer_address: input.customer_address.trim(),
          lat: input.lat ?? null,
          lng: input.lng ?? null,
          platform: input.platform,
          order_total: cleanTotal,
          payment_method: input.payment_method,
          change_needed: cleanChange,
          status: 'pending',
        });
        if (error) {
          pushToast({ title: 'Errore inserimento ordine', description: error.message, variant: 'danger' });
          return;
        }
        await refreshFromSupabase();
        pushToast({
          title: `Ordine assegnato (Round ${assignedRound})`,
          description: input.customer_address,
          variant: 'success',
        });
        return;
      }

      const riderName = db.users.find((u) => u.id === input.rider_id)?.name ?? 'Rider';
      const newOrder: Order = {
        id: crypto.randomUUID(),
        shift_id: input.shift_id,
        rider_id: input.rider_id,
        customer_address: input.customer_address.trim(),
        lat: input.lat ?? null,
        lng: input.lng ?? null,
        platform: input.platform,
        order_total: cleanTotal,
        payment_method: input.payment_method,
        change_needed: cleanChange,
        status: 'pending',
        created_at: new Date().toISOString(),
        delivered_at: null,
        round_number: assignedRound,
        is_moved: false,
      };

      commitLocalDb(
        (prev) => recomputeShiftState({ ...prev, orders: [newOrder, ...prev.orders] }, input.shift_id),
        `Round ${assignedRound} • Assegnato a ${riderName}: ${input.customer_address}`
      );
      pushToast({
        title: `Round ${assignedRound} • Assegnato a ${riderName}`,
        description: input.customer_address,
        variant: 'success',
      });
    },
    [commitLocalDb, db.users, getRiderCurrentRound, pushToast, refreshFromSupabase]
  );

  const updateOrderStatus = useCallback(
    async (orderId: string, status: OrderStatus, actualPaymentMethod?: PaymentMethod) => {
      const deliveredAt = status === 'delivered' ? new Date().toISOString() : null;

      if (isSupabaseConfigured && supabase) {
        const payload: Partial<Order> = { status, delivered_at: deliveredAt };
        if (actualPaymentMethod) payload.payment_method = actualPaymentMethod;
        const { error } = await supabase.from('orders').update(payload).eq('id', orderId);
        if (error) {
          pushToast({ title: 'Errore aggiornamento ordine', description: error.message, variant: 'danger' });
          return;
        }
        await refreshFromSupabase();
        return;
      }

      let targetShiftId = '';
      let targetAddress = '';
      commitLocalDb((prev) => {
        const updatedOrders = prev.orders.map((o) => {
          if (o.id !== orderId) return o;
          targetShiftId = o.shift_id;
          targetAddress = o.customer_address;
          return {
            ...o,
            status,
            payment_method: actualPaymentMethod ?? o.payment_method,
            delivered_at: status === 'delivered' ? new Date().toISOString() : null,
          };
        });
        if (!targetShiftId) return prev;
        return recomputeShiftState({ ...prev, orders: updatedOrders }, targetShiftId);
      }, status === 'delivered' ? `Consegnato: ${targetAddress}` : undefined);

      if (status === 'delivered') {
        pushToast({
          title: 'Consegna registrata',
          description: 'Saldo cassa aggiornato in tempo reale',
          variant: 'success',
        });
      }
    },
    [commitLocalDb, pushToast, refreshFromSupabase]
  );

  const deleteOrCancelOrder = useCallback(
    async (orderId: string) => {
      if (isSupabaseConfigured && supabase) {
        const { error } = await supabase.from('orders').delete().eq('id', orderId);
        if (error) {
          pushToast({ title: 'Errore eliminazione ordine', description: error.message, variant: 'danger' });
          return;
        }
        await refreshFromSupabase();
        pushToast({ title: 'Consegna eliminata', variant: 'warning' });
        return;
      }

      let targetShiftId = '';
      let targetAddress = '';
      commitLocalDb((prev) => {
        const found = prev.orders.find((o) => o.id === orderId);
        if (!found) return prev;
        targetShiftId = found.shift_id;
        targetAddress = found.customer_address;
        const remainingOrders = prev.orders.filter((o) => o.id !== orderId);
        return recomputeShiftState({ ...prev, orders: remainingOrders }, targetShiftId);
      }, targetAddress ? `Consegna eliminata: ${targetAddress}` : undefined);
      pushToast({ title: 'Consegna eliminata', description: targetAddress || undefined, variant: 'warning' });
    },
    [commitLocalDb, pushToast, refreshFromSupabase]
  );

  const moveOrder = useCallback(
    async (orderId: string, options: MoveOrderOptions) => {
      const existing = db.orders.find((o) => o.id === orderId);
      if (!existing) return;

      const currentRound = getOrderRound(existing);
      const nextRiderId = options.targetRiderId ?? existing.rider_id;
      const nextRound =
        options.targetRound && options.targetRound >= 1
          ? Math.floor(options.targetRound)
          : currentRound;

      if (nextRiderId === existing.rider_id && nextRound === currentRound) {
        return;
      }

      const prevRiderName =
        db.users.find((u) => u.id === existing.rider_id)?.name ?? 'Rider';
      const targetRiderName =
        db.users.find((u) => u.id === nextRiderId)?.name ?? 'Rider';

      if (isSupabaseConfigured && supabase) {
        const { error } = await supabase
          .from('orders')
          .update({ rider_id: nextRiderId })
          .eq('id', orderId);
        if (error) {
          pushToast({
            title: 'Errore spostamento comanda',
            description: error.message,
            variant: 'danger',
          });
          return;
        }
        await refreshFromSupabase();
        pushToast({
          title: `Comanda spostata • ${targetRiderName} (Round ${nextRound})`,
          description: existing.customer_address,
          variant: 'success',
        });
        return;
      }

      const riderChanged = nextRiderId !== existing.rider_id;
      const roundChanged = nextRound !== currentRound;

      commitLocalDb(
        (prev) => {
          const found = prev.orders.find((o) => o.id === orderId);
          if (!found) return prev;
          const origRound = getOrderRound(found);
          const origRiderName =
            prev.users.find((u) => u.id === found.rider_id)?.name ?? prevRiderName;

          const updatedOrders = prev.orders.map((o) => {
            if (o.id !== orderId) return o;
            return {
              ...o,
              rider_id: nextRiderId,
              round_number: nextRound,
              is_moved: true,
              moved_from_rider_id: riderChanged
                ? found.rider_id
                : found.moved_from_rider_id ?? null,
              moved_from_rider_name: riderChanged
                ? origRiderName
                : found.moved_from_rider_name ?? null,
              moved_from_round: roundChanged
                ? origRound
                : found.moved_from_round ?? origRound,
              moved_at: new Date().toISOString(),
            };
          });

          return recomputeShiftState(
            { ...prev, orders: updatedOrders },
            found.shift_id
          );
        },
        `Comanda spostata a ${targetRiderName} (Round ${nextRound}): ${existing.customer_address}`
      );

      const moveDescParts: string[] = [];
      if (riderChanged) moveDescParts.push(`${prevRiderName} → ${targetRiderName}`);
      if (roundChanged) moveDescParts.push(`Round ${currentRound} → Round ${nextRound}`);

      pushToast({
        title: `Comanda spostata (${moveDescParts.join(' • ')})`,
        description: existing.customer_address,
        variant: 'success',
      });
    },
    [commitLocalDb, db.orders, db.users, pushToast, refreshFromSupabase]
  );

  const reassignOrder = useCallback(
    async (orderId: string, newRiderId: string) => {
      await moveOrder(orderId, { targetRiderId: newRiderId });
    },
    [moveOrder]
  );

  const advanceRiderRound = useCallback(
    async (shiftId: string, riderId: string): Promise<number> => {
      const currentRound = getRiderCurrentRound(shiftId, riderId);
      const nextRound = currentRound + 1;
      const riderName = db.users.find((u) => u.id === riderId)?.name ?? 'Rider';
      const nowIso = new Date().toISOString();

      commitLocalDb((prev) => {
        // 1. Marca come completate/storicizzate le consegne ancora aperte del round precedente per questo rider
        const updatedOrders = prev.orders.map((o) => {
          if (
            o.shift_id === shiftId &&
            o.rider_id === riderId &&
            getOrderRound(o) <= currentRound &&
            (o.status === 'pending' || o.status === 'in_transit')
          ) {
            return {
              ...o,
              status: 'delivered' as const,
              delivered_at: nowIso,
            };
          }
          return o;
        });

        // 2. Aggiorna current_round sul RiderShift del rider
        const hasRs = prev.riderShifts.some(
          (rs) => rs.shift_id === shiftId && rs.rider_id === riderId
        );
        const updatedRiderShifts = hasRs
          ? prev.riderShifts.map((rs) =>
              rs.shift_id === shiftId && rs.rider_id === riderId
                ? { ...rs, current_round: nextRound }
                : rs
            )
          : [
              ...prev.riderShifts,
              {
                id: crypto.randomUUID(),
                shift_id: shiftId,
                rider_id: riderId,
                initial_float: 0,
                cash_collected: 0,
                pos_collected: 0,
                platform_prepaid: 0,
                expected_cash_return: 0,
                actual_cash_returned: null,
                discrepancy: null,
                is_settled: false,
                current_round: nextRound,
              },
            ];

        // 3. Aggiorna anche il round massimo sul turno se superiore
        const updatedShifts = prev.shifts.map((s) =>
          s.id === shiftId
            ? { ...s, current_round: Math.max(s.current_round ?? 1, nextRound) }
            : s
        );

        return recomputeShiftState(
          {
            ...prev,
            orders: updatedOrders,
            riderShifts: updatedRiderShifts,
            shifts: updatedShifts,
          },
          shiftId
        );
      }, `${riderName} ha completato il Round ${currentRound} • Iniziato Round ${nextRound}`);

      pushToast({
        title: `Iniziato Round ${nextRound} (${riderName})`,
        description: `Round ${currentRound} completato e storicizzato • Mappa pulita per il nuovo giro`,
        variant: 'success',
      });

      return nextRound;
    },
    [commitLocalDb, db.users, getRiderCurrentRound, pushToast]
  );

  const advanceShiftRound = useCallback(
    async (shiftId: string): Promise<number> => {
      const shiftObj = db.shifts.find((s) => s.id === shiftId);
      const maxRiderRound = Math.max(
        1,
        shiftObj?.current_round ?? 1,
        ...db.riderShifts
          .filter((rs) => rs.shift_id === shiftId)
          .map((rs) => rs.current_round ?? 1)
      );
      const nextRound = maxRiderRound + 1;
      const nowIso = new Date().toISOString();

      commitLocalDb((prev) => {
        const updatedOrders = prev.orders.map((o) => {
          if (
            o.shift_id === shiftId &&
            getOrderRound(o) <= maxRiderRound &&
            (o.status === 'pending' || o.status === 'in_transit')
          ) {
            return {
              ...o,
              status: 'delivered' as const,
              delivered_at: nowIso,
            };
          }
          return o;
        });

        const updatedRiderShifts = prev.riderShifts.map((rs) =>
          rs.shift_id === shiftId
            ? { ...rs, current_round: Math.max(rs.current_round ?? 1, nextRound) }
            : rs
        );

        const updatedShifts = prev.shifts.map((s) =>
          s.id === shiftId ? { ...s, current_round: nextRound } : s
        );

        return recomputeShiftState(
          {
            ...prev,
            orders: updatedOrders,
            riderShifts: updatedRiderShifts,
            shifts: updatedShifts,
          },
          shiftId
        );
      }, `Chiuso Round ${maxRiderRound} • Avviato Round ${nextRound} per il turno`);

      pushToast({
        title: `Iniziato Round ${nextRound}`,
        description: `Round ${maxRiderRound} storicizzato • Mappa pronta per il nuovo giro`,
        variant: 'success',
      });

      return nextRound;
    },
    [commitLocalDb, db.riderShifts, db.shifts, pushToast]
  );

  const settleSingleRider = useCallback(
    async (shiftId: string, riderId: string, actualCashReturned: number) => {
      const cleanActual = fromCents(toCents(Math.max(0, actualCashReturned)));

      if (isSupabaseConfigured && supabase) {
        await supabase
          .from('rider_shifts')
          .update({ actual_cash_returned: cleanActual, is_settled: true })
          .eq('shift_id', shiftId)
          .eq('rider_id', riderId);
        await refreshFromSupabase();
        pushToast({ title: 'Cassa rider riconciliata', variant: 'success' });
        return;
      }

      commitLocalDb((prev) => ({
        ...prev,
        riderShifts: prev.riderShifts.map((rs) =>
          rs.shift_id === shiftId && rs.rider_id === riderId
            ? {
                ...rs,
                actual_cash_returned: cleanActual,
                discrepancy: diffEuro(cleanActual, rs.expected_cash_return),
                is_settled: true,
              }
            : rs
        ),
      }));
      pushToast({ title: 'Cassa rider riconciliata', variant: 'success' });
    },
    [commitLocalDb, pushToast, refreshFromSupabase]
  );

  const closeShiftWithSettlement = useCallback(
    async (shiftId: string, actualCashByRider: Record<string, number>, notes?: string) => {
      if (isSupabaseConfigured && supabase) {
        const sb = supabase;
        const entries = Object.entries(actualCashByRider);
        await Promise.all(
          entries.map(([riderId, cash]) =>
            sb
              .from('rider_shifts')
              .update({
                actual_cash_returned: fromCents(toCents(Math.max(0, cash))),
                is_settled: true,
              })
              .eq('shift_id', shiftId)
              .eq('rider_id', riderId)
          )
        );
        await sb
          .from('shifts')
          .update({
            status: 'closed',
            closed_at: new Date().toISOString(),
            ...(notes !== undefined ? { notes } : {}),
          })
          .eq('id', shiftId);
        await refreshFromSupabase();
        pushToast({ title: 'Turno chiuso e salvato nello storico', variant: 'success' });
        return;
      }

      commitLocalDb(
        (prev) => ({
          ...prev,
          riderShifts: prev.riderShifts.map((rs) => {
            if (rs.shift_id !== shiftId) return rs;
            const counted =
              actualCashByRider[rs.rider_id] !== undefined
                ? fromCents(toCents(Math.max(0, actualCashByRider[rs.rider_id])))
                : rs.actual_cash_returned ?? rs.expected_cash_return;
            return {
              ...rs,
              actual_cash_returned: counted,
              discrepancy: diffEuro(counted, rs.expected_cash_return),
              is_settled: true,
            };
          }),
          shifts: prev.shifts.map((s) =>
            s.id === shiftId
              ? {
                  ...s,
                  status: 'closed',
                  closed_at: new Date().toISOString(),
                  notes: notes !== undefined ? notes : s.notes,
                }
              : s
          ),
        }),
        'Turno chiuso dalla cassa'
      );
      pushToast({ title: 'Turno chiuso e salvato nello storico!', variant: 'success' });
    },
    [commitLocalDb, pushToast, refreshFromSupabase]
  );

  const addQualityLog = useCallback(
    async (input: AddQualityLogInput) => {
      const cleanBonus = fromCents(toCents(input.bonus_malus_amount));

      if (isSupabaseConfigured && supabase) {
        const { error } = await supabase.from('quality_logs').insert({
          shift_id: input.shift_id,
          rider_id: input.rider_id,
          rating: input.rating,
          packaging_check: input.packaging_check,
          notes: input.notes.trim(),
          bonus_malus_amount: cleanBonus,
        });
        if (error) {
          pushToast({ title: 'Errore salvataggio Barbiè', description: error.message, variant: 'danger' });
          return;
        }
        await refreshFromSupabase();
        pushToast({ title: 'Valutazione Qualità Barbiè salvata', variant: 'success' });
        return;
      }

      const log: QualityLog = {
        id: crypto.randomUUID(),
        shift_id: input.shift_id,
        rider_id: input.rider_id,
        rating: input.rating,
        packaging_check: input.packaging_check,
        notes: input.notes.trim(),
        bonus_malus_amount: cleanBonus,
        created_at: new Date().toISOString(),
      };
      commitLocalDb((prev) => ({
        ...prev,
        qualityLogs: [log, ...prev.qualityLogs],
      }));
      pushToast({ title: 'Valutazione Qualità Barbiè registrata', variant: 'success' });
    },
    [commitLocalDb, pushToast, refreshFromSupabase]
  );

  const resetDemoData = useCallback(() => {
    if (isSupabaseConfigured) return;
    const fresh = createInitialSeedState();
    setDb(fresh);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
      channelRef.current?.postMessage({ type: 'SYNC_DB', payload: fresh });
    } catch {
      // ignore
    }
    pushToast({
      title: 'Dati turno azzerati',
      description: 'Tutti i saldi e le consegne sono stati riportati a zero',
      variant: 'default',
    });
  }, [pushToast]);

  const activeShift = useMemo(
    () => db.shifts.find((s) => s.status === 'open') ?? null,
    [db.shifts]
  );

  const riders = useMemo(
    () =>
      db.users
        .filter((u) => u.role === 'rider' && u.is_active)
        .sort((a, b) => (a.rider_number ?? 99) - (b.rider_number ?? 99)),
    [db.users]
  );

  const value: AppContextValue = {
    db,
    currentUser,
    activeShift,
    riders,
    theme,
    isRealtimeSupabase: isSupabaseConfigured,
    isLoading,
    toasts,
    dismissToast,
    pushToast,
    toggleTheme,
    loginWithPin,
    loginAsUser,
    loginWithEmail,
    logout,
    openNewShift,
    updateRiderFloat,
    createOrder,
    updateOrderStatus,
    deleteOrCancelOrder,
    reassignOrder,
    moveOrder,
    getRiderCurrentRound,
    advanceRiderRound,
    advanceShiftRound,
    settleSingleRider,
    closeShiftWithSettlement,
    addQualityLog,
    resetDemoData,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export function useAppStore(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error('useAppStore must be used inside AppProvider');
  }
  return ctx;
}
