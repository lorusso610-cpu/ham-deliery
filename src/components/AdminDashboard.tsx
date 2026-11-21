import React, { useMemo, useState } from 'react';
import {
  ArrowRightLeft,
  Award,
  Banknote,
  BarChart3,
  Bike,
  CheckSquare,
  ChevronDown,
  CornerUpRight,
  CreditCard,
  FastForward,
  Globe,
  Layers,
  LayoutGrid,
  LogOut,
  Map as MapIcon,
  MapPin,
  Moon,
  Plus,
  RotateCcw,
  Search,
  Sun,
  TrendingUp,
  X,
  Zap,
} from 'lucide-react';
import {
  formatOrderMovedOrigin,
  getOrderRound,
  getPlatformTheme,
  ORDER_PLATFORMS,
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  type Order,
} from '@/types/database';
import { formatEuro, parseEuroInput, sumEuro } from '@/lib/currency';
import { computeRiderLiveMetrics } from '@/lib/reconciliation';
import { useAppStore } from '@/lib/store';
import { Badge, Button, Card, Input, Modal, cn } from '@/components/ui/primitives';
import {
  AnimatedEuro,
  AutoSaveStatusPill,
  TopProgressBar,
} from '@/components/ui/animations';
import { QuickAddOrderBar } from '@/components/QuickAddOrderBar';
import { RiderLiveCard } from '@/components/RiderLiveCard';
import { CashSettlementModal } from '@/components/CashSettlementModal';
import { QualityBarbiePanel } from '@/components/QualityBarbiePanel';
import { AnalyticsDashboard } from '@/components/AnalyticsDashboard';
import { AltamuraMap } from '@/components/AltamuraMap';
import { MoveOrderModal } from '@/components/MoveOrderModal';

type AdminTab = 'live' | 'map' | 'quality' | 'analytics';

