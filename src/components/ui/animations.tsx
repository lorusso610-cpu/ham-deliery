import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { formatEuro } from '@/lib/currency';
import { cn } from '@/components/ui/primitives';

/**
 * 6. KPI Number Ticker: Conteggio animato rapido (500ms) dei valori in Euro
 */
export const AnimatedEuro: React.FC<{
  value: number;
  className?: string;
  durationMs?: number;
}> = ({ value, className, durationMs = 480 }) => {
  const [displayValue, setDisplayValue] = useState<number>(value);
  const prevValueRef = useRef<number>(value);

  useEffect(() => {
    const startVal = prevValueRef.current;
    const endVal = value;
    if (Math.abs(endVal - startVal) < 0.005) {
      setDisplayValue(endVal);
      prevValueRef.current = endVal;
      return;
    }

    let rafId = 0;
    const startTime = performance.now();

    const step = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / durationMs);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = startVal + (endVal - startVal) * eased;
      setDisplayValue(progress >= 1 ? endVal : current);
      if (progress < 1) {
        rafId = requestAnimationFrame(step);
      } else {
        prevValueRef.current = endVal;
      }
    };

    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [value, durationMs]);

  return <span className={cn('tabular-nums', className)}>{formatEuro(displayValue)}</span>;
};

/**
 * 1. Progress Bar lineare (Top-bar): Linea sottile (2.5px) in cima alla finestra
 * che avanza durante il cambio scheda o aggiornamenti dati.
 */
export const TopProgressBar: React.FC<{ triggerKey: string | number }> = ({
  triggerKey,
}) => {
  const [visible, setVisible] = useState(false);
  const [widthPct, setWidthPct] = useState(0);
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    setVisible(true);
    setWidthPct(28);
    const t1 = setTimeout(() => setWidthPct(78), 70);
    const t2 = setTimeout(() => setWidthPct(100), 210);
    const t3 = setTimeout(() => {
      setVisible(false);
      setWidthPct(0);
    }, 380);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [triggerKey]);

  if (!visible) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[80] h-[2.5px] bg-transparent pointer-events-none overflow-hidden">
      <div
        className="h-full bg-zinc-950 dark:bg-white transition-all duration-150 ease-out"
        style={{ width: `${widthPct}%` }}
      />
    </div>
  );
};

/**
 * 5. SVG Checkmark Draw: Animazione del tratto vettoriale (stroke-dashoffset)
 */
export const SvgCheckmark: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={cn('h-4 w-4', className)}
  >
    <path d="M20 6L9 17l-5-5" className="animate-svg-check" />
  </svg>
);

/**
 * 7. Copy-to-Clipboard Morph: L'icona "copia" si trasforma per 1.5s in una spunta verde con tooltip "Copiato!"
 */
export const CopyToClipboardButton: React.FC<{
  text: string;
  className?: string;
  label?: string;
}> = ({ text, className, label }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore clipboard errors
    }
  };

  return (
    <button
      type="button"
      onClick={(e) => void handleCopy(e)}
      className={cn(
        'relative inline-flex items-center justify-center rounded-full p-1 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200/60 dark:hover:bg-zinc-800 transition-all',
        copied && 'text-emerald-600 dark:text-emerald-400',
        className
      )}
      title={copied ? 'Copiato!' : label ?? 'Copia indirizzo'}
      aria-label={copied ? 'Copiato!' : label ?? 'Copia indirizzo'}
    >
      {copied ? (
        <>
          <SvgCheckmark className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
          <span className="absolute -top-7 left-1/2 -translate-x-1/2 rounded-md bg-zinc-950 dark:bg-white text-white dark:text-zinc-950 px-1.5 py-0.5 text-[10px] font-semibold shadow-md whitespace-nowrap animate-fade-in">
            Copiato!
          </span>
        </>
      ) : (
        <Copy className="h-3 w-3" />
      )}
    </button>
  );
};

/**
 * 5. Auto-save Status Morph: Transizione silenziosa nell'header ("Sincronizzazione..." -> "Salvato • HH:MM")
 */
export const AutoSaveStatusPill: React.FC<{ triggerKey: number }> = ({
  triggerKey,
}) => {
  const [status, setStatus] = useState<'saving' | 'saved'>('saved');
  const [timeStr, setTimeStr] = useState<string>(() =>
    new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
  );
  const isFirst = useRef(true);

  useEffect(() => {
    if (isFirst.current) {
      isFirst.current = false;
      return;
    }
    setStatus('saving');
    const timer = setTimeout(() => {
      setStatus('saved');
      setTimeStr(
        new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
      );
    }, 420);
    return () => clearTimeout(timer);
  }, [triggerKey]);

  return (
    <div className="hidden lg:inline-flex items-center gap-1.5 rounded-full bg-zinc-100 dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 px-3 py-1 text-[11px] font-medium text-zinc-500 dark:text-zinc-400 transition-all">
      {status === 'saving' ? (
        <>
          <span className="h-2 w-2 rounded-full bg-zinc-900 dark:bg-white animate-ping" />
          <span>Salvataggio...</span>
        </>
      ) : (
        <>
          <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400 animate-svg-check" />
          <span>Salvato {timeStr}</span>
        </>
      )}
    </div>
  );
};
