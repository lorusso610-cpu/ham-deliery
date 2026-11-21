import React, { useMemo, useState } from 'react';
import {
  ArrowRightLeft,
  Banknote,
  CheckCircle2,
  Clock,
  CornerUpRight,
  CreditCard,
  FastForward,
  Globe,
  Layers,
  LogOut,
  Map,
  MapPin,
  Moon,
  PackageOpen,
  Sun,
  Truck,
} from 'lucide-react';
import {
  formatOrderMovedOrigin,
  getOrderRound,
  getPlatformTheme,
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  type Order,
  type PaymentMethod,
} from '@/types/database';
import { formatEuro } from '@/lib/currency';
import { useAppStore } from '@/lib/store';
import { Badge, Button, Card, Modal, cn } from '@/components/ui/primitives';
import { CopyToClipboardButton, TopProgressBar } from '@/components/ui/animations';
import { AltamuraMap } from '@/components/AltamuraMap';
import { RiderAddDeliverySection } from '@/components/RiderAddDeliverySection';
import { MoveOrderModal } from '@/components/MoveOrderModal';

export const RiderMobileView: React.FC = () => {
  const {
    db,
    currentUser,
    activeShift,
    theme,
    toggleTheme,
    logout,
    updateOrderStatus,
    getRiderCurrentRound,
    advanceRiderRound,
  } = useAppStore();

  const [tab, setTab] = useState<'todo' | 'add' | 'map' | 'done'>('todo');
  const [selectedRoundFilter, setSelectedRoundFilter] = useState<number | 'all'>('all');
  const [confirmOrder, setConfirmOrder] = useState<Order | null>(null);
  const [moveOrderTarget, setMoveOrderTarget] = useState<Order | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod>('cash');
  const [submitting, setSubmitting] = useState(false);

  if (!currentUser) return null;

  const currentRound = activeShift
    ? getRiderCurrentRound(activeShift.id, currentUser.id)
    : 1;

  const myShiftOrders = useMemo(
    () =>
      activeShift
        ? db.orders.filter(
            (o) =>
              o.shift_id === activeShift.id &&
              o.rider_id === currentUser.id &&
              o.status !== 'cancelled'
          )
        : [],
    [activeShift, currentUser.id, db.orders]
  );

  // Tutti i Round esistenti o attivi per questo rider
  const availableRounds = useMemo(() => {
    const set = new Set<number>([1, currentRound]);
    myShiftOrders.forEach((o) => set.add(getOrderRound(o)));
    return Array.from(set).sort((a, b) => a - b);
  }, [currentRound, myShiftOrders]);

  // Filtro per singolo Round (se selezionato)
  const filteredShiftOrders = useMemo(() => {
    if (selectedRoundFilter === 'all') return myShiftOrders;
    return myShiftOrders.filter((o) => getOrderRound(o) === selectedRoundFilter);
  }, [myShiftOrders, selectedRoundFilter]);

  const todoOrders = useMemo(
    () =>
      filteredShiftOrders.filter(
        (o) => o.status === 'pending' || o.status === 'in_transit'
      ),
    [filteredShiftOrders]
  );
  const doneOrders = useMemo(
    () => filteredShiftOrders.filter((o) => o.status === 'delivered'),
    [filteredShiftOrders]
  );

  // Ordini per la Mappa: se l'utente ha selezionato un Round specifico mostra quello;
  // se è su "Tutti", mostra comunque solo le consegne attive (o del Round selezionato)
  const mapOrders = useMemo(() => {
    if (selectedRoundFilter !== 'all') {
      return myShiftOrders.filter((o) => getOrderRound(o) === selectedRoundFilter);
    }
    return myShiftOrders.filter(
      (o) =>
        (o.status === 'pending' || o.status === 'in_transit') &&
        getOrderRound(o) === currentRound
    );
  }, [currentRound, myShiftOrders, selectedRoundFilter]);

  const currentRoundActiveCount = useMemo(
    () =>
      myShiftOrders.filter(
        (o) =>
          getOrderRound(o) === currentRound &&
          (o.status === 'pending' || o.status === 'in_transit')
      ).length,
    [currentRound, myShiftOrders]
  );

  const handleAdvanceRound = async () => {
    if (!activeShift) return;
    const nextRound = await advanceRiderRound(activeShift.id, currentUser.id);
    // Passa automaticamente il filtro sul nuovo Round così lista e mappa sono subito pulite per il nuovo giro
    setSelectedRoundFilter(nextRound);
  };

  const openDeliveryConfirm = (order: Order) => {
    setConfirmOrder(order);
    setSelectedMethod(order.payment_method);
  };

  const handleConfirmDelivery = async () => {
    if (!confirmOrder) return;
    setSubmitting(true);
    await updateOrderStatus(confirmOrder.id, 'delivered', selectedMethod);
    setSubmitting(false);
    setConfirmOrder(null);
  };

  return (
    <div className="min-h-screen bg-[#ededee] dark:bg-[#0b0b0d] text-zinc-900 dark:text-zinc-100 pb-24 transition-colors">
      <TopProgressBar
        triggerKey={`${tab}-${currentRound}-${selectedRoundFilter}-${todoOrders.length}-${doneOrders.length}`}
      />
      <div className="max-w-md mx-auto">
        {/* Header compatto mobile-first */}
        <header className="sticky top-0 z-20 bg-white/90 dark:bg-[#141417]/90 backdrop-blur-md border-b border-zinc-200/80 dark:border-zinc-800/80 px-4 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-9 w-9 rounded-full bg-[#141414] text-white dark:bg-[#f4f4f6] dark:text-[#121212] font-bold flex items-center justify-center shrink-0">
              {currentUser.rider_number ?? 'R'}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="font-bold text-base tracking-tight truncate text-zinc-950 dark:text-zinc-50">
                  {currentUser.name}
                </h1>
                <Badge key={currentRound} variant="neutral" className="text-[10px] font-bold animate-badge-pop">
                  <Layers className="h-3 w-3" />
                  Round {currentRound}
                </Badge>
              </div>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                {activeShift ? `Turno ${activeShift.date} • Live` : 'Nessun turno aperto'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={toggleTheme}
              className="h-9 px-3 rounded-full border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex items-center gap-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-300"
              aria-label="Cambia tema"
            >
              {theme === 'dark' ? (
                <>
                  <Sun className="h-3.5 w-3.5" />
                  <span>Light</span>
                </>
              ) : (
                <>
                  <Moon className="h-3.5 w-3.5" />
                  <span>Dark</span>
                </>
              )}
            </button>
            <Button variant="ghost" size="sm" onClick={() => void logout()} className="rounded-full">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </header>

        <div className="p-4 space-y-4">
          {/* BARRA GESTIONE GIRI (ROUND) + PASSAGGIO RAPIDO AL ROUND SUCCESSIVO */}
          {activeShift && (
            <Card className="overflow-hidden rounded-[26px] p-0 border-zinc-200/80 dark:border-zinc-800/90">
              <div className="bg-[#141414] text-white px-4 py-3.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                    <Layers className="h-3 w-3" />
                    <span>Giro Attivo • Serata Corrente</span>
                  </div>
                  <p className="text-base font-bold text-white mt-0.5">
                    Round {currentRound}{' '}
                    <span className="text-xs font-normal text-zinc-400">
                      ({currentRoundActiveCount} {currentRoundActiveCount === 1 ? 'via attiva' : 'vie attive'})
                    </span>
                  </p>
                </div>

                {/* Pulsante ben visibile per chiudere il giro corrente e passare al successivo */}
                <button
                  type="button"
                  onClick={() => void handleAdvanceRound()}
                  className="inline-flex items-center gap-1.5 rounded-full bg-white text-[#141414] hover:bg-zinc-200 px-3.5 py-2 text-xs font-bold shadow-sm transition-all active:scale-95 shrink-0"
                  title={`Chiude e storicizza il Round ${currentRound}, pulisce la mappa e avvia il Round ${currentRound + 1}`}
                >
                  <FastForward className="h-3.5 w-3.5" />
                  <span>Inizia Round {currentRound + 1}</span>
                </button>
              </div>

              {/* Filtro rapido per singolo Round (Lista + Mappa) */}
              <div className="px-3.5 py-2.5 bg-white dark:bg-[#141417] flex items-center gap-1.5 overflow-x-auto">
                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 mr-1 shrink-0">
                  Filtra Giro:
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedRoundFilter('all')}
                  className={cn(
                    'px-3 py-1 rounded-full text-xs font-semibold transition-all shrink-0',
                    selectedRoundFilter === 'all'
                      ? 'bg-[#141414] text-white dark:bg-white dark:text-[#121212]'
                      : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300'
                  )}
                >
                  Tutti ({myShiftOrders.length})
                </button>
                {availableRounds.map((rNum) => {
                  const rOrders = myShiftOrders.filter((o) => getOrderRound(o) === rNum);
                  const isCurrent = rNum === currentRound;
                  const isSelected = selectedRoundFilter === rNum;
                  return (
                    <button
                      key={rNum}
                      type="button"
                      onClick={() => setSelectedRoundFilter(rNum)}
                      className={cn(
                        'px-3 py-1 rounded-full text-xs font-semibold transition-all shrink-0 inline-flex items-center gap-1',
                        isSelected
                          ? 'bg-[#141414] text-white dark:bg-white dark:text-[#121212]'
                          : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300'
                      )}
                    >
                      <span>Round {rNum}</span>
                      <span className="opacity-75">({rOrders.length})</span>
                      {isCurrent && (
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" title="Round in corso" />
                      )}
                    </button>
                  );
                })}
              </div>
            </Card>
          )}

          {/* Switch Attive / Aggiungi / Mappa Giro / Fatte */}
          <div className="grid grid-cols-4 gap-1.5 p-1 rounded-full bg-white dark:bg-[#141417] border border-zinc-200/80 dark:border-zinc-800 shadow-sm">
            <button
              type="button"
              onClick={() => setTab('todo')}
              className={cn(
                'py-2.5 rounded-full text-xs font-semibold transition-all duration-150',
                tab === 'todo'
                  ? 'bg-[#141414] text-white dark:bg-[#f4f4f6] dark:text-[#121212] shadow-sm'
                  : 'text-zinc-600 dark:text-zinc-400'
              )}
            >
              Attive ({todoOrders.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('add')}
              className={cn(
                'py-2.5 rounded-full text-xs font-semibold transition-all duration-150',
                tab === 'add'
                  ? 'bg-[#141414] text-white dark:bg-[#f4f4f6] dark:text-[#121212] shadow-sm'
                  : 'text-zinc-600 dark:text-zinc-400'
              )}
            >
              + Aggiungi
            </button>
            <button
              type="button"
              onClick={() => setTab('map')}
              className={cn(
                'py-2.5 rounded-full text-xs font-semibold transition-all duration-150',
                tab === 'map'
                  ? 'bg-[#141414] text-white dark:bg-[#f4f4f6] dark:text-[#121212] shadow-sm'
                  : 'text-zinc-600 dark:text-zinc-400'
              )}
            >
              Mappa Giro
            </button>
            <button
              type="button"
              onClick={() => setTab('done')}
              className={cn(
                'py-2.5 rounded-full text-xs font-semibold transition-all duration-150',
                tab === 'done'
                  ? 'bg-[#141414] text-white dark:bg-[#f4f4f6] dark:text-[#121212] shadow-sm'
                  : 'text-zinc-600 dark:text-zinc-400'
              )}
            >
              Fatte ({doneOrders.length})
            </button>
          </div>

          {/* Sezione "Aggiungi" con Comando Vocale (it-IT) e Step di Review & Conferma Finale */}
          {activeShift && (tab === 'todo' || tab === 'add') && (
            <RiderAddDeliverySection
              shiftId={activeShift.id}
              riderId={currentUser.id}
              riderName={currentUser.name}
              activeRound={
                selectedRoundFilter !== 'all' ? selectedRoundFilter : currentRound
              }
              onOrderSaved={() => setTab('todo')}
            />
          )}

          {/* Mappa Confinata Altamura + Percorso Ottimale Locale (filtrata e pulita per Round) */}
          {tab === 'map' ? (
            <AltamuraMap
              key={`rider-map-round-${selectedRoundFilter !== 'all' ? selectedRoundFilter : currentRound}`}
              orders={mapOrders}
              heightClass="h-[430px]"
              autoCalculateRoute
              title={`Giro Ottimale • ${
                selectedRoundFilter !== 'all'
                  ? `Round ${selectedRoundFilter}`
                  : `Round ${currentRound} (Attivo)`
              } • ${currentUser.name}`}
              onMoveOrder={(order) => setMoveOrderTarget(order)}
              onCompleteOrder={(order) => openDeliveryConfirm(order)}
            />
          ) : tab === 'add' ? null : !activeShift ? (
            <Card className="p-8 text-center text-sm text-zinc-500">
              Il cassiere non ha ancora aperto il turno di oggi.
            </Card>
          ) : (tab === 'todo' ? todoOrders : doneOrders).length === 0 ? (
            <Card className="p-8 text-center text-sm text-zinc-500 space-y-2">
              <div className="h-11 w-11 rounded-full bg-zinc-100 dark:bg-zinc-800/80 text-zinc-400 mx-auto flex items-center justify-center animate-empty-float">
                <PackageOpen className="h-5 w-5" />
              </div>
              <p>
                {tab === 'todo'
                  ? selectedRoundFilter === 'all'
                    ? 'Nessuna consegna in sospeso! Ottimo lavoro.'
                    : `Nessuna consegna attiva nel Round ${selectedRoundFilter}.`
                  : selectedRoundFilter === 'all'
                  ? 'Non hai ancora completato consegne in questo turno.'
                  : `Nessuna consegna completata nel Round ${selectedRoundFilter}.`}
              </p>
            </Card>
          ) : (
            <div className="space-y-3">
              {(tab === 'todo' ? todoOrders : doneOrders).map((order) => {
                const channelTheme = getPlatformTheme(order.platform);
                const orderRound = getOrderRound(order);
                const movedOrigin = formatOrderMovedOrigin(order);

                return (
                  <Card
                    key={order.id}
                    className={cn(
                      'p-4 space-y-3 animate-row-insert erp-card-lift',
                      channelTheme.cardBorder,
                      order.is_moved &&
                        'ring-2 ring-violet-500/60 dark:ring-violet-400/60 border-dashed',
                      order.status === 'delivered' && 'opacity-90'
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {/* Badge Round */}
                        <Badge variant="neutral" className="font-bold uppercase tracking-wider">
                          <Layers className="h-3 w-3" />
                          ROUND {orderRound}
                        </Badge>

                        {/* Badge Stato */}
                        <Badge
                          variant={
                            order.status === 'delivered'
                              ? 'green'
                              : order.status === 'in_transit'
                              ? 'blue'
                              : 'amber'
                          }
                          className="uppercase tracking-wider font-bold"
                        >
                          {order.status === 'delivered' ? (
                            <CheckCircle2 className="h-3 w-3" />
                          ) : order.status === 'in_transit' ? (
                            <Truck className="h-3 w-3" />
                          ) : (
                            <Clock className="h-3 w-3" />
                          )}
                          {ORDER_STATUS_LABELS[order.status]}
                        </Badge>

                        {/* Badge Canale (Blu / Giallo / Arancione) */}
                        <Badge variant={channelTheme.badgeVariant} className="font-extrabold uppercase tracking-wider">
                          <span className={cn('h-1.5 w-1.5 rounded-full', channelTheme.dotClass)} />
                          {channelTheme.fullName}
                        </Badge>

                        {/* Contrassegno visivo evidente Comanda Spostata */}
                        {order.is_moved && (
                          <Badge variant="purple" className="font-bold uppercase tracking-wider">
                            <CornerUpRight className="h-3 w-3" />
                            SPOSTATA {movedOrigin ? `• ${movedOrigin}` : ''}
                          </Badge>
                        )}
                      </div>

                      <span className="font-mono text-xl font-black text-zinc-900 dark:text-zinc-50 tabular-nums shrink-0">
                        {formatEuro(order.order_total)}
                      </span>
                    </div>

                    {/* Barra Indirizzo con tasto Mappa e tasto Sposta Comanda */}
                    <div className="flex items-center justify-between gap-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-950 p-2.5">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedRoundFilter(orderRound);
                          setTab('map');
                        }}
                        className="flex items-start gap-2.5 min-w-0 flex-1 text-left active:scale-[0.99] transition-transform group"
                        title="Tocca per visualizzare il giro sulla mappa integrata"
                      >
                        <MapPin className={cn('h-5 w-5 shrink-0 mt-0.5', channelTheme.textClass)} />
                        <div className="min-w-0">
                          <p className="font-bold text-sm text-zinc-900 dark:text-zinc-50 leading-snug break-words uppercase tracking-wide">
                            {order.customer_address}
                          </p>
                          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 font-medium mt-0.5 flex items-center gap-1 uppercase tracking-wider">
                            <Map className="h-3 w-3 shrink-0" />
                            VEDI SULLA MAPPA (ROUND {orderRound})
                          </p>
                        </div>
                      </button>

                      {/* Tasti rapidi a destra: Copia, Mappa e Sposta Comanda */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        <CopyToClipboardButton
                          text={order.customer_address}
                          className="h-9 w-9 rounded-full"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedRoundFilter(orderRound);
                            setTab('map');
                          }}
                          className="h-9 w-9 rounded-full bg-zinc-100 dark:bg-zinc-800 hover:bg-[#141414] dark:hover:bg-white text-zinc-700 dark:text-zinc-200 hover:text-white dark:hover:text-[#141414] flex items-center justify-center transition-all active:scale-95"
                          title="Apri Mappa Integrata"
                          aria-label="Apri Mappa Integrata"
                        >
                          <Map className="h-4 w-4" />
                        </button>

                        <button
                          type="button"
                          onClick={() => setMoveOrderTarget(order)}
                          className="h-9 px-3 rounded-full bg-zinc-100 dark:bg-zinc-800 hover:bg-[#141414] dark:hover:bg-white text-zinc-800 dark:text-zinc-200 hover:text-white dark:hover:text-[#141414] flex items-center gap-1.5 font-semibold text-xs transition-all active:scale-95"
                          title="Sposta Comanda (Round successivo o altro Rider)"
                          aria-label="Sposta Comanda"
                        >
                          <ArrowRightLeft className="h-3.5 w-3.5" />
                          <span>Sposta Comanda</span>
                        </button>
                      </div>
                    </div>

                    {/* Dettaglio metodo pagamento previsto & resto */}
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs uppercase tracking-wider">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1.5 font-bold px-2.5 py-1 rounded-lg',
                          order.payment_method === 'cash'
                            ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                            : order.payment_method === 'pos_rider'
                            ? 'bg-sky-500/15 text-sky-700 dark:text-sky-300'
                            : 'bg-violet-500/15 text-violet-700 dark:text-violet-300'
                        )}
                      >
                        {order.payment_method === 'cash' && <Banknote className="h-3.5 w-3.5" />}
                        {order.payment_method === 'pos_rider' && (
                          <CreditCard className="h-3.5 w-3.5" />
                        )}
                        {order.payment_method === 'prepaid_platform' && (
                          <Globe className="h-3.5 w-3.5" />
                        )}
                        {PAYMENT_METHOD_LABELS[order.payment_method]}
                      </span>

                      {order.change_needed > 0 && order.payment_method === 'cash' && (
                        <span className="font-mono font-bold text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2.5 py-1 rounded-lg uppercase">
                          PORTA RESTO: {formatEuro(order.change_needed)}
                        </span>
                      )}
                    </div>

                    {/* Azioni per ordini attivi */}
                    {order.status !== 'delivered' && (
                      <div className="space-y-2 pt-1">
                        <div className="grid grid-cols-2 gap-2">
                          {order.status === 'pending' ? (
                            <Button
                              type="button"
                              variant="secondary"
                              size="lg"
                              className="w-full font-bold"
                              onClick={() => void updateOrderStatus(order.id, 'in_transit')}
                            >
                              <Truck className="h-4 w-4" />
                              In Consegna
                            </Button>
                          ) : (
                            <Button
                              type="button"
                              variant="secondary"
                              size="lg"
                              className="w-full font-bold"
                              onClick={() => {
                                setSelectedRoundFilter(orderRound);
                                setTab('map');
                              }}
                            >
                              <Map className="h-4 w-4" />
                              Vedi Mappa
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant="success"
                            size="lg"
                            className="w-full font-extrabold"
                            onClick={() => openDeliveryConfirm(order)}
                          >
                            <CheckCircle2 className="h-4 w-4" />
                            Consegnato
                          </Button>
                        </div>

                        {/* Bottone Sposta Comanda (Round successivo o altro Rider) */}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="w-full flex items-center justify-center gap-2 font-semibold h-10 rounded-2xl"
                          onClick={() => setMoveOrderTarget(order)}
                        >
                          <ArrowRightLeft className="h-4 w-4" />
                          Sposta Comanda (Round {orderRound + 1} / Altro Rider)
                        </Button>
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Modal Sposta Comanda (Round successivo o Altro Rider) */}
      <MoveOrderModal
        order={moveOrderTarget}
        onClose={() => setMoveOrderTarget(null)}
      />

      {/* Bottom Sheet Conferma Metodo Pagamento Effettivo */}
      <Modal
        open={Boolean(confirmOrder)}
        onClose={() => setConfirmOrder(null)}
        title="Conferma Consegna & Incasso"
        subtitle={confirmOrder?.customer_address}
        maxWidthClass="max-w-md"
      >
        {confirmOrder && (
          <div className="space-y-4">
            <div className="rounded-2xl bg-zinc-100 dark:bg-zinc-950 p-4 flex items-center justify-between">
              <span className="text-sm font-semibold text-zinc-600 dark:text-zinc-400">
                Totale Ordine (Round {getOrderRound(confirmOrder)})
              </span>
              <span className="font-mono text-2xl font-black text-zinc-900 dark:text-zinc-50">
                {formatEuro(confirmOrder.order_total)}
              </span>
            </div>

            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-zinc-500 mb-2">
                Come ha pagato effettivamente il cliente?
              </p>
              <div className="space-y-2">
                {(
                  [
                    {
                      id: 'cash',
                      label: 'Contanti',
                      desc: 'Somma al tuo saldo contanti da versare',
                      icon: Banknote,
                    },
                    {
                      id: 'pos_rider',
                      label: 'POS Mobile del locale',
                      desc: 'Pagato con macchinetta POS (0 € contanti)',
                      icon: CreditCard,
                    },
                    {
                      id: 'prepaid_platform',
                      label: 'Già Pagato su Piattaforma',
                      desc: 'App Proprietaria / Just Eat (0 € contanti)',
                      icon: Globe,
                    },
                  ] as const
                ).map(({ id, label, desc, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setSelectedMethod(id)}
                    className={cn(
                      'w-full flex items-center gap-3 rounded-2xl border-2 p-3.5 text-left transition-all',
                      selectedMethod === id
                        ? 'border-zinc-950 dark:border-white bg-zinc-100 dark:bg-zinc-800/80'
                        : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-400'
                    )}
                  >
                    <div
                      className={cn(
                        'h-10 w-10 rounded-full flex items-center justify-center shrink-0',
                        selectedMethod === id
                          ? 'bg-[#141414] text-white dark:bg-white dark:text-[#141414]'
                          : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500'
                      )}
                    >
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="font-bold text-sm text-zinc-900 dark:text-zinc-50">
                        {label}
                      </p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">{desc}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <Button
              type="button"
              variant="success"
              size="lg"
              loading={submitting}
              className="w-full h-14 text-base font-extrabold"
              disabled={submitting}
              onClick={() => void handleConfirmDelivery()}
            >
              <CheckCircle2 className="h-5 w-5" />
              CONFERMA CONSEGNA
            </Button>
          </div>
        )}
      </Modal>
    </div>
  );
};
