import { describe, expect, it } from 'vitest';
import { collectOffers, parseJsonLdBlocks, pickOffer, resolvePrice, type RawPageData } from '../src/extract';
import type { Target } from '../src/types';

const plainTarget: Target = { id: 't', name: 'T', retailer: 'R', url: 'https://example.com', group: 'A' };
const variantTarget = (offerMatch?: string): Target => ({
  ...plainTarget,
  group: 'B',
  variant: { label: 'Indigo', steps: [{ action: 'click', selector: '#x' }], offerMatch },
  selectors: ['.price'],
});
const raw = (over: Partial<RawPageData> = {}): RawPageData => ({ jsonLd: [], microdata: {}, meta: {}, ...over });

// Shapes taken from the real target pages.
const kefProductGroup = JSON.stringify({
  '@context': 'http://schema.org',
  '@type': 'ProductGroup',
  name: 'S3 Floor Stand',
  color: 'Slate Grey, Mineral White, Indigo Matte Special Edition',
  hasVariant: [
    { '@type': 'Product', name: 'Slate Grey', sku: 'SP4062MA', gtin12: '637203049019', offers: { '@type': 'Offer', price: '699', priceCurrency: 'GBP', availability: 'http://schema.org/InStock' } },
    { '@type': 'Product', name: 'Indigo Matte Special Edition', sku: 'SP4062CA', gtin12: '637203049866', offers: { '@type': 'Offer', price: '649', priceCurrency: 'GBP', availability: 'http://schema.org/OutOfStock' } },
  ],
});
const wooGraph = JSON.stringify({
  '@context': 'https://schema.org/',
  '@graph': [
    { '@type': 'BreadcrumbList', itemListElement: [] },
    {
      '@type': 'Product',
      name: 'Purifi 1ET400A ST',
      offers: [{ '@type': 'Offer', priceSpecification: [{ '@type': 'UnitPriceSpecification', price: '1090.00', priceCurrency: 'EUR' }], availability: 'https://schema.org/InStock' }],
    },
  ],
});

describe('collectOffers', () => {
  it('reads offers from ProductGroup variants', () => {
    const offers = collectOffers(parseJsonLdBlocks([kefProductGroup]));
    expect(offers).toHaveLength(2);
    expect(offers[1]).toMatchObject({ price: 649, currency: 'GBP', availability: 'out_of_stock' });
    expect(offers[1].context).toContain('637203049866');
  });

  it('reads priceSpecification inside @graph', () => {
    expect(collectOffers(parseJsonLdBlocks([wooGraph]))).toEqual([
      expect.objectContaining({ price: 1090, currency: 'EUR', availability: 'in_stock' }),
    ]);
  });

  it('ignores offers that are not attached to a product', () => {
    const block = JSON.stringify({ '@type': 'Organization', offers: { '@type': 'Offer', price: '10', priceCurrency: 'GBP' } });
    expect(collectOffers(parseJsonLdBlocks([block]))).toEqual([]);
  });

  it('tolerates raw control characters and skips invalid blocks', () => {
    const withNewline = '{"@type":"Product","name":"A\nB","offers":{"@type":"Offer","price":5,"priceCurrency":"GBP"}}';
    expect(collectOffers(parseJsonLdBlocks([withNewline, '{not json']))).toHaveLength(1);
  });
});

describe('pickOffer', () => {
  const offers = collectOffers(parseJsonLdBlocks([kefProductGroup]));
  it('matches a variant by GTIN', () => {
    expect(pickOffer(offers, '637203049866')?.price).toBe(649);
  });
  it('returns null when several different prices exist and nothing to match on', () => {
    expect(pickOffer(offers)).toBeNull();
  });
  it('returns the offer when all offers agree', () => {
    const same = offers.map((o) => ({ ...o, price: 699 }));
    expect(pickOffer(same)?.price).toBe(699);
  });
});

describe('resolvePrice', () => {
  it('prefers JSON-LD over meta tags', () => {
    const r = resolvePrice(raw({ jsonLd: [wooGraph], meta: { price: '999', currency: 'EUR' } }), plainTarget, []);
    expect(r).toMatchObject({ price: 1090, currency: 'EUR', source: 'json-ld' });
  });

  it('falls back to microdata, then meta', () => {
    expect(resolvePrice(raw({ microdata: { price: '1190', currency: 'EUR', availability: 'https://schema.org/Discontinued' } }), plainTarget, []))
      .toMatchObject({ price: 1190, currency: 'EUR', availability: 'discontinued', source: 'microdata' });
    expect(resolvePrice(raw({ meta: { price: '649.00', currency: 'GBP' } }), plainTarget, [])).toMatchObject({ price: 649, source: 'meta' });
  });

  it('uses the matching variant offer for variant targets', () => {
    const r = resolvePrice(raw({ jsonLd: [kefProductGroup] }), variantTarget('637203049866'), []);
    expect(r).toMatchObject({ price: 649, availability: 'out_of_stock', source: 'json-ld' });
  });

  it('skips page-level structured data for variant targets without offerMatch', () => {
    const notes: string[] = [];
    const r = resolvePrice(
      raw({ jsonLd: [wooGraph], meta: { price: '1', currency: 'GBP' }, selectorHit: { selector: '.price', text: '£699.00' } }),
      variantTarget(),
      notes,
    );
    expect(r).toMatchObject({ price: 699, currency: 'GBP', source: 'selector' });
    expect(notes.join(' ')).toMatch(/JSON-LD skipped/);
  });

  it('returns null when nothing usable is found', () => {
    const notes: string[] = [];
    expect(resolvePrice(raw({ selectorHit: { selector: '.price', text: '£399 – £849' } }), variantTarget(), notes)).toBeNull();
    expect(notes.join(' ')).toMatch(/not a single price/);
  });
});
