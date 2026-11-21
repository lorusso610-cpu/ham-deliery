import React from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Loader2, X } from 'lucide-react';
import type { ToastItem } from '@/lib/store';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'success';
  size?: 'sm' | 'md' | 'lg' | 'icon';
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', loading = false, children, disabled, ...props }, ref) => {
    const variants: Record<NonNullable<ButtonProps['variant']>, string> = {
      primary:
        'bg-[#141414] text-white font-semibold hover:bg-zinc-800 dark:bg-[#f4f4f6] dark:text-[#121212] dark:hover:bg-white active:scale-[0.98]',
      secondary:
        'bg-zinc-200/75 text-zinc-900 hover:bg-zinc-200 dark:bg-zinc-800/90 dark:text-zinc-100 dark:hover:bg-zinc-700 font-medium active:scale-[0.98]',
      outline:
        'border border-zinc-300/90 dark:border-zinc-700 bg-transparent hover:bg-zinc-100 dark:hover:bg-zinc-800/70 text-zinc-900 dark:text-zinc-100 font-medium active:scale-[0.98]',
      ghost:
        'bg-transparent hover:bg-zinc-200/60 dark:hover:bg-zinc-800/70 text-zinc-700 dark:text-zinc-300 active:scale-[0.98]',
      danger:
        'bg-rose-600 text-white font-semibold hover:bg-rose-500 active:scale-[0.98]',
      success:
        'bg-[#141414] text-white font-semibold hover:bg-zinc-800 dark:bg-[#f4f4f6] dark:text-[#121212] dark:hover:bg-white active:scale-[0.98]',
    };

    const sizes: Record<NonNullable<ButtonProps['size']>, string> = {
      sm: 'h-8 px-3.5 text-xs rounded-full',
      md: 'h-10 px-4 text-sm rounded-2xl',
      lg: 'h-12 px-5 text-sm font-semibold rounded-2xl',
      icon: 'h-10 w-10 rounded-full flex items-center justify-center',
    };

    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          'relative inline-flex items-center justify-center gap-2 transition-all duration-150 disabled:opacity-45 disabled:pointer-events-none focus:outline-none focus:ring-2 focus:ring-zinc-900/20 dark:focus:ring-white/25',
          variants[variant],
          sizes[size],
          className
        )}
        {...props}
      >
        {loading && (
          <span className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="h-4 w-4 animate-spin" />
          </span>
        )}
        <span className={cn('inline-flex items-center justify-center gap-2', loading && 'opacity-0')}>
          {children}
        </span>
      </button>
    );
  }
);
Button.displayName = 'Button';

export const Card: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className,
  ...props
}) => (
  <div
    className={cn(
      'rounded-[28px] border border-zinc-200/80 dark:border-zinc-800/90 bg-white dark:bg-[#141417] shadow-[0_10px_30px_-15px_rgba(0,0,0,0.05)] dark:shadow-[0_14px_35px_-18px_rgba(0,0,0,0.55)]',
      className
    )}
    {...props}
  />
);

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'neutral' | 'amber' | 'yellow' | 'orange' | 'green' | 'red' | 'blue' | 'purple';
}

