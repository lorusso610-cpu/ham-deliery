import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Banknote,
  CheckCircle2,
  CreditCard,
  Globe,
  MapPin,
  Mic,
  MicOff,
  Pencil,
  PlusCircle,
  Sparkles,
} from 'lucide-react';
import {
  getPlatformTheme,
  ORDER_PLATFORMS,
  type CanonicalOrderPlatform,
  type PaymentMethod,
} from '@/types/database';
import { formatEuro, parseEuroInput } from '@/lib/currency';
import { parseVoiceOrderTranscript } from '@/lib/voiceOrderParser';
import { useAppStore } from '@/lib/store';
import {
  AltamuraAddressInput,
  type ResolvedAltamuraAddress,
} from '@/components/AltamuraAddressInput';
import { Badge, Button, Input, Modal, cn } from '@/components/ui/primitives';

// Tipizzazione compatibile con Web Speech API (SpeechRecognition / webkitSpeechRecognition)
interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
  length: number;
}

interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
}

interface SpeechRecognitionErrorEventLike extends Event {
  error: string;
  message?: string;
}

interface SpeechRecognitionInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

function getSpeechRecognitionCtor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const PAYMENT_SELECTOR_OPTIONS: Array<{
  id: PaymentMethod;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  activeClass: string;
}> = [
  {
    id: 'cash',
    label: 'Contanti',
    icon: Banknote,
    activeClass: 'bg-emerald-600 text-white border-emerald-600 shadow-sm',
  },
  {
    id: 'pos_rider',
    label: 'POS',
    icon: CreditCard,
    activeClass: 'bg-sky-600 text-white border-sky-600 shadow-sm',
  },
  {
    id: 'prepaid_platform',
    label: 'Pagato',
    icon: Globe,
    activeClass: 'bg-violet-600 text-white border-violet-600 shadow-sm',
  },
];

interface RiderAddDeliverySectionProps {
  shiftId: string;
  riderId: string;
  riderName: string;
  activeRound?: number;
  onOrderSaved?: () => void;
}

