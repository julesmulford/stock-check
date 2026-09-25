import nodemailer from 'nodemailer';
import { alertableEvents } from './compare';
import { EXDEMO_MODEL, exDemoFinds, exDemoPageAlerts } from './exdemo';
import { AVAILABILITY_LABEL, formatMoney } from './price';
import { priceTableHtml, priceTableText, ukDate, type PriceTable } from './prices-table';
import type { ExDemoEvent, ExDemoListingState, ExDemoPage, MonitorEvent, ScrapeResult, Target } from './types';

export interface Alert {
  subject: string;
  text: string;
  html: string;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Short name for a subject line; retailer alone is ambiguous for shops with several products. */
const subjectLabel = (t: Target) =>
  t.group === 'C' ? t.name : t.group === 'D' ? `${t.retailer} (subwoofer)` : `${t.retailer} (stands)`;

export interface ExDemoEmailInput {
  events: ExDemoEvent[];
  pages: ExDemoPage[];
}

/**
 * True when the run has something beyond the daily table: a price drop, an ex-demo find, or a
 * newly broken target or page.
 */
export function hasAlerts(events: MonitorEvent[], exdemoEvents: ExDemoEvent[] = []): boolean {
  const { drops, failures } = alertableEvents(events);
  return drops.length > 0 || failures.length > 0 || exDemoFinds(exdemoEvents).length > 0 || exDemoPageAlerts(exdemoEvents).length > 0;
}

function exDemoPrice(l: ExDemoListingState) {
  return l.price != null && l.currency ? formatMoney(l.price, l.currency) : 'price not shown';
}

/**
 * The daily email: ex-demo finds first, then price drops and newly broken targets, then the full
 * prices table. Sent every run, whether or not anything changed.
 */
export function buildEmail(
  events: MonitorEvent[],
  targets: Target[],
  results: ScrapeResult[],
  table: PriceTable,
  exdemo: ExDemoEmailInput = { events: [], pages: [] },
): Alert {
  const { drops, failures, recovered } = alertableEvents(events);
  const finds = exDemoFinds(exdemo.events);
  const pageAlerts = exDemoPageAlerts(exdemo.events);
  const byId = (id: string) => targets.find((t) => t.id === id)!;
  const pageById = (id: string) => exdemo.pages.find((p) => p.id === id)!;
  const resultFor = (id: string) => results.find((r) => r.targetId === id);

  const subjectParts: string[] = [];
  if (finds.length === 1) {
    const f = finds[0];
    subjectParts.push(
      f.type === 'found'
        ? `Ex demo ${EXDEMO_MODEL} found: ${f.listing.retailer} ${exDemoPrice(f.listing)}${f.listing.condition ? ` (${f.listing.condition})` : ''}`
        : `Ex demo ${EXDEMO_MODEL} now ${exDemoPrice(f.listing)} at ${f.listing.retailer} (was ${formatMoney(f.oldPrice, f.listing.currency ?? 'GBP')})`,
    );
  } else if (finds.length > 1) {
    subjectParts.push(`${finds.length} ex demo ${EXDEMO_MODEL} listings found`);
  }
  if (drops.length === 1) {
    const d = drops[0];
    subjectParts.push(`Price drop: ${subjectLabel(byId(d.targetId))} ${formatMoney(d.oldPrice, d.currency)} → ${formatMoney(d.newPrice, d.currency)} (−${d.pctDrop}%)`);
  } else if (drops.length > 1) {
    subjectParts.push(`${drops.length} price drops: ${drops.map((d) => subjectLabel(byId(d.targetId))).join(', ')}`);
  }
  let subject = subjectParts.length ? subjectParts.join(' · ') : `Daily prices, ${ukDate(table.generatedAt)}`;
  const broken = failures.length + pageAlerts.length;
  if (broken) subject += ` · ${broken} broken target${broken > 1 ? 's' : ''}`;

  const text: string[] = [];
  const html: string[] = ['<div style="font-family:Arial,Helvetica,sans-serif;color:#222">'];

  if (finds.length) {
    const heading = `Ex demo ${EXDEMO_MODEL.replace(/^SVS /, '')} found`;
    text.push(heading.toUpperCase(), '');
    html.push(`<h2>${esc(heading)}</h2><ul>`);
    for (const f of finds) {
      const l = f.listing;
      const page = pageById(l.pageId);
      const price = f.type === 'cheaper' ? `${formatMoney(f.oldPrice, l.currency ?? 'GBP')} -> ${exDemoPrice(l)} (price drop)` : exDemoPrice(l);
      text.push(l.title, `  ${l.retailer} (${page.label})`, `  Condition: ${l.condition ?? 'not stated'}`, `  Price: ${price}`, `  ${l.url}`, '');
      const priceHtml =
        f.type === 'cheaper'
          ? `<s>${esc(formatMoney(f.oldPrice, l.currency ?? 'GBP'))}</s> → <strong>${esc(exDemoPrice(l))}</strong> (price drop)`
          : `<strong>${esc(exDemoPrice(l))}</strong>`;
      html.push(
        `<li><strong>${esc(l.title)}</strong> at ${esc(l.retailer)} (${esc(page.label)})<br>` +
          `${priceHtml} · ${esc(l.condition ?? 'condition not stated')}<br><a href="${esc(l.url)}">${esc(l.url)}</a></li>`,
      );
    }
    html.push('</ul>');
  }

  if (drops.length) {
    text.push('PRICE DROPS', '');
    html.push('<h2>Price drops</h2><ul>');
    for (const d of drops) {
      const t = byId(d.targetId);
      const stock = AVAILABILITY_LABEL[resultFor(d.targetId)?.availability ?? 'unknown'];
      const oldP = formatMoney(d.oldPrice, d.currency);
      const newP = formatMoney(d.newPrice, d.currency);
      const gbp = resultFor(d.targetId)?.gbp;
      const approx = d.currency !== 'GBP' && gbp != null ? ` (≈ ${formatMoney(gbp, 'GBP')})` : '';
      const vat = t.vat === 'excl' ? ' + VAT' : '';
      text.push(`${t.name}`, `  Retailer: ${t.retailer} (${t.country})`, `  ${oldP} -> ${newP}${vat}${approx} (-${d.pctDrop}%)`, `  Stock: ${stock}`, `  ${t.url}`, '');
      html.push(
        `<li><strong>${esc(t.name)}</strong> at ${esc(t.retailer)} (${esc(t.country)})<br>` +
          `<s>${esc(oldP)}</s> → <strong>${esc(newP)}</strong>${esc(vat + approx)} (−${d.pctDrop}%)` +
          (stock !== '—' ? ` · ${esc(stock)}` : '') +
          `<br><a href="${esc(t.url)}">${esc(t.url)}</a></li>`,
      );
    }
    html.push('</ul>');
  }

  if (broken) {
    text.push('BROKEN TARGETS (failed 3 runs in a row; a selector may need updating)', '');
    html.push('<h2>Broken targets</h2><p>These have failed three runs in a row, so a selector may need updating.</p><ul>');
    const items = [
      ...failures.map((f) => ({ who: byId(f.targetId).retailer, what: byId(f.targetId).name, error: f.error ?? f.status, url: byId(f.targetId).url })),
      ...pageAlerts.map((f) => ({ who: pageById(f.pageId).retailer, what: `${pageById(f.pageId).label} page (ex demo watch)`, error: f.error ?? f.status, url: pageById(f.pageId).url })),
    ];
    for (const i of items) {
      text.push(`${i.who}: ${i.what}`, `  ${i.error}`, `  ${i.url}`, '');
      html.push(`<li><strong>${esc(i.who)}</strong>: ${esc(i.what)}<br>${esc(i.error)}<br><a href="${esc(i.url)}">${esc(i.url)}</a></li>`);
    }
    html.push('</ul>');
  }

  if (recovered.length) {
    const names = recovered.map((r) => byId(r.targetId).retailer).join(', ');
    text.push(`Recovered since last alert: ${names}`, '');
    html.push(`<p>Recovered since last alert: ${esc(names)}</p>`);
  }

  if (finds.length || drops.length || broken) html.push('<h2>All prices</h2>');
  text.push(priceTableText(table));
  html.push(priceTableHtml(table), '</div>');

  return { subject, text: text.join('\n'), html: html.join('\n') };
}

export interface ChannelConfig {
  email?: { host: string; port: number; user?: string; pass?: string; from: string; to: string };
  telegram?: { token: string; chatId: string };
}

export function channelsFromEnv(env: NodeJS.ProcessEnv = process.env): ChannelConfig {
  const cfg: ChannelConfig = {};
  if (env.SMTP_HOST && env.ALERT_EMAIL_TO) {
    cfg.email = {
      host: env.SMTP_HOST,
      port: Number(env.SMTP_PORT || 465),
      user: env.SMTP_USER || undefined,
      pass: env.SMTP_PASS || undefined,
      from: env.SMTP_FROM || env.SMTP_USER || env.ALERT_EMAIL_TO,
      to: env.ALERT_EMAIL_TO,
    };
  }
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    cfg.telegram = { token: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_CHAT_ID };
  }
  return cfg;
}

