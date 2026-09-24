import { describe, expect, it } from 'vitest';
import { toGbp } from '../src/fx';
import { buildPriceTable, gbpInclVat, priceTableHtml, priceTableMarkdown, priceTableText } from '../src/prices-table';
import type { FxRates, MonitorEvent, ScrapeResult, State, Target, TargetState } from '../src/types';

const fx: FxRates = { date: '2026-09-24', perGbp: { EUR: 1.163, USD: 1.322 } };

describe('toGbp', () => {
  it('converts using units per pound and rounds to pence', () => {
    expect(toGbp(1090, 'EUR', fx)).toBe(937.23);
    expect(toGbp(1150, 'USD', fx)).toBe(869.89);
  });
  it('passes GBP through and returns undefined without a rate', () => {
    expect(toGbp(699, 'GBP', null)).toBe(699);
    expect(toGbp(10, 'CHF', fx)).toBeUndefined();
    expect(toGbp(10, 'EUR', null)).toBeUndefined();
  });
});

describe('gbpInclVat', () => {
  const t = (vat: Target['vat']): Target => ({ id: 'x', name: 'x', retailer: 'x', url: 'x', group: 'C', country: 'USA', vat });
  it('adds 20% only for prices shown without VAT', () => {
    expect(gbpInclVat(100, t('excl'))).toBe(120);
    expect(gbpInclVat(100, t('incl'))).toBe(100);
    expect(gbpInclVat(undefined, t('excl'))).toBeUndefined();
  });
});

describe('pricesTable', () => {
  const amp = (id: string, retailer: string, country: string, vat: Target['vat']): Target => ({
    id, name: `${retailer} amp`, retailer, url: `https://${id}.example`, group: 'C', country, vat,
  });
  const stand: Target = { id: 'stand', name: 'KEF S3', retailer: 'KEF UK', url: 'https://kef.example', group: 'B', country: 'UK', vat: 'incl' };
  const targets = [stand, amp('us', 'VTV', 'USA', 'excl'), amp('fr', 'Audiophonics', 'France', 'incl'), amp('uk', 'Nord', 'UK', 'incl')];

  const ts = (lastPrice: number, currency: string, lastGbp: number, extra: Partial<TargetState> = {}): TargetState => ({
    name: '', retailer: '', url: '', lastPrice, currency, lastGbp, availability: 'in_stock',
    lastSuccessAt: '2026-09-23T06:00:00Z', consecutiveFailures: 0, failureAlerted: false, history: [], ...extra,
  });
  const state: State = {
    version: 1,
    targets: {
      stand: ts(699, 'GBP', 699),
      us: ts(1150, 'USD', 869.89), // £1,043.87 with VAT
      fr: ts(1290, 'EUR', 1109.2),
      uk: ts(1010, 'GBP', 1010, { consecutiveFailures: 1 }),
    },
  };
  const ok = (id: string): ScrapeResult => ({ targetId: id, status: 'ok', notes: [] });
  const results: ScrapeResult[] = [ok('stand'), ok('us'), ok('fr'), { targetId: 'uk', status: 'blocked', notes: [] }];
  const events: MonitorEvent[] = [{ type: 'drop', targetId: 'stand', oldPrice: 749, newPrice: 699, currency: 'GBP', pctDrop: 6.7 }];
  const table = buildPriceTable(targets, state, results, events, { generatedAt: '2026-09-24T06:05:00Z', fx });
  const md = priceTableMarkdown(table);

  it('sorts each section cheapest first, including UK VAT', () => {
    const amps = md.slice(md.indexOf('## Purifi'));
    const order = ['[Nord]', '[VTV]', '[Audiophonics]'].map((s) => amps.indexOf(s));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('shows country, native price, GBP and VAT-inclusive GBP', () => {
    expect(md).toContain('| USA | US$1,150.00 + VAT | £869.89 | £1,043.87 |');
    expect(md).toContain('| France | €1,290.00 | £1,109.20 | £1,109.20 |');
  });

  it('only shows conversion columns where they add something', () => {
    const stands = md.slice(md.indexOf('## KEF'), md.indexOf('## Purifi'));
    expect(stands).not.toContain('≈ GBP');
    expect(stands).toContain('**↓ £50.00 (−6.7%)**');
  });

  it('keeps failed targets with their last known price and date', () => {
    expect(md).toMatch(/\[Nord\].*£1,010\.00.*⚠ blocked by site; price from 23 Sept?/);
  });

  it('states the exchange rates used', () => {
    expect(md).toContain('reference rates for 2026-09-24');
  });

  it('renders the same rows as an HTML table, highlighting drops and linking retailers', () => {
    const html = priceTableHtml(table);
    expect(html).toContain('<a href="https://kef.example">KEF UK</a>');
    expect(html).toMatch(/background:#e6f4ea;"><strong>↓ £50\.00 \(−6\.7%\)<\/strong>/);
    expect(html).toContain('US$1,150.00 + VAT');
  });

  it('renders a plain-text version with GBP incl. VAT first for the amplifiers', () => {
    const text = priceTableText(table);
    expect(text).toContain('  £699.00  KEF UK (UK) · In stock · ↓ £50.00 (−6.7%)');
    expect(text).toContain('  £1,043.87 (US$1,150.00 + VAT)  VTV amp, VTV (USA) · In stock');
  });
});
