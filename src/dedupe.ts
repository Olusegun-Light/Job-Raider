import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { ScoredJob } from './types.js';

/** Query params that identify the referrer, not the job. */
const TRACKING_PARAMS =
  /^(utm_|gh_|ref$|source$|src$|lever-|mc_|_hs|fbclid$|gclid$|trk$|trackingId$)/i;

/** Greenhouse served boards from two hosts during its migration; same job. */
const HOST_ALIASES: Record<string, string> = {
  'boards.greenhouse.io': 'job-boards.greenhouse.io',
};

/**
 * Canonical form of a job URL, so the same posting reached by different
 * referrers hashes to one id.
 */
export function normalizeUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }

  url.hash = '';
  url.hostname = HOST_ALIASES[url.hostname.toLowerCase()] ?? url.hostname.toLowerCase();
  url.protocol = url.protocol.toLowerCase();

  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();

  let out = url.toString();
  if (out.endsWith('?')) out = out.slice(0, -1);
  if (out.endsWith('/') && new URL(out).pathname !== '/') out = out.slice(0, -1);
  return out;
}

/** Stable short id for a job: the hash of its normalized URL. */
export function jobId(url: string): string {
  return createHash('sha256').update(normalizeUrl(url)).digest('hex').slice(0, 16);
}

export type SeenEntry = {
  firstSeen: string;
  title: string;
  company: string;
};

export type SeenStore = Record<string, SeenEntry>;

const seenEntrySchema = z.object({
  firstSeen: z.string(),
  title: z.string(),
  company: z.string(),
});

/**
 * Read data/seen.json.
 *
 * A corrupt or missing store returns empty rather than throwing: losing
 * dedupe history re-sends some jobs once, while crashing means no digest at
 * all. Individual malformed entries are dropped and the rest kept.
 */
export function loadSeen(path: string): SeenStore {
  if (!existsSync(path)) return {};

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};

  const store: SeenStore = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const parsed = seenEntrySchema.safeParse(value);
    if (parsed.success) store[id] = parsed.data;
  }
  return store;
}

/** Write the store as sorted, indented JSON, since CI commits this file. */
export function saveSeen(path: string, store: SeenStore): void {
  mkdirSync(dirname(path), { recursive: true });
  const sorted: SeenStore = {};
  for (const id of Object.keys(store).sort()) sorted[id] = store[id]!;
  writeFileSync(path, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');
}

/** Forget entries older than `retentionDays`, to keep the file from growing forever. */
export function pruneSeen(store: SeenStore, now: Date, retentionDays: number): SeenStore {
  const cutoff = now.getTime() - retentionDays * 86_400_000;
  const kept: SeenStore = {};

  for (const [id, entry] of Object.entries(store)) {
    const firstSeen = new Date(entry.firstSeen).getTime();
    // An unparseable timestamp cannot be aged out later, so drop it now.
    if (Number.isNaN(firstSeen) || firstSeen < cutoff) continue;
    kept[id] = entry;
  }
  return kept;
}

/** Key for the second, fuzzy dedupe pass: same company, same role. */
function fuzzyKey(company: string, title: string): string {
  const flatten = (s: string): string =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  return `${flatten(company)}::${flatten(title)}`;
}

/** ATS records carry location, dates and a full description; Serper has a snippet. */
const SOURCE_RANK: Record<ScoredJob['source'], number> = {
  greenhouse: 3,
  lever: 3,
  ashby: 3,
  serper: 1,
};

/**
 * Remove jobs already reported, and collapse jobs found twice in one run.
 *
 * Two passes: the id (hash of the normalized URL) catches the same posting at
 * the same URL, and `company + title` catches the same posting found via both
 * Serper and its ATS board, where the URLs differ. The ATS copy wins, since
 * it has the real location, posting date and description.
 */
export function dropSeen<T extends ScoredJob>(jobs: T[], seen: SeenStore): T[] {
  const seenFuzzy = new Set(
    Object.values(seen).map((entry) => fuzzyKey(entry.company, entry.title)),
  );

  const byFuzzy = new Map<string, T>();
  for (const job of jobs) {
    if (seen[job.id]) continue;

    const key = fuzzyKey(job.company, job.title);
    if (seenFuzzy.has(key)) continue;

    const existing = byFuzzy.get(key);
    if (!existing) {
      byFuzzy.set(key, job);
      continue;
    }

    // Keep the richer record; break a tie on score.
    const better =
      SOURCE_RANK[job.source] > SOURCE_RANK[existing.source] ||
      (SOURCE_RANK[job.source] === SOURCE_RANK[existing.source] && job.score > existing.score);
    if (better) byFuzzy.set(key, job);
  }

  // Preserve the incoming order of whichever record was kept.
  const kept = new Set(byFuzzy.values());
  return jobs.filter((job) => kept.has(job));
}

/** Record the delivered jobs so later runs do not report them again. */
export function recordSeen(store: SeenStore, jobs: ScoredJob[], now: Date): SeenStore {
  const updated: SeenStore = { ...store };
  for (const job of jobs) {
    updated[job.id] ??= {
      firstSeen: now.toISOString(),
      title: job.title,
      company: job.company,
    };
  }
  return updated;
}
