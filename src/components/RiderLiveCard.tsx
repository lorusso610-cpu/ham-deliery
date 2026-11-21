import React, { useMemo, useState } from 'react';
import {
  ArrowRightLeft,
  Banknote,
  Check,
  CheckCircle2,
  Clock,
  CornerUpRight,
  CreditCard,
  FastForward,
  Globe,
  Layers,
  Lock,
  MapPin,
  PackageOpen,
  Pencil,
  Trash2,
  Truck,
} from 'lucide-react';
import {
  formatOrderMovedOrigin,
  getOrderRound,
  getPlatformTheme,
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  type Order,
  type RiderShift,
  type User,
} from '@/types/database';
import { formatEuro, parseEuroInput } from '@/lib/currency';
import { computeRiderLiveMetrics, evaluateDiscrepancy } from '@/lib/reconciliation';
import { useAppStore } from '@/lib/store';
import { Badge, Button, Card, Input, cn } from '@/components/ui/primitives';
import { AnimatedEuro, CopyToClipboardButton } from '@/components/ui/animations';
import { MoveOrderModal } from '@/components/MoveOrderModal';

interface RiderLiveCardProps {
  shiftId: string;
  rider: User;
  riderShift?: RiderShift;
  orders: Order[];
  shiftIsClosed: boolean;
  highlightedStreetQuery?: string;
  selectedRoundFilter?: number | 'all';
}

