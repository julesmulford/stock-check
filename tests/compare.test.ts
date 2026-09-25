import { describe, expect, it } from 'vitest';
import { applyAll, applyResult, FAILURE_ALERT_THRESHOLD, HISTORY_LIMIT, pctChange } from '../src/compare';
import { buildEmail, hasAlerts } from '../src/notify';
import { buildPriceTable } from '../src/prices-table';
import type { MonitorEvent, ScrapeResult, State, Target, TargetState } from '../src/types';

const target: Target = { id: 'kef', name: 'KEF S3', retailer: 'KEF UK', url: 'https://uk.kef.com/x', group: 'B', country: 'UK', vat: 'incl' };
const ok = (price: number, currency = 'GBP', availability: ScrapeResult['availability'] = 'in_stock'): ScrapeResult => ({
  targetId: 'kef', status: 'ok', price, currency, availability, notes: [],
});
const fail = (status: ScrapeResult['status'] = 'not_found'): ScrapeResult => ({ targetId: 'kef', status, error: 'Price not found', notes: [] });

/** Run a sequence of results through applyResult, returning the final state and all events. */
function run(results: ScrapeResult[], start?: TargetState) {
  let state = start;
  const events = results.map((r, i) => {
    const out = applyResult(state, target, r, `2026-01-${String(i + 1).padStart(2, '0')}T07:00:00Z`);
    state = out.next;
    return out.event;
  });
  return { state: state!, events };
}

describe('applyResult', () => {
  it('records the first reading without alerting', () => {
    const { state, events } = run([ok(699)]);
    expect(events[0]).toEqual({ type: 'first', targetId: 'kef', price: 699, currency: 'GBP' });
    expect(state.history).toHaveLength(1);
    expect(state.history[0].change).toBe('initial');
  });

  it('detects a drop with the percentage', () => {
    const { state, events } = run([ok(699), ok(599)]);
    expect(events[1]).toEqual({ type: 'drop', targetId: 'kef', oldPrice: 699, newPrice: 599, currency: 'GBP', pctDrop: 14.3 });
    expect(state.lastPrice).toBe(599);
    expect(state.history.map((h) => h.change)).toEqual(['initial', 'drop']);
  });

  it('records a rise in history as a rise event', () => {
    const { state, events } = run([ok(649), ok(699)]);
    expect(events[1]).toMatchObject({ type: 'rise', pctRise: 7.7 });
    expect(state.history.map((h) => h.change)).toEqual(['initial', 'rise']);
  });

  it('treats sub-penny float noise as no change', () => {
    const { events } = run([ok(649.99), ok(649.99000001)]);
    expect(events[1].type).toBe('same');
  });

  it('does not add history when nothing changes, but records stock changes', () => {
    const { state } = run([ok(699), ok(699), ok(699, 'GBP', 'out_of_stock')]);
    expect(state.history.map((h) => h.change)).toEqual(['initial', 'stock']);
  });

  it('never compares across currencies', () => {
    const { state, events } = run([ok(1190, 'EUR'), ok(999, 'GBP')]);
    expect(events[1]).toMatchObject({ type: 'currency_changed', oldCurrency: 'EUR', newCurrency: 'GBP' });
    expect(state.currency).toBe('GBP');
    // The next GBP drop is measured from the GBP baseline.
    const next = applyResult(state, target, ok(899, 'GBP'), 'later');
    expect(next.event).toMatchObject({ type: 'drop', oldPrice: 999, newPrice: 899 });
  });

  it('keeps the last good price through failures', () => {
    const { state } = run([ok(699), fail()]);
    expect(state.lastPrice).toBe(699);
    expect(state.consecutiveFailures).toBe(1);
  });

  it(`alerts once after ${FAILURE_ALERT_THRESHOLD} failures in a row, then reports recovery`, () => {
    const { state, events } = run([ok(699), fail(), fail('blocked'), fail(), fail(), ok(699)]);
    expect(events.map((e) => e.type)).toEqual(['first', 'failure', 'failure', 'failure_alert', 'failure', 'recovered']);
    expect(state.consecutiveFailures).toBe(0);
    expect(state.failureAlerted).toBe(false);
  });

  it('alerts again if a target breaks again after recovering', () => {
    const { events } = run([fail(), fail(), fail(), ok(1), fail(), fail(), fail()]);
    expect(events.filter((e) => e.type === 'failure_alert')).toHaveLength(2);
  });

  it('a failure streak interrupted by a success does not alert', () => {
    const { events } = run([fail(), fail(), ok(5), fail(), fail()]);
    expect(events.some((e) => e.type === 'failure_alert')).toBe(false);
  });

  it('sets the original price at the first reading and never changes it', () => {
    const { state } = run([ok(699), ok(649), ok(749), ok(1190, 'EUR'), fail(), ok(599)]);
    expect(state).toMatchObject({ originalPrice: 699, originalCurrency: 'GBP', originalAt: '2026-01-01T07:00:00Z', lastPrice: 599 });
  });

  it('does not set an original price until a reading succeeds', () => {
    const { state } = run([fail(), fail()]);
    expect(state.originalPrice).toBeUndefined();
    expect(applyResult(state, target, ok(699), 'later').next.originalPrice).toBe(699);
  });

  it('backfills the original price from the first recorded reading for older saved state', () => {
    const saved: TargetState = {
      name: 'KEF', retailer: 'KEF UK', url: 'u', lastPrice: 649, currency: 'GBP', consecutiveFailures: 0, failureAlerted: false,
      history: [
        { at: '2026-09-24T06:00:00Z', price: 699, currency: 'GBP', change: 'initial' },
        { at: '2026-09-26T06:00:00Z', price: 649, currency: 'GBP', change: 'drop' },
      ],
    };
    expect(applyResult(saved, target, ok(649), 'now').next).toMatchObject({ originalPrice: 699, originalAt: '2026-09-24T06:00:00Z' });
    // Also on a failed run, so the table shows it either way.
    expect(applyResult(saved, target, fail(), 'now').next.originalPrice).toBe(699);
  });

  it('caps history length', () => {
    const results = Array.from({ length: HISTORY_LIMIT + 10 }, (_, i) => ok(1000 - i));
    expect(run(results).state.history).toHaveLength(HISTORY_LIMIT);
  });
});

