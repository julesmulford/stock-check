import { AVAILABILITY_LABEL, formatMoney, round2 } from './price';
import type { FxRates, Group, MonitorEvent, ScrapeResult, State, Target } from './types';

export const UK_VAT_RATE = 0.2;

const SECTIONS: Array<{ title: string; groups: Group[] }> = [
  { title: 'KEF S3 Floor Stands, Indigo (pair)', groups: ['A', 'B'] },
  { title: 'Purifi stereo amplifiers', groups: ['C'] },
];

const ukDateTime = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
const ukDate = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short' }).format(new Date(iso));

/** GBP price with UK VAT: adds 20% for prices shown without VAT. */
export function gbpInclVat(gbp: number | undefined, target: Target): number | undefined {
  return gbp == null ? undefined : target.vat === 'excl' ? round2(gbp * (1 + UK_VAT_RATE)) : gbp;
}

function todayCell(target: Target, result: ScrapeResult | undefined, event: MonitorEvent | undefined, lastSuccessAt?: string): string {
  if (!result) return 'not checked';
  if (result.status !== 'ok') {
    const status = STATUS_LABEL[result.status].toLowerCase();
    return lastSuccessAt ? `⚠ ${status}; price from ${ukDate(lastSuccessAt)}` : `⚠ ${status}`;
  }
  switch (event?.type) {
    case 'drop':
      return `**↓ ${formatMoney(event.oldPrice - event.newPrice, event.currency)} (−${event.pctDrop}%)**`;
    case 'rise':
      return `↑ ${formatMoney(event.newPrice - event.oldPrice, event.currency)} (+${event.pctRise}%)`;
    case 'first':
      return 'new';
    case 'currency_changed':
      return `now in ${event.newCurrency}`;
    default:
      return '–';
  }
}

/**
 * The daily prices table (PRICES.md): every enabled target with its latest known price,
 * GBP equivalents and today's change, cheapest first within each product section.
 */
export function pricesTable(
  targets: Target[],
  state: State,
  results: ScrapeResult[],
  events: MonitorEvent[],
  opts: { generatedAt: string; fx: FxRates | null },
): string {
  const out = [
    '# Current prices',
    '',
    `Updated ${ukDateTime(opts.generatedAt)} (UK time). Each section is sorted cheapest first, including UK VAT.`,
    '',
  ];

  for (const section of SECTIONS) {
    const rows = targets
      .filter((t) => t.enabled !== false && section.groups.includes(t.group))
      .map((target) => {
        const s = state.targets[target.id];
        const result = results.find((r) => r.targetId === target.id);
        const gbp = s?.lastGbp ?? (s?.currency === 'GBP' ? s.lastPrice : undefined);
        return { target, s, result, event: events.find((e) => e.targetId === target.id), gbp, gbpVat: gbpInclVat(gbp, target) };
      })
      .sort((a, b) => (a.gbpVat ?? Infinity) - (b.gbpVat ?? Infinity));
    if (!rows.length) continue;

    const showConversion = rows.some((r) => r.target.vat === 'excl' || (r.s?.currency && r.s.currency !== 'GBP'));
    const showProduct = new Set(rows.map((r) => r.target.name)).size > 1;
    const header = [
      ...(showProduct ? ['Product'] : []),
      'Retailer',
      'Country',
      'Price',
      ...(showConversion ? ['≈ GBP', '≈ GBP incl. UK VAT'] : []),
      'Stock',
      'Today',
    ];

    out.push(`## ${section.title}`, '', `| ${header.join(' | ')} |`, `|${header.map(() => '---').join('|')}|`);
    for (const { target, s, result, event, gbp, gbpVat } of rows) {
      const price = s?.lastPrice != null && s.currency ? formatMoney(s.lastPrice, s.currency) : '—';
      const cells = [
        ...(showProduct ? [escapeCell(target.name)] : []),
        `[${escapeCell(target.retailer)}](${target.url})`,
        target.country,
        price + (target.vat === 'excl' ? ' + VAT' : ''),
        ...(showConversion ? [gbp != null ? formatMoney(gbp, 'GBP') : '—', gbpVat != null ? formatMoney(gbpVat, 'GBP') : '—'] : []),
        AVAILABILITY_LABEL[s?.availability ?? 'unknown'],
        todayCell(target, result, event, s?.lastSuccessAt),
      ];
      out.push(`| ${cells.join(' | ')} |`);
    }
    out.push('');
  }

  const rates = opts.fx
    ? `Exchange rates: European Central Bank reference rates for ${opts.fx.date}` +
      (Object.keys(opts.fx.perGbp).length
        ? ` (${Object.entries(opts.fx.perGbp).map(([c, r]) => `£1 = ${formatMoney(r, c)}`).join(', ')}).`
        : '.')
    : 'Exchange rates were unavailable for this run, so GBP figures are from the last successful reading.';
  out.push(
    '---',
    '',
    `- ${rates}`,
    '- "+ VAT" prices are from sellers outside the UK that show prices without VAT. "Incl. UK VAT" adds the 20% import VAT you would pay on delivery. It does not include shipping, customs duty or courier fees.',
    '- Price drops are measured in each seller\'s own currency, so exchange-rate moves never trigger an alert.',
    '',
  );
  return out.join('\n');
}

