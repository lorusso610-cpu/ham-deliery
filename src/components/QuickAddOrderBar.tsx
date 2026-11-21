import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Banknote,
  CreditCard,
  Globe,
  PlusCircle,
  Sparkles,
} from 'lucide-react';
import {
  getPlatformTheme,
  ORDER_PLATFORMS,
  type CanonicalOrderPlatform,
  type PaymentMethod,
  type User,
} from '@/types/database';
import { parseEuroInput } from '@/lib/currency';
import { useAppStore } from '@/lib/store';
import { Button, Card, Input, cn } from '@/components/ui/primitives';
import {
  AltamuraAddressInput,
  type ResolvedAltamuraAddress,
} from '@/components/AltamuraAddressInput';

const quickOrderSchema = z.object({
  customer_address: z
    .string()
    .trim()
    .min(3, 'Inserisci un indirizzo valido (min 3 caratteri)'),
  platform: z.enum(['App', 'Gestionale', 'JustEat']),
  order_total: z
    .string()
    .refine((val) => {
      const n = parseEuroInput(val);
      return !Number.isNaN(n) && n > 0;
    }, 'Importo ordine non valido o <= € 0,00 (es. 24,50)'),
  payment_method: z.enum(['cash', 'pos_rider', 'prepaid_platform']),
  change_needed: z.string().refine((val) => {
    if (!val.trim()) return true;
    const n = parseEuroInput(val);
    return !Number.isNaN(n) && n >= 0;
  }, 'Resto non valido (es. 5,00)'),
  rider_id: z.string().min(1, 'Seleziona un rider'),
});

type QuickOrderFormValues = z.infer<typeof quickOrderSchema>;

interface QuickAddOrderBarProps {
  shiftId: string;
  riders: User[];
}

