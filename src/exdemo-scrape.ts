import type { BrowserContext, Page } from 'playwright';
import { detectCondition, isWatchedModel, listingKey } from './exdemo';
import { parsePrice } from './price';
import { BLOCK_STATUSES, BLOCK_TITLE, NAV_TIMEOUT, dismissCookies, errMsg, settle } from './scrape';
import type { ExDemoListing, ExDemoPage, ExDemoPageResult } from './types';

/** How long to wait for a listing grid (often filtered by JavaScript) to stop changing. */
const GRID_TIMEOUT = 20_000;

export interface RawCard {
  title: string;
  href: string;
  priceText?: string;
  text: string;
}

export interface GridArgs {
  cardSelector: string;
  titleSelector: string;
  linkSelector?: string;
  priceSelectors: string[];
  priceExclude?: string;
  emptySelector?: string;
  emptyText?: string;
}

/** Runs in the browser: the visible listing cards, and whether the page says it has none. */
export function readGrid(args: GridArgs): { cards: RawCard[]; empty: boolean } {
  const visible = (e: Element) => (e as HTMLElement).getClientRects().length > 0;
  const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
  const cards = [...document.querySelectorAll(args.cardSelector)].filter(visible).map((card) => {
    const titleEl = card.querySelector(args.titleSelector);
    const link = (args.linkSelector ? card.querySelector(args.linkSelector) : null) ?? card.querySelector('a[href]');
    let priceText: string | undefined;
    for (const sel of args.priceSelectors) {
      const el = [...card.querySelectorAll(sel)].find((e) => visible(e) && /\d/.test(e.textContent ?? ''));
      if (!el) continue;
      const copy = el.cloneNode(true) as Element;
      if (args.priceExclude) copy.querySelectorAll(args.priceExclude).forEach((x) => x.remove());
      priceText = clean(copy.textContent);
      break;
    }
    return { title: clean(titleEl?.textContent), href: (link as HTMLAnchorElement | null)?.href ?? '', priceText, text: clean((card as HTMLElement).innerText) };
  });
  const empty =
    (!!args.emptySelector && [...document.querySelectorAll(args.emptySelector)].some(visible)) ||
    (!!args.emptyText && new RegExp(args.emptyText, 'i').test(document.body.innerText));
  return { cards, empty };
}

/** Wait until the grid stops changing and shows either listings or an explicit "no products". */
async function waitForGrid(page: Page, args: GridArgs) {
  const deadline = Date.now() + GRID_TIMEOUT;
  let last = -1;
  let stableChecks = 0;
  let grid = await page.evaluate(readGrid, args);
  while (Date.now() < deadline) {
    const settled = grid.cards.length > 0 || grid.empty;
    stableChecks = grid.cards.length === last && settled ? stableChecks + 1 : 0;
    if (stableChecks >= 2) break;
    last = grid.cards.length;
    await page.waitForTimeout(1_000);
    grid = await page.evaluate(readGrid, args);
  }
  return grid;
}

/**
 * Turn raw cards into the result: checks that the brand filter applied, then keeps the
 * listings whose title is the watched model. Pure, so it can be tested without a browser.
 */
export function interpretGrid(page: ExDemoPage, grid: { cards: RawCard[]; empty: boolean }, notes: string[] = []): Omit<ExDemoPageResult, 'pageId'> {
  const cards = grid.cards.filter((c) => c.title);
  if (grid.cards.length > cards.length) notes.push(`${grid.cards.length - cards.length} listing(s) without a title ignored`);
  if (!cards.length) {
    return grid.empty
      ? { status: 'ok', itemCount: 0, matches: [], notes: [...notes, 'No products listed'] }
      : { status: 'grid_not_found', itemCount: 0, matches: [], error: 'No listings and no "no products" message: the page layout may have changed', notes };
  }
  const brand = new RegExp(`\\b${page.brand}\\b`, 'i');
  const offBrand = cards.find((c) => !brand.test(c.title));
  if (offBrand) {
    return { status: 'filter_not_applied', itemCount: cards.length, matches: [], error: `${page.brand} filter not applied: listed "${offBrand.title.slice(0, 60)}"`, notes };
  }

  const matches: ExDemoListing[] = [];
  const seen = new Set<string>();
  for (const c of cards) {
    if (!isWatchedModel(c.title) || !c.href) continue;
    const key = listingKey(c.href);
    if (seen.has(key)) continue;
    seen.add(key);
    const price = c.priceText ? parsePrice(c.priceText) : null;
    if (!price) notes.push(`No price found for "${c.title.slice(0, 60)}"`);
    matches.push({
      key,
      title: c.title,
      price: price?.amount,
      currency: price?.currency ?? (price ? 'GBP' : undefined),
      condition: detectCondition(c.title, c.text, page.defaultCondition),
      url: c.href.split('#')[0],
    });
  }
  return { status: 'ok', itemCount: cards.length, matches, notes };
}

export async function scrapeExDemoPage(context: BrowserContext, cfg: ExDemoPage): Promise<ExDemoPageResult> {
  const notes: string[] = [];
  const base = { pageId: cfg.id, itemCount: 0, matches: [], notes };
  const page = await context.newPage();
  try {
    let response;
    try {
      response = await page.goto(cfg.url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    } catch (err) {
      return { ...base, status: 'load_error', error: `Navigation failed: ${errMsg(err)}` };
    }
    const httpStatus = response?.status();
    await settle(page);
    const title = await page.title().catch(() => '');
    if ((httpStatus && BLOCK_STATUSES.has(httpStatus)) || BLOCK_TITLE.test(title)) {
      return { ...base, status: 'blocked', error: `Blocked by the site (HTTP ${httpStatus ?? '?'}, title "${title}")` };
    }
    if (httpStatus && httpStatus >= 400) return { ...base, status: 'load_error', error: `HTTP ${httpStatus}` };

    if (await dismissCookies(page)) notes.push('Cookie banner dismissed');
    const grid = await waitForGrid(page, {
      cardSelector: cfg.cardSelector,
      titleSelector: cfg.titleSelector,
      linkSelector: cfg.linkSelector,
      priceSelectors: cfg.priceSelectors,
      priceExclude: cfg.priceExclude,
      emptySelector: cfg.emptySelector,
      emptyText: cfg.emptyText,
    });
    return { pageId: cfg.id, ...interpretGrid(cfg, grid, notes) };
  } catch (err) {
    return { ...base, status: 'load_error', error: errMsg(err) };
  } finally {
    await page.close().catch(() => {});
  }
}