export const Badge: React.FC<BadgeProps> = ({
  className,
  variant = 'neutral',
  ...props
}) => {
  const styles: Record<NonNullable<BadgeProps['variant']>, string> = {
    neutral:
      'bg-zinc-100 text-zinc-900 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-100 dark:border-zinc-700',
    amber:
      'bg-zinc-100 text-zinc-900 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-100 dark:border-zinc-700',
    yellow:
      'bg-yellow-400/20 text-yellow-950 border-yellow-500/45 dark:bg-yellow-400/20 dark:text-yellow-200 dark:border-yellow-400/45',
    orange:
      'bg-orange-500/15 text-orange-900 border-orange-500/40 dark:bg-orange-500/20 dark:text-orange-200 dark:border-orange-500/45',
    green:
      'bg-emerald-500/12 text-emerald-900 border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-200 dark:border-emerald-500/35',
    red: 'bg-rose-500/12 text-rose-900 border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-200 dark:border-rose-500/35',
    blue: 'bg-blue-500/15 text-blue-900 border-blue-500/40 dark:bg-blue-500/20 dark:text-blue-200 dark:border-blue-500/40',
    purple:
      'bg-violet-500/12 text-violet-900 border-violet-500/30 dark:bg-violet-500/15 dark:text-violet-200 dark:border-violet-500/35',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap transition-transform duration-150',
        styles[variant],
        className
      )}
      {...props}
    />
  );
};

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      'w-full h-10 rounded-2xl border border-zinc-200/90 dark:border-zinc-800 bg-[#f4f4f5] dark:bg-zinc-900/80 px-3.5 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-900/15 dark:focus:ring-white/20 focus:border-zinc-900 dark:focus:border-zinc-300 focus:bg-white dark:focus:bg-zinc-900 transition-all duration-150',
      className
    )}
    {...props}
  />
));
Input.displayName = 'Input';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  maxWidthClass?: string;
  children: React.ReactNode;
}

export const Modal: React.FC<ModalProps> = ({
  open,
  onClose,
  title,
  subtitle,
  maxWidthClass = 'max-w-2xl',
  children,
}) => {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/55 backdrop-blur-sm p-0 sm:p-4 animate-backdrop-fade"
      onClick={onClose}
    >
      <div
        className={cn(
          'w-full rounded-t-[32px] sm:rounded-[30px] border border-zinc-200/80 dark:border-zinc-800 bg-white dark:bg-[#141417] shadow-2xl max-h-[92vh] flex flex-col overflow-hidden animate-modal-zoom',
          maxWidthClass
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-zinc-100 dark:border-zinc-800/80 px-6 py-5">
          <div>
            <h2 className="text-lg font-bold tracking-tight text-zinc-950 dark:text-zinc-50">
              {title}
            </h2>
            {subtitle && (
              <p className="text-xs sm:text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
                {subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
            aria-label="Chiudi modale"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="overflow-y-auto p-6">{children}</div>
      </div>
    </div>
  );
};

export const Toaster: React.FC<{
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;

  const variantClasses: Record<NonNullable<ToastItem['variant']>, string> = {
    default: 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#141417]',
    success: 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#141417]',
    warning: 'border-amber-500/40 bg-white dark:bg-[#141417]',
    danger: 'border-rose-500/40 bg-white dark:bg-[#141417]',
  };

  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2.5 max-w-sm w-[calc(100%-2rem)] pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            'pointer-events-auto relative overflow-hidden flex items-start justify-between gap-3 rounded-2xl border p-4 shadow-xl backdrop-blur-md animate-toast-in',
            variantClasses[t.variant ?? 'default']
          )}
        >
          <div className="flex items-start gap-2.5 min-w-0">
            {t.variant === 'success' && (
              <span className="h-6 w-6 rounded-full bg-[#141414] text-white dark:bg-white dark:text-[#141414] flex items-center justify-center shrink-0 mt-0.5">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-3.5 w-3.5"
                >
                  <path d="M20 6L9 17l-5-5" className="animate-svg-check" />
                </svg>
              </span>
            )}
            <div className="min-w-0">
              <p className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                {t.title}
              </p>
              {t.description && (
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 truncate">
                  {t.description}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onDismiss(t.id)}
            className="text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 p-0.5"
          >
            <X className="h-4 w-4" />
          </button>

          {/* Barra di timer che si accorcia (Toast Stack Timer) */}
          <div className="absolute bottom-0 left-0 right-0 h-[2.5px] bg-zinc-100 dark:bg-zinc-800">
            <div className="h-full bg-zinc-900 dark:bg-zinc-200 animate-toast-timer" />
          </div>
        </div>
      ))}
    </div>
  );
};