export async function sendAlert(alert: Alert, cfg: ChannelConfig): Promise<string[]> {
  if (!cfg.email && !cfg.telegram) {
    throw new Error('No notification channel configured: set SMTP_HOST and ALERT_EMAIL_TO (and optionally Telegram secrets).');
  }
  const sent: string[] = [];
  const errors: string[] = [];

  if (cfg.email) {
    try {
      const transport = nodemailer.createTransport({
        host: cfg.email.host,
        port: cfg.email.port,
        secure: cfg.email.port === 465,
        auth: cfg.email.user ? { user: cfg.email.user, pass: cfg.email.pass } : undefined,
      });
      await transport.sendMail({ from: cfg.email.from, to: cfg.email.to, subject: alert.subject, text: alert.text, html: alert.html });
      sent.push('email');
    } catch (err) {
      errors.push(`email: ${err instanceof Error ? err.message : err}`);
    }
  }

  if (cfg.telegram) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${cfg.telegram.token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: cfg.telegram.chatId,
          text: `${alert.subject}\n\n${alert.text}`.slice(0, 4000),
          disable_web_page_preview: true,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
      sent.push('telegram');
    } catch (err) {
      errors.push(`telegram: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Email is the primary channel: if it was configured and failed, treat the send as failed.
  if (errors.length && (!sent.length || (cfg.email && !sent.includes('email')))) {
    throw new Error(`Notification failed (${errors.join('; ')})`);
  }
  for (const e of errors) console.warn(`Warning: ${e}`);
  return sent;
}
