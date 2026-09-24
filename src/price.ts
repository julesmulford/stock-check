import type { Availability } from './types';

export interface ParsedPrice {
  amount: number;
  currency?: string;
}

const CURRENCY_PATTERNS: Array<[RegExp, string]> = [
  [/£|\bGBP\b/i, 'GBP'],
  [/€|\bEUR\b/i, 'EUR'],
  [/US\$|\bUSD\b/i, 'USD'],
  [/\$/, 'USD'],
  [/\bCHF\b/i, 'CHF'],
];

export function detectCurrency(text: string): string | undefined {
  for (const [re, code] of CURRENCY_PATTERNS) if (re.test(text)) return code;
  return undefined;
}

/** Normalise a currency code or symbol ("gbp", "£", "EUR") to an ISO code. */
export function normaliseCurrency(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim();
  if (/^[A-Za-z]{3}$/.test(v)) return v.toUpperCase();
  return detectCurrency(v);
}

/**
 * Parse a price from a number or text such as "£1,010.00", "1 190,00 €", "1.190,00 €",
 * "Regular price £699.00" or "699". Returns null when there is no number, or when the text
 * looks like a price range ("£399.00 – £849.00"), because a range isn't a single price.
 */
export function parsePrice(input: unknown, currencyHint?: string): ParsedPrice | null {
  const hint = normaliseCurrency(currencyHint);
  if (typeof input === 'number') {
    return Number.isFinite(input) && input >= 0 ? { amount: round2(input), currency: hint } : null;
  }
  if (typeof input !== 'string') return null;

  const text = input.replace(/[   ]/g, ' ').trim();
  // Either digits with grouped thousands ("1,010.00", "1 190,00", "1.190") or plain digits with
  // an optional decimal part ("699.00", "12,5").
  const tokens = text.match(/\d{1,3}(?:[ '.,]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?/g);
  if (!tokens) return null;
  if (tokens.length > 1 && /\d\s*[£€$]?\s*[–—-]\s*[£€$]?\s*\d/.test(text)) return null;

  const amount = parseNumber(tokens[0].trim());
  if (amount === null) return null;
  return { amount, currency: detectCurrency(text) ?? hint };
}

function parseNumber(raw: string): number | null {
  // Spaces and apostrophes are only ever thousands separators.
  let s = raw.replace(/[ ']/g, '');
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');

  if (lastComma >= 0 && lastDot >= 0) {
    // Both present: whichever comes last is the decimal separator.
    const decimal = lastComma > lastDot ? ',' : '.';
    const thousands = decimal === ',' ? '.' : ',';
    s = s.split(thousands).join('').replace(decimal, '.');
  } else if (lastComma >= 0 || lastDot >= 0) {
    const sep = lastComma >= 0 ? ',' : '.';
    const parts = s.split(sep);
    const tail = parts[parts.length - 1];
    // "1,190" / "1.190" / "1,234,567": groups of three after the separator are thousands.
    const isThousands = tail.length === 3 && parts.slice(1).every((p) => p.length === 3) && parts[0].length <= 3;
    s = isThousands ? parts.join('') : parts.slice(0, -1).join('') + '.' + tail;
  }

  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? round2(n) : null;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Map schema.org availability URLs and free text ("out of stock", "instock") to a status. */
export function normaliseAvailability(value: unknown): Availability {
  if (typeof value !== 'string' || !value.trim()) return 'unknown';
  const v = value.toLowerCase().replace(/^https?:\/\/schema\.org\//, '').replace(/[\s_-]+/g, '');
  if (/discontinued/.test(v)) return 'discontinued';
  if (/outofstock|soldout|unavailable|notavailable/.test(v)) return 'out_of_stock';
  if (/preorder|presale/.test(v)) return 'preorder';
  if (/backorder/.test(v)) return 'backorder';
  if (/limitedavailability|lowstock|onlyafewleft/.test(v)) return 'limited';
  if (/instock|instoreonly|onlineonly|available/.test(v)) return 'in_stock';
  return 'unknown';
}

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export const AVAILABILITY_LABEL: Record<Availability, string> = {
  in_stock: 'In stock',
  out_of_stock: 'Out of stock',
  preorder: 'Pre-order',
  backorder: 'Backorder',
  limited: 'Limited',
  discontinued: 'Discontinued',
  unknown: '—',
};
