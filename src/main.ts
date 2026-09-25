import fs from 'node:fs';
import { chromium } from 'playwright';
import { applyAll } from './compare';
import { applyExDemo, exDemoPages as allExDemoPages } from './exdemo';
import { scrapeExDemoPage } from './exdemo-scrape';
import { fetchGbpRates, toGbp } from './fx';
import { buildEmail, channelsFromEnv, hasAlerts, sendAlert } from './notify';
import { buildPriceTable, priceTableMarkdown } from './prices-table';
import { consoleReport, exDemoConsoleReport, exDemoMarkdownReport, markdownReport, type ReportRow } from './report';
import { scrapeTarget } from './scrape';
import { loadState, saveState, STATE_PATH } from './state';
import { targets as allTargets } from './targets';
import type { ExDemoPageResult, ScrapeResult } from './types';

const DELAY_BETWEEN_TARGETS_MS = Number(process.env.DELAY_MS ?? 4_000);
const PRICES_PATH = process.env.PRICES_TABLE_FILE ?? 'PRICES.md';

function parseArgs(argv: string[]) {
  const dryRun = argv.includes('--dry-run') || /^(1|true)$/i.test(process.env.DRY_RUN ?? '');
  const onlyArg = argv.find((a) => a.startsWith('--only='));
  const only = onlyArg ? onlyArg.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean) : undefined;
  return { dryRun, only };
}

const pause = () => new Promise((r) => setTimeout(r, DELAY_BETWEEN_TARGETS_MS));

async function main() {
  const { dryRun, only } = parseArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString();

  const known = new Set([...allTargets.map((t) => t.id), ...allExDemoPages.map((p) => p.id)]);
  if (known.size !== allTargets.length + allExDemoPages.length) throw new Error('Duplicate ids in targets.ts / exdemo.ts');
  const unknown = only?.filter((id) => !known.has(id)) ?? [];
  if (unknown.length) throw new Error(`Unknown target or page id(s): ${unknown.join(', ')}`);
  const targets = allTargets.filter((t) => (only ? only.includes(t.id) : t.enabled !== false));
  const exDemoPages = allExDemoPages.filter((p) => !only || only.includes(p.id));

  const state = loadState();
  console.log(`${dryRun ? 'DRY RUN: ' : ''}checking ${targets.length} target(s) and ${exDemoPages.length} ex-demo page(s)\n`);

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    locale: 'en-GB',
    timezoneId: 'Europe/London',
  });
  // tsx compiles named functions with an esbuild `__name` helper, which doesn't exist inside the
  // page when a function is passed to page.evaluate. Define a no-op version there.
  await context.addInitScript('globalThis.__name = globalThis.__name || ((fn) => fn);');
  const results: ScrapeResult[] = [];
  const exDemoResults: ExDemoPageResult[] = [];
  try {
    for (const [i, target] of targets.entries()) {
      if (i > 0) await pause();
      const result = await scrapeTarget(context, target);
      results.push(result);
      const price = result.price != null ? `${result.price} ${result.currency}` : '';
      console.log(`[${i + 1}/${targets.length}] ${target.retailer}: ${result.status} ${price} ${result.error ?? ''}`.trimEnd());
    }
    for (const [i, page] of exDemoPages.entries()) {
      if (i > 0 || targets.length) await pause();
      const result = await scrapeExDemoPage(context, page);
      exDemoResults.push(result);
      const found = result.status === 'ok' ? `${result.itemCount} listing(s), ${result.matches.length} SB-1000 Pro` : '';
      console.log(`[ex-demo ${i + 1}/${exDemoPages.length}] ${page.retailer} ${page.label}: ${result.status} ${found} ${result.error ?? ''}`.trimEnd());
    }
  } finally {
    await browser.close();
  }

  // GBP equivalents are for display only; comparisons stay in each seller's own currency.
  const fx = await fetchGbpRates(results.flatMap((r) => (r.currency ? [r.currency] : [])));
  for (const r of results) if (r.price != null && r.currency) r.gbp = toGbp(r.price, r.currency, fx);

  // Prune against the full config so that --only runs don't drop other targets' state.
  const { state: nextState, events } = applyAll(state, allTargets, results, startedAt);
  nextState.fx = fx ?? state.fx;
  const exdemo = applyExDemo(state.exdemo, allExDemoPages, exDemoResults, startedAt);
  nextState.exdemo = exdemo.state;

  const table = buildPriceTable(only ? targets : allTargets, nextState, results, events, {
    generatedAt: startedAt,
    fx,
    exdemo: exDemoPages.length ? { pages: allExDemoPages, state: exdemo.state, results: exDemoResults, events: exdemo.events } : undefined,
  });
  const prices = priceTableMarkdown(table);
  const rows: ReportRow[] = targets.map((target) => ({
    target,
    result: results.find((r) => r.targetId === target.id)!,
    event: events.find((e) => e.targetId === target.id),
  }));

  console.log('\n' + consoleReport(rows) + '\n');
  if (exDemoResults.length) console.log(exDemoConsoleReport(allExDemoPages, exDemoResults) + '\n');
  if (dryRun) {
    for (const { target, result } of rows) {
      console.log(`- ${target.retailer} [${result.status}] ${result.finalUrl ?? target.url}`);
      for (const n of [result.error, ...result.notes].filter(Boolean)) console.log(`    ${n}`);
    }
    for (const r of exDemoResults) {
      const page = allExDemoPages.find((p) => p.id === r.pageId)!;
      console.log(`- ${page.retailer} ${page.label} [${r.status}] ${page.url}`);
      for (const n of [r.error, ...r.notes, ...r.matches.map((m) => `SB-1000 Pro: ${m.title} · ${m.price ?? '?'} · ${m.condition ?? '?'} · ${m.url}`)].filter(Boolean)) {
        console.log(`    ${n}`);
      }
    }
    console.log('');
  }

  // The daily email goes out on every full run. A partial --only run would send a partial table,
  // so it only emails when there's something to report.
  const email = buildEmail(events, allTargets, results, table, { events: exdemo.events, pages: allExDemoPages });
  let notifySummary = 'Partial run with nothing to report, so no email sent.';
  if (!only || hasAlerts(events, exdemo.events)) {
    if (dryRun) {
      notifySummary = `Would send "${email.subject}" (dry run: not sent).`;
      console.log(`--- Email that would be sent ---\nSubject: ${email.subject}\n\n${email.text}\n--------------------------------\n`);
    } else {
      // Send before saving: if sending fails the job fails, state stays unchanged,
      // and the next run detects the same drop or find again.
      const sent = await sendAlert(email, channelsFromEnv());
      notifySummary = `Sent "${email.subject}" via ${sent.join(' and ')}.`;
    }
  }
  console.log(notifySummary);

  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      prices +
        '\n' +
        markdownReport(rows, { dryRun, startedAt }) +
        (exDemoResults.length ? '\n' + exDemoMarkdownReport(allExDemoPages, exDemoResults) : '') +
        `\n**Notifications:** ${notifySummary}\n`,
    );
  }

  if (dryRun) {
    console.log(`Dry run: state and ${PRICES_PATH} not saved.`);
  } else {
    saveState(nextState);
    // A partial --only run would leave other targets out of the table, so only write it for full runs.
    if (!only) fs.writeFileSync(PRICES_PATH, prices);
    console.log(`Saved ${STATE_PATH}${only ? '' : ` and ${PRICES_PATH}`}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
