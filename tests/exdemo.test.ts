import { describe, expect, it } from 'vitest';
import { applyExDemo, detectCondition, isWatchedModel, listingKey } from '../src/exdemo';
import { interpretGrid, type RawCard } from '../src/exdemo-scrape';
import { buildEmail } from '../src/notify';
import { buildPriceTable, priceTableMarkdown, priceTableText } from '../src/prices-table';
import type { ExDemoListing, ExDemoPage, ExDemoPageResult, ExDemoState, State } from '../src/types';

describe('isWatchedModel', () => {
  it.each(['SVS SB-1000 Pro Subwoofer', 'SVS SB1000 Pro - Black Ash - Ex Demo', 'svs sb 1000 pro', 'SB-1000-Pro B Grade', 'SB1000Pro'])('matches %j', (t) => {
    expect(isWatchedModel(t)).toBe(true);
  });
  it.each(['SVS SB-1000 Subwoofer', 'SVS SB-2000 Pro Subwoofer', 'SVS PB-1000 Pro', 'SVS SB-1000 Professional', 'SVS SB-10000 Pro', 'SVS 3000 Micro'])('ignores %j', (t) => {
    expect(isWatchedModel(t)).toBe(false);
  });
});

describe('detectCondition', () => {
  it('prefers the title, then the listing text, then the page default', () => {
    expect(detectCondition('SVS SB-1000 Pro - Black Ash - OPEN BOX', 'Sale')).toBe('Open box');
    expect(detectCondition('SVS SB-1000 Pro', 'Nearly New · £549')).toBe('Nearly new');
    expect(detectCondition('SVS SB-1000 Pro B-Grade', '')).toBe('B grade');
    expect(detectCondition('SVS SB-1000 Pro', '£549', 'Ex demo')).toBe('Ex demo');
    expect(detectCondition('SVS SB-1000 Pro', '£549')).toBeUndefined();
  });
});

describe('listingKey', () => {
  it('ignores query strings, case and a trailing slash', () => {
    expect(listingKey('https://www.HomeAVDirect.co.uk/products/svs-sb-1000-pro-open-box?variant=1&_pos=2')).toBe('www.homeavdirect.co.uk/products/svs-sb-1000-pro-open-box');
    expect(listingKey('https://x.co.uk/p/a/')).toBe(listingKey('https://x.co.uk/p/a'));
  });
});

const page: ExDemoPage = {
  id: 'shop-clearance',
  retailer: 'Shop',
  label: 'Clearance',
  url: 'https://shop.example/clearance?brand=svs',
  brand: 'SVS',
  cardSelector: '.card',
  titleSelector: 'h3',
  priceSelectors: ['.price'],
};
const card = (title: string, price = '£549.00', href = `https://shop.example/p/${title.toLowerCase().replace(/\W+/g, '-')}`): RawCard => ({ title, href, priceText: price, text: `${title} ${price}` });

describe('interpretGrid', () => {
  it('treats an explicit "no products" page as nothing found', () => {
    expect(interpretGrid(page, { cards: [], empty: true })).toMatchObject({ status: 'ok', itemCount: 0, matches: [] });
  });

  it('fails when there are no listings and no "no products" message', () => {
    expect(interpretGrid(page, { cards: [], empty: false }).status).toBe('grid_not_found');
  });

  it('fails when a listing from another brand shows the filter did not apply', () => {
    const r = interpretGrid(page, { cards: [card('SVS SB-1000 Pro'), card('Arcam Solo Uno')], empty: false });
    expect(r).toMatchObject({ status: 'filter_not_applied', matches: [] });
    expect(r.error).toContain('Arcam Solo Uno');
  });

  it('keeps only SB-1000 Pro listings, with price, condition and URL', () => {
    const r = interpretGrid(page, {
      cards: [
        card('SVS SB-2000 Pro Subwoofer - Open Box', '£929.00'),
        card('SVS SB-1000 Subwoofer', '£399.00'),
        card('SVS SB-1000 Pro Subwoofer - Black Ash - Ex Demo', '£549.00', 'https://shop.example/p/sb1000pro-exdemo?v=1'),
        card('SVS SB-1000 Pro Subwoofer - Black Ash - Ex Demo', '£549.00', 'https://shop.example/p/sb1000pro-exdemo?v=2'),
      ],
      empty: false,
    });
    expect(r.status).toBe('ok');
    expect(r.itemCount).toBe(4);
    expect(r.matches).toEqual([
      {
        key: 'shop.example/p/sb1000pro-exdemo',
        title: 'SVS SB-1000 Pro Subwoofer - Black Ash - Ex Demo',
        price: 549,
        currency: 'GBP',
        condition: 'Ex demo',
        url: 'https://shop.example/p/sb1000pro-exdemo?v=1',
      },
    ]);
  });
});

