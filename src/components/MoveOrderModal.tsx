import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  CornerUpRight,
  FastForward,
  Layers,
  MapPin,
} from 'lucide-react';
import {
  formatOrderMovedOrigin,
  getOrderRound,
  getPlatformTheme,
  PAYMENT_METHOD_LABELS,
  type Order,
} from '@/types/database';
import { formatEuro } from '@/lib/currency';
import { useAppStore } from '@/lib/store';
import { Badge, Button, Modal, cn } from '@/components/ui/primitives';

interface MoveOrderModalProps {
  order: Order | null;
  onClose: () => void;
}

export const MoveOrderModal: React.FC<MoveOrderModalProps> = ({
  order,
  onClose,
}) => {
  const { riders, moveOrder, getRiderCurrentRound } = useAppStore();

  const currentOrderRound = order ? getOrderRound(order) : 1;
  const [targetRiderId, setTargetRiderId] = useState<string>(order?.rider_id ?? '');
  const [targetRound, setTargetRound] = useState<number>(currentOrderRound);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (order) {
      const r = getOrderRound(order);
      setTargetRiderId(order.rider_id);
      setTargetRound(r);
    }
  }, [order]);

  if (!order) return null;

  const channelTheme = getPlatformTheme(order.platform);
  const currentRider = riders.find((r) => r.id === order.rider_id);
  const selectedRider = riders.find((r) => r.id === targetRiderId);
  const riderActiveRound = getRiderCurrentRound(order.shift_id, targetRiderId || order.rider_id);

  // Opzioni round disponibili (da 1 fino a max(currentOrderRound + 2, riderActiveRound + 1, 4))
  const maxRoundOption = Math.max(4, currentOrderRound + 2, riderActiveRound + 1);
  const roundOptions = Array.from({ length: maxRoundOption }, (_, i) => i + 1);

  const hasChanges =
    targetRiderId !== order.rider_id || targetRound !== currentOrderRound;

  const handleConfirmMove = async () => {
    if (!hasChanges) {
      onClose();
      return;
    }
    setSubmitting(true);
    await moveOrder(order.id, {
      targetRiderId,
      targetRound,
    });
    setSubmitting(false);
    onClose();
  };

  const handleQuickNextRound = async () => {
    setSubmitting(true);
    await moveOrder(order.id, {
      targetRiderId: order.rider_id,
      targetRound: currentOrderRound + 1,
    });
    setSubmitting(false);
    onClose();
  };

  const existingOrigin = formatOrderMovedOrigin(order);

  return (
    <Modal
      open={Boolean(order)}
      onClose={onClose}
      title="Sposta Comanda"
      subtitle="Sposta a un Round successivo o riassegna a un altro Rider (senza duplicare i totali)"
      maxWidthClass="max-w-md"
    >
      <div className="space-y-4">
        {/* Riepilogo comanda selezionata */}
        <div
          className={cn(
            'rounded-2xl border p-3.5 space-y-2',
            channelTheme.rowBg
          )}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5 mb-1 uppercase tracking-wider">
                <Badge variant="neutral" className="font-bold text-[10px]">
                  <Layers className="h-3 w-3" />
                  Round {currentOrderRound}
                </Badge>
                <Badge variant={channelTheme.badgeVariant} className="text-[10px] font-bold">
                  <span className={cn('h-1.5 w-1.5 rounded-full', channelTheme.dotClass)} />
                  {channelTheme.fullName}
                </Badge>
                {order.is_moved && (
                  <Badge variant="purple" className="text-[10px] font-bold">
                    <CornerUpRight className="h-3 w-3" />
                    Spostata {existingOrigin ? `(${existingOrigin})` : ''}
                  </Badge>
                )}
              </div>
              <p className="font-bold text-sm text-zinc-950 dark:text-zinc-50 flex items-center gap-1.5 uppercase tracking-wide">
                <MapPin className={cn('h-4 w-4 shrink-0', channelTheme.textClass)} />
                <span className="truncate">{order.customer_address}</span>
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 uppercase tracking-wider">
                Attualmente a: <strong>{currentRider?.name ?? 'Rider'}</strong> •{' '}
                {PAYMENT_METHOD_LABELS[order.payment_method]}
              </p>
            </div>
            <span className="font-mono text-lg font-bold text-zinc-950 dark:text-zinc-50 shrink-0 tabular-nums">
              {formatEuro(order.order_total)}
            </span>
          </div>
        </div>

        {/* Azione immediata 1-click: Sposta al Round Successivo */}
        <button
          type="button"
          disabled={submitting}
          onClick={() => void handleQuickNextRound()}
          className="w-full flex items-center justify-between gap-3 rounded-2xl bg-[#141414] text-white dark:bg-[#f4f4f6] dark:text-[#121212] p-3.5 hover:opacity-90 active:scale-[0.99] transition-all text-left"
        >
          <div className="flex items-center gap-3">
            <span className="h-9 w-9 rounded-full bg-white/15 dark:bg-black/10 flex items-center justify-center shrink-0">
              <FastForward className="h-4 w-4" />
            </span>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider opacity-75">
                Azione Rapida 1-Toc
              </p>
              <p className="text-sm font-bold">
                Sposta subito al Round {currentOrderRound + 1} ({currentRider?.name})
              </p>
            </div>
          </div>
          <CornerUpRight className="h-4 w-4 shrink-0" />
        </button>

        <div className="h-px bg-zinc-200 dark:bg-zinc-800" />

        {/* Selettore Round di Destinazione */}
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-2">
            1. Scegli Round di Destinazione
          </label>
          <div className="grid grid-cols-4 gap-2">
            {roundOptions.map((rNum) => {
              const isSelected = targetRound === rNum;
              const isCurrent = rNum === currentOrderRound;
              return (
                <button
                  key={rNum}
                  type="button"
                  onClick={() => setTargetRound(rNum)}
                  className={cn(
                    'py-2.5 px-2 rounded-2xl border text-xs font-bold flex flex-col items-center justify-center gap-0.5 transition-all active:scale-95',
                    isSelected
                      ? 'bg-[#141414] text-white border-[#141414] dark:bg-white dark:text-[#121212] dark:border-white shadow-sm'
                      : 'border-zinc-200 dark:border-zinc-800 bg-[#f4f4f5] dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:border-zinc-400'
                  )}
                >
                  <span>Round {rNum}</span>
                  <span className="text-[10px] font-normal opacity-75">
                    {isCurrent ? 'Attuale' : rNum === currentOrderRound + 1 ? 'Successivo' : `Giro ${rNum}`}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Selettore Rider di Destinazione */}
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-2">
            2. Scegli Rider Assegnatario
          </label>
          <div className="grid grid-cols-2 gap-2">
            {riders.map((r) => {
              const isSelected = targetRiderId === r.id;
              const isOriginal = r.id === order.rider_id;
              const rRound = getRiderCurrentRound(order.shift_id, r.id);
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => {
                    setTargetRiderId(r.id);
                    // Se cambia rider, suggerisce il round attivo di quel rider
                    if (r.id !== order.rider_id && targetRound === currentOrderRound) {
                      setTargetRound(rRound);
                    }
                  }}
                  className={cn(
                    'p-3 rounded-2xl border text-left flex items-center gap-2.5 transition-all active:scale-95',
                    isSelected
                      ? 'bg-[#141414] text-white border-[#141414] dark:bg-white dark:text-[#121212] dark:border-white shadow-sm'
                      : 'border-zinc-200 dark:border-zinc-800 bg-[#f4f4f5] dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200 hover:border-zinc-400'
                  )}
                >
                  <div
                    className={cn(
                      'h-8 w-8 rounded-full font-bold text-xs flex items-center justify-center shrink-0',
                      isSelected
                        ? 'bg-white/20 text-white dark:bg-black/15 dark:text-[#121212]'
                        : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200'
                    )}
                  >
                    #{r.rider_number ?? 'R'}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold truncate">{r.name}</p>
                    <p className="text-[10px] opacity-75 truncate">
                      {isOriginal ? 'Rider attuale' : `In Round ${rRound}`}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Box Anteprima Contrassegno "Spostata" */}
        {hasChanges && (
          <div className="rounded-2xl border border-violet-500/40 bg-violet-500/10 p-3 text-xs text-violet-900 dark:text-violet-200 flex items-center justify-between gap-2 animate-dropdown-expand">
            <div className="flex items-center gap-2 min-w-0">
              <CornerUpRight className="h-4 w-4 text-violet-600 dark:text-violet-400 shrink-0" />
              <span className="font-semibold truncate">
                Verrà contrassegnata come <strong>SPOSTATA</strong>:{' '}
                {targetRiderId !== order.rider_id
                  ? `${currentRider?.name} → ${selectedRider?.name}`
                  : ''}{' '}
                {targetRound !== currentOrderRound
                  ? `(Round ${currentOrderRound} → Round ${targetRound})`
                  : ''}
              </span>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 pt-1">
          <Button type="button" variant="outline" size="lg" onClick={onClose}>
            Annulla
          </Button>
          <Button
            type="button"
            variant="primary"
            size="lg"
            loading={submitting}
            disabled={!hasChanges || submitting}
            onClick={() => void handleConfirmMove()}
          >
            <CheckCircle2 className="h-4 w-4" />
            Conferma Sposta
          </Button>
        </div>
      </div>
    </Modal>
  );
};
