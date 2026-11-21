import React from 'react';
import {
  BarChart3,
  CalendarDays,
  CheckCircle2,
  CreditCard,
  Banknote,
  Globe,
  TrendingUp,
} from 'lucide-react';
import { getPlatformTheme, normalizePlatform, ORDER_PLATFORMS } from '@/types/database';
import { formatEuro, sumEuro } from '@/lib/currency';
import { evaluateDiscrepancy } from '@/lib/reconciliation';
import { useAppStore } from '@/lib/store';
import { Badge, Card, cn } from '@/components/ui/primitives';

export const AnalyticsDashboard: React.FC = () => {
  const { db, riders } = useAppStore();

  const deliveredOrders = db.orders.filter((o) => o.status === 'delivered');
  const totalRevenueAll = sumEuro(...deliveredOrders.map((o) => o.order_total));
  const totalCashAll = sumEuro(
    ...deliveredOrders
      .filter((o) => o.payment_method === 'cash')
      .map((o) => o.order_total)
  );
  const totalPosAll = sumEuro(
    ...deliveredOrders
      .filter((o) => o.payment_method === 'pos_rider')
      .map((o) => o.order_total)
  );
  const totalPrepaidAll = sumEuro(
    ...deliveredOrders
      .filter((o) => o.payment_method === 'prepaid_platform')
      .map((o) => o.order_total)
  );

  const platformBreakdown = ORDER_PLATFORMS.map((platform) => {
    const platOrders = deliveredOrders.filter(
      (o) => normalizePlatform(o.platform) === platform
    );
    const amount = sumEuro(...platOrders.map((o) => o.order_total));
    const pct = totalRevenueAll > 0 ? Math.round((amount / totalRevenueAll) * 100) : 0;
    const theme = getPlatformTheme(platform);
    return {
      platform,
      theme,
      count: platOrders.length,
      amount,
      pct,
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-extrabold tracking-tight text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-amber-500" />
          Analitica &amp; Storico Turni HAM
        </h2>
        <p className="text-xs sm:text-sm text-zinc-500 dark:text-zinc-400">
          Riepilogo incassi per canale, metodi di pagamento e storico riconciliazioni cassa.
        </p>
      </div>

      {/* KPI globali */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="p-4">
          <div className="flex items-center justify-between text-xs text-zinc-500 font-semibold">
            <span>Fatturato Consegnato</span>
            <TrendingUp className="h-4 w-4 text-amber-500" />
          </div>
          <p className="font-mono text-2xl font-extrabold mt-2 text-zinc-900 dark:text-zinc-50 tabular-nums">
            {formatEuro(totalRevenueAll)}
          </p>
          <p className="text-[11px] text-zinc-500 mt-1">
            {deliveredOrders.length} ordini completati su {db.shifts.length} turni
          </p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between text-xs text-emerald-600 dark:text-emerald-400 font-semibold">
            <span>Incasso Contanti</span>
            <Banknote className="h-4 w-4" />
          </div>
          <p className="font-mono text-2xl font-extrabold mt-2 text-emerald-600 dark:text-emerald-400 tabular-nums">
            {formatEuro(totalCashAll)}
          </p>
          <p className="text-[11px] text-zinc-500 mt-1">
            Escluso fondo cassa iniziale
          </p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between text-xs text-sky-600 dark:text-sky-400 font-semibold">
            <span>Incasso POS Mobile</span>
            <CreditCard className="h-4 w-4" />
          </div>
          <p className="font-mono text-2xl font-extrabold mt-2 text-sky-600 dark:text-sky-400 tabular-nums">
            {formatEuro(totalPosAll)}
          </p>
          <p className="text-[11px] text-zinc-500 mt-1">
            Da verificare con chiusure POS
          </p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between text-xs text-violet-600 dark:text-violet-400 font-semibold">
            <span>Pagato su Piattaforma</span>
            <Globe className="h-4 w-4" />
          </div>
          <p className="font-mono text-2xl font-extrabold mt-2 text-violet-600 dark:text-violet-400 tabular-nums">
            {formatEuro(totalPrepaidAll)}
          </p>
          <p className="text-[11px] text-zinc-500 mt-1">
            0 € movimento contanti rider
          </p>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Ripartizione per Piattaforma */}
        <Card className="lg:col-span-5 p-5">
          <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-50 mb-4">
            Fatturato per Canale / Piattaforma
          </h3>
          <div className="space-y-3.5">
            {platformBreakdown.map((item) => (
              <div key={item.platform}>
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <div className="flex items-center gap-2">
                    <Badge variant={item.theme.badgeVariant} className="font-extrabold">
                      <span className={cn('h-2 w-2 rounded-full', item.theme.dotClass)} />
                      {item.theme.fullName}
                    </Badge>
                    <span className="text-zinc-400 font-normal">({item.count})</span>
                  </div>
                  <span className="font-mono font-bold text-zinc-900 dark:text-zinc-100 tabular-nums">
                    {formatEuro(item.amount)} ({item.pct}%)
                  </span>
                </div>
                <div className="h-2.5 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                  <div
                    className={cn('h-full rounded-full transition-all', item.theme.barClass)}
                    style={{ width: `${item.pct}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Storico Turni e Riconciliazioni */}
        <Card className="lg:col-span-7 p-5">
          <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-50 mb-4 flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-amber-500" />
            Storico Turni &amp; Riconciliazioni Cassa
          </h3>

          <div className="space-y-3">
            {db.shifts.map((shift) => {
              const rsList = db.riderShifts.filter((rs) => rs.shift_id === shift.id);
              const shiftOrdersCount = db.orders.filter(
                (o) => o.shift_id === shift.id && o.status === 'delivered'
              ).length;

              return (
                <div
                  key={shift.id}
                  className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/60 p-3.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-bold text-zinc-900 dark:text-zinc-100">
                        {shift.date}
                      </span>
                      <Badge variant={shift.status === 'open' ? 'amber' : 'green'}>
                        {shift.status === 'open' ? 'Aperto' : 'Chiuso'}
                      </Badge>
                      <span className="text-xs text-zinc-500">
                        {shiftOrdersCount} consegne
                      </span>
                    </div>
                    <span className="font-mono text-base font-extrabold text-zinc-900 dark:text-zinc-50">
                      {formatEuro(shift.total_revenue)}
                    </span>
                  </div>

                  {shift.notes && (
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2.5">
                      {shift.notes}
                    </p>
                  )}

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {riders.map((r) => {
                      const rs = rsList.find((x) => x.rider_id === r.id);
                      if (!rs) return null;
                      const disc = evaluateDiscrepancy(
                        rs.expected_cash_return,
                        rs.actual_cash_returned
                      );
                      return (
                        <div
                          key={r.id}
                          className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-2 text-[11px]"
                        >
                          <div className="font-bold text-zinc-900 dark:text-zinc-100 truncate">
                            {r.name}
                          </div>
                          <div className="text-zinc-500 font-mono mt-0.5">
                            Atteso: {formatEuro(rs.expected_cash_return)}
                          </div>
                          {rs.is_settled ? (
                            <div
                              className={
                                disc.level === 'exact'
                                  ? 'text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1 mt-0.5'
                                  : disc.level === 'shortage'
                                  ? 'text-rose-600 dark:text-rose-400 font-bold mt-0.5'
                                  : 'text-amber-600 dark:text-amber-400 font-bold mt-0.5'
                              }
                            >
                              {disc.level === 'exact' && (
                                <CheckCircle2 className="h-3 w-3 shrink-0" />
                              )}
                              {disc.level === 'exact'
                                ? 'Quadra'
                                : disc.level === 'shortage'
                                ? `${formatEuro(disc.discrepancy)}`
                                : `+${formatEuro(disc.discrepancy)}`}
                            </div>
                          ) : (
                            <div className="text-zinc-400 mt-0.5">In corso</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
};
