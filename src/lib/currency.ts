import { z } from 'zod';

/**
 * Converte un valore numerico in Euro in centesimi interi per evitare errori floating-point.
 */
export function toCents(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100);
}

/**
 * Converte centesimi interi in valore Euro arrotondato a 2 decimali.
 */
export function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}

/**
 * Somma sicura di importi monetari in Euro usando aritmetica intera in centesimi.
 */
export function sumEuro(...amounts: number[]): number {
  const totalCents = amounts.reduce((acc, v) => acc + toCents(v), 0);
  return fromCents(totalCents);
}

/**
 * Sottrazione sicura (a - b) in Euro usando centesimi interi.
 */
export function diffEuro(a: number, b: number): number {
  return fromCents(toCents(a) - toCents(b));
}

/**
 * Parsa una stringa monetaria accettando sia la virgola (es. "24,50") che il punto ("24.50")
 * e rimuovendo eventuali simboli "€" o spazi. Ritorna NaN se non valido.
 */
export function parseEuroInput(raw: string | number): number {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? fromCents(toCents(raw)) : Number.NaN;
  }
  const cleaned = raw.trim().replace(/€/g, '').replace(/\s+/g, '').replace(',', '.');
  if (!cleaned || !/^-?\d+(\.\d{1,2})?$/.test(cleaned)) {
    // Permetti anche più decimali temporanei solo se numerico valido? No, max 2 decimali rigorosi!
    if (/^-?\d+(\.\d+)?$/.test(cleaned)) {
      const parsed = Number(cleaned);
      return Number.isFinite(parsed) ? fromCents(toCents(parsed)) : Number.NaN;
    }
    return Number.NaN;
  }
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? fromCents(toCents(parsed)) : Number.NaN;
}

/**
 * Formattazione rigorosa in Euro italiano: "€ 0,00" (o "-€ 12,50" per negativi).
 */
export function formatEuro(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) {
    return '€ 0,00';
  }
  const cents = toCents(amount);
  const absFormatted = (Math.abs(cents) / 100).toLocaleString('it-IT', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return cents < 0 ? `-€ ${absFormatted}` : `€ ${absFormatted}`;
}

/**
 * Schema Zod per importi monetari >= 0 (accetta sia virgola che punto).
 */
export const nonNegativeEuroSchema = (fieldLabel = 'Importo') =>
  z
    .union([z.string(), z.number()])
    .transform((val) => parseEuroInput(val))
    .refine((val) => !Number.isNaN(val), {
      message: `${fieldLabel} non valido (usa es. 12,50 o 12.50)`,
    })
    .refine((val) => val >= 0, {
      message: `${fieldLabel} non può essere negativo`,
    });

/**
 * Schema Zod per importi monetari con segno (es. bonus/malus Barbiè).
 */
export const signedEuroSchema = (fieldLabel = 'Importo') =>
  z
    .union([z.string(), z.number()])
    .transform((val) => parseEuroInput(val))
    .refine((val) => !Number.isNaN(val), {
      message: `${fieldLabel} non valido (usa es. 5,00 o -5,00)`,
    });
