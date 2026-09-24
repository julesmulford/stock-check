import { describe, expect, it } from 'vitest';
import { applyAll, applyResult, FAILURE_ALERT_THRESHOLD, HISTORY_LIMIT, pctChange } from '../src/compare';
import { buildAlert } from '../src/notify';
import type { ScrapeResult, State, Target, TargetState } from '../src/types';

const target: Target = { id: 'kef', name: 'KEF S3', retailer: 'KEF UK', url: 'https://uk.kef.com/x', group: 'B' };
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

describe('buildAlert', () => {
  const other: Target = { id: 'nord', name: 'Nord Three', retailer: 'Nord', url: 'https://nord.example', group: 'C' };

  it('sends nothing when there are no drops or new failure alerts', () => {
    expect(buildAlert([{ type: 'rise', targetId: 'kef', oldPrice: 1, newPrice: 2, currency: 'GBP', pctRise: 100 }], [target], [])).toBeNull();
    expect(buildAlert([{ type: 'failure', targetId: 'kef', consecutive: 2, status: 'not_found' }], [target], [])).toBeNull();
  });

  it('combines drops and failures into one message with the required details', () => {
    const alert = buildAlert(
      [
        { type: 'drop', targetId: 'kef', oldPrice: 699, newPrice: 599, currency: 'GBP', pctDrop: 14.3 },
        { type: 'failure_alert', targetId: 'nord', consecutive: 3, status: 'not_found', error: 'Price not found' },
      ],
      [target, other],
      [ok(599)],
    )!;
    expect(alert.subject).toBe('Price monitor: 1 price drop, 1 broken target');
    for (const s of ['KEF S3', 'KEF UK', '£699.00', '£599.00', '14.3%', 'https://uk.kef.com/x', 'Nord', 'Price not found']) {
      expect(alert.text).toContain(s);
    }
    expect(alert.html).toContain('<a href="https://uk.kef.com/x">');
  });
});