export const QuickAddOrderBar: React.FC<QuickAddOrderBarProps> = ({
  shiftId,
  riders,
}) => {
  const { createOrder, getRiderCurrentRound } = useAppStore();
  const addressInputRef = useRef<HTMLInputElement | null>(null);
  const [resolvedCoords, setResolvedCoords] = useState<{
    lat: number | null;
    lng: number | null;
  }>({ lat: null, lng: null });

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<QuickOrderFormValues>({
    resolver: zodResolver(quickOrderSchema),
    defaultValues: {
      customer_address: '',
      platform: 'Gestionale',
      order_total: '',
      payment_method: 'cash',
      change_needed: '0,00',
      rider_id: riders[0]?.id ?? '',
    },
  });

  const customerAddressVal = watch('customer_address');
  const paymentMethod = watch('payment_method');
  const selectedPlatform = watch('platform');
  const selectedRider = watch('rider_id');

  const handleAddressChange = useCallback(
    (resolved: ResolvedAltamuraAddress) => {
      setValue('customer_address', resolved.fullAddress, {
        shouldValidate: resolved.fullAddress.trim().length >= 3,
      });
      setResolvedCoords({ lat: resolved.lat, lng: resolved.lng });
    },
    [setValue]
  );

  // Aggiorna rider default se cambia la lista
  useEffect(() => {
    if (!selectedRider && riders[0]?.id) {
      setValue('rider_id', riders[0].id);
    }
  }, [riders, selectedRider, setValue]);

  // Suggerisce metodo pagamento tipico del canale (sempre modificabile dall'operatore)
  const handlePlatformClick = (p: CanonicalOrderPlatform) => {
    setValue('platform', p);
    if (p === 'App' || p === 'JustEat') {
      setValue('payment_method', 'prepaid_platform');
      setValue('change_needed', '0,00');
    } else if (p === 'Gestionale') {
      setValue('payment_method', 'cash');
    }
  };

  // Scorciatoia da tastiera: "/" o Ctrl/Cmd + K per focus immediato su Indirizzo
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        addressInputRef.current?.focus();
      } else if (
        e.key === '/' &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA' &&
        document.activeElement?.tagName !== 'SELECT'
      ) {
        e.preventDefault();
        addressInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const onSubmit = async (data: QuickOrderFormValues) => {
    const orderTotal = parseEuroInput(data.order_total);
    const changeNeeded = data.change_needed.trim()
      ? parseEuroInput(data.change_needed)
      : 0;
    await createOrder({
      shift_id: shiftId,
      rider_id: data.rider_id,
      customer_address: data.customer_address,
      lat: resolvedCoords.lat,
      lng: resolvedCoords.lng,
      platform: data.platform,
      order_total: orderTotal,
      payment_method: data.payment_method,
      change_needed: data.payment_method === 'cash' ? changeNeeded : 0,
    });
    setResolvedCoords({ lat: null, lng: null });
    reset({
      customer_address: '',
      platform: data.platform,
      order_total: '',
      payment_method: data.payment_method,
      change_needed: '0,00',
      rider_id: data.rider_id,
    });
    addressInputRef.current?.focus();
  };

  return (
    <Card className="p-5 sm:p-6 border-zinc-200/80 dark:border-zinc-800/90 bg-white dark:bg-[#141417]">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2.5">
          <div className="h-7 w-7 rounded-full bg-[#141414] text-white dark:bg-[#f4f4f6] dark:text-[#121212] flex items-center justify-center shrink-0">
            <Sparkles className="h-3.5 w-3.5" />
          </div>
          <h2 className="text-sm font-bold tracking-tight text-zinc-950 dark:text-zinc-50">
            Nuovo Ordine Rapido
          </h2>
          <span className="hidden sm:inline-flex items-center rounded-full border border-zinc-200 dark:border-zinc-800 bg-zinc-100/80 dark:bg-zinc-900 px-2.5 py-0.5 font-mono text-[10px] text-zinc-500 dark:text-zinc-400">
            ⌘K o / per inserire • Invio per assegnare
          </span>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-3.5">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          {/* Indirizzo Altamura Offline Autocomplete + Civico */}
          <div className="md:col-span-5">
            <label className="block text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400 mb-1.5">
              Indirizzo Altamura &amp; Civico *
            </label>
            <input type="hidden" {...register('customer_address')} />
            <AltamuraAddressInput
              value={customerAddressVal}
              onChangeAddress={handleAddressChange}
              inputRef={addressInputRef}
              error={errors.customer_address?.message}
            />
          </div>

          {/* Importo € */}
          <div className="md:col-span-2">
            <label className="block text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400 mb-1.5">
              Totale (€) *
            </label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-sm font-bold text-zinc-900 dark:text-zinc-100">€</span>
              <Input
                {...register('order_total')}
                inputMode="decimal"
                placeholder="24,50"
                className="pl-7 font-mono font-bold tabular-nums"
              />
            </div>
            {errors.order_total && (
              <p className="text-xs text-rose-500 mt-1">{errors.order_total.message}</p>
            )}
          </div>

          {/* Resto specifico (solo se contanti) */}
          <div className="md:col-span-2">
            <label className="block text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400 mb-1.5">
              Resto da portare
            </label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-sm font-semibold text-zinc-400">
                €
              </span>
              <Input
                {...register('change_needed')}
                inputMode="decimal"
                disabled={paymentMethod !== 'cash'}
                placeholder="0,00"
                className="pl-7 font-mono tabular-nums disabled:opacity-40"
              />
            </div>
            {errors.change_needed && (
              <p className="text-xs text-rose-500 mt-1">{errors.change_needed.message}</p>
            )}
          </div>

          {/* Rider */}
          <div className="md:col-span-3">
            <label className="block text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400 mb-1.5">
              Assegna Rider *
            </label>
            <select
              {...register('rider_id')}
              className="w-full h-10 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/70 px-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900/20 dark:focus:ring-white/20"
            >
              {riders.map((r) => {
                const rRound = getRiderCurrentRound(shiftId, r.id);
                return (
                  <option key={r.id} value={r.id}>
                    {r.rider_number ? `#${r.rider_number} ` : ''}
                    {r.name} • Round {rRound}
                  </option>
                );
              })}
            </select>
            {errors.rider_id && (
              <p className="text-xs text-rose-500 mt-1">{errors.rider_id.message}</p>
            )}
          </div>
        </div>

        {/* Selettori rapidi Piattaforma + Metodo Pagamento + Submit */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mr-1">
              Canale:
            </span>
            {ORDER_PLATFORMS.map((p) => {
              const chTheme = getPlatformTheme(p);
              const isSelected = selectedPlatform === p;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => handlePlatformClick(p)}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-extrabold border transition-all',
                    isSelected
                      ? chTheme.activeButtonClass
                      : 'bg-zinc-100 dark:bg-zinc-800/80 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 hover:border-zinc-400'
                  )}
                >
                  <span
                    className={cn(
                      'h-2 w-2 rounded-full shrink-0',
                      isSelected ? 'bg-current opacity-85' : chTheme.dotClass
                    )}
                  />
                  {chTheme.fullName}
                </button>
              );
            })}
          </div>

          <Controller
            control={control}
            name="payment_method"
            render={({ field }) => (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mr-1">
                  Incasso:
                </span>
                {(
                  [
                    { id: 'cash', label: 'Contanti', icon: Banknote },
                    { id: 'pos_rider', label: 'POS Mobile', icon: CreditCard },
                    { id: 'prepaid_platform', label: 'Già Pagato', icon: Globe },
                  ] as { id: PaymentMethod; label: string; icon: React.ComponentType<{ className?: string }> }[]
                ).map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      field.onChange(id);
                      if (id !== 'cash') setValue('change_needed', '0,00');
                    }}
                    className={cn(
                      'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all',
                      field.value === id
                        ? id === 'cash'
                          ? 'bg-emerald-600 text-white border-emerald-600'
                          : id === 'pos_rider'
                          ? 'bg-sky-600 text-white border-sky-600'
                          : 'bg-violet-600 text-white border-violet-600'
                        : 'bg-zinc-100 dark:bg-zinc-800/80 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 hover:border-zinc-400'
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </button>
                ))}
              </div>
            )}
          />

          <Button type="submit" loading={isSubmitting} disabled={isSubmitting} className="ml-auto rounded-full">
            <PlusCircle className="h-4 w-4" />
            Assegna Ordine
          </Button>
        </div>
      </form>
    </Card>
  );
};