describe('applyExDemo', () => {
  const listing = (price: number, key = 'shop.example/p/unit-1'): ExDemoListing => ({ key, title: 'SVS SB-1000 Pro - Ex Demo', price, currency: 'GBP', condition: 'Ex demo', url: `https://${key}` });
  const ok = (...matches: ExDemoListing[]): ExDemoPageResult => ({ pageId: page.id, status: 'ok', itemCount: matches.length, matches, notes: [] });
  const failed = (): ExDemoPageResult => ({ pageId: page.id, status: 'load_error', itemCount: 0, matches: [], error: 'HTTP 500', notes: [] });

  /** Run a sequence of page results, returning the event types per run and the final state. */
  function run(results: ExDemoPageResult[], days = results.map((_, i) => i)) {
    let state: ExDemoState | undefined;
    const events = results.map((r, i) => {
      const out = applyExDemo(state, [page], [r], new Date(Date.UTC(2026, 8, 26 + days[i], 6)).toISOString());
      state = out.state;
      return out.events.map((e) => e.type);
    });
    return { events, state: state! };
  }

  it('reports a new listing once, not on later runs', () => {
    const { events, state } = run([ok(), ok(listing(549)), ok(listing(549)), ok(listing(549))]);
    expect(events).toEqual([[], ['found'], [], []]);
    expect(Object.values(state.listings)[0]).toMatchObject({ price: 549, listed: true, retailer: 'Shop', pageId: page.id });
  });

  it('reports a price drop on a listing already seen, but not a rise', () => {
    const { events } = run([ok(listing(549)), ok(listing(499)), ok(listing(529)), ok(listing(529))]);
    expect(events).toEqual([['found'], ['cheaper'], [], []]);
  });

  it('does not re-report a unit that disappears and comes back at the same price', () => {
    const { events, state } = run([ok(listing(549)), ok(), ok(listing(549)), ok(), ok(listing(499))]);
    expect(events).toEqual([['found'], [], [], [], ['cheaper']]);
    expect(Object.values(state.listings)[0].listed).toBe(true);
  });

  it('marks a listing as no longer listed when it leaves the page', () => {
    const { state } = run([ok(listing(549)), ok()]);
    expect(Object.values(state.listings)[0].listed).toBe(false);
  });

  it('reports each new unit separately', () => {
    const { events } = run([ok(listing(549, 'a/1')), ok(listing(549, 'a/1'), listing(599, 'a/2'))]);
    expect(events).toEqual([['found'], ['found']]);
  });

  it('keeps listings unchanged while the page fails, and alerts after three failures in a row', () => {
    const { events, state } = run([ok(listing(549)), failed(), failed(), failed(), failed(), ok(listing(549))]);
    expect(events).toEqual([['found'], ['page_failure'], ['page_failure'], ['page_failure_alert'], ['page_failure'], ['page_recovered']]);
    expect(Object.values(state.listings)[0].listed).toBe(true);
  });

  it('treats an empty page as nothing found, not a failure', () => {
    const { events, state } = run([ok(), ok(), ok()]);
    expect(events).toEqual([[], [], []]);
    expect(state.pages[page.id].consecutiveFailures).toBe(0);
  });

  it('forgets units not seen for 180 days', () => {
    const { state } = run([ok(listing(549)), ok(), ok()], [0, 1, 200]);
    expect(state.listings).toEqual({});
  });

  it('drops state for pages that are no longer configured', () => {
    const prev: ExDemoState = { pages: { gone: { consecutiveFailures: 2, failureAlerted: false } }, listings: {} };
    expect(applyExDemo(prev, [page], [], '2026-09-26T06:00:00Z').state.pages).toEqual({});
  });
});

describe('ex-demo email and table', () => {
  const found = applyExDemo(undefined, [page], [{ pageId: page.id, status: 'ok', itemCount: 1, matches: [{ key: 'shop.example/p/u', title: 'SVS SB-1000 Pro Subwoofer - Ex Demo', price: 549, currency: 'GBP', condition: 'Ex demo', url: 'https://shop.example/p/u' }], notes: [] }], '2026-09-26T06:00:00Z');
  const state: State = { version: 1, targets: {} };
  const exdemo = { pages: [page], state: found.state, results: [{ pageId: page.id, status: 'ok' as const, itemCount: 1, matches: [], notes: [] }], events: found.events };
  const table = buildPriceTable([], state, [], [], { generatedAt: '2026-09-26T06:05:00Z', fx: null, exdemo });

  it('puts the find at the top of the email, under its own heading, and in the subject', () => {
    const email = buildEmail([], [], [], table, { events: found.events, pages: [page] });
    expect(email.subject).toBe('Ex demo SVS SB-1000 Pro found: Shop £549.00 (Ex demo)');
    expect(email.text.startsWith('EX DEMO SB-1000 PRO FOUND')).toBe(true);
    expect(email.html).toContain('<h2>Ex demo SB-1000 Pro found</h2>');
    for (const s of ['SVS SB-1000 Pro Subwoofer - Ex Demo', 'Shop (Clearance)', 'Condition: Ex demo', 'Price: £549.00', 'https://shop.example/p/u']) {
      expect(email.text).toContain(s);
    }
  });

  it('lists current listings in the prices table', () => {
    const md = priceTableMarkdown(table);
    expect(md).toContain('## Ex demo watch: SVS SB-1000 Pro');
    expect(md).toContain('| Shop (Clearance) | [SVS SB-1000 Pro Subwoofer - Ex Demo](https://shop.example/p/u) | Ex demo | £549.00 | 26 Sept | **new** |');
    expect(priceTableText(table)).toContain('1 clearance / ex-demo page checked. 1 SB-1000 Pro listing currently on them.');
  });

  it('says so when nothing is listed, and names pages that could not be checked', () => {
    const quiet = buildPriceTable([], state, [], [], {
      generatedAt: '2026-09-26T06:05:00Z',
      fx: null,
      exdemo: { pages: [page], state: { pages: {}, listings: {} }, results: [{ pageId: page.id, status: 'blocked', itemCount: 0, matches: [], notes: [] }], events: [] },
    });
    expect(priceTableMarkdown(quiet)).toContain('No SB-1000 Pro listings on them. Couldn\'t check: Shop Clearance: blocked by site.');
    expect(buildEmail([], [], [], quiet).subject).toBe('Daily prices, 26 Sept');
  });
});
