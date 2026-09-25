import { pctChange } from './compare';
import { EXDEMO_MODEL } from './exdemo';
import { AVAILABILITY_LABEL, formatMoney, round2 } from './price';
import { STATUS_LABEL } from './report';
import type {
  ExDemoEvent,
  ExDemoPage,
  ExDemoPageResult,
  ExDemoState,
  FxRates,
  Group,
  MonitorEvent,
  ScrapeResult,
  State,
  Target,
  TargetState,
} from './types';

export const UK_VAT_RATE = 0.2;

const SECTIONS: Array<{ title: string; groups: Group[] }> = [
  { title: 'KEF S3 Floor Stands, Indigo (pair)', groups: ['A', 'B'] },
  { title: 'Purifi stereo amplifiers', groups: ['C'] },
  { title: 'SVS SB-1000 Pro subwoofer, Black Ash', groups: ['D'] },
];

export const ukDateTime = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
export const ukDate = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short' }).format(new Date(iso));

export interface PriceRow {
  targetId: string;
  product: string;
  retailer: string;
  url: string;
  country: string;
  /** Price in the seller's currency, with "+ VAT" for ex-VAT prices. */
  price: string;
  gbp: string;
  gbpVat: string;
  /** Price when monitoring started, with the date it was recorded. Never changes. */
  original: string;
  /** Current price against the original, e.g. "↓ £50.00 (−7.2%)". */
  sinceOriginal: string;
  sinceKind: 'down' | 'up' | 'same' | 'none';
  stock: string;
  today: string;
  kind: 'drop' | 'rise' | 'new' | 'same' | 'failed' | 'other';
}

export interface PriceSection {
  title: string;
  /** More than one product in the section, so name each row's product. */
  showProduct: boolean;
  /** Some prices are foreign or ex-VAT, so show the GBP columns. */
  showConversion: boolean;
  rows: PriceRow[];
}

export interface ExDemoRow {
  retailer: string;
  page: string;
  title: string;
  url: string;
  condition: string;
  price: string;
  firstSeen: string;
  today: string;
  kind: 'found' | 'cheaper' | 'same';
}

export interface ExDemoBlock {
  title: string;
  /** Matching listings currently on their pages, cheapest first. */
  rows: ExDemoRow[];
  pagesChecked: number;
  /** Pages that couldn't be read this run, e.g. "Nintronics Bargains: blocked by site". */
  problems: string[];
}

export interface PriceTable {
  generatedAt: string;
  sections: PriceSection[];
  exdemo?: ExDemoBlock;
  notes: string[];
}

export interface ExDemoInput {
  pages: ExDemoPage[];
  state: ExDemoState;
  results: ExDemoPageResult[];
  events: ExDemoEvent[];
}

const EXDEMO_STATUS: Record<ExDemoPageResult['status'], string> = {
  ok: 'OK',
  blocked: 'blocked by site',
  load_error: 'failed to load',
  grid_not_found: 'listings not found (page layout may have changed)',
  filter_not_applied: 'brand filter not applied',
};

export function buildExDemoBlock(input: ExDemoInput): ExDemoBlock {
  const listed = Object.values(input.state.listings)
    .filter((l) => l.listed && input.pages.some((p) => p.id === l.pageId))
    .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
  const rows = listed.map((l): ExDemoRow => {
    const page = input.pages.find((p) => p.id === l.pageId)!;
    const event = input.events.find((e) => (e.type === 'found' || e.type === 'cheaper') && e.listing.key === l.key);
    let today = '–';
    let kind: ExDemoRow['kind'] = 'same';
    if (event?.type === 'found') [today, kind] = ['new', 'found'];
    if (event?.type === 'cheaper' && l.price != null && l.currency) {
      [today, kind] = [`↓ ${formatMoney(event.oldPrice - l.price, l.currency)} (−${-pctChange(event.oldPrice, l.price)}%)`, 'cheaper'];
    }
    return {
      retailer: l.retailer,
      page: page.label,
      title: l.title,
      url: l.url,
      condition: l.condition ?? '—',
      price: l.price != null && l.currency ? formatMoney(l.price, l.currency) : '—',
      firstSeen: ukDate(l.firstSeenAt),
      today,
      kind,
    };
  });
  const problems = input.results
    .filter((r) => r.status !== 'ok')
    .map((r) => {
      const p = input.pages.find((x) => x.id === r.pageId)!;
      return `${p.retailer} ${p.label}: ${EXDEMO_STATUS[r.status]}`;
    });
  return { title: `Ex demo watch: ${EXDEMO_MODEL}`, rows, pagesChecked: input.results.length, problems };
}

