import { normaliseAvailability, normaliseCurrency, parsePrice } from './price';
import type { Availability, PriceSource, Target } from './types';

/** Raw data collected from the page by `collectRaw` in scrape.ts. */
export interface RawPageData {
  jsonLd: string[];
  microdata: { price?: string; currency?: string; availability?: string };
  meta: { price?: string; currency?: string; availability?: string };
  selectorHit?: { selector: string; text: string };
  stockText?: string;
}

export interface OfferCandidate {
  price: number;
  currency?: string;
  availability: Availability;
  /** Identifying text (product name, SKU, GTIN, URL, colour) used for variant matching. */
  context: string;
}

export interface Resolved {
  price: number;
  currency: string;
  availability: Availability;
  source: PriceSource;
}

const PRODUCT_TYPES = new Set(['Product', 'ProductGroup', 'IndividualProduct', 'ProductModel', 'SomeProducts']);
const ID_FIELDS = ['name', 'sku', 'mpn', 'gtin', 'gtin8', 'gtin12', 'gtin13', 'gtin14', 'productID', 'color', 'url', '@id'];

export function parseJsonLdBlocks(blocks: string[]): unknown[] {
  const out: unknown[] = [];
  for (const block of blocks) {
    try {
      out.push(JSON.parse(block));
    } catch {
      // Some sites emit raw control characters inside strings; retry with them blanked out.
      try {
        out.push(JSON.parse(block.replace(/[\u0000-\u001f]+/g, ' ')));
      } catch {
        /* ignore unparseable block */
      }
    }
  }
  return out;
}

function asArray<T>(v: T | T[] | undefined | null): T[] {
  return v == null ? [] : Array.isArray(v) ? v : [v];
}

function typesOf(node: Record<string, unknown>): string[] {
  return asArray(node['@type'] as string | string[]).map((t) => String(t).replace(/^https?:\/\/schema\.org\//, ''));
}

function idText(node: Record<string, unknown>): string {
  return ID_FIELDS.map((f) => node[f])
    .filter((v) => typeof v === 'string' || typeof v === 'number')
    .join(' | ');
}

/**
 * Walk JSON-LD (including @graph, hasVariant and nested offers) and return every product offer.
 * An AggregateOffer's lowPrice counts only when it equals highPrice, or with `acceptLowPrice`.
 */
export function collectOffers(roots: unknown[], opts: { acceptLowPrice?: boolean } = {}): OfferCandidate[] {
  const offers: OfferCandidate[] = [];

  const visitOffer = (node: Record<string, unknown>, productContext: string) => {
    const types = typesOf(node);
    const spec = asArray(node.priceSpecification as Record<string, unknown>[])[0];
    let rawPrice = node.price ?? spec?.price;
    if (rawPrice == null && types.includes('AggregateOffer') && node.lowPrice != null && (opts.acceptLowPrice || node.lowPrice === node.highPrice)) {
      rawPrice = node.lowPrice;
    }
    const currency = normaliseCurrency(node.priceCurrency ?? spec?.priceCurrency);
    const parsed = rawPrice == null ? null : parsePrice(typeof rawPrice === 'number' ? rawPrice : String(rawPrice), currency);
    if (parsed) {
      offers.push({
        price: parsed.amount,
        currency: parsed.currency ?? currency,
        availability: normaliseAvailability(node.availability),
        context: [productContext, idText(node)].filter(Boolean).join(' | '),
      });
    }
    for (const child of asArray(node.offers as Record<string, unknown>[])) {
      if (child && typeof child === 'object') visitOffer(child, productContext);
    }
  };

  const visit = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    if (obj['@graph']) visit(obj['@graph']);
    if (typesOf(obj).some((t) => PRODUCT_TYPES.has(t))) {
      const ctx = idText(obj);
      for (const o of asArray(obj.offers as Record<string, unknown>[])) {
        if (o && typeof o === 'object') visitOffer(o, ctx);
      }
      visit(obj.hasVariant);
    }
  };

  roots.forEach(visit);
  return offers;
}

/**
 * Choose the offer to use. With `match`, the first offer whose context matches the regex.
 * Without it, the offer only when every offer agrees on price and currency; otherwise the
 * page lists several different prices and JSON-LD can't say which one is ours.
 */
export function pickOffer(offers: OfferCandidate[], match?: string): OfferCandidate | null {
  if (match) {
    const re = new RegExp(match, 'i');
    return offers.find((o) => re.test(o.context)) ?? null;
  }
  if (offers.length === 0) return null;
  const distinct = new Set(offers.map((o) => `${o.price}|${o.currency ?? ''}`));
  return distinct.size === 1 ? offers[0] : null;
}

/**
 * Apply the source preference order: JSON-LD, then itemprop/og meta, then the CSS selectors.
 * For variant targets, page-level structured data is skipped unless `variant.offerMatch`
 * identifies the variant's own offer.
 */
export function resolvePrice(raw: RawPageData, target: Target, notes: string[]): Resolved | null {
  const isVariant = !!target.variant?.steps.length;
  const pageAvailability = normaliseAvailability(raw.microdata.availability ?? raw.meta.availability);

  // 1. JSON-LD Product/Offer
  const offers = collectOffers(parseJsonLdBlocks(raw.jsonLd), { acceptLowPrice: target.priceFrom });
  if (isVariant && !target.variant?.offerMatch) {
    if (offers.length) notes.push('JSON-LD skipped: page-level offer, not specific to the selected variant');
  } else {
    const offer = pickOffer(offers, target.variant?.offerMatch);
    if (offer?.currency) {
      return { price: offer.price, currency: offer.currency, availability: offer.availability, source: 'json-ld' };
    }
    if (offers.length && !offer) {
      notes.push(target.variant?.offerMatch ? `No JSON-LD offer matched /${target.variant.offerMatch}/` : 'JSON-LD has several different prices');
    } else if (offer && !offer.currency) {
      notes.push('JSON-LD offer has no currency');
    }
  }

  // 2. itemprop="price", then og:price / product:price meta tags
  if (isVariant) {
    if (raw.microdata.price || raw.meta.price) notes.push('Meta/microdata skipped: page-level, not variant-specific');
  } else {
    const micro = raw.microdata.price ? parsePrice(raw.microdata.price, raw.microdata.currency) : null;
    if (micro?.currency) return { price: micro.amount, currency: micro.currency, availability: pageAvailability, source: 'microdata' };
    const meta = raw.meta.price ? parsePrice(raw.meta.price, raw.meta.currency) : null;
    if (meta?.currency) return { price: meta.amount, currency: meta.currency, availability: pageAvailability, source: 'meta' };
  }

  // 3. Configured CSS selectors
  if (raw.selectorHit) {
    const parsed = parsePrice(raw.selectorHit.text);
    if (parsed?.currency) {
      let availability = normaliseAvailability(raw.stockText);
      if (availability === 'unknown' && !isVariant) availability = pageAvailability;
      return { price: parsed.amount, currency: parsed.currency, availability, source: 'selector' };
    }
    notes.push(`Selector ${raw.selectorHit.selector} text "${raw.selectorHit.text.slice(0, 40)}" is not a single price with a currency`);
  } else if (target.selectors?.length) {
    notes.push('No configured selector matched a visible element');
  }
  return null;
}
