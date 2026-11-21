import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  CreditCard,
  Lock,
  Sparkles,
} from 'lucide-react';
import type { Order, RiderShift, Shift, User } from '@/types/database';
import { formatEuro, parseEuroInput, sumEuro } from '@/lib/currency';
import { computeRiderLiveMetrics, evaluateDiscrepancy } from '@/lib/reconciliation';
import { useAppStore } from '@/lib/store';
import { Badge, Button, Input, Modal, cn } from '@/components/ui/primitives';

interface CashSettlementModalProps {
  open: boolean;
  onClose: () => void;
  shift: Shift;
  riders: User[];
  riderShifts: RiderShift[];
  orders: Order[];
}

export const CashSettlementModal: React.FC<CashSettlementModalProps> = ({
  open,
  onClose,
  shift,
  riders,
  riderShifts,
  orders,
}) => {
  const { closeShiftWithSettlement, settleSingleRider, pushToast } = useAppStore();
  const [cashInputs, setCashInputs] = useState<Record<string, string>>({});
  const [shiftNotes, setShiftNotes] = useState(shift.notes);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (!open) return;
    const init: Record<string, string> = {};
    for (const r of riders) {
      const rs = riderShifts.find((x) => x.rider_id === r.id);
      const riderOrders = orders.filter((o) => o.rider_id === r.id);
      const metrics = computeRiderLiveMetrics(riderOrders, rs?.initial_float ?? 0);
      const val =
        rs?.actual_cash_returned !== null && rs?.actual_cash_returned !== undefined
          ? rs.actual_cash_returned
          : metrics.expectedCashReturn;
      init[r.id] = val.toFixed(2).replace('.', ',');
    }
    setCashInputs(init);
    setShiftNotes(shift.notes);
  }, [open, riders, riderShifts, orders, shift.notes]);

  const inFlightOrders = orders.filter(
    (o) => o.status === 'pending' || o.status === 'in_transit'
  );

  const parsedByRider: Record<string, number> = {};
  let hasInvalidInput = false;
  for (const r of riders) {
    const parsed = parseEuroInput(cashInputs[r.id] ?? '');
    if (Number.isNaN(parsed) || parsed < 0) {
      hasInvalidInput = true;
    } else {
      parsedByRider[r.id] = parsed;
    }
  }

  const totalExpectedCash = sumEuro(
    ...riders.map((r) => {
      const rs = riderShifts.find((x) => x.rider_id === r.id);
      const riderOrders = orders.filter((o) => o.rider_id === r.id);
      return computeRiderLiveMetrics(riderOrders, rs?.initial_float ?? 0).expectedCashReturn;
    })
  );

  const totalCountedCash = sumEuro(
    ...riders.map((r) => parsedByRider[r.id] ?? 0)
  );

  const totalDiscrepancy = evaluateDiscrepancy(totalExpectedCash, totalCountedCash);

  const handleCloseShift = async () => {
    if (hasInvalidInput) {
      pushToast({
        title: 'Controlla gli importi inseriti',
        description: 'Alcuni valori di contante non sono validi.',
        variant: 'danger',
      });
      return;
    }
    setClosing(true);
    await closeShiftWithSettlement(shift.id, parsedByRider, shiftNotes);
    setClosing(false);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Chiusura Turno & Riconciliazione Cassa"
      subtitle={`Turno del ${shift.date} • Inserisci il contante contato fisicamente per ogni rider`}
      maxWidthClass="max-w-3xl"
    >
      <div className="space-y-4">
        {inFlightOrders.length > 0 && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5">
            <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
            <div className="text-xs text-amber-800 dark:text-amber-200">
              <p className="font-bold">
                Attenzione: ci sono ancora {inFlightOrders.length} ordini in consegna/attesa
              </p>
              <p className="mt-0.5 opacity-90">
                Gli ordini non ancora contrassegnati come &quot;Consegnato&quot; non rientrano nel
                contante atteso. Completa o annulla gli ordini prima della chiusura definitiva.
              </p>
            </div>
          </div>
        )}

        <div className="space-y-3">
          {riders.map((r) => {
            const rs = riderShifts.find((x) => x.rider_id === r.id);
            const riderOrders = orders.filter((o) => o.rider_id === r.id);
            const metrics = computeRiderLiveMetrics(riderOrders, rs?.initial_float ?? 0);
            const countedVal = parseEuroInput(cashInputs[r.id] ?? '');
            const disc = evaluateDiscrepancy(
              metrics.expectedCashReturn,
              Number.isNaN(countedVal) ? null : countedVal
            );

            return (
              <div
                key={r.id}
                className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/60 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-amber-500 text-zinc-950 font-mono text-xs font-black">
                      {r.rider_number ?? '#'}
                    </span>
                    <span className="font-bold text-zinc-900 dark:text-zinc-50">
                      {r.name}
                    </span>
                    <span className="text-xs text-zinc-500">
                      ({metrics.deliveredCount} consegne)
                    </span>
                  </div>

                  {/* Badge riconciliazione Verde / Rosso / Giallo */}
                  <Badge
                    variant={
                      disc.level === 'exact'
                        ? 'green'
                        : disc.level === 'shortage'
                        ? 'red'
                        : disc.level === 'surplus'
                        ? 'amber'
                        : 'neutral'
                    }
                  >
                    {disc.level === 'exact' && <CheckCircle2 className="h-3.5 w-3.5" />}
                    {disc.level === 'shortage' && <AlertTriangle className="h-3.5 w-3.5" />}
                    {disc.level === 'surplus' && <Sparkles className="h-3.5 w-3.5" />}
                    {disc.level === 'exact'
                      ? 'Quadra (€ 0,00)'
                      : disc.level === 'shortage'
                      ? `Mancano ${formatEuro(Math.abs(disc.discrepancy ?? 0))}`
                      : disc.level === 'surplus'
                      ? `Eccedenza / Mancia +${formatEuro(disc.discrepancy ?? 0)}`
                      : 'Inserisci importo'}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs mb-3">
                  <div className="rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-2.5">
                    <span className="text-zinc-500 block">Fondo Cassa</span>
                    <span className="font-mono font-bold text-zinc-900 dark:text-zinc-100">
                      {formatEuro(rs?.initial_float ?? 0)}
                    </span>
                  </div>
                  <div className="rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-2.5">
                    <span className="text-zinc-500 block">Contanti Clienti</span>
                    <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                      + {formatEuro(metrics.cashCollected)}
                    </span>
                  </div>
                  <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-2.5">
                    <span className="text-emerald-700 dark:text-emerald-300 font-semibold block">
                      Atteso in Contanti
                    </span>
                    <span className="font-mono font-extrabold text-emerald-700 dark:text-emerald-300">
                      {formatEuro(metrics.expectedCashReturn)}
                    </span>
                  </div>
                  <div className="rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-2.5">
                    <span className="inline-flex items-center gap-1 text-sky-600 dark:text-sky-400">
                      <CreditCard className="h-3 w-3" /> Scontrino POS
                    </span>
                    <span className="font-mono font-bold text-zinc-900 dark:text-zinc-100 block">
                      {formatEuro(metrics.posCollected)}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
                    <Banknote className="h-4 w-4 text-amber-500" />
                    Contante fisico contato (€):
                  </label>
                  <div className="flex items-center gap-2">
                    <Input
                      value={cashInputs[r.id] ?? ''}
                      onChange={(e) =>
                        setCashInputs((prev) => ({ ...prev, [r.id]: e.target.value }))
                      }
                      inputMode="decimal"
                      className={cn(
                        'w-32 text-right font-mono font-bold',
                        disc.level === 'exact' && 'border-emerald-500',
                        disc.level === 'shortage' && 'border-rose-500',
                        disc.level === 'surplus' && 'border-amber-500'
                      )}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={Number.isNaN(countedVal) || countedVal < 0}
                      onClick={() => void settleSingleRider(shift.id, r.id, countedVal)}
                    >
                      Salva Singolo
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Riepilogo complessivo cassa */}
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-950 p-4 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Totale Contante Atteso vs Contato
            </p>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="font-mono text-lg font-extrabold text-zinc-900 dark:text-zinc-50">
                {formatEuro(totalCountedCash)}
              </span>
              <span className="text-xs text-zinc-500">
                su {formatEuro(totalExpectedCash)} attesi
              </span>
            </div>
          </div>

          <Badge
            variant={
              totalDiscrepancy.level === 'exact'
                ? 'green'
                : totalDiscrepancy.level === 'shortage'
                ? 'red'
                : 'amber'
            }
            className="text-sm px-3 py-1"
          >
            {totalDiscrepancy.level === 'exact'
              ? 'Cassa Serata Quadra'
              : totalDiscrepancy.level === 'shortage'
              ? `Ammanco Totale: ${formatEuro(Math.abs(totalDiscrepancy.discrepancy ?? 0))}`
              : `Eccedenza Totale: +${formatEuro(totalDiscrepancy.discrepancy ?? 0)}`}
          </Badge>
        </div>

        <div>
          <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400 mb-1.5">
            Note chiusura serata (opzionale)
          </label>
          <Input
            value={shiftNotes}
            onChange={(e) => setShiftNotes(e.target.value)}
            placeholder="Es. Chiusura POS verificata, tutto regolare..."
          />
        </div>

        <div className="flex items-center justify-end gap-2.5 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Annulla
          </Button>
          <Button
            type="button"
            variant="primary"
            size="lg"
            disabled={closing || hasInvalidInput}
            onClick={() => void handleCloseShift()}
          >
            <Lock className="h-4 w-4" />
            {closing ? 'Chiusura in corso...' : 'Chiudi Turno e Salva Storico'}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