export const RiderAddDeliverySection: React.FC<RiderAddDeliverySectionProps> = ({
  shiftId,
  riderId,
  riderName,
  activeRound,
  onOrderSaved,
}) => {
  const { createOrder, getRiderCurrentRound, pushToast } = useAppStore();
  const targetRound = activeRound ?? getRiderCurrentRound(shiftId, riderId);

  // Campi obbligatori del form "Aggiungi"
  const [customerAddress, setCustomerAddress] = useState('');
  const [resolvedCoords, setResolvedCoords] = useState<{
    lat: number | null;
    lng: number | null;
  }>({ lat: null, lng: null });
  const [amountInput, setAmountInput] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [platform, setPlatform] = useState<CanonicalOrderPlatform>('Gestionale');

  // Validazione & Errori
  const [formError, setFormError] = useState<string | null>(null);

  // Stato Comando Vocale (Web Speech API it-IT)
  const [isListening, setIsListening] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const [voiceStatusMsg, setVoiceStatusMsg] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const addressInputRef = useRef<HTMLInputElement | null>(null);

  // Stato Step 3: Modale di Review e Conferma Finale
  const [reviewOpen, setReviewOpen] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);

  const handleAddressChange = useCallback((resolved: ResolvedAltamuraAddress) => {
    setCustomerAddress(resolved.fullAddress);
    setResolvedCoords({ lat: resolved.lat, lng: resolved.lng });
    setFormError(null);
  }, []);

  const applyTranscriptToFields = useCallback(
    (transcriptText: string) => {
      const parsed = parseVoiceOrderTranscript(transcriptText);

      if (parsed.resolvedAddress.fullAddress) {
        setCustomerAddress(parsed.resolvedAddress.fullAddress);
        setResolvedCoords({
          lat: parsed.resolvedAddress.lat,
          lng: parsed.resolvedAddress.lng,
        });
      }
      if (parsed.amountFormatted) {
        setAmountInput(parsed.amountFormatted);
      }
      if (parsed.paymentMethod) {
        setPaymentMethod(parsed.paymentMethod);
      }
      if (parsed.platform) {
        setPlatform(parsed.platform);
      }

      setFormError(null);
      setVoiceStatusMsg('Campi precompilati dal comando vocale. Verifica e premi Aggiungi.');
      pushToast({
        title: 'Comando vocale riconosciuto',
        description: `«${transcriptText}»`,
        variant: 'success',
      });
    },
    [pushToast]
  );

  // Pulizia istanza SpeechRecognition su unmount
  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
    };
  }, []);

  const toggleVoiceCommand = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const SpeechCtor = getSpeechRecognitionCtor();
    if (!SpeechCtor) {
      setFormError(
        'Il tuo browser non supporta la Web Speech API (usa Chrome, Safari o Edge).'
      );
      return;
    }

    try {
      const recognition = new SpeechCtor();
      recognition.lang = 'it-IT';
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        setIsListening(true);
        setFormError(null);
        setVoiceTranscript('');
        setVoiceStatusMsg(
          'In ascolto (it-IT)... Es: "Via Roma 15, 18 euro contanti, Just Eat"'
        );
      };

      let latestTranscript = '';

      recognition.onresult = (event: SpeechRecognitionEventLike) => {
        let combined = '';
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          combined += event.results[i][0].transcript;
        }
        latestTranscript = combined.trim();
        setVoiceTranscript(latestTranscript);

        const lastResult = event.results[event.results.length - 1];
        if (lastResult?.isFinal && latestTranscript) {
          applyTranscriptToFields(latestTranscript);
        }
      };

      recognition.onerror = (event: SpeechRecognitionErrorEventLike) => {
        setIsListening(false);
        if (event.error === 'not-allowed') {
          setFormError(
            'Permesso microfono negato. Consenti l’accesso al microfono nelle impostazioni del browser.'
          );
        } else if (event.error !== 'aborted') {
          setFormError(`Errore riconoscimento vocale (${event.error}). Riprova.`);
        }
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch {
      setIsListening(false);
      setFormError('Impossibile avviare il microfono. Verifica i permessi del browser.');
    }
  };

  // Apertura Step di Review dopo validazione campi obbligatori
  const handleOpenReview = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanAddr = customerAddress.trim();
    if (cleanAddr.length < 3) {
      setFormError('Inserisci una Via / Indirizzo valido (minimo 3 caratteri).');
      addressInputRef.current?.focus();
      return;
    }

    const parsedAmount = parseEuroInput(amountInput);
    if (Number.isNaN(parsedAmount) || parsedAmount <= 0) {
      setFormError('Inserisci un Importo valido maggiore di € 0,00 (es. 18,00).');
      return;
    }

    setFormError(null);
    setReviewOpen(true);
  };

  // Salvataggio definitivo dopo Conferma Finale nello step di Review
  const handleFinalConfirm = async () => {
    const parsedAmount = parseEuroInput(amountInput);
    if (Number.isNaN(parsedAmount) || parsedAmount <= 0) return;

    setSavingOrder(true);
    await createOrder({
      shift_id: shiftId,
      rider_id: riderId,
      customer_address: customerAddress.trim(),
      lat: resolvedCoords.lat,
      lng: resolvedCoords.lng,
      platform,
      order_total: parsedAmount,
      payment_method: paymentMethod,
      change_needed: 0,
      round_number: targetRound,
    });
    setSavingOrder(false);
    setReviewOpen(false);

    // Reset campi form
    setCustomerAddress('');
    setResolvedCoords({ lat: null, lng: null });
    setAmountInput('');
    setVoiceTranscript('');
    setVoiceStatusMsg(null);
    setFormError(null);
    onOrderSaved?.();
  };

  const selectedChannelTheme = getPlatformTheme(platform);
  const parsedReviewAmount = parseEuroInput(amountInput);
  const selectedPaymentLabel =
    PAYMENT_SELECTOR_OPTIONS.find((p) => p.id === paymentMethod)?.label ?? 'Contanti';

  return (
    <>
      <div
        className={cn(
          'p-5 sm:p-6 space-y-4 rounded-[32px] border transition-all shadow-sm',
          'bg-[#faf8f5] dark:bg-[#151518] border-[#ebe5dc] dark:border-zinc-800'
        )}
      >
        {/* Intestazione Sezione "Aggiungi" + Pulsante Comando Vocale (Stile Pill Nero come da mockup) */}
        <div className="flex items-center justify-between gap-2">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#141414] text-white dark:bg-white dark:text-[#121212] shadow-sm">
            <PlusCircle className="h-4 w-4" />
            <span className="text-xs font-black uppercase tracking-wider">AGGIUNGI</span>
          </div>

          {/* Pulsante Microfono Web Speech API (it-IT) stile pill nera "DETTA" */}
          <button
            type="button"
            onClick={toggleVoiceCommand}
            className={cn(
              'inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-black uppercase tracking-wider transition-all shrink-0 active:scale-95 shadow-sm',
              isListening
                ? 'bg-rose-600 text-white animate-pulse shadow-rose-500/30'
                : 'bg-[#141414] text-white hover:bg-zinc-800 dark:bg-white dark:text-[#121212]'
            )}
            title="Detta consegna (es. 'Via Golgota 86, 18 euro contanti, Just Eat')"
            aria-label="Comando vocale aggiungi consegna"
          >
            {isListening ? (
              <>
                <MicOff className="h-3.5 w-3.5" />
                <span>STOP</span>
              </>
            ) : (
              <>
                <Mic className="h-3.5 w-3.5" />
                <span>DETTA</span>
              </>
            )}
          </button>
        </div>

        {/* Box Stato / Trascrizione Comando Vocale */}
        {(isListening || voiceTranscript || voiceStatusMsg) && (
          <div
            className={cn(
              'rounded-2xl border px-3 py-2 text-xs space-y-1 animate-dropdown-expand',
              isListening
                ? 'border-rose-500/50 bg-rose-500/10 text-rose-700 dark:text-rose-200'
                : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
            )}
          >
            {voiceStatusMsg && (
              <p className="font-bold flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 shrink-0" />
                <span>{voiceStatusMsg}</span>
              </p>
            )}
            {voiceTranscript && (
              <p className="font-mono text-[11px] opacity-95">
                🎙️ Trascrizione: <strong>&laquo;{voiceTranscript}&raquo;</strong>
              </p>
            )}
          </div>
        )}

        {formError && (
          <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-600 dark:text-rose-300 animate-validation-shake">
            {formError}
          </div>
        )}

        <form onSubmit={handleOpenReview} className="space-y-4">
          {/* 1. Via / Indirizzo (con autocompletamento stradario Altamura) */}
          <div>
            <label className="block text-xs font-black uppercase tracking-wider text-zinc-900 dark:text-zinc-100 mb-2">
              1. VIA / INDIRIZZO *
            </label>
            <AltamuraAddressInput
              value={customerAddress}
              onChangeAddress={handleAddressChange}
              inputRef={addressInputRef}
              placeholder="Es. Via Golgota 86 o Piazza Duomo..."
            />
          </div>

          {/* 2. Importo (input numerico in €) */}
          <div>
            <label className="block text-xs font-black uppercase tracking-wider text-zinc-900 dark:text-zinc-100 mb-2">
              2. IMPORTO (€) *
            </label>
            <div className="relative">
              <span className="absolute left-4 top-3 text-lg font-black text-zinc-900 dark:text-zinc-100">
                €
              </span>
              <Input
                value={amountInput}
                onChange={(e) => {
                  setAmountInput(e.target.value);
                  setFormError(null);
                }}
                inputMode="decimal"
                placeholder="18,00"
                className="pl-9 h-12 rounded-2xl border border-zinc-200/90 dark:border-zinc-800 bg-[#f8f8fa] dark:bg-zinc-900/90 font-mono text-lg font-black text-zinc-900 dark:text-zinc-50 tabular-nums shadow-sm"
                required
              />
            </div>
          </div>

          {/* 3. Metodo di pagamento: selettore esclusivo tra Contanti, POS, Pagato */}
          <div>
            <label className="block text-xs font-black uppercase tracking-wider text-zinc-900 dark:text-zinc-100 mb-2">
              3. METODO DI PAGAMENTO *
            </label>
            <div className="grid grid-cols-3 gap-2 sm:gap-2.5">
              {PAYMENT_SELECTOR_OPTIONS.map(({ id, label, icon: Icon }) => {
                const active = paymentMethod === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setPaymentMethod(id)}
                    className={cn(
                      'h-12 rounded-2xl border text-sm font-bold flex items-center justify-center gap-1.5 transition-all active:scale-95 shadow-sm',
                      active
                        ? id === 'cash'
                          ? 'bg-[#107c55] text-white border-[#107c55]'
                          : id === 'pos_rider'
                          ? 'bg-sky-600 text-white border-sky-600'
                          : 'bg-violet-600 text-white border-violet-600'
                        : 'border-zinc-200/90 dark:border-zinc-800 bg-[#f8f8fa] dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 hover:border-zinc-400'
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 4. Canale / App: selettore tra App (Blu), Gestionale (Giallo), Just Eat (Arancione) */}
          <div>
            <label className="block text-xs font-black uppercase tracking-wider text-zinc-900 dark:text-zinc-100 mb-2">
              4. CANALE / APP *
            </label>
            <div className="grid grid-cols-3 gap-2 sm:gap-2.5">
              {ORDER_PLATFORMS.map((p) => {
                const ch = getPlatformTheme(p);
                const active = platform === p;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPlatform(p)}
                    className={cn(
                      'h-12 rounded-2xl border text-sm font-bold flex items-center justify-center gap-2 transition-all active:scale-95 shadow-sm',
                      active
                        ? p === 'Gestionale'
                          ? 'bg-[#f59e0b] text-[#141414] border-[#d97706]'
                          : p === 'App'
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-orange-500 text-white border-orange-500'
                        : 'border-zinc-200/90 dark:border-zinc-800 bg-[#f8f8fa] dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 hover:border-zinc-400'
                    )}
                  >
                    <span
                      className={cn(
                        'h-2.5 w-2.5 rounded-full shrink-0',
                        active ? (p === 'Gestionale' ? 'bg-[#141414]' : 'bg-white') : ch.dotClass
                      )}
                    />
                    <span>{ch.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Pulsante Principale Stile Pillola Nera Extra Arrotondata come da Mockup */}
          <button
            type="submit"
            className="w-full h-14 rounded-full bg-[#141414] hover:bg-zinc-800 text-white dark:bg-white dark:hover:bg-zinc-200 dark:text-[#121212] text-xs sm:text-sm font-black uppercase tracking-wider flex items-center justify-center gap-2 shadow-md transition-all active:scale-[0.99] mt-2"
          >
            <PlusCircle className="h-5 w-5" />
            <span>VERIFICA &amp; AGGIUNGI CONSEGNA</span>
          </button>
        </form>
      </div>

      {/* STEP 3: Modale di Review e Conferma Finale */}
      <Modal
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        title="Review & Conferma Finale Consegna"
        subtitle={`Controlla i dati prima di salvare nella lista di ${riderName}`}
        maxWidthClass="max-w-md"
      >
        <div className="space-y-4">
          {voiceTranscript && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
              🎙️ Dettato vocale: <strong>&laquo;{voiceTranscript}&raquo;</strong>
            </div>
          )}

          {/* Card Riepilogativa colorata in base al Canale (Blu / Giallo / Arancione) */}
          <div
            className={cn(
              'rounded-2xl border p-4 space-y-3',
              selectedChannelTheme.rowBg
            )}
          >
            <div className="flex items-center justify-between gap-2 border-b border-zinc-200/70 dark:border-zinc-800/70 pb-2.5">
              <span className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Canale / App
              </span>
              <Badge
                variant={selectedChannelTheme.badgeVariant}
                className="text-xs px-3 py-0.5 font-extrabold"
              >
                <span
                  className={cn('h-2 w-2 rounded-full', selectedChannelTheme.dotClass)}
                />
                {selectedChannelTheme.fullName}
              </Badge>
            </div>

            <div className="flex items-start justify-between gap-3 border-b border-zinc-200/70 dark:border-zinc-800/70 pb-2.5">
              <span className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 shrink-0">
                Via / Indirizzo
              </span>
              <div className="text-right min-w-0">
                <p className="font-extrabold text-sm text-zinc-900 dark:text-zinc-50 break-words flex items-center justify-end gap-1">
                  <MapPin
                    className={cn('h-4 w-4 shrink-0', selectedChannelTheme.textClass)}
                  />
                  <span>{customerAddress}</span>
                </p>
                {resolvedCoords.lat !== null && resolvedCoords.lng !== null && (
                  <p className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 mt-0.5">
                    Coordinate agganciate alla mappa
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 border-b border-zinc-200/70 dark:border-zinc-800/70 pb-2.5">
              <span className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Metodo Pagamento
              </span>
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 font-extrabold text-xs px-2.5 py-1 rounded-lg',
                  paymentMethod === 'cash'
                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                    : paymentMethod === 'pos_rider'
                    ? 'bg-sky-500/15 text-sky-700 dark:text-sky-300'
                    : 'bg-violet-500/15 text-violet-700 dark:text-violet-300'
                )}
              >
                {paymentMethod === 'cash' && <Banknote className="h-3.5 w-3.5" />}
                {paymentMethod === 'pos_rider' && <CreditCard className="h-3.5 w-3.5" />}
                {paymentMethod === 'prepaid_platform' && <Globe className="h-3.5 w-3.5" />}
                {selectedPaymentLabel}
              </span>
            </div>

            <div className="flex items-center justify-between gap-2 pt-0.5">
              <span className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Importo Ordine
              </span>
              <span className="font-mono text-2xl font-black text-zinc-900 dark:text-zinc-50 tabular-nums">
                {formatEuro(Number.isNaN(parsedReviewAmount) ? 0 : parsedReviewAmount)}
              </span>
            </div>
          </div>

          {/* Pulsanti Modifica e Conferma Finale */}
          <div className="grid grid-cols-2 gap-2.5 pt-1">
            <Button
              type="button"
              variant="outline"
              size="lg"
              disabled={savingOrder}
              onClick={() => setReviewOpen(false)}
              className="w-full font-bold"
            >
              <Pencil className="h-4 w-4" />
              Modifica
            </Button>
            <Button
              type="button"
              variant="success"
              size="lg"
              loading={savingOrder}
              disabled={savingOrder}
              onClick={() => void handleFinalConfirm()}
              className="w-full font-bold"
            >
              <CheckCircle2 className="h-4 w-4" />
              Conferma Finale
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
};