describe('pctChange', () => {
  it('rounds to one decimal place', () => {
    expect(pctChange(699, 649)).toBe(-7.2);
    expect(pctChange(100, 50)).toBe(-50);
  });
});

describe('applyAll', () => {
  it('drops state for targets removed from the config and keeps unvisited ones', () => {
    const other: Target = { ...target, id: 'other' };
    const state: State = {
      version: 1,
      targets: {
        removed: { name: 'x', retailer: 'x', url: 'x', consecutiveFailures: 0, failureAlerted: false, history: [] },
        other: { name: 'o', retailer: 'o', url: 'o', lastPrice: 5, currency: 'GBP', consecutiveFailures: 0, failureAlerted: false, history: [] },
      },
    };
    const out = applyAll(state, [target, other], [ok(699)], 'now');
    expect(Object.keys(out.state.targets).sort()).toEqual(['kef', 'other']);
    expect(out.state.targets.other.lastPrice).toBe(5);
  });
});

describe('buildEmail', () => {
  const other: Target = { id: 'nord', name: 'Nord Three', retailer: 'Nord', url: 'https://nord.example', group: 'C', country: 'UK', vat: 'incl' };
  const table = (events: MonitorEvent[]) => {
    const state: State = {
      version: 1,
      targets: {
        kef: { name: '', retailer: '', url: '', lastPrice: 599, currency: 'GBP', availability: 'in_stock', consecutiveFailures: 0, failureAlerted: false, history: [] },
      },
    };
    return buildPriceTable([target, other], state, [ok(599)], events, { generatedAt: '2026-09-25T06:03:00Z', fx: null });
  };

  it('still sends the daily table when nothing changed', () => {
    const events: MonitorEvent[] = [{ type: 'same', targetId: 'kef' }];
    const email = buildEmail(events, [target, other], [ok(599)], table(events));
    expect(email.subject).toBe('Daily prices, 25 Sept');
    expect(hasAlerts(events)).toBe(false);
    expect(email.text).toContain('KEF S3 FLOOR STANDS');
    expect(email.text).not.toContain('PRICE DROPS');
    expect(email.html).toContain('<table');
  });

  it('puts drop details and broken targets before the table', () => {
    const events: MonitorEvent[] = [
      { type: 'drop', targetId: 'kef', oldPrice: 699, newPrice: 599, currency: 'GBP', pctDrop: 14.3 },
      { type: 'failure_alert', targetId: 'nord', consecutive: 3, status: 'not_found', error: 'Price not found' },
    ];
    const email = buildEmail(events, [target, other], [ok(599)], table(events));
    expect(hasAlerts(events)).toBe(true);
    expect(email.subject).toBe('Price drop: KEF UK (stands) £699.00 → £599.00 (−14.3%) · 1 broken target');
    for (const s of ['KEF S3', 'KEF UK (UK)', '£699.00', '£599.00', '14.3%', 'https://uk.kef.com/x', 'Nord', 'Price not found']) {
      expect(email.text).toContain(s);
    }
    expect(email.text.indexOf('PRICE DROPS')).toBeLessThan(email.text.indexOf('KEF S3 FLOOR STANDS'));
    expect(email.html.indexOf('<h2>Price drops</h2>')).toBeLessThan(email.html.indexOf('<h2>All prices</h2>'));
  });

  it('lists several drops in the subject', () => {
    const events: MonitorEvent[] = [
      { type: 'drop', targetId: 'kef', oldPrice: 699, newPrice: 599, currency: 'GBP', pctDrop: 14.3 },
      { type: 'drop', targetId: 'nord', oldPrice: 1010, newPrice: 950, currency: 'GBP', pctDrop: 5.9 },
    ];
    expect(buildEmail(events, [target, other], [ok(599)], table(events)).subject).toBe('2 price drops: KEF UK (stands), Nord Three');
  });
});