export interface ReportRow {
  target: Target;
  result: ScrapeResult;
  event?: MonitorEvent;
}

const STATUS_LABEL: Record<ScrapeResult['status'], string> = {
  ok: 'OK',
  not_found: 'Price not found',
  load_error: 'Load failed',
  blocked: 'Blocked by site',
  variant_error: 'Variant selection failed',
};

export function describeChange(event: MonitorEvent | undefined): string {
  if (!event) return '';
  switch (event.type) {
    case 'first':
      return 'First reading';
    case 'same':
      return 'No change';
    case 'drop':
      return `DROP from ${formatMoney(event.oldPrice, event.currency)} (−${event.pctDrop}%)`;
    case 'rise':
      return `Rise from ${formatMoney(event.oldPrice, event.currency)} (+${event.pctRise}%)`;
    case 'currency_changed':
      return `Currency changed ${event.oldCurrency} → ${event.newCurrency}; not compared`;
    case 'failure':
      return `Failure ${event.consecutive} in a row`;
    case 'failure_alert':
      return `Failure ${event.consecutive} in a row: broken-target alert`;
    case 'recovered':
      return `Recovered after ${event.afterFailures} failure(s)`;
  }
}

function priceCell(r: ScrapeResult) {
  return r.price != null && r.currency ? formatMoney(r.price, r.currency) : '—';
}

const escapeCell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function markdownReport(rows: ReportRow[], opts: { dryRun: boolean; startedAt: string }): string {
  const lines = [
    `## Run details ${opts.dryRun ? '(dry run: nothing saved or sent)' : ''}`,
    '',
    `Run at ${opts.startedAt} (UTC)`,
    '',
    '| # | Group | Retailer | Product | Status | Price | Stock | Source | Change | Notes |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ];
  rows.forEach(({ target, result, event }, i) => {
    const notes = [result.error, target.note, ...result.notes].filter(Boolean).join('; ');
    lines.push(
      `| ${i + 1} | ${target.group} | [${escapeCell(target.retailer)}](${target.url}) | ${escapeCell(target.name)} | ${STATUS_LABEL[result.status]} | ${priceCell(result)} | ${AVAILABILITY_LABEL[result.availability ?? 'unknown']} | ${result.source ?? '—'} | ${escapeCell(describeChange(event))} | ${escapeCell(notes)} |`,
    );
  });

  const blocked = rows.filter((r) => r.result.status === 'blocked');
  if (blocked.length) {
    lines.push('', '### Blocked by bot protection', '');
    lines.push('These sites refused automated access. The monitor does not try to get round this.', '');
    for (const { target, result } of blocked) lines.push(`- **${target.retailer}**: ${result.error}`);
  }
  const broken = rows.filter((r) => r.result.status !== 'ok' && r.result.status !== 'blocked');
  if (broken.length) {
    lines.push('', '### Failed targets', '');
    for (const { target, result } of broken) lines.push(`- **${target.retailer}** (${target.id}): ${result.error}`);
  }
  return lines.join('\n') + '\n';
}

/** Plain console table: one line per target. */
export function consoleReport(rows: ReportRow[]): string {
  const data = rows.map(({ target, result, event }, i) => [
    String(i + 1),
    target.group,
    target.retailer,
    STATUS_LABEL[result.status],
    priceCell(result),
    AVAILABILITY_LABEL[result.availability ?? 'unknown'],
    result.source ?? '—',
    describeChange(event) || (result.error ?? ''),
  ]);
  const header = ['#', 'Grp', 'Retailer', 'Status', 'Price', 'Stock', 'Source', 'Change / error'];
  const widths = header.map((h, c) => Math.max(h.length, ...data.map((row) => row[c].length)));
  const fmt = (row: string[]) => row.map((cell, c) => cell.padEnd(widths[c])).join('  ');
  return [fmt(header), widths.map((w) => '-'.repeat(w)).join('  '), ...data.map(fmt)].join('\n');
}
