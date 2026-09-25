import { FAILURE_ALERT_THRESHOLD } from './compare';
import type { ExDemoEvent, ExDemoListingState, ExDemoPage, ExDemoPageResult, ExDemoPageState, ExDemoState } from './types';

/** The watched model's name, for headings and subjects. */
export const EXDEMO_MODEL = 'SVS SB-1000 Pro';

/**
 * "SB-1000 Pro", "SB1000 Pro", "SB 1000 Pro", "SB-1000-Pro"… in any case. Requires "Pro", so the
 * plain SB-1000, and other SVS models such as the SB-2000 Pro, don't match.
 */
const MODEL_PATTERN = /\bSB[\s-]?1000[\s-]*Pro\b/i;

export const isWatchedModel = (title: string) => MODEL_PATTERN.test(title);

/** Days after a listing was last seen before it's forgotten (and could be reported again). */
const FORGET_AFTER_DAYS = 180;

/**
 * Clearance and ex-demo pages to check, each already filtered to SVS.
 *
 * Not included, because bot protection (Cloudflare) blocks the monitor:
 * - Audio Affair ex-demo/graded (blocked even from a home connection):
 *   https://www.audioaffair.co.uk/sale/ex-demo-graded?manufacturer=SVS
 * - Hi-Fi Corner clearance (blocked from GitHub):
 *   https://www.hificorner.co.uk/product-category/clearance/?_brands=svs
 */
export const exDemoPages: ExDemoPage[] = [
  {
    id: 'homeavdirect-clearance-svs',
    retailer: 'Home AV Direct',
    label: 'Clearance',
    url: 'https://www.homeavdirect.co.uk/collections/clearance?filter.p.vendor=SVS&sort_by=price-ascending',
    brand: 'SVS',
    cardSelector: 'product-card',
    titleSelector: '.product__content h3',
    linkSelector: 'a.product-card__link',
    priceSelectors: ['.price_product h4'],
    priceExclude: '.compare-price-cross',
    emptySelector: '.main-collection-grid__empty-title',
  },
  {
    id: 'homeavdirect-exdemo-svs',
    retailer: 'Home AV Direct',
    label: 'Ex-demo',
    url: 'https://www.homeavdirect.co.uk/collections/clearance-ex-demo?filter.p.vendor=SVS&sort_by=price-ascending',
    brand: 'SVS',
    cardSelector: 'product-card',
    titleSelector: '.product__content h3',
    linkSelector: 'a.product-card__link',
    priceSelectors: ['.price_product h4'],
    priceExclude: '.compare-price-cross',
    emptySelector: '.main-collection-grid__empty-title',
    defaultCondition: 'Ex demo',
  },
  {
    id: 'nintronics-bargains-svs',
    retailer: 'Nintronics',
    label: 'Bargains',
    url: 'https://nintronics.co.uk/collections/bargains?sort_by=price-ascending&filter.v.price.gte=&filter.v.price.lte=&filter.p.vendor=SVS',
    brand: 'SVS',
    cardSelector: '#product-grid > li',
    titleSelector: '.card__heading a',
    linkSelector: '.card__heading a',
    // The sale price when there is one, otherwise the regular price.
    priceSelectors: ['.price__sale .price-item--sale', '.price__regular .price-item--regular'],
    emptySelector: '.collection--empty',
    emptyText: 'No products found',
  },
  {
    id: 'petertyson-clearance-svs-speakers',
    retailer: 'Peter Tyson',
    label: 'Clearance',
    url: 'https://petertyson.co.uk/clearance/all-clearance/speakers?clearance_condition=1837,1836&manufacturer=777&product_list_limit=36',
    brand: 'SVS',
    cardSelector: '.item.product',
    titleSelector: 'a.product-item-link',
    linkSelector: 'a.product-item-link',
    // The public price, not the members-only "PT VIP" price.
    priceSelectors: ['[data-price-type="finalPrice"] .price'],
    emptySelector: '.message.info.empty',
    emptyText: "can.t find products matching",
  },
];

/** Most specific first; the first match in the title, then the listing text, wins. */
const CONDITIONS: Array<[string, RegExp]> = [
  ['Ex demo', /\bex[\s-]?demo\b/i],
  ['Ex display', /\bex[\s-]?display\b/i],
  ['B grade', /\bB[\s-]?grade\b/i],
  ['A grade', /\bA[\s-]?grade\b/i],
  ['Graded', /\bgraded\b/i],
  ['Open box', /\bopen[\s-]?box\b/i],
  ['Nearly new', /\bnearly[\s-]?new\b/i],
  ['Customer return', /\bcustomer[\s-]?return\b/i],
  ['Refurbished', /\brefurb/i],
  ['Pre-owned', /\bpre[\s-]?owned\b|\bsecond[\s-]?hand\b|\bused\b/i],
  ['Box damaged', /\b(box|packaging)[\s-]damaged\b|\bdamaged[\s-](box|packaging)\b/i],
  ['Clearance', /\bclearance\b/i],
];

