import fs from 'node:fs';
import { chromium } from 'playwright';
import { applyAll } from './compare';
import { buildAlert, channelsFromEnv, sendAlert } from './notify';
import { consoleReport, markdownReport, type ReportRow } from './report';
import { scrapeTarget } from './scrape';
import { loadState, saveState, STATE_PATH } from './state';
import { targets as allTargets } from './targets';
import type { ScrapeResult } from './types';

const DELAY_BETWEEN_TARGETS_MS = Number(process.env.DELAY_MS ?? 4_000);

function parseArgs(argv: string[]) {
  const dryRun = argv.includes('--dry-run') || /^(1|true)$/i.test(process.env.DRY_RUN ?? '');
  const onlyArg = argv.find((a) => a.startsWith('--only='));
  const only = onlyArg ? onlyArg.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean) : undefined;
  return { dryRun, only };
}

async function main() {
  const { dryRun, only } = parseArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString();

  const unknown = only?.filter((id) => !allTargets.some((t) => t.id === id)) ?? [];
  if (unknown.length) throw new Error(`Unknown target id(s): ${unknown.join(', ')}`);
  const targets = allTargets.filter((t) => (only ? only.includes(t.id) : t.enabled !== false));
  const ids = new Set(allTargets.map((t) => t.id));
  if (ids.size !== allTargets.length) throw new Error('Duplicate target ids in targets.ts');

  const state = loadState();
  console.log(`${dryRun ? 'DRY RUN: ' : ''}checking ${targets.length} target(s)\n`);

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
  try {
    for (const [i, target] of targets.entries()) {
      if (i > 0) await new Promise((r) => setTimeout(r, DELAY_BETWEEN_TARGETS_MS));
      const result = await scrapeTarget(context, target);
      results.push(result);
      const price = result.price != null ? `${result.price} ${result.currency}` : '';
      console.log(`[${i + 1}/${targets.length}] ${target.retailer}: ${result.status} ${price} ${result.error ?? ''}`.trimEnd());
    }
  } finally {
    await browser.close();
  }

  // Prune against the full config so that --only runs don't drop other targets' state.
  const { state: nextState, events } = applyAll(state, allTargets, results, startedAt);
  const rows: ReportRow[] = targets.map((target) => ({
    target,
    result: results.find((r) => r.targetId === target.id)!,
    event: events.find((e) => e.targetId === target.id),
  }));

  console.log('\n' + consoleReport(rows) + '\n');
  if (dryRun) {
    for (const { target, result } of rows) {
      console.log(`- ${target.retailer} [${result.status}] ${result.finalUrl ?? target.url}`);
      for (const n of [result.error, ...result.notes].filter(Boolean)) console.log(`    ${n}`);
    }
    console.log('');
  }

  const alert = buildAlert(events, allTargets, results);
  let notifySummary = 'No price drops or newly broken targets, so nothing sent.';
  if (alert) {
    if (dryRun) {
      notifySummary = `Would send "${alert.subject}" (dry run: not sent).`;
      console.log(`--- Message that would be sent ---\n${alert.text}\n----------------------------------\n`);
    } else {
      // Send before saving: if sending fails the job fails, state stays unchanged,
      // and the next run detects the same drop again.
      const sent = await sendAlert(alert, channelsFromEnv());
      notifySummary = `Sent "${alert.subject}" via ${sent.join(' and ')}.`;
    }
  }
  console.log(notifySummary);

  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdownReport(rows, { dryRun, startedAt }) + `\n**Notifications:** ${notifySummary}\n`);
  }

  if (dryRun) {
    console.log('Dry run: state not saved.');
  } else {
    saveState(nextState);
    console.log(`Saved ${STATE_PATH}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
