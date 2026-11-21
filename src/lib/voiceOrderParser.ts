import type { CanonicalOrderPlatform, PaymentMethod } from '@/types/database';
import {
  resolveAddressFromText,
  type ResolvedAltamuraAddress,
} from '@/components/AltamuraAddressInput';

export interface ParsedVoiceOrder {
  rawTranscript: string;
  resolvedAddress: ResolvedAltamuraAddress;
  amountNumber: number | null;
  amountFormatted: string;
  paymentMethod: PaymentMethod | null;
  platform: CanonicalOrderPlatform | null;
}

const ITALIAN_NUMBER_WORDS: Record<string, number> = {
  uno: 1,
  una: 1,
  due: 2,
  tre: 3,
  quattro: 4,
  cinque: 5,
  sei: 6,
  sette: 7,
  otto: 8,
  nove: 9,
  dieci: 10,
  undici: 11,
  dodici: 12,
  tredici: 13,
  quattordici: 14,
  quindici: 15,
  sedici: 16,
  diciassette: 17,
  diciotto: 18,
  diciannove: 19,
  venti: 20,
  ventuno: 21,
  ventidue: 22,
  ventitre: 23,
  ventitré: 23,
  ventiquattro: 24,
  venticinque: 25,
  ventisei: 26,
  ventisette: 27,
  ventotto: 28,
  ventinove: 29,
  trenta: 30,
  trentacinque: 35,
  quaranta: 40,
  quarantacinque: 45,
  cinquanta: 50,
  sessanta: 60,
  settanta: 70,
  ottanta: 80,
  novanta: 90,
  cento: 100,
};

function replaceSpokenItalianNumbers(text: string): string {
  return text.replace(
    /\b(uno|una|due|tre|quattro|cinque|sei|sette|otto|nove|dieci|undici|dodici|tredici|quattordici|quindici|sedici|diciassette|diciotto|diciannove|venti|ventuno|ventidue|ventitre|ventitré|ventiquattro|venticinque|ventisei|ventisette|ventotto|ventinove|trenta|trentacinque|quaranta|quarantacinque|cinquanta|sessanta|settanta|ottanta|novanta|cento)\b/gi,
    (match) => {
      const val = ITALIAN_NUMBER_WORDS[match.toLowerCase()];
      return val !== undefined ? String(val) : match;
    }
  );
}

/**
 * Analizza una frase dettata vocalmente (es. "Via Roma 15, 18 euro contanti, Just Eat")
 * ed estrae automaticamente:
 * - Via / Indirizzo (risolto sullo stradario di Altamura se presente)
 * - Importo in Euro (formattato con virgola, es. "18,00")
 * - Metodo di pagamento ('cash' | 'pos_rider' | 'prepaid_platform')
 * - Canale ('App' | 'Gestionale' | 'JustEat')
 */