export const RiderLiveCard: React.FC<RiderLiveCardProps> = ({
  shiftId,
  rider,
  riderShift,
  orders,
  shiftIsClosed,
  highlightedStreetQuery = '',
  selectedRoundFilter = 'all',
}) => {
  const {
    updateRiderFloat,
    updateOrderStatus,
    deleteOrCancelOrder,
    advanceRiderRound,
    getRiderCurrentRound,
    pushToast,
  } = useAppStore();
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [moveOrderTarget, setMoveOrderTarget] = useState<Order | null>(null);
  const [localRoundFilter, setLocalRoundFilter] = useState<number | 'all'>('all');

  const initialFloat = riderShift?.initial_float ?? 0;
  const currentRiderRound = getRiderCurrentRound(shiftId, rider.id);

  // I totali contabili di fine serata (Resto, Pos gest, Gest+resto, POS -, TOTALE)
  // sono sempre calcolati su tutti gli ordini attivi del rider nel turno, senza duplicazioni.
  const metrics = computeRiderLiveMetrics(orders, initialFloat);
  const discrepancyInfo = evaluateDiscrepancy(
    metrics.expectedCashReturn,
    riderShift?.actual_cash_returned
  );

  const [editingFloat, setEditingFloat] = useState(false);
  const [floatInput, setFloatInput] = useState(
    initialFloat.toFixed(2).replace('.', ',')
  );

  const handleSaveFloat = async () => {
    const parsed = parseEuroInput(floatInput);
    if (Number.isNaN(parsed) || parsed < 0) {
      pushToast({
        title: 'Importo fondo cassa non valido',
        description: 'Inserisci un numero positivo (es. 50,00)',
        variant: 'danger',
      });
      return;
    }
    await updateRiderFloat(shiftId, rider.id, parsed);
    setEditingFloat(false);
  };

  const activeOrders = useMemo(
    () => orders.filter((o) => o.status !== 'cancelled'),
    [orders]
  );

  // Round presenti per questo rider
  const availableRounds = useMemo(() => {
    const set = new Set<number>([1, currentRiderRound]);
    activeOrders.forEach((o) => set.add(getOrderRound(o)));
    return Array.from(set).sort((a, b) => a - b);
  }, [activeOrders, currentRiderRound]);

  // Filtro effettivo (prende priorità dal filtro globale Admin se impostato, altrimenti quello locale della card)
  const effectiveRoundFilter =
    selectedRoundFilter !== 'all' ? selectedRoundFilter : localRoundFilter;

  const visibleOrders = useMemo(() => {
    if (effectiveRoundFilter === 'all') return activeOrders;
    return activeOrders.filter((o) => getOrderRound(o) === effectiveRoundFilter);
  }, [activeOrders, effectiveRoundFilter]);

  const cleanSearch = highlightedStreetQuery.trim().toLowerCase();

  return (
    <>
      <Card className="flex flex-col overflow-hidden rounded-[30px] border-zinc-200/80 dark:border-zinc-800/90 erp-card-lift">
        {/* Header Two-Tone Stile "Analytics" Screen + Controllo Round */}
        <div className="bg-[#141414] text-white px-4 py-3.5 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="h-9 w-9 rounded-full bg-white/12 border border-white/15 text-white flex items-center justify-center font-bold text-xs shrink-0">
                {rider.rider_number ?? 'R'}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <h3 className="font-semibold text-base tracking-tight text-white truncate">
                    {rider.name}
                  </h3>
                  <span
                    key={`round-${currentRiderRound}`}
                    className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-bold text-white animate-badge-pop shrink-0"
                  >
                    <Layers className="h-2.5 w-2.5" />
                    Round {currentRiderRound}
                  </span>
                </div>
                <p className="text-[11px] text-zinc-400">
                  {metrics.deliveredCount} consegnate • {metrics.inFlightCount} attive
                </p>
              </div>
            </div>

            {!shiftIsClosed && (
              <button
                type="button"
                onClick={() => {
                  void advanceRiderRound(shiftId, rider.id);
                  setLocalRoundFilter('all');
                }}
                className="inline-flex items-center gap-1 rounded-full bg-white text-[#141414] hover:bg-zinc-200 px-2.5 py-1 text-[11px] font-bold transition-all active:scale-95 shrink-0"
                title={`Chiudi e storicizza Round ${currentRiderRound} e passa a Round ${currentRiderRound + 1}`}
              >
                <FastForward className="h-3 w-3" />
                <span>Inizia R{currentRiderRound + 1}</span>
              </button>
            )}
          </div>

          {/* Mini-filtro Round per singolo Rider */}
          {availableRounds.length > 1 && (
            <div className="flex items-center gap-1 overflow-x-auto pt-0.5">
              <button
                type="button"
                onClick={() => setLocalRoundFilter('all')}
                className={cn(
                  'px-2.5 py-0.5 rounded-full text-[10px] font-semibold transition-all shrink-0',
                  effectiveRoundFilter === 'all'
                    ? 'bg-white text-[#141414]'
                    : 'bg-white/10 text-zinc-300 hover:bg-white/20'
                )}
              >
                Tutti ({activeOrders.length})
              </button>
              {availableRounds.map((rNum) => {
                const count = activeOrders.filter((o) => getOrderRound(o) === rNum).length;
                const isActive = effectiveRoundFilter === rNum;
                return (
                  <button
                    key={rNum}
                    type="button"
                    onClick={() => setLocalRoundFilter(rNum)}
                    className={cn(
                      'px-2.5 py-0.5 rounded-full text-[10px] font-semibold transition-all shrink-0',
                      isActive
                        ? 'bg-white text-[#141414]'
                        : 'bg-white/10 text-zinc-300 hover:bg-white/20'
                    )}
                  >
                    Round {rNum} ({count})
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Intestazione Tabella Principale: Indirizzo / piattaforma | Importo */}
        <div className="grid grid-cols-12 items-center px-4 py-2 bg-[#f6f6f7] dark:bg-zinc-900/60 border-b border-zinc-200/70 dark:border-zinc-800/70 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
          <span className="col-span-8">
            Indirizzo / Canale {effectiveRoundFilter !== 'all' ? `(Round ${effectiveRoundFilter})` : ''}
          </span>
          <span className="col-span-4 text-right">Importo</span>
        </div>

        {/* Righe Tabella Consegne colorate per Canale (Blu = App, Giallo = Gestionale, Arancione = Just Eat) */}
        <div className="p-3.5 space-y-2.5 flex-1 max-h-[380px] overflow-y-auto bg-white dark:bg-[#141417]">
          {visibleOrders.length === 0 ? (
            <div className="py-10 text-center space-y-2">
              <div className="h-10 w-10 rounded-full bg-zinc-100 dark:bg-zinc-800/80 text-zinc-400 mx-auto flex items-center justify-center animate-empty-float">
                <PackageOpen className="h-4 w-4" />
              </div>
              <p className="text-xs text-zinc-400 dark:text-zinc-500 font-medium">
                {effectiveRoundFilter === 'all'
                  ? 'Nessuna consegna assegnata'
                  : `Nessuna consegna nel Round ${effectiveRoundFilter}`}
              </p>
            </div>
          ) : (
            visibleOrders.map((order) => {
              const isDelivered = order.status === 'delivered';
              const isInTransit = order.status === 'in_transit';
              const channelTheme = getPlatformTheme(order.platform);
              const orderRound = getOrderRound(order);
              const movedOrigin = formatOrderMovedOrigin(order);
              const isHighlighted =
                cleanSearch.length >= 2 &&
                order.customer_address.toLowerCase().includes(cleanSearch);

              return (
                <div
                  key={order.id}
                  className={cn(
                    'rounded-2xl border p-3 animate-row-insert erp-row-hover',
                    channelTheme.rowBg,
                    order.is_moved &&
                      'ring-1 ring-violet-500/60 dark:ring-violet-400/60 border-dashed',
                    isHighlighted &&
                      'ring-2 ring-zinc-950 dark:ring-white ring-offset-2 ring-offset-white dark:ring-offset-zinc-950 scale-[1.01]',
                    isDelivered && !isHighlighted && 'opacity-85'
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="inline-flex items-center gap-1 text-xs font-bold text-zinc-900 dark:text-zinc-100 max-w-full uppercase tracking-wide">
                        <MapPin className={cn('h-3.5 w-3.5 shrink-0', channelTheme.textClass)} />
                        <span className="truncate">{order.customer_address}</span>
                        <CopyToClipboardButton text={order.customer_address} />
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                        {/* Badge Round */}
                        <Badge variant="neutral" className="text-[10px] px-2 py-0 font-bold uppercase tracking-wider">
                          <Layers className="h-2.5 w-2.5" />
                          R{orderRound}
                        </Badge>

                        {/* Badge Canale */}
                        <Badge
                          variant={channelTheme.badgeVariant}
                          className="text-[10px] px-2 py-0 font-bold uppercase tracking-wider"
                        >
                          <span className={cn('h-1.5 w-1.5 rounded-full', channelTheme.dotClass)} />
                          {channelTheme.label}
                        </Badge>

                        {/* Contrassegno visivo evidente per Comanda Spostata */}
                        {order.is_moved && (
                          <Badge
                            variant="purple"
                            className="text-[10px] px-2 py-0 font-bold uppercase tracking-wider"
                            title={movedOrigin ?? 'Comanda spostata'}
                          >
                            <CornerUpRight className="h-2.5 w-2.5" />
                            Spostata {movedOrigin ? `• ${movedOrigin}` : ''}
                          </Badge>
                        )}

                        <span
                          className={cn(
                            'text-[10px] font-bold uppercase tracking-wider',
                            order.payment_method === 'cash'
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : order.payment_method === 'pos_rider'
                              ? 'text-sky-700 dark:text-sky-400'
                              : 'text-violet-700 dark:text-violet-400'
                          )}
                        >
                          {PAYMENT_METHOD_LABELS[order.payment_method]}
                        </span>
                        {order.change_needed > 0 && order.payment_method === 'cash' && (
                          <span className="text-[10px] font-mono text-zinc-600 dark:text-zinc-300 font-medium uppercase">
                            (Resto {formatEuro(order.change_needed)})
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <p className="font-mono text-sm font-bold text-zinc-950 dark:text-zinc-50 tabular-nums">
                        {formatEuro(order.order_total)}
                      </p>
                      <Badge
                        variant={
                          isDelivered ? 'green' : isInTransit ? 'blue' : 'neutral'
                        }
                        className="mt-1 text-[10px] px-2 py-0"
                      >
                        {isDelivered ? (
                          <CheckCircle2 className="h-2.5 w-2.5" />
                        ) : isInTransit ? (
                          <Truck className="h-2.5 w-2.5" />
                        ) : (
                          <Clock className="h-2.5 w-2.5" />
                        )}
                        {ORDER_STATUS_LABELS[order.status]}
                      </Badge>
                    </div>
                  </div>

                  {!shiftIsClosed && (
                    <div className="flex flex-wrap items-center justify-between gap-1.5 mt-2.5 pt-2 border-t border-zinc-200/70 dark:border-zinc-800/70">
                      {/* Azione Sposta Comanda (Round successivo o altro Rider) */}
                      <button
                        type="button"
                        onClick={() => setMoveOrderTarget(order)}
                        className="inline-flex items-center gap-1 rounded-full border border-zinc-200 dark:border-zinc-700 bg-white/90 dark:bg-zinc-900 hover:bg-[#141414] hover:text-white dark:hover:bg-white dark:hover:text-[#141414] px-2.5 py-1 text-[11px] font-semibold text-zinc-700 dark:text-zinc-200 transition-all active:scale-95"
                        title="Sposta a un Round successivo o riassegna a un altro Rider"
                      >
                        <ArrowRightLeft className="h-3 w-3 shrink-0" />
                        <span>Sposta Comanda</span>
                      </button>

                      <div className="flex items-center gap-1.5 ml-auto">
                        {confirmDeleteId === order.id ? (
                          <>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="rounded-full px-2.5 py-1 text-[11px] font-medium text-zinc-500 hover:bg-zinc-200/60 dark:hover:bg-zinc-800"
                            >
                              Annulla
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setConfirmDeleteId(null);
                                void deleteOrCancelOrder(order.id);
                              }}
                              className="inline-flex items-center gap-1 rounded-full bg-rose-600 hover:bg-rose-500 px-2.5 py-1 text-[11px] font-semibold text-white"
                            >
                              <Trash2 className="h-3 w-3" />
                              Conferma
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(order.id)}
                            className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium text-zinc-500 hover:text-rose-600 hover:bg-rose-500/10 transition-colors"
                            title="Elimina consegna"
                          >
                            <Trash2 className="h-3 w-3" />
                            Elimina
                          </button>
                        )}

                        {!isDelivered && (
                          <button
                            type="button"
                            onClick={() => void updateOrderStatus(order.id, 'delivered')}
                            className="inline-flex items-center gap-1 rounded-full bg-[#141414] hover:bg-zinc-800 dark:bg-[#f4f4f6] dark:hover:bg-white px-3 py-1 text-[11px] font-semibold text-white dark:text-[#121212] transition-all active:scale-95"
                          >
                            <Check className="h-3 w-3" />
                            Consegnato
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Sezione Contabile Stile "Analytics" List Rows (Resto, Pos gest, Gest+resto, POS -, TOTALE BLOCCATO) */}
        <div className="border-t border-zinc-200/80 dark:border-zinc-800/80 bg-[#f6f6f7] dark:bg-zinc-900/50 text-xs uppercase">
          {/* Riga 1: Fondo cassa Resto (Inline Editing Transition) */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-200/60 dark:border-zinc-800/60">
            <div className="flex items-center gap-2.5">
              <span className="h-6 w-6 rounded-full bg-[#141414] text-white dark:bg-zinc-800 dark:text-zinc-200 flex items-center justify-center shrink-0">
                <Banknote className="h-3 w-3" />
              </span>
              <span className="font-bold text-zinc-600 dark:text-zinc-300 tracking-wider">
                RESTO (FONDO CASSA)
              </span>
            </div>
            {editingFloat ? (
              <div className="flex items-center gap-1 animate-dropdown-expand">
                <Input
                  value={floatInput}
                  onChange={(e) => setFloatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleSaveFloat();
                    if (e.key === 'Escape') setEditingFloat(false);
                  }}
                  className="h-7 w-24 text-right font-mono text-xs px-2 rounded-xl"
                  autoFocus
                />
                <Button size="sm" className="h-7 px-2.5 text-xs font-bold uppercase" onClick={() => void handleSaveFloat()}>
                  OK
                </Button>
              </div>
            ) : (
              <button
                type="button"
                disabled={shiftIsClosed}
                onClick={() => {
                  setFloatInput(initialFloat.toFixed(2).replace('.', ','));
                  setEditingFloat(true);
                }}
                className="inline-flex items-center gap-1.5 font-mono text-xs font-bold text-zinc-900 dark:text-zinc-100 hover:opacity-70 disabled:pointer-events-none transition-opacity"
              >
                <AnimatedEuro value={initialFloat} />
                {!shiftIsClosed && <Pencil className="h-3 w-3 text-zinc-400" />}
              </button>
            )}
          </div>

          {/* Riga 2: Pos gest / Prepagati online */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-200/60 dark:border-zinc-800/60">
            <div className="flex items-center gap-2.5">
              <span className="h-6 w-6 rounded-full bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 flex items-center justify-center shrink-0">
                <Globe className="h-3 w-3" />
              </span>
              <span className="font-bold text-zinc-600 dark:text-zinc-300 tracking-wider">
                POS GEST (ONLINE)
              </span>
            </div>
            <AnimatedEuro
              value={metrics.platformPrepaid}
              className="font-mono font-bold text-zinc-800 dark:text-zinc-200"
            />
          </div>

          {/* Riga 3: Gest+resto */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-200/60 dark:border-zinc-800/60">
            <span className="font-bold text-zinc-700 dark:text-zinc-300 pl-8 tracking-wider">
              GEST+RESTO
            </span>
            <AnimatedEuro
              value={metrics.gestPlusResto}
              className="font-mono font-bold text-zinc-900 dark:text-zinc-100"
            />
          </div>

          {/* Riga 4: POS - (sottratti dal totale) */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-200/60 dark:border-zinc-800/60">
            <div className="flex items-center gap-2.5">
              <span className="h-6 w-6 rounded-full bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 flex items-center justify-center shrink-0">
                <CreditCard className="h-3 w-3" />
              </span>
              <span className="font-bold text-zinc-700 dark:text-zinc-300 tracking-wider">
                POS − <span className="font-semibold text-[10px] text-zinc-400">(SOTTRATTI)</span>
              </span>
            </div>
            <span className="font-mono font-bold text-zinc-900 dark:text-zinc-100 tabular-nums">
              - <AnimatedEuro value={metrics.posCollected} />
            </span>
          </div>

          {/* Riga 5: TOTALE BLOCCATO (Sola lettura, calcolato = (Gest+resto) - POS) */}
          <div
            className="flex items-center justify-between px-4 py-3 bg-[#141414] text-white dark:bg-zinc-950 dark:border-t dark:border-zinc-800"
            title="Totale bloccato: calcolato automaticamente come (Gest+resto) - POS"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Lock className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
              <div>
                <span className="font-bold text-xs uppercase tracking-wider text-white block leading-tight">
                  TOTALE
                </span>
                <span className="text-[10px] font-medium text-zinc-400 block leading-tight">
                  Bloccato • (Gest+resto − POS)
                </span>
              </div>
            </div>
            <input
              type="text"
              readOnly
              tabIndex={-1}
              aria-label={`Totale bloccato per ${rider.name}`}
              value={formatEuro(metrics.expectedCashReturn)}
              className="w-28 bg-white/10 dark:bg-zinc-900 border border-white/15 dark:border-zinc-700 rounded-xl px-2.5 py-1 text-right font-mono text-base font-bold text-white tabular-nums select-none cursor-not-allowed focus:outline-none"
            />
          </div>

          {/* Badge riconciliazione finale se già chiuso/contato */}
          {riderShift?.is_settled && (
            <div className="flex items-center justify-between px-4 py-2.5 bg-zinc-100/70 dark:bg-zinc-950/60">
              <span className="text-[11px] text-zinc-500">
                Contati: <strong className="font-mono">{formatEuro(riderShift.actual_cash_returned)}</strong>
              </span>
              <Badge
                variant={
                  discrepancyInfo.level === 'exact'
                    ? 'green'
                    : discrepancyInfo.level === 'shortage'
                    ? 'red'
                    : 'neutral'
                }
              >
                {discrepancyInfo.level === 'exact'
                  ? 'Quadra (€ 0,00)'
                  : discrepancyInfo.level === 'shortage'
                  ? `Mancano ${formatEuro(Math.abs(discrepancyInfo.discrepancy ?? 0))}`
                  : `Eccedenza +${formatEuro(discrepancyInfo.discrepancy ?? 0)}`}
              </Badge>
            </div>
          )}
        </div>
      </Card>

      {/* Modale Sposta Comanda (Round successivo o altro Rider) */}
      <MoveOrderModal
        order={moveOrderTarget}
        onClose={() => setMoveOrderTarget(null)}
      />
    </>
  );
};
