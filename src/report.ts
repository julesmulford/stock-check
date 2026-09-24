import { AVAILABILITY_LABEL, formatMoney } from './price';
import type { MonitorEvent, ScrapeResult, Target } from './types';

export interface ReportRow {
  target: Target;
  result: ScrapeResult;
  event?: MonitorEvent;
}

export const STATUS_LABEL: Record<ScrapeResult['status'], string> = {
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
