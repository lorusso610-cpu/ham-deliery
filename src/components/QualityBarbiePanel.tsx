import React from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Award,
  CheckCircle2,
  Lightbulb,
  PackageCheck,
  PackageX,
  Star,
} from 'lucide-react';
import { formatEuro, parseEuroInput, sumEuro } from '@/lib/currency';
import { useAppStore } from '@/lib/store';
import { Badge, Button, Card, Input, cn } from '@/components/ui/primitives';

const qualitySchema = z.object({
  rider_id: z.string().min(1, 'Seleziona un rider'),
  rating: z.number().int().min(1).max(5),
  packaging_check: z.boolean(),
  notes: z.string().trim().min(3, 'Inserisci una nota qualità o proposta innovativa'),
  bonus_malus_amount: z.string().refine((val) => {
    if (!val.trim()) return true;
    return !Number.isNaN(parseEuroInput(val));
  }, 'Importo non valido (es. 5,00 o -2,00)'),
});

type QualityFormValues = z.infer<typeof qualitySchema>;

export const QualityBarbiePanel: React.FC = () => {
  const { db, activeShift, riders, addQualityLog } = useAppStore();
  const targetShiftId = activeShift?.id ?? db.shifts[0]?.id ?? '';

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<QualityFormValues>({
    resolver: zodResolver(qualitySchema),
    defaultValues: {
      rider_id: riders[0]?.id ?? '',
      rating: 5,
      packaging_check: true,
      notes: '',
      bonus_malus_amount: '0,00',
    },
  });

  const onSubmit = async (data: QualityFormValues) => {
    if (!targetShiftId) return;
    const bonusMalus = data.bonus_malus_amount.trim()
      ? parseEuroInput(data.bonus_malus_amount)
      : 0;
    await addQualityLog({
      shift_id: targetShiftId,
      rider_id: data.rider_id,
      rating: data.rating,
      packaging_check: data.packaging_check,
      notes: data.notes,
      bonus_malus_amount: bonusMalus,
    });
    reset({
      rider_id: data.rider_id,
      rating: 5,
      packaging_check: true,
      notes: '',
      bonus_malus_amount: '0,00',
    });
  };

  const riderStats = riders.map((r) => {
    const logs = db.qualityLogs.filter((q) => q.rider_id === r.id);
    const avgRating =
      logs.length > 0
        ? logs.reduce((acc, l) => acc + l.rating, 0) / logs.length
        : null;
    const totalBonus = sumEuro(...logs.map((l) => l.bonus_malus_amount));
    const packagingRate =
      logs.length > 0
        ? Math.round((logs.filter((l) => l.packaging_check).length / logs.length) * 100)
        : null;
    return {
      rider: r,
      logsCount: logs.length,
      avgRating,
      totalBonus,
      packagingRate,
    };
  });

  return (
    <div className="space-y-6">
      {/* Header modulo Barbiè */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold tracking-tight text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
            <Award className="h-5 w-5 text-amber-500" />
            QUALITÀ / INNOVAZIONE BARBIÈ
          </h2>
          <p className="text-xs sm:text-sm text-zinc-500 dark:text-zinc-400">
            Controllo standard servizio a domicilio: integrità packaging, puntualità, proposte operative e premi turno.
          </p>
        </div>
      </div>

      {/* Riepilogo scorecard per rider */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {riderStats.map(({ rider, logsCount, avgRating, totalBonus, packagingRate }) => (
          <Card key={rider.id} className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="h-6 w-6 rounded-lg bg-amber-500 text-zinc-950 font-mono text-xs font-black flex items-center justify-center">
                  {rider.rider_number ?? '#'}
                </span>
                <span className="font-bold text-sm text-zinc-900 dark:text-zinc-100">
                  {rider.name}
                </span>
              </div>
              <Badge variant="neutral">{logsCount} log</Badge>
            </div>

            <div className="flex items-baseline justify-between mt-3">
              <div className="flex items-center gap-1">
                <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                <span className="font-mono text-lg font-extrabold">
                  {avgRating !== null ? avgRating.toFixed(1) : '—'}
                </span>
                <span className="text-xs text-zinc-400">/ 5</span>
              </div>
              <span
                className={cn(
                  'font-mono text-sm font-bold',
                  totalBonus > 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : totalBonus < 0
                    ? 'text-rose-600 dark:text-rose-400'
                    : 'text-zinc-500'
                )}
              >
                {totalBonus > 0 ? `+${formatEuro(totalBonus)}` : formatEuro(totalBonus)}
              </span>
            </div>

            <p className="text-[11px] text-zinc-500 mt-1">
              Packaging OK:{' '}
              <strong>{packagingRate !== null ? `${packagingRate}%` : 'Nessun dato'}</strong>
            </p>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Form Nuova Valutazione Barbiè */}
        <Card className="lg:col-span-5 p-5">
          <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2 mb-4">
            <Lightbulb className="h-4 w-4 text-amber-500" />
            Nuova Scheda Qualità / Idea Innovazione
          </h3>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400 mb-1">
                Rider Valutato
              </label>
              <select
                {...register('rider_id')}
                className="w-full h-10 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100"
              >
                {riders.map((r) => (
                  <option key={r.id} value={r.id}>
                    #{r.rider_number} {r.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400 mb-1.5">
                Valutazione Servizio &amp; Puntualità (1-5)
              </label>
              <Controller
                control={control}
                name="rating"
                render={({ field }) => (
                  <div className="flex items-center gap-2">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        onClick={() => field.onChange(star)}
                        className={cn(
                          'h-10 w-10 rounded-xl border flex items-center justify-center transition-all',
                          field.value >= star
                            ? 'border-amber-500 bg-amber-500/15 text-amber-500'
                            : 'border-zinc-200 dark:border-zinc-800 text-zinc-400'
                        )}
                      >
                        <Star
                          className={cn(
                            'h-5 w-5',
                            field.value >= star && 'fill-amber-400'
                          )}
                        />
                      </button>
                    ))}
                  </div>
                )}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400 mb-1.5">
                  Integrità Packaging
                </label>
                <Controller
                  control={control}
                  name="packaging_check"
                  render={({ field }) => (
                    <button
                      type="button"
                      onClick={() => field.onChange(!field.value)}
                      className={cn(
                        'w-full h-10 rounded-xl border px-3 flex items-center justify-center gap-2 text-xs font-bold transition-all',
                        field.value
                          ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-600 dark:text-emerald-300'
                          : 'border-rose-500/50 bg-rose-500/15 text-rose-600 dark:text-rose-300'
                      )}
                    >
                      {field.value ? (
                        <>
                          <PackageCheck className="h-4 w-4" /> Packaging Integro
                        </>
                      ) : (
                        <>
                          <PackageX className="h-4 w-4" /> Anomalia Packaging
                        </>
                      )}
                    </button>
                  )}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400 mb-1.5">
                  Premio / Malus (€)
                </label>
                <Input
                  {...register('bonus_malus_amount')}
                  inputMode="decimal"
                  placeholder="Es. 5,00 o -2,00"
                  className="font-mono font-bold"
                />
                {errors.bonus_malus_amount && (
                  <p className="text-xs text-rose-500 mt-1">
                    {errors.bonus_malus_amount.message}
                  </p>
                )}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400 mb-1.5">
                Note Qualità / Proposte Innovazione Team
              </label>
              <textarea
                {...register('notes')}
                rows={3}
                placeholder="Es. Consegna impeccabile, sigilli integri. Proposta: buste termiche dedicate per fritti..."
                className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 p-3 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-amber-500/60"
              />
              {errors.notes && (
                <p className="text-xs text-rose-500 mt-1">{errors.notes.message}</p>
              )}
            </div>

            <Button type="submit" className="w-full" disabled={isSubmitting || !targetShiftId}>
              <CheckCircle2 className="h-4 w-4" />
              Registra Valutazione Barbiè
            </Button>
          </form>
        </Card>

        {/* Feed storico valutazioni */}
        <Card className="lg:col-span-7 p-5">
          <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-50 mb-4">
            Registro Controlli &amp; Idee Barbiè ({db.qualityLogs.length})
          </h3>
          <div className="space-y-3 max-h-[460px] overflow-y-auto pr-1">
            {db.qualityLogs.length === 0 ? (
              <p className="text-sm text-zinc-500 py-8 text-center">
                Nessuna valutazione registrata.
              </p>
            ) : (
              db.qualityLogs.map((log) => {
                const rider = db.users.find((u) => u.id === log.rider_id);
                return (
                  <div
                    key={log.id}
                    className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950/60 p-3.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-zinc-900 dark:text-zinc-100">
                          {rider?.name ?? 'Rider'}
                        </span>
                        <div className="flex items-center gap-0.5">
                          {Array.from({ length: 5 }).map((_, i) => (
                            <Star
                              key={i}
                              className={cn(
                                'h-3.5 w-3.5',
                                i < log.rating
                                  ? 'fill-amber-400 text-amber-400'
                                  : 'text-zinc-300 dark:text-zinc-700'
                              )}
                            />
                          ))}
                        </div>
                        <Badge variant={log.packaging_check ? 'green' : 'red'}>
                          {log.packaging_check ? 'Packaging OK' : 'Packaging Ko'}
                        </Badge>
                      </div>

                      {log.bonus_malus_amount !== 0 && (
                        <Badge variant={log.bonus_malus_amount > 0 ? 'green' : 'red'}>
                          {log.bonus_malus_amount > 0
                            ? `Premio +${formatEuro(log.bonus_malus_amount)}`
                            : `Malus ${formatEuro(log.bonus_malus_amount)}`}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed">
                      {log.notes}
                    </p>
                    <p className="text-[10px] text-zinc-400 mt-1.5">
                      {new Date(log.created_at).toLocaleString('it-IT', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>
                );
              })
            )}
          </div>
        </Card>
      </div>
    </div>
  );
};