export const AdminDashboard: React.FC = () => {
  const {
    db,
    currentUser,
    activeShift,
    riders,
    theme,
    toggleTheme,
    isRealtimeSupabase,
    logout,
    openNewShift,
    advanceShiftRound,
    resetDemoData,
    pushToast,
  } = useAppStore();

  const [activeTab, setActiveTab] = useState<AdminTab>('live');
  const [mapRiderFilter, setMapRiderFilter] = useState<string>('all');
  const [adminRoundFilter, setAdminRoundFilter] = useState<number | 'all'>('all');
  const [streetLookupQuery, setStreetLookupQuery] = useState<string>('');
  const [moveOrderTarget, setMoveOrderTarget] = useState<Order | null>(null);
  const [settlementOpen, setSettlementOpen] = useState(false);
  const [newShiftModalOpen, setNewShiftModalOpen] = useState(false);

  // Stato modale apertura nuovo turno: default fondo cassa fisso a 50,00€ modificabile per ciascun rider
  const [newShiftDate, setNewShiftDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [newShiftNotes, setNewShiftNotes] = useState('');
  const [floatDrafts, setFloatDrafts] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    riders.forEach((r) => {
      map[r.id] = '50,00';
    });
    return map;
  });

  const handleOpenNewShift = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedFloats: Record<string, number> = {};
    for (const r of riders) {
      const val = parseEuroInput(floatDrafts[r.id] ?? '0');
      if (Number.isNaN(val) || val < 0) {
        pushToast({
          title: `Fondo cassa non valido per ${r.name}`,
          variant: 'danger',
        });
        return;
      }
      parsedFloats[r.id] = val;
    }
    await openNewShift(newShiftDate, newShiftNotes, parsedFloats);
    setNewShiftModalOpen(false);
  };

  // Metriche Live del turno attivo
  const activeShiftOrders = activeShift
    ? db.orders.filter((o) => o.shift_id === activeShift.id)
    : [];
  const activeRiderShifts = activeShift
    ? db.riderShifts.filter((rs) => rs.shift_id === activeShift.id)
    : [];

  const nonCancelledShiftOrders = useMemo(
    () => activeShiftOrders.filter((o) => o.status !== 'cancelled'),
    [activeShiftOrders]
  );

  const uniqueShiftStreets = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const o of nonCancelledShiftOrders) {
      const clean = o.customer_address.trim();
      if (clean && !seen.has(clean.toLowerCase())) {
        seen.add(clean.toLowerCase());
        list.push(clean);
      }
    }
    return list.sort((a, b) => a.localeCompare(b, 'it'));
  }, [nonCancelledShiftOrders]);

  const streetLookupMatches = useMemo(() => {
    const q = streetLookupQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    return nonCancelledShiftOrders.filter((o) =>
      o.customer_address.toLowerCase().includes(q)
    );
  }, [nonCancelledShiftOrders, streetLookupQuery]);

  const currentShiftRound = useMemo(() => {
    if (!activeShift) return 1;
    return Math.max(
      1,
      activeShift.current_round ?? 1,
      ...activeRiderShifts.map((rs) => rs.current_round ?? 1),
      ...nonCancelledShiftOrders.map((o) => getOrderRound(o))
    );
  }, [activeRiderShifts, activeShift, nonCancelledShiftOrders]);

  const availableShiftRounds = useMemo(() => {
    const set = new Set<number>([1, currentShiftRound]);
    activeRiderShifts.forEach((rs) => {
      if (rs.current_round && rs.current_round >= 1) set.add(rs.current_round);
    });
    nonCancelledShiftOrders.forEach((o) => set.add(getOrderRound(o)));
    return Array.from(set).sort((a, b) => a - b);
  }, [activeRiderShifts, currentShiftRound, nonCancelledShiftOrders]);

  const filteredMapOrders = useMemo(() => {
    return nonCancelledShiftOrders.filter((o) => {
      if (mapRiderFilter !== 'all' && o.rider_id !== mapRiderFilter) return false;
      if (adminRoundFilter !== 'all' && getOrderRound(o) !== adminRoundFilter) return false;
      return true;
    });
  }, [adminRoundFilter, mapRiderFilter, nonCancelledShiftOrders]);

  const liveSummary = riders.reduce(
    (acc, r) => {
      const rs = activeRiderShifts.find((x) => x.rider_id === r.id);
      const rOrders = activeShiftOrders.filter((o) => o.rider_id === r.id);
      const m = computeRiderLiveMetrics(rOrders, rs?.initial_float ?? 0);
      acc.expectedCash = sumEuro(acc.expectedCash, m.expectedCashReturn);
      acc.pos = sumEuro(acc.pos, m.posCollected);
      acc.prepaid = sumEuro(acc.prepaid, m.platformPrepaid);
      acc.revenue = sumEuro(acc.revenue, m.totalRiderRevenue);
      acc.inFlight += m.inFlightCount;
      acc.delivered += m.deliveredCount;
      return acc;
    },
    { expectedCash: 0, pos: 0, prepaid: 0, revenue: 0, inFlight: 0, delivered: 0 }
  );

  return (
    <div className="min-h-screen bg-[#ededee] dark:bg-[#0b0b0d] text-zinc-900 dark:text-zinc-100 transition-colors">
      {/* 1. Progress Bar lineare (Top-bar) */}
      <TopProgressBar
        triggerKey={`${activeTab}-${nonCancelledShiftOrders.length}-${liveSummary.revenue}-${liveSummary.expectedCash}`}
      />

      {/* Top Navbar */}
      <header className="sticky top-0 z-30 border-b border-zinc-200/80 dark:border-zinc-800/80 bg-white/90 dark:bg-[#141417]/90 backdrop-blur-md">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-9 w-9 rounded-full bg-[#141414] text-white dark:bg-[#f4f4f6] dark:text-[#121212] flex items-center justify-center font-bold text-sm shrink-0">
              H
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-bold tracking-tight text-sm sm:text-base truncate text-zinc-950 dark:text-zinc-50">
                  HAM Cassa &amp; Delivery
                </span>
                <Badge variant={isRealtimeSupabase ? 'green' : 'neutral'} className="hidden md:inline-flex">
                  <Zap className="h-3 w-3" />
                  {isRealtimeSupabase ? 'Supabase Live' : 'Real-Time Sync'}
                </Badge>
                <AutoSaveStatusPill
                  triggerKey={nonCancelledShiftOrders.length + liveSummary.revenue + liveSummary.expectedCash}
                />
              </div>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                Operatore: <strong>{currentUser?.name}</strong>
              </p>
            </div>
          </div>

          {/* Nav Tabs Desktop (Tab Indicator Pill) */}
          <nav className="hidden md:flex items-center gap-1 p-1 rounded-full bg-[#f4f4f5] dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800">
            {[
              { id: 'live' as const, label: 'Cassa Live', icon: LayoutGrid },
              { id: 'map' as const, label: 'Mappa Altamura', icon: MapIcon },
              { id: 'quality' as const, label: 'Qualità Barbiè', icon: Award },
              { id: 'analytics' as const, label: 'Analitica & Storico', icon: BarChart3 },
            ].map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={cn(
                  'inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold transition-all duration-150',
                  activeTab === id
                    ? 'bg-[#141414] text-white dark:bg-[#f4f4f6] dark:text-[#121212] shadow-sm'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-100'
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </nav>

          {/* Actions */}
          <div className="flex items-center gap-2">
            {!isRealtimeSupabase && (
              <Button
                variant="outline"
                size="sm"
                onClick={resetDemoData}
                title="Azzera tutte le consegne e i saldi del turno"
                className="hidden sm:inline-flex rounded-full"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Azzera Turno
              </Button>
            )}
            <button
              type="button"
              onClick={toggleTheme}
              className="h-9 px-3 rounded-full border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex items-center gap-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:border-zinc-900 dark:hover:border-zinc-400 transition-colors"
              aria-label="Cambia tema"
            >
              {theme === 'dark' ? (
                <>
                  <Sun className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Light</span>
                </>
              ) : (
                <>
                  <Moon className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Dark</span>
                </>
              )}
            </button>
            <Button variant="ghost" size="sm" onClick={() => void logout()} className="rounded-full">
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Esci</span>
            </Button>
          </div>
        </div>

        {/* Mobile/Tablet Tab Bar */}
        <div className="md:hidden flex border-t border-zinc-200/80 dark:border-zinc-800 px-2 py-1.5 gap-1">
          {[
            { id: 'live' as const, label: 'Cassa', icon: LayoutGrid },
            { id: 'map' as const, label: 'Mappa', icon: MapIcon },
            { id: 'quality' as const, label: 'Barbiè', icon: Award },
            { id: 'analytics' as const, label: 'Analisi', icon: BarChart3 },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 py-2 rounded-full text-xs font-semibold transition-all',
                activeTab === id
                  ? 'bg-[#141414] text-white dark:bg-[#f4f4f6] dark:text-[#121212]'
                  : 'text-zinc-500 dark:text-zinc-400'
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-6 space-y-6">
        {activeTab === 'live' && (
          <>
            {activeShift ? (
              <>
                {/* Barra stato turno + KPI cassa live con Number Ticker */}
                <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5 flex-1">
                    {/* Card 1: Stile Weather / Clean Monochrome */}
                    <Card className="p-4 sm:p-5 erp-card-lift">
                      <div className="flex items-center justify-between text-xs font-medium text-zinc-500">
                        <span>Fatturato ({activeShift.date})</span>
                        <span className="h-7 w-7 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-900 dark:text-zinc-100">
                          <TrendingUp className="h-3.5 w-3.5" />
                        </span>
                      </div>
                      <p className="text-2xl sm:text-3xl font-light tracking-tight mt-2 text-zinc-950 dark:text-zinc-50">
                        <AnimatedEuro value={liveSummary.revenue} />
                      </p>
                      <div className="h-px bg-zinc-200/80 dark:bg-zinc-800 my-2.5" />
                      <p className="text-[11px] text-zinc-500">
                        {liveSummary.delivered} consegnati • {liveSummary.inFlight} in corso
                      </p>
                    </Card>

                    {/* Card 2: Stile "Analytics $ 2,500" Dark Monochrome Card */}
                    <Card className="p-4 sm:p-5 bg-[#141414] text-white dark:bg-[#1b1b20] border-zinc-900 dark:border-zinc-700 erp-card-lift">
                      <div className="flex items-center justify-between text-xs font-medium text-zinc-400">
                        <span>Contante da Ritirare</span>
                        <span className="h-7 w-7 rounded-full bg-white/12 flex items-center justify-center text-white">
                          <Banknote className="h-3.5 w-3.5" />
                        </span>
                      </div>
                      <p className="text-2xl sm:text-3xl font-bold tracking-tight mt-2 text-white">
                        <AnimatedEuro value={liveSummary.expectedCash} />
                      </p>
                      <div className="h-px bg-white/15 my-2.5" />
                      <p className="text-[11px] text-zinc-400">
                        Fondi cassa + contanti
                      </p>
                    </Card>

                    {/* Card 3: Totale POS Mobile */}
                    <Card className="p-4 sm:p-5 erp-card-lift">
                      <div className="flex items-center justify-between text-xs font-medium text-zinc-500">
                        <span>Totale POS Mobile</span>
                        <span className="h-7 w-7 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-900 dark:text-zinc-100">
                          <CreditCard className="h-3.5 w-3.5" />
                        </span>
                      </div>
                      <p className="text-2xl sm:text-3xl font-light tracking-tight mt-2 text-zinc-950 dark:text-zinc-50">
                        <AnimatedEuro value={liveSummary.pos} />
                      </p>
                      <div className="h-px bg-zinc-200/80 dark:bg-zinc-800 my-2.5" />
                      <p className="text-[11px] text-zinc-500">
                        Da verificare con scontrini
                      </p>
                    </Card>

                    {/* Card 4: Già Pagato Online */}
                    <Card className="p-4 sm:p-5 erp-card-lift">
                      <div className="flex items-center justify-between text-xs font-medium text-zinc-500">
                        <span>Già Pagato Online</span>
                        <span className="h-7 w-7 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-900 dark:text-zinc-100">
                          <Globe className="h-3.5 w-3.5" />
                        </span>
                      </div>
                      <p className="text-2xl sm:text-3xl font-light tracking-tight mt-2 text-zinc-950 dark:text-zinc-50">
                        <AnimatedEuro value={liveSummary.prepaid} />
                      </p>
                      <div className="h-px bg-zinc-200/80 dark:bg-zinc-800 my-2.5" />
                      <p className="text-[11px] text-zinc-500">
                        App Proprietaria / Just Eat
                      </p>
                    </Card>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      variant="primary"
                      size="lg"
                      onClick={() => setSettlementOpen(true)}
                      className="w-full xl:w-auto rounded-2xl"
                    >
                      <CheckSquare className="h-4 w-4" />
                      Chiudi Turno &amp; Riconcilia Cassa
                    </Button>
                  </div>
                </div>

                {/* Quick-Add Order Bar */}
                <QuickAddOrderBar shiftId={activeShift.id} riders={riders} />

                {/* Barra Gestione Giri (Round) + Passaggio Rapido al Round Successivo + Filtro Lista/Mappa */}
                <Card className="p-4 sm:p-5 border-zinc-200/80 dark:border-zinc-800/90 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-2 text-sm font-bold text-zinc-950 dark:text-zinc-50 mr-1">
                      <span className="h-7 w-7 rounded-full bg-[#141414] text-white dark:bg-[#f4f4f6] dark:text-[#121212] inline-flex items-center justify-center">
                        <Layers className="h-3.5 w-3.5" />
                      </span>
                      Giri di Consegna (Round)
                    </span>

                    <button
                      type="button"
                      onClick={() => setAdminRoundFilter('all')}
                      className={cn(
                        'px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all',
                        adminRoundFilter === 'all'
                          ? 'bg-[#141414] text-white dark:bg-[#f4f4f6] dark:text-[#121212] shadow-sm'
                          : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200'
                      )}
                    >
                      Tutti i Round ({nonCancelledShiftOrders.length})
                    </button>

                    {availableShiftRounds.map((rNum) => {
                      const count = nonCancelledShiftOrders.filter(
                        (o) => getOrderRound(o) === rNum
                      ).length;
                      const isSelected = adminRoundFilter === rNum;
                      const isCurrent = rNum === currentShiftRound;
                      return (
                        <button
                          key={rNum}
                          type="button"
                          onClick={() => setAdminRoundFilter(rNum)}
                          className={cn(
                            'px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all inline-flex items-center gap-1.5',
                            isSelected
                              ? 'bg-[#141414] text-white dark:bg-[#f4f4f6] dark:text-[#121212] shadow-sm'
                              : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200'
                          )}
                        >
                          <span>Round {rNum}</span>
                          <span className="opacity-75">({count})</span>
                          {isCurrent && (
                            <span
                              className="h-2 w-2 rounded-full bg-emerald-400"
                              title="Round corrente"
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {activeShift.status !== 'closed' && (
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        onClick={async () => {
                          const nextR = await advanceShiftRound(activeShift.id);
                          setAdminRoundFilter(nextR);
                        }}
                        className="rounded-full px-4 h-9"
                        title={`Storicizza il Round ${currentShiftRound}, pulisce la mappa attiva e passa al Round ${currentShiftRound + 1}`}
                      >
                        <FastForward className="h-3.5 w-3.5" />
                        Inizia Round {currentShiftRound + 1} (Nuovo Giro)
                      </Button>
                    </div>
                  )}
                </Card>

                {/* Barra Admin: Ricerca / Selezione Via ("Vedere chi ce l'ha") + Legenda Colori Canali */}
                <Card className="p-4 sm:p-5 border-zinc-200/80 dark:border-zinc-800/90 space-y-3">
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="inline-flex items-center gap-2 text-sm font-bold text-zinc-950 dark:text-zinc-50">
                        <span className="h-7 w-7 rounded-full bg-[#141414] text-white dark:bg-[#f4f4f6] dark:text-[#121212] inline-flex items-center justify-center">
                          <Search className="h-3.5 w-3.5" />
                        </span>
                        Controllo Via — Vedi chi ce l&apos;ha
                      </span>
                      <div className="flex flex-wrap items-center gap-1.5 ml-1">
                        {ORDER_PLATFORMS.map((p) => {
                          const ch = getPlatformTheme(p);
                          return (
                            <Badge key={p} variant={ch.badgeVariant} className="text-[11px]">
                              <span className={cn('h-2 w-2 rounded-full', ch.dotClass)} />
                              {ch.fullName}
                            </Badge>
                          );
                        })}
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 lg:min-w-[520px]">
                      {/* Menu a tendina vie attive nel turno */}
                      <div className="relative flex-1">
                        <MapPin className="h-3.5 w-3.5 text-zinc-500 pointer-events-none absolute left-3 top-3" />
                        <select
                          aria-label="Seleziona una via del turno per vedere chi ce l'ha"
                          value={
                            uniqueShiftStreets.some(
                              (s) => s.toLowerCase() === streetLookupQuery.trim().toLowerCase()
                            )
                              ? uniqueShiftStreets.find(
                                  (s) => s.toLowerCase() === streetLookupQuery.trim().toLowerCase()
                                ) ?? ''
                              : ''
                          }
                          onChange={(e) => setStreetLookupQuery(e.target.value)}
                          className="w-full h-9 appearance-none rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-900/80 pl-8 pr-8 text-xs font-bold text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900/20 dark:focus:ring-white/20 cursor-pointer"
                        >
                          <option value="">
                            Seleziona via del turno ({uniqueShiftStreets.length})...
                          </option>
                          {uniqueShiftStreets.map((addr) => (
                            <option key={addr} value={addr}>
                              {addr}
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="h-3.5 w-3.5 text-zinc-400 pointer-events-none absolute right-2.5 top-2.5" />
                      </div>

                      {/* Oppure ricerca testuale rapida */}
                      <div className="relative flex-1">
                        <Search className="h-3.5 w-3.5 text-zinc-400 absolute left-3 top-2.5" />
                        <Input
                          value={streetLookupQuery}
                          onChange={(e) => setStreetLookupQuery(e.target.value)}
                          placeholder="Cerca una via (es. Via Golgota)..."
                          className="h-9 pl-8 pr-8 text-xs font-semibold"
                        />
                        {streetLookupQuery && (
                          <button
                            type="button"
                            onClick={() => setStreetLookupQuery('')}
                            className="absolute right-2.5 top-2 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                            aria-label="Pulisci ricerca via"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Risultati immediati "Chi ce l'ha" */}
                  {streetLookupQuery.trim().length >= 2 && (
                    <div className="pt-2 border-t border-zinc-200 dark:border-zinc-800 space-y-2">
                      {streetLookupMatches.length === 0 ? (
                        <p className="text-xs text-zinc-500 py-1">
                          Nessuna consegna trovata per &quot;{streetLookupQuery}&quot; in questo turno.
                        </p>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                          {streetLookupMatches.map((order) => {
                            const assignedRider = riders.find((r) => r.id === order.rider_id);
                            const ch = getPlatformTheme(order.platform);
                            const orderRound = getOrderRound(order);
                            const movedOrigin = formatOrderMovedOrigin(order);
                            return (
                              <div
                                key={order.id}
                                className={cn(
                                  'rounded-2xl border p-3 flex flex-wrap items-center justify-between gap-2 text-xs',
                                  ch.rowBg,
                                  order.is_moved &&
                                    'ring-1 ring-violet-500/60 border-dashed'
                                )}
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <Badge variant="neutral" className="text-[11px] font-black">
                                      <Bike className="h-3 w-3" />
                                      CE L&apos;HA: {assignedRider ? `#${assignedRider.rider_number ?? ''} ${assignedRider.name}` : 'N/D'}
                                    </Badge>
                                    <Badge variant="neutral" className="text-[10px] font-bold">
                                      <Layers className="h-2.5 w-2.5" />
                                      Round {orderRound}
                                    </Badge>
                                    <Badge variant={ch.badgeVariant} className="text-[10px]">
                                      {ch.label}
                                    </Badge>
                                    {order.is_moved && (
                                      <Badge variant="purple" className="text-[10px] font-bold">
                                        <CornerUpRight className="h-2.5 w-2.5" />
                                        Spostata {movedOrigin ? `• ${movedOrigin}` : ''}
                                      </Badge>
                                    )}
                                    <Badge
                                      variant={
                                        order.status === 'delivered'
                                          ? 'green'
                                          : order.status === 'in_transit'
                                          ? 'blue'
                                          : 'amber'
                                      }
                                      className="text-[10px]"
                                    >
                                      {ORDER_STATUS_LABELS[order.status]}
                                    </Badge>
                                  </div>
                                  <p className="font-extrabold text-zinc-900 dark:text-zinc-50 mt-1 truncate">
                                    {order.customer_address}
                                  </p>
                                  <p className="text-[11px] text-zinc-600 dark:text-zinc-300 font-mono font-bold">
                                    {formatEuro(order.order_total)} • {PAYMENT_METHOD_LABELS[order.payment_method]}
                                  </p>
                                </div>

                                {activeShift.status !== 'closed' && (
                                  <button
                                    type="button"
                                    onClick={() => setMoveOrderTarget(order)}
                                    className="inline-flex items-center gap-1 rounded-full bg-[#141414] text-white dark:bg-white dark:text-[#141414] px-3 py-1.5 text-[11px] font-bold shrink-0 hover:opacity-90 transition-all"
                                  >
                                    <ArrowRightLeft className="h-3 w-3" />
                                    Sposta Comanda
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </Card>

                {/* Kanban / Griglia 4 Colonne Rider (Principale HAM) */}
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 items-start">
                  {riders.map((rider) => {
                    const riderShift = activeRiderShifts.find(
                      (rs) => rs.rider_id === rider.id
                    );
                    const riderOrders = activeShiftOrders.filter(
                      (o) => o.rider_id === rider.id
                    );
                    return (
                      <RiderLiveCard
                        key={rider.id}
                        shiftId={activeShift.id}
                        rider={rider}
                        riderShift={riderShift}
                        orders={riderOrders}
                        shiftIsClosed={activeShift.status === 'closed'}
                        highlightedStreetQuery={streetLookupQuery}
                        selectedRoundFilter={adminRoundFilter}
                      />
                    );
                  })}
                </div>

                {/* Sezione Principale in basso come foglio Excel: QUALITÀ / INNOVAZIONE BARBIÈ */}
                <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800">
                  <QualityBarbiePanel />
                </div>
              </>
            ) : (
              <Card className="p-10 text-center max-w-lg mx-auto my-12">
                <div className="h-14 w-14 rounded-2xl bg-amber-500/15 text-amber-500 flex items-center justify-center mx-auto mb-4">
                  <Plus className="h-7 w-7" />
                </div>
                <h2 className="text-xl font-extrabold text-zinc-900 dark:text-zinc-50">
                  Nessun turno aperto al momento
                </h2>
                <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1.5 mb-6">
                  Apri il turno giornaliero e assegna il fondo cassa iniziale (&quot;Resto&quot;)
                  ai rider attivi per iniziare a registrare le consegne.
                </p>
                <Button
                  size="lg"
                  onClick={() => {
                    const defaults: Record<string, string> = {};
                    riders.forEach((r) => {
                      defaults[r.id] = '0,00';
                    });
                    setFloatDrafts(defaults);
                    setNewShiftModalOpen(true);
                  }}
                >
                  <Plus className="h-4 w-4" />
                  Apri Nuovo Turno Serale
                </Button>
              </Card>
            )}
          </>
        )}

        {activeTab === 'map' && (
          <div className="space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-extrabold tracking-tight text-zinc-900 dark:text-zinc-50">
                  Mappa Consegne &amp; Percorsi Altamura (BA)
                </h2>
                <p className="text-xs sm:text-sm text-zinc-500 dark:text-zinc-400">
                  Filtra per Rider e per singolo Round di consegna per visualizzare il giro attivo sulla mappa.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {/* Filtro Round sulla Mappa */}
                <div className="flex flex-wrap items-center gap-1 bg-white dark:bg-[#141417] p-1 rounded-full border border-zinc-200 dark:border-zinc-800">
                  <button
                    type="button"
                    onClick={() => setAdminRoundFilter('all')}
                    className={cn(
                      'px-3 py-1 rounded-full text-xs font-semibold transition-all',
                      adminRoundFilter === 'all'
                        ? 'bg-[#141414] text-white dark:bg-white dark:text-[#121212]'
                        : 'text-zinc-600 dark:text-zinc-300'
                    )}
                  >
                    Tutti i Round
                  </button>
                  {availableShiftRounds.map((rNum) => (
                    <button
                      key={rNum}
                      type="button"
                      onClick={() => setAdminRoundFilter(rNum)}
                      className={cn(
                        'px-3 py-1 rounded-full text-xs font-semibold transition-all',
                        adminRoundFilter === rNum
                          ? 'bg-[#141414] text-white dark:bg-white dark:text-[#121212]'
                          : 'text-zinc-600 dark:text-zinc-300'
                      )}
                    >
                      Round {rNum}
                    </button>
                  ))}
                </div>

                {/* Filtro Rider sulla Mappa */}
                <div className="flex flex-wrap items-center gap-1 bg-white dark:bg-[#141417] p-1 rounded-full border border-zinc-200 dark:border-zinc-800">
                  <button
                    type="button"
                    onClick={() => setMapRiderFilter('all')}
                    className={cn(
                      'px-3 py-1 rounded-full text-xs font-semibold transition-all',
                      mapRiderFilter === 'all'
                        ? 'bg-[#141414] text-white dark:bg-white dark:text-[#121212]'
                        : 'text-zinc-600 dark:text-zinc-300'
                    )}
                  >
                    Tutti i Rider
                  </button>
                  {riders.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setMapRiderFilter(r.id)}
                      className={cn(
                        'px-3 py-1 rounded-full text-xs font-semibold transition-all',
                        mapRiderFilter === r.id
                          ? 'bg-[#141414] text-white dark:bg-white dark:text-[#121212]'
                          : 'text-zinc-600 dark:text-zinc-300'
                      )}
                    >
                      #{r.rider_number} {r.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <AltamuraMap
              key={`admin-map-${mapRiderFilter}-${adminRoundFilter}-${currentShiftRound}`}
              orders={filteredMapOrders}
              heightClass="h-[520px]"
              autoCalculateRoute={mapRiderFilter !== 'all'}
              allowOrderManagement={activeShift?.status !== 'closed'}
              title={
                mapRiderFilter === 'all'
                  ? `Consegne Altamura • ${
                      adminRoundFilter === 'all' ? 'Tutti i Round' : `Round ${adminRoundFilter}`
                    }`
                  : `Percorso Ottimale • ${
                      riders.find((r) => r.id === mapRiderFilter)?.name ?? ''
                    } (${
                      adminRoundFilter === 'all' ? 'Tutti i Round' : `Round ${adminRoundFilter}`
                    })`
              }
            />
          </div>
        )}

        {activeTab === 'quality' && <QualityBarbiePanel />}

        {activeTab === 'analytics' && <AnalyticsDashboard />}
      </main>

      {/* Modale Sposta Comanda (Round successivo o altro Rider) */}
      <MoveOrderModal
        order={moveOrderTarget}
        onClose={() => setMoveOrderTarget(null)}
      />

      {/* Modale Chiusura Turno (1-Click Settlement) */}
      {activeShift && (
        <CashSettlementModal
          open={settlementOpen}
          onClose={() => setSettlementOpen(false)}
          shift={activeShift}
          riders={riders}
          riderShifts={activeRiderShifts}
          orders={activeShiftOrders}
        />
      )}

      {/* Modale Apertura Nuovo Turno */}
      <Modal
        open={newShiftModalOpen}
        onClose={() => setNewShiftModalOpen(false)}
        title="Apri Nuovo Turno Giornaliero"
        subtitle="Imposta la data e il fondo cassa iniziale ('Resto') consegnato a ciascun rider"
        maxWidthClass="max-w-lg"
      >
        <form onSubmit={handleOpenNewShift} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400 mb-1">
                Data Turno
              </label>
              <Input
                type="date"
                value={newShiftDate}
                onChange={(e) => setNewShiftDate(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400 mb-1">
                Note Turno
              </label>
              <Input
                value={newShiftNotes}
                onChange={(e) => setNewShiftNotes(e.target.value)}
                placeholder="Es. Turno venerdì sera"
              />
            </div>
          </div>

          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-zinc-500 mb-2">
              Fondo Cassa Iniziale per Rider (€)
            </p>
            <div className="space-y-2">
              {riders.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 dark:border-zinc-800 px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="h-6 w-6 rounded-lg bg-amber-500 text-zinc-950 font-mono text-xs font-black flex items-center justify-center">
                      {r.rider_number ?? '#'}
                    </span>
                    <span className="text-sm font-bold">{r.name}</span>
                  </div>
                  <div className="relative w-28">
                    <span className="absolute left-2.5 top-2.5 text-xs font-bold text-zinc-400">
                      €
                    </span>
                    <Input
                      value={floatDrafts[r.id] ?? '0,00'}
                      onChange={(e) =>
                        setFloatDrafts((prev) => ({ ...prev, [r.id]: e.target.value }))
                      }
                      inputMode="decimal"
                      className="pl-6 text-right font-mono font-bold"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setNewShiftModalOpen(false)}
            >
              Annulla
            </Button>
            <Button type="submit">Apri Turno &amp; Inizia</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