export function parseVoiceOrderTranscript(transcript: string): ParsedVoiceOrder {
  const rawTranscript = transcript.trim();
  let working = replaceSpokenItalianNumbers(rawTranscript);

  // 1. Estrazione Canale / App
  let platform: CanonicalOrderPlatform | null = null;
  const channelPatterns: Array<{
    regex: RegExp;
    value: CanonicalOrderPlatform;
  }> = [
    { regex: /\b(just\s*eat|justeat|just\s*it|giust\s*it)\b/gi, value: 'JustEat' },
    { regex: /\b(gestionale|cassa|telefono|diretto)\b/gi, value: 'Gestionale' },
    { regex: /\b(app\s+proprietaria|applicazione|app)\b/gi, value: 'App' },
  ];

  for (const cp of channelPatterns) {
    if (cp.regex.test(working)) {
      platform = cp.value;
      working = working.replace(cp.regex, ' ');
      break;
    }
  }

  // 2. Estrazione Metodo di Pagamento (Contanti, POS, Pagato)
  let paymentMethod: PaymentMethod | null = null;
  const paymentPatterns: Array<{
    regex: RegExp;
    value: PaymentMethod;
  }> = [
    {
      regex: /\b(gi[aà]\s*pagat[oa]|pagat[oa]\s*online|prepagat[oa]|pagat[oa])\b/gi,
      value: 'prepaid_platform',
    },
    {
      regex: /\b(pos\s*mobile|pos|bancomat|carta\s*di\s*credito|carta)\b/gi,
      value: 'pos_rider',
    },
    {
      regex: /\b(in\s*contanti|contanti|contante|cash)\b/gi,
      value: 'cash',
    },
  ];

  for (const pp of paymentPatterns) {
    if (pp.regex.test(working)) {
      paymentMethod = pp.value;
      working = working.replace(pp.regex, ' ');
      break;
    }
  }

  // 3. Estrazione Importo (€)
  // Caso A: "18 euro e 50", "18,50 euro", "€ 18,50", "18 euro"
  let amountNumber: number | null = null;

  const euroWithCentsRegex =
    /(?:€\s*)?(\d{1,4})(?:[,.](\d{1,2}))?\s*(?:euro|€|eur)(?:\s*(?:e\s*)?(\d{1,2})(?:\s*centesimi)?)?\b/i;
  const euroPrefixRegex = /€\s*(\d{1,4})(?:[,.](\d{1,2}))?/i;
  const decimalWithECentsRegex = /\b(\d{1,3})\s+e\s+(\d{1,2})\b/i;
  const explicitDecimalRegex = /\b(\d{1,3})[,.](\d{1,2})\b/;

  const matchA = working.match(euroWithCentsRegex);
  if (matchA) {
    const whole = Number(matchA[1]);
    const decStr = matchA[2] ?? matchA[3] ?? '0';
    const cents = decStr.length === 1 ? Number(decStr) * 10 : Number(decStr);
    amountNumber = whole + cents / 100;
    working = working.replace(matchA[0], ' ');
  } else {
    const matchPrefix = working.match(euroPrefixRegex);
    if (matchPrefix) {
      const whole = Number(matchPrefix[1]);
      const decStr = matchPrefix[2] ?? '0';
      const cents = decStr.length === 1 ? Number(decStr) * 10 : Number(decStr);
      amountNumber = whole + cents / 100;
      working = working.replace(matchPrefix[0], ' ');
    } else {
      const matchDec = working.match(explicitDecimalRegex);
      if (matchDec) {
        const whole = Number(matchDec[1]);
        const decStr = matchDec[2];
        const cents = decStr.length === 1 ? Number(decStr) * 10 : Number(decStr);
        amountNumber = whole + cents / 100;
        working = working.replace(matchDec[0], ' ');
      } else {
        const matchECents = working.match(decimalWithECentsRegex);
        if (matchECents) {
          const whole = Number(matchECents[1]);
          const cents = Number(matchECents[2]);
          amountNumber = whole + (cents < 10 ? cents * 10 : cents) / 100;
          working = working.replace(matchECents[0], ' ');
        } else {
          // Se ci sono 2 numeri separati (es. "Via Roma 15, 18"), l'ultimo numero isolato è l'importo
          const allNums = [...working.matchAll(/\b(\d{1,3})\b/g)];
          if (allNums.length >= 2) {
            const lastMatch = allNums[allNums.length - 1];
            amountNumber = Number(lastMatch[1]);
            if (lastMatch.index !== undefined) {
              working =
                working.slice(0, lastMatch.index) +
                ' ' +
                working.slice(lastMatch.index + lastMatch[0].length);
            }
          }
        }
      }
    }
  }

  // 4. Pulizia della stringa rimanente per ottenere Via / Indirizzo
  const cleanedAddressCandidate = working
    .replace(/\b(consegna|ordine|importo|totale|metodo|canale|piattaforma|a|in)\b/gi, ' ')
    .replace(/[,;:.!?]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const resolvedAddress = resolveAddressFromText(cleanedAddressCandidate);

  const amountFormatted =
    amountNumber !== null && Number.isFinite(amountNumber) && amountNumber > 0
      ? amountNumber.toFixed(2).replace('.', ',')
      : '';

  return {
    rawTranscript,
    resolvedAddress,
    amountNumber,
    amountFormatted,
    paymentMethod,
    platform,
  };
}