export function detectCondition(title: string, cardText: string, fallback?: string): string | undefined {
  for (const text of [title, cardText]) {
    for (const [label, re] of CONDITIONS) if (re.test(text)) return label;
  }
  return fallback;
}

/** Identify a unit by its URL, ignoring query strings (tracking and variant params) and case. */
export function listingKey(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`.toLowerCase().replace(/\/$/, '');
  } catch {
    return url.split(/[?#]/)[0].toLowerCase();
  }
}

/**
 * Fold one run's page results into the saved ex-demo state. Reports a listing when it's never
 * been seen before, or when it's cheaper than when last seen. A listing that disappears and
 * later returns at the same price is not reported again.
 */
export function applyExDemo(
  prev: ExDemoState | undefined,
  pages: ExDemoPage[],
  results: ExDemoPageResult[],
  now: string,
): { state: ExDemoState; events: ExDemoEvent[] } {
  const configured = new Set(pages.map((p) => p.id));
  const pagesState: Record<string, ExDemoPageState> = {};
  for (const [id, s] of Object.entries(prev?.pages ?? {})) if (configured.has(id)) pagesState[id] = s;
  const listings: Record<string, ExDemoListingState> = { ...(prev?.listings ?? {}) };
  const events: ExDemoEvent[] = [];

  for (const result of results) {
    const page = pages.find((p) => p.id === result.pageId);
    if (!page) continue;
    const before = pagesState[page.id] ?? { consecutiveFailures: 0, failureAlerted: false };

    if (result.status !== 'ok') {
      const consecutive = before.consecutiveFailures + 1;
      const alert = consecutive >= FAILURE_ALERT_THRESHOLD && !before.failureAlerted;
      pagesState[page.id] = { ...before, consecutiveFailures: consecutive, failureAlerted: before.failureAlerted || alert, lastCheckedAt: now, lastError: result.error ?? result.status };
      const payload = { pageId: page.id, consecutive, status: result.status, error: result.error };
      events.push(alert ? { type: 'page_failure_alert', ...payload } : { type: 'page_failure', ...payload });
      continue;
    }

    if (before.consecutiveFailures > 0) events.push({ type: 'page_recovered', pageId: page.id, afterFailures: before.consecutiveFailures });
    pagesState[page.id] = { consecutiveFailures: 0, failureAlerted: false, lastCheckedAt: now, lastSuccessAt: now, lastItemCount: result.itemCount };

    const seenNow = new Set<string>();
    for (const m of result.matches) {
      seenNow.add(m.key);
      const old = listings[m.key];
      const next: ExDemoListingState = { ...m, pageId: page.id, retailer: page.retailer, firstSeenAt: old?.firstSeenAt ?? now, lastSeenAt: now, listed: true };
      listings[m.key] = next;
      if (!old) {
        events.push({ type: 'found', listing: next });
      } else if (old.price != null && m.price != null && old.currency === m.currency && Math.round(m.price * 100) < Math.round(old.price * 100)) {
        events.push({ type: 'cheaper', listing: next, oldPrice: old.price });
      }
    }
    // Listings from this page that weren't on it this time: keep them, so they aren't re-reported.
    for (const [key, l] of Object.entries(listings)) {
      if (l.pageId === page.id && !seenNow.has(key) && l.listed) listings[key] = { ...l, listed: false };
    }
  }

  const cutoff = Date.parse(now) - FORGET_AFTER_DAYS * 86_400_000;
  for (const [key, l] of Object.entries(listings)) {
    if (!l.listed && Date.parse(l.lastSeenAt) < cutoff) delete listings[key];
  }
  return { state: { pages: pagesState, listings }, events };
}

/** Found or cheaper listings: the ones that go at the top of the email. */
export function exDemoFinds(events: ExDemoEvent[]) {
  return events.filter((e): e is Extract<ExDemoEvent, { type: 'found' | 'cheaper' }> => e.type === 'found' || e.type === 'cheaper');
}

export function exDemoPageAlerts(events: ExDemoEvent[]) {
  return events.filter((e): e is Extract<ExDemoEvent, { type: 'page_failure_alert' }> => e.type === 'page_failure_alert');
}
