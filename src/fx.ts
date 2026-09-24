import { round2 } from './price';
import type { FxRates } from './types';

const FX_URL = 'https://api.frankfurter.dev/v1/latest';

/**
 * Fetch ECB reference rates (via Frankfurter, no API key) for converting to GBP. Returns null on
 * any failure, since GBP figures are only for display and must never stop a run.
 */
export async function fetchGbpRates(currencies: string[]): Promise<FxRates | null> {
  const symbols = [...new Set(currencies.filter((c) => c !== 'GBP'))];
  if (!symbols.length) return { date: new Date().toISOString().slice(0, 10), perGbp: {} };
  try {
    const res = await fetch(`${FX_URL}?base=GBP&symbols=${symbols.join(',')}`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { date: string; rates: Record<string, number> };
    return { date: body.date, perGbp: body.rates };
  } catch (err) {
    console.warn(`Warning: exchange rates unavailable (${err instanceof Error ? err.message : err}); GBP column left blank.`);
    return null;
  }
}

/** Convert an amount to GBP, or undefined when there's no rate for the currency. */
export function toGbp(amount: number, currency: string, rates: FxRates | null): number | undefined {
  if (currency === 'GBP') return amount;
  const rate = rates?.perGbp[currency];
  return rate ? round2(amount / rate) : undefined;
}
