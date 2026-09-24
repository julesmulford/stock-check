import { describe, expect, it } from 'vitest';
import { normaliseAvailability, normaliseCurrency, parsePrice } from '../src/price';

describe('parsePrice', () => {
  it.each([
    ['£699.00', 699, 'GBP'],
    ['£649.99', 649.99, 'GBP'],
    ['£1,010.00', 1010, 'GBP'],
    ['£2,099', 2099, 'GBP'],
    ['Regular price £699.00', 699, 'GBP'],
    ['£699.00 inc. VAT', 699, 'GBP'],
    ['1,090.00€', 1090, 'EUR'],
    // French formatting: space (or no-break space) thousands, comma decimals
    ['1 190,00 €', 1190, 'EUR'],
    ['1 190,00 €', 1190, 'EUR'],
    ['1 190,00 €', 1190, 'EUR'],
    ['1.190,00 €', 1190, 'EUR'],
    ['991,67 € tax excl.', 991.67, 'EUR'],
    ['€1.190', 1190, 'EUR'],
    ['EUR 12,5', 12.5, 'EUR'],
    ['£1,234,567.89', 1234567.89, 'GBP'],
    ['£0.00', 0, 'GBP'],
  ])('parses %j', (input, amount, currency) => {
    expect(parsePrice(input)).toEqual({ amount, currency });
  });

  it('does not merge a price with a following number', () => {
    expect(parsePrice('£699.00 or 3 payments')).toEqual({ amount: 699, currency: 'GBP' });
  });

  it('accepts numbers and numeric strings, using the currency hint', () => {
    expect(parsePrice(649.0, 'GBP')).toEqual({ amount: 649, currency: 'GBP' });
    expect(parsePrice('1190', 'EUR')).toEqual({ amount: 1190, currency: 'EUR' });
    expect(parsePrice('699.00')).toEqual({ amount: 699, currency: undefined });
  });

  it('prefers a symbol in the text over the hint', () => {
    expect(parsePrice('€10.00', 'GBP')?.currency).toBe('EUR');
  });

  it('rejects price ranges', () => {
    expect(parsePrice('£399.00 – £849.00')).toBeNull();
    expect(parsePrice('£159.00 - £195.00')).toBeNull();
  });

  it('rejects text without a number', () => {
    expect(parsePrice('Call for price')).toBeNull();
    expect(parsePrice('')).toBeNull();
    expect(parsePrice(undefined)).toBeNull();
    expect(parsePrice(NaN)).toBeNull();
  });
});

describe('normaliseCurrency', () => {
  it('handles codes and symbols', () => {
    expect(normaliseCurrency('gbp')).toBe('GBP');
    expect(normaliseCurrency('€')).toBe('EUR');
    expect(normaliseCurrency(undefined)).toBeUndefined();
  });
});

describe('normaliseAvailability', () => {
  it.each([
    ['https://schema.org/InStock', 'in_stock'],
    ['http://schema.org/OutOfStock', 'out_of_stock'],
    ['https://schema.org/Discontinued', 'discontinued'],
    ['https://schema.org/PreOrder', 'preorder'],
    ['https://schema.org/BackOrder', 'backorder'],
    ['out of stock', 'out_of_stock'],
    ['instock', 'in_stock'],
    ['2 in stock', 'in_stock'],
    ['', 'unknown'],
    [undefined, 'unknown'],
  ])('%j -> %s', (input, expected) => {
    expect(normaliseAvailability(input)).toBe(expected);
  });
});
