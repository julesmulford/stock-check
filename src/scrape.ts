import type { BrowserContext, Page } from 'playwright';
import { resolvePrice, type RawPageData } from './extract';
import type { ScrapeResult, Target, VariantStep } from './types';

export const NAV_TIMEOUT = 45_000;
const IDLE_TIMEOUT = 10_000;
const STEP_TIMEOUT = 15_000;

/** Page titles and statuses that indicate bot protection rather than a broken page. */
export const BLOCK_TITLE = /access denied|just a moment|attention required|are you a robot|verify you are human|captcha|request blocked|pardon our interruption/i;
export const BLOCK_STATUSES = new Set([401, 403, 429]);

/**
 * Buttons that dismiss a cookie banner. Reject/essential-only options are tried first,
 * then accept. Names are matched against the whole accessible name to avoid stray clicks.
 */
const COOKIE_BUTTON_NAMES = [
  /^(deny|decline|reject|reject all|reject all cookies|accept essentials only|essential only|only essential|necessary only|only necessary|use necessary cookies only|continue without accepting)$/i,
  /^(accept|accept all|accept all cookies|accept cookies|allow all|allow all cookies|i agree|agree|agree and close|got it)$/i,
];

export async function settle(page: Page, extraMs = 0) {
  await page.waitForLoadState('networkidle', { timeout: IDLE_TIMEOUT }).catch(() => {});
  if (extraMs) await page.waitForTimeout(extraMs);
}

/** Dismiss a cookie banner if one appears within a few seconds. Never throws. */
export async function dismissCookies(page: Page, override?: string): Promise<boolean> {
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    const candidates = [
      ...(override ? [page.locator(override)] : []),
      ...COOKIE_BUTTON_NAMES.map((name) => page.getByRole('button', { name })),
    ];
    for (const loc of candidates) {
      const visible = loc.filter({ visible: true }).first();
      if (await visible.count().catch(() => 0)) {
        const clicked = await visible.click({ timeout: 3_000 }).then(() => true, () => false);
        if (clicked) {
          await page.waitForTimeout(750);
          return true;
        }
      }
    }
    await page.waitForTimeout(500);
  }
  return false;
}

async function runStep(page: Page, step: VariantStep) {
  // Pages often render the same picker twice (e.g. a hidden mobile drawer), so use the first visible one.
  const loc = step.action === 'click' ? page.locator(step.selector).filter({ visible: true }).first() : page.locator(step.selector).first();
  switch (step.action) {
    case 'select':
      await loc.selectOption(step.value, { timeout: STEP_TIMEOUT });
      break;
    case 'click':
      await loc.click({ timeout: STEP_TIMEOUT });
      break;
    case 'expectValue': {
      const deadline = Date.now() + STEP_TIMEOUT;
      let value = '';
      while (Date.now() < deadline) {
        value = await loc.inputValue({ timeout: STEP_TIMEOUT });
        if (value === step.value) return;
        await page.waitForTimeout(250);
      }
      throw new Error(`${step.selector} has value "${value}", expected "${step.value}"`);
    }
  }
}

/** Runs in the browser: gathers every candidate price source without interpreting it. */
function collectRaw(args: { selectors: string[]; stockSelector?: string }): RawPageData {
  const isVisible = (el: Element) => (el as HTMLElement).getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim() || undefined;
  const attrOrText = (el: Element | null) =>
    el ? (el.getAttribute('content') ?? el.getAttribute('href') ?? el.getAttribute('value') ?? text(el)) || undefined : undefined;
  const meta = (...names: string[]) => {
    for (const n of names) {
      const el = document.querySelector(`meta[property="${n}"], meta[name="${n}"]`);
      const v = el?.getAttribute('content');
      if (v) return v;
    }
    return undefined;
  };

  let selectorHit: RawPageData['selectorHit'];
  for (const selector of args.selectors) {
    const el = [...document.querySelectorAll(selector)].find((e) => isVisible(e) && /\d/.test(e.textContent ?? ''));
    if (el) {
      selectorHit = { selector, text: text(el)! };
      break;
    }
  }
  const stockEl = args.stockSelector ? [...document.querySelectorAll(args.stockSelector)].find(isVisible) : undefined;

  return {
    jsonLd: [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent ?? ''),
    microdata: {
      price: attrOrText(document.querySelector('[itemprop="price"]')),
      currency: attrOrText(document.querySelector('[itemprop="priceCurrency"]')),
      availability: attrOrText(document.querySelector('[itemprop="availability"]')),
    },
    meta: {
      price: meta('og:price:amount', 'product:price:amount'),
      currency: meta('og:price:currency', 'product:price:currency'),
      availability: meta('og:availability', 'product:availability'),
    },
    selectorHit,
    stockText: text(stockEl),
  };
}

export async function scrapeTarget(context: BrowserContext, target: Target): Promise<ScrapeResult> {
  const notes: string[] = [];
  const base = { targetId: target.id, notes };
  const page = await context.newPage();
  try {
    let response;
    try {
      response = await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    } catch (err) {
      return { ...base, status: 'load_error', error: `Navigation failed: ${errMsg(err)}` };
    }
    const httpStatus = response?.status();
    const finalUrl = page.url();
    await settle(page);
    const title = await page.title().catch(() => '');

    if ((httpStatus && BLOCK_STATUSES.has(httpStatus)) || BLOCK_TITLE.test(title)) {
      return { ...base, status: 'blocked', httpStatus, finalUrl, error: `Blocked by the site (HTTP ${httpStatus ?? '?'}, title "${title}")` };
    }
    if (httpStatus && httpStatus >= 400) {
      return { ...base, status: 'load_error', httpStatus, finalUrl, error: `HTTP ${httpStatus}` };
    }

    if (await dismissCookies(page, target.cookieSelector)) notes.push('Cookie banner dismissed');

    if (target.variant?.steps.length) {
      try {
        for (const step of target.variant.steps) {
          await runStep(page, step);
          await settle(page, 300);
        }
        // Give the price element time to re-render after the final selection.
        await settle(page, 1_500);
        notes.push(`Selected ${target.variant.label}`);
      } catch (err) {
        return { ...base, status: 'variant_error', httpStatus, finalUrl, error: `Could not select ${target.variant.label}: ${errMsg(err)}` };
      }
    }

    const raw = await page.evaluate(collectRaw, { selectors: target.selectors ?? [], stockSelector: target.stockSelector });
    const resolved = resolvePrice(raw, target, notes);
    if (!resolved) {
      return { ...base, status: 'not_found', httpStatus, finalUrl: page.url(), error: 'Price not found' };
    }
    return { ...base, status: 'ok', httpStatus, finalUrl: page.url(), ...resolved };
  } catch (err) {
    return { ...base, status: 'load_error', error: errMsg(err) };
  } finally {
    await page.close().catch(() => {});
  }
}

export function errMsg(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).split('\n')[0].slice(0, 200);
}
