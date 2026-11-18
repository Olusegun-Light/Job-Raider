import { z } from 'zod';
import type { Deliverer, RunStats, ScoredJob } from '../types.js';
import type { Logger } from '../util/log.js';
import { fetchJson } from '../util/http.js';
import { SECTIONS } from './console.js';

/** Telegram rejects any sendMessage text longer than this. */
export const TELEGRAM_LIMIT = 4096;

const SPONSOR_ICON = { yes: '🟢', no: '🔴', unknown: '⚪' } as const;

/**
 * Escape the characters Telegram's HTML parse mode reserves.
 *
 * `&` must go first, or the `&` of an escape produced by a later replacement
 * would itself be escaped.
 */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** "6h ago" / "2d ago", or null when the source never gave a date. */
export function formatRelativeAge(postedAt: string | null, now: Date): string | null {
  if (!postedAt) return null;
  const posted = new Date(postedAt).getTime();
  if (Number.isNaN(posted)) return null;

  const hours = Math.floor((now.getTime() - posted) / 3_600_000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Caps on the variable-length fields, so one absurd title cannot produce a
 * block that exceeds Telegram's limit. The splitter would then have to cut
 * mid-tag, Telegram would answer 400 "Unclosed start tag", and the entire
 * digest would be lost rather than one job being ugly.
 */
const MAX_TITLE = 300;
const MAX_COMPANY = 120;
const MAX_LOCATION = 160;

/** Trim to a character budget on a word boundary where possible. */
function clamp(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut}\u2026`;
}

/** The three-line block from plan §8. */
export function formatJobBlock(job: ScoredJob, now: Date): string {
  const badge = job.ukSponsorLicensed ? ' 🏛️' : '';
  const age = formatRelativeAge(job.postedAt, now);
  const meta = [
    `📍 ${escapeHtml(clamp(job.location ?? 'location not stated', MAX_LOCATION))}`,
    `🛂 Sponsorship: ${job.sponsorship}${badge}`,
    `⭐ ${job.score}`,
  ];
  // encodeURI leaves & and # alone, so the href still needs HTML escaping.
  const footer = [`<a href="${escapeHtml(encodeURI(job.url))}">Apply</a>`, job.source, age].filter(
    (part): part is string => Boolean(part),
  );

  return [
    `${SPONSOR_ICON[job.sponsorship]} <b>${escapeHtml(clamp(job.title, MAX_TITLE))}</b> — ${escapeHtml(clamp(job.company, MAX_COMPANY))}`,
    meta.join(' · '),
    footer.join(' · '),
  ].join('\n');
}

export function formatHeader(stats: RunStats, now: Date): string {
  const day = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const credits = stats.serperCredits !== null ? ` · ${stats.serperCredits} credits` : '';
  return `<b>Job Radar</b> — ${day} · ${stats.delivered} new (from ${stats.scanned} scanned)${credits}`;
}

/**
 * Render the digest as one or more messages, each within Telegram's limit.
 *
 * Splitting happens only at job boundaries so no message can end mid-tag,
 * which would make Telegram reject the whole message as malformed HTML.
 */
export function renderTelegramMessages(jobs: ScoredJob[], stats: RunStats, now: Date): string[] {
  const header = formatHeader(stats, now);

  if (jobs.length === 0) {
    return [`${header}\n\nNo new matches today.`];
  }

  // Each block is an indivisible unit: a section heading or one job.
  const blocks: string[] = [];
  for (const { bucket, label } of SECTIONS) {
    const inSection = jobs.filter((job) => job.bucket === bucket).sort((a, b) => b.score - a.score);
    if (inSection.length === 0) continue;
    blocks.push(`<b>${label}</b> (${inSection.length})`);
    for (const job of inSection) blocks.push(formatJobBlock(job, now));
  }

  const messages: string[] = [];
  let current = header;

  for (const block of blocks) {
    const candidate = current.length === 0 ? block : `${current}\n\n${block}`;
    if (candidate.length <= TELEGRAM_LIMIT) {
      current = candidate;
      continue;
    }
    if (current.length > 0) messages.push(current);
    // Field caps keep every block well under the limit, so this is only a
    // backstop. Drop the block rather than emit a mid-tag cut, which would
    // make Telegram reject the message and lose the whole digest.
    if (block.length <= TELEGRAM_LIMIT) {
      current = block;
    } else {
      current = '';
    }
  }
  if (current.length > 0) messages.push(current);

  return messages;
}

const sendMessageResponse = z.object({ ok: z.boolean(), description: z.string().nullish() });

export type TelegramOptions = {
  botToken: string;
  chatId: string;
  log: Logger;
  /** Overridden in tests to point at a local server. */
  apiBase?: string;
  now?: () => Date;
};

/**
 * Telegram deliverer.
 *
 * Messages go out in order, one request each, because Telegram applies the
 * 4096-character limit per message and ordering matters for a digest.
 */
export function createTelegramDeliverer(options: TelegramOptions): Deliverer {
  const base = options.apiBase ?? 'https://api.telegram.org';
  const url = `${base}/bot${options.botToken}/sendMessage`;
  const now = options.now ?? (() => new Date());

  const send = async (text: string): Promise<void> => {
    const response = await fetchJson(url, sendMessageResponse, {
      method: 'POST',
      json: {
        chat_id: options.chatId,
        text,
        parse_mode: 'HTML',
        // Job links would otherwise each generate a preview card.
        disable_web_page_preview: true,
      },
    });
    if (!response.ok) {
      throw new Error(`telegram rejected the message: ${response.description ?? 'unknown reason'}`);
    }
  };

  return {
    name: 'telegram',

    async deliver(jobs, stats) {
      const messages = renderTelegramMessages(jobs, stats, now());
      for (const [index, message] of messages.entries()) {
        await send(message);
        options.log.debug('telegram message sent', {
          part: `${index + 1}/${messages.length}`,
          chars: message.length,
        });
      }
      options.log.info('digest delivered', { messages: messages.length, jobs: jobs.length });
    },

    async deliverError(error, context) {
      const text = [
        '🛑 <b>Job Radar run failed</b>',
        `Stage: ${escapeHtml(context)}`,
        `Error: ${escapeHtml(error.message)}`,
      ].join('\n');
      await send(text.slice(0, TELEGRAM_LIMIT));
    },
  };
}
