import type { HistoryEntry, MonitorEvent, ScrapeResult, State, Target, TargetState } from './types';

export const HISTORY_LIMIT = 30;
export const FAILURE_ALERT_THRESHOLD = 3;

const toMinor = (n: number) => Math.round(n * 100);

export function pctChange(oldPrice: number, newPrice: number): number {
  return Math.round(((newPrice - oldPrice) / oldPrice) * 1000) / 10;
}

function pushHistory(history: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  return [...history, entry].slice(-HISTORY_LIMIT);
}

/**
 * Fold one scrape result into a target's state. Pure: returns the new state and the event
 * describing what happened. Prices are compared only within the same currency.
 */
export function applyResult(
  prev: TargetState | undefined,
  target: Target,
  result: ScrapeResult,
  now: string,
): { next: TargetState; event: MonitorEvent } {
  const base: TargetState = prev
    ? { ...prev, name: target.name, retailer: target.retailer, url: target.url }
    : { name: target.name, retailer: target.retailer, url: target.url, consecutiveFailures: 0, failureAlerted: false, history: [] };
  base.lastCheckedAt = now;
  const id = target.id;

  if (result.status !== 'ok' || result.price == null || !result.currency) {
    const consecutive = base.consecutiveFailures + 1;
    const shouldAlert = consecutive >= FAILURE_ALERT_THRESHOLD && !base.failureAlerted;
    const next: TargetState = {
      ...base,
      consecutiveFailures: consecutive,
      failureAlerted: base.failureAlerted || shouldAlert,
      lastError: result.error ?? result.status,
    };
    const payload = { targetId: id, consecutive, status: result.status, error: result.error };
    return { next, event: shouldAlert ? { type: 'failure_alert', ...payload } : { type: 'failure', ...payload } };
  }

  const { price, currency } = result;
  const availability = result.availability ?? 'unknown';
  const recovered = base.consecutiveFailures > 0 ? base.consecutiveFailures : 0;
  const ok: TargetState = {
    ...base,
    lastPrice: price,
    currency,
    lastGbp: result.gbp,
    availability,
    lastSuccessAt: now,
    consecutiveFailures: 0,
    failureAlerted: false,
    lastError: undefined,
  };
  const entry = (change: HistoryEntry['change']): HistoryEntry => ({ at: now, price, currency, gbp: result.gbp, availability, change });

  if (base.lastPrice == null || !base.currency) {
    return { next: { ...ok, history: pushHistory(base.history, entry('initial')) }, event: { type: 'first', targetId: id, price, currency } };
  }
  if (base.currency !== currency) {
    return {
      next: { ...ok, history: pushHistory(base.history, entry('currency')) },
      event: { type: 'currency_changed', targetId: id, oldCurrency: base.currency, newCurrency: currency, price },
    };
  }

  const oldPrice = base.lastPrice;
  if (toMinor(price) < toMinor(oldPrice)) {
    return {
      next: { ...ok, history: pushHistory(base.history, entry('drop')) },
      event: { type: 'drop', targetId: id, oldPrice, newPrice: price, currency, pctDrop: -pctChange(oldPrice, price) },
    };
  }
  if (toMinor(price) > toMinor(oldPrice)) {
    return {
      next: { ...ok, history: pushHistory(base.history, entry('rise')) },
      event: { type: 'rise', targetId: id, oldPrice, newPrice: price, currency, pctRise: pctChange(oldPrice, price) },
    };
  }

  const stockChanged = base.availability && base.availability !== availability;
  const history = stockChanged ? pushHistory(base.history, entry('stock')) : base.history;
  return {
    next: { ...ok, history },
    event: recovered ? { type: 'recovered', targetId: id, afterFailures: recovered } : { type: 'same', targetId: id },
  };
}

/** Apply every result, dropping state for targets that are no longer configured. */
export function applyAll(
  state: State,
  targets: Target[],
  results: ScrapeResult[],
  now: string,
): { state: State; events: MonitorEvent[] } {
  const configured = new Set(targets.map((t) => t.id));
  const nextTargets: State['targets'] = {};
  for (const [id, s] of Object.entries(state.targets)) if (configured.has(id)) nextTargets[id] = s;

  const events: MonitorEvent[] = [];
  for (const result of results) {
    const target = targets.find((t) => t.id === result.targetId);
    if (!target) continue;
    const { next, event } = applyResult(nextTargets[target.id], target, result, now);
    nextTargets[target.id] = next;
    events.push(event);
  }
  return { state: { version: 1, updatedAt: now, targets: nextTargets }, events };
}

/** Events that warrant a notification: price drops and newly broken targets. */
export function alertableEvents(events: MonitorEvent[]) {
  return {
    drops: events.filter((e): e is Extract<MonitorEvent, { type: 'drop' }> => e.type === 'drop'),
    failures: events.filter((e): e is Extract<MonitorEvent, { type: 'failure_alert' }> => e.type === 'failure_alert'),
    recovered: events.filter((e): e is Extract<MonitorEvent, { type: 'recovered' }> => e.type === 'recovered'),
  };
}
