import nodemailer from 'nodemailer';
import { alertableEvents } from './compare';
import { AVAILABILITY_LABEL, formatMoney } from './price';
import type { MonitorEvent, ScrapeResult, Target } from './types';

export interface Alert {
  subject: string;
  text: string;
  html: string;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Build the single combined message for this run, or null when there's nothing to send.
 * A message is sent only for price drops and for targets that have just failed three runs in a row.
 */
export function buildAlert(events: MonitorEvent[], targets: Target[], results: ScrapeResult[]): Alert | null {
  const { drops, failures, recovered } = alertableEvents(events);
  if (!drops.length && !failures.length) return null;
  const byId = (id: string) => targets.find((t) => t.id === id)!;
  const resultFor = (id: string) => results.find((r) => r.targetId === id);

  const parts: string[] = [];
  if (drops.length) parts.push(`${drops.length} price drop${drops.length > 1 ? 's' : ''}`);
  if (failures.length) parts.push(`${failures.length} broken target${failures.length > 1 ? 's' : ''}`);
  const subject = `Price monitor: ${parts.join(', ')}`;

  const text: string[] = [];
  const html: string[] = [];

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

  if (failures.length) {
    text.push('BROKEN TARGETS (failed 3 runs in a row; a selector may need updating)', '');
    html.push('<h2>Broken targets</h2><p>These have failed three runs in a row, so a selector may need updating.</p><ul>');
    for (const f of failures) {
      const t = byId(f.targetId);
      text.push(`${t.retailer}: ${t.name}`, `  ${f.error ?? f.status}`, `  ${t.url}`, '');
      html.push(`<li><strong>${esc(t.retailer)}</strong>: ${esc(t.name)}<br>${esc(f.error ?? f.status)}<br><a href="${esc(t.url)}">${esc(t.url)}</a></li>`);
    }
    html.push('</ul>');
  }

  if (recovered.length) {
    const names = recovered.map((r) => byId(r.targetId).retailer).join(', ');
    text.push(`Recovered since last alert: ${names}`);
    html.push(`<p>Recovered since last alert: ${esc(names)}</p>`);
  }

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