/** GBP price with UK VAT: adds 20% for prices shown without VAT. */
export function gbpInclVat(gbp: number | undefined, target: Target): number | undefined {
  return gbp == null ? undefined : target.vat === 'excl' ? round2(gbp * (1 + UK_VAT_RATE)) : gbp;
}

function sinceOriginal(s: TargetState | undefined, target: Target): Pick<PriceRow, 'original' | 'sinceOriginal' | 'sinceKind'> {
  if (s?.originalPrice == null || !s.originalCurrency) return { original: '—', sinceOriginal: '—', sinceKind: 'none' };
  const vat = target.vat === 'excl' ? ' + VAT' : '';
  const original = `${formatMoney(s.originalPrice, s.originalCurrency)}${vat}${s.originalAt ? ` (${ukDate(s.originalAt)})` : ''}`;
  // Only compare within one currency, as for drop alerts.
  if (s.lastPrice == null || s.currency !== s.originalCurrency) return { original, sinceOriginal: '—', sinceKind: 'none' };
  const diff = Math.round((s.lastPrice - s.originalPrice) * 100) / 100;
  if (diff === 0) return { original, sinceOriginal: '–', sinceKind: 'same' };
  const pct = pctChange(s.originalPrice, s.lastPrice);
  return diff < 0
    ? { original, sinceOriginal: `↓ ${formatMoney(-diff, s.currency)} (−${-pct}%)`, sinceKind: 'down' }
    : { original, sinceOriginal: `↑ ${formatMoney(diff, s.currency)} (+${pct}%)`, sinceKind: 'up' };
}

function today(result: ScrapeResult | undefined, event: MonitorEvent | undefined, lastSuccessAt?: string): Pick<PriceRow, 'today' | 'kind'> {
  if (!result) return { today: 'not checked', kind: 'other' };
  if (result.status !== 'ok') {
    const status = STATUS_LABEL[result.status].toLowerCase();
    return { today: lastSuccessAt ? `⚠ ${status}; price from ${ukDate(lastSuccessAt)}` : `⚠ ${status}`, kind: 'failed' };
  }
  switch (event?.type) {
    case 'drop':
      return { today: `↓ ${formatMoney(event.oldPrice - event.newPrice, event.currency)} (−${event.pctDrop}%)`, kind: 'drop' };
    case 'rise':
      return { today: `↑ ${formatMoney(event.newPrice - event.oldPrice, event.currency)} (+${event.pctRise}%)`, kind: 'rise' };
    case 'first':
      return { today: 'new', kind: 'new' };
    case 'currency_changed':
      return { today: `now in ${event.newCurrency}`, kind: 'other' };
    default:
      return { today: '–', kind: 'same' };
  }
}

/**
 * Every enabled target with its latest known price, GBP equivalents and today's change,
 * cheapest first (including UK VAT) within each product section.
 */
export function buildPriceTable(
  targets: Target[],
  state: State,
  results: ScrapeResult[],
  events: MonitorEvent[],
  opts: { generatedAt: string; fx: FxRates | null; exdemo?: ExDemoInput },
): PriceTable {
  const sections: PriceSection[] = [];
  for (const section of SECTIONS) {
    const rows = targets
      .filter((t) => t.enabled !== false && section.groups.includes(t.group))
      .map((target) => {
        const s = state.targets[target.id];
        const gbp = s?.lastGbp ?? (s?.currency === 'GBP' ? s.lastPrice : undefined);
        const gbpVat = gbpInclVat(gbp, target);
        const row: PriceRow = {
          targetId: target.id,
          product: target.name,
          retailer: target.retailer,
          url: target.url,
          country: target.country,
          price: (s?.lastPrice != null && s.currency ? formatMoney(s.lastPrice, s.currency) : '—') + (target.vat === 'excl' ? ' + VAT' : ''),
          gbp: gbp != null ? formatMoney(gbp, 'GBP') : '—',
          gbpVat: gbpVat != null ? formatMoney(gbpVat, 'GBP') : '—',
          ...sinceOriginal(s, target),
          stock: AVAILABILITY_LABEL[s?.availability ?? 'unknown'],
          ...today(
            results.find((r) => r.targetId === target.id),
            events.find((e) => e.targetId === target.id),
            s?.lastSuccessAt,
          ),
        };
        return { row, sortKey: gbpVat ?? Infinity, foreign: target.vat === 'excl' || (!!s?.currency && s.currency !== 'GBP') };
      })
      .sort((a, b) => a.sortKey - b.sortKey);
    if (!rows.length) continue;
    sections.push({
      title: section.title,
      showProduct: new Set(rows.map((r) => r.row.product)).size > 1,
      showConversion: rows.some((r) => r.foreign),
      rows: rows.map((r) => r.row),
    });
  }

  const rates = opts.fx
    ? `Exchange rates: European Central Bank reference rates for ${opts.fx.date}` +
      (Object.keys(opts.fx.perGbp).length
        ? ` (${Object.entries(opts.fx.perGbp).map(([c, r]) => `£1 = ${formatMoney(r, c)}`).join(', ')}).`
        : '.')
    : 'Exchange rates were unavailable for this run, so GBP figures are from the last successful reading.';
  return {
    generatedAt: opts.generatedAt,
    sections,
    exdemo: opts.exdemo ? buildExDemoBlock(opts.exdemo) : undefined,
    notes: [
      rates,
      '"+ VAT" prices are from sellers outside the UK that show prices without VAT. "Incl. UK VAT" adds the 20% import VAT you would pay on delivery. It does not include shipping, customs duty or courier fees.',
      "Price drops are measured in each seller's own currency, so exchange-rate moves never trigger an alert.",
    ],
  };
}

function columns(section: PriceSection): Array<{ header: string; value: (r: PriceRow) => string }> {
  return [
    ...(section.showProduct ? [{ header: 'Product', value: (r: PriceRow) => r.product }] : []),
    { header: 'Retailer', value: (r) => r.retailer },
    { header: 'Country', value: (r) => r.country },
    { header: 'Price', value: (r) => r.price },
    { header: 'Original price', value: (r) => r.original },
    { header: 'Since original', value: (r) => r.sinceOriginal },
    ...(section.showConversion
      ? [
          { header: '≈ GBP', value: (r: PriceRow) => r.gbp },
          { header: '≈ GBP incl. UK VAT', value: (r: PriceRow) => r.gbpVat },
        ]
      : []),
    { header: 'Stock', value: (r) => r.stock },
    { header: 'Today', value: (r) => r.today },
  ];
}

const intro = (t: PriceTable) => `Updated ${ukDateTime(t.generatedAt)} (UK time). Each section is sorted cheapest first, including UK VAT.`;

/** PRICES.md and the job summary. */
export function priceTableMarkdown(t: PriceTable): string {
  const md = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const out = ['# Current prices', '', intro(t), ''];
  for (const section of t.sections) {
    const cols = columns(section);
    out.push(`## ${section.title}`, '', `| ${cols.map((c) => c.header).join(' | ')} |`, `|${cols.map(() => '---').join('|')}|`);
    for (const row of section.rows) {
      const cells = cols.map((c) => {
        const v = md(c.value(row));
        if (c.header === 'Retailer') return `[${v}](${row.url})`;
        if (c.header === 'Today' && row.kind === 'drop') return `**${v}**`;
        return v;
      });
      out.push(`| ${cells.join(' | ')} |`);
    }
    out.push('');
  }
  if (t.exdemo) {
    const x = t.exdemo;
    out.push(`## ${x.title}`, '', exDemoSummary(x), '');
    if (x.rows.length) {
      out.push('| Retailer | Listing | Condition | Price | First seen | Today |', '|---|---|---|---|---|---|');
      for (const r of x.rows) {
        const today = r.kind === 'same' ? r.today : `**${md(r.today)}**`;
        out.push(`| ${md(r.retailer)} (${md(r.page)}) | [${md(r.title)}](${r.url}) | ${md(r.condition)} | ${md(r.price)} | ${r.firstSeen} | ${today} |`);
      }
      out.push('');
    }
  }
  out.push('---', '', ...t.notes.map((n) => `- ${n}`), '');
  return out.join('\n');
}

function exDemoSummary(x: ExDemoBlock): string {
  const pages = `${x.pagesChecked} clearance / ex-demo page${x.pagesChecked === 1 ? '' : 's'} checked`;
  const found = x.rows.length
    ? `${x.rows.length} SB-1000 Pro listing${x.rows.length === 1 ? '' : 's'} currently on them.`
    : 'No SB-1000 Pro listings on them.';
  const problems = x.problems.length ? ` Couldn't check: ${x.problems.join('; ')}.` : '';
  return `${pages}. ${found}${problems}`;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const SINCE_COLOUR: Record<PriceRow['sinceKind'], string> = { down: 'color:#137333;', up: 'color:#c5221f;', same: '', none: '' };

/** The table for the daily email. Inline styles, because email clients ignore stylesheets. */
export function priceTableHtml(t: PriceTable): string {
  const cell = 'padding:6px 10px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top;';
  const out = [`<p style="color:#555">${esc(intro(t))}</p>`];
  for (const section of t.sections) {
    const cols = columns(section);
    out.push(
      `<h3 style="margin:24px 0 8px">${esc(section.title)}</h3>`,
      '<table style="border-collapse:collapse;font-size:14px">',
      `<tr>${cols.map((c) => `<th style="${cell}background:#f3f3f3">${esc(c.header)}</th>`).join('')}</tr>`,
    );
    for (const row of section.rows) {
      const bg = row.kind === 'drop' ? 'background:#e6f4ea;' : row.kind === 'failed' ? 'background:#fdf3e1;' : '';
      const cells = cols.map((c) => {
        const v = esc(c.value(row));
        const content = c.header === 'Retailer' ? `<a href="${esc(row.url)}">${v}</a>` : c.header === 'Today' && row.kind === 'drop' ? `<strong>${v}</strong>` : v;
        const colour = c.header === 'Since original' ? SINCE_COLOUR[row.sinceKind] : '';
        return `<td style="${cell}${bg}${colour}">${content}</td>`;
      });
      out.push(`<tr>${cells.join('')}</tr>`);
    }
    out.push('</table>');
  }
  if (t.exdemo) {
    const x = t.exdemo;
    out.push(`<h3 style="margin:24px 0 8px">${esc(x.title)}</h3>`, `<p style="color:#555">${esc(exDemoSummary(x))}</p>`);
    if (x.rows.length) {
      const headers = ['Retailer', 'Listing', 'Condition', 'Price', 'First seen', 'Today'];
      out.push('<table style="border-collapse:collapse;font-size:14px">', `<tr>${headers.map((h) => `<th style="${cell}background:#f3f3f3">${h}</th>`).join('')}</tr>`);
      for (const r of x.rows) {
        const bg = r.kind === 'same' ? '' : 'background:#e6f4ea;';
        const today = r.kind === 'same' ? esc(r.today) : `<strong>${esc(r.today)}</strong>`;
        const cells = [`${esc(r.retailer)} (${esc(r.page)})`, `<a href="${esc(r.url)}">${esc(r.title)}</a>`, esc(r.condition), esc(r.price), esc(r.firstSeen), today];
        out.push(`<tr>${cells.map((c) => `<td style="${cell}${bg}">${c}</td>`).join('')}</tr>`);
      }
      out.push('</table>');
    }
  }
  out.push(`<ul style="color:#555;font-size:13px">${t.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`);
  return out.join('\n');
}

/** Plain-text version for the email's text part and Telegram: one line per item. */
export function priceTableText(t: PriceTable): string {
  const out = [intro(t), ''];
  for (const section of t.sections) {
    out.push(section.title.toUpperCase());
    for (const r of section.rows) {
      const lead = section.showConversion ? `${r.gbpVat}${r.gbpVat !== r.price ? ` (${r.price})` : ''}` : r.price;
      const what = section.showProduct ? `${r.product}, ${r.retailer}` : r.retailer;
      const change = r.kind === 'same' ? '' : ` · ${r.today}`;
      const since = r.sinceKind === 'down' || r.sinceKind === 'up' ? ` · since original ${r.original}: ${r.sinceOriginal}` : '';
      out.push(`  ${lead}  ${what} (${r.country}) · ${r.stock}${change}${since}`);
    }
    out.push('');
  }
  if (t.exdemo) {
    const x = t.exdemo;
    out.push(x.title.toUpperCase(), `  ${exDemoSummary(x)}`);
    for (const r of x.rows) {
      const change = r.kind === 'same' ? '' : ` · ${r.today}`;
      out.push(`  ${r.price}  ${r.title} (${r.condition}), ${r.retailer} ${r.page} · first seen ${r.firstSeen}${change}`, `    ${r.url}`);
    }
    out.push('');
  }
  out.push(...t.notes.map((n) => `* ${n}`));
  return out.join('\n');
}
