import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { ScoredJob } from './types.js';

/**
 * Query params that identify the referrer, not the job.
 *
 * Listed exactly, never by prefix: `gh_src` is tracking, but `gh_jid` is
 * Greenhouse's job id on an embedded careers page, and stripping that would
 * collapse every job on the page to a single id.
 */
const TRACKING_PARAMS =
  /^(utm_[a-z_]*|gh_src|ref|source|src|mc_[a-z_]*|_hs[a-z_]*|fbclid|gclid|trk|trackingid|lever-origin|lever-source)$/i;

/**
 * Hosts that serve the same board. Greenhouse ran two hosts through its
 * migration and a third in the EU; all reach the same posting.
 */
const HOST_ALIASES: Record<string, string> = {
  'boards.greenhouse.io': 'job-boards.greenhouse.io',
  'boards.eu.greenhouse.io': 'job-boards.greenhouse.io',
  'job-boards.eu.greenhouse.io': 'job-boards.greenhouse.io',
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
  // One job must not get two ids over a scheme or a "www." prefix.
  if (url.protocol === 'http:') url.protocol = 'https:';
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  url.hostname = HOST_ALIASES[host] ?? host;

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
export function loadSeen(path: string, onWarn: (message: string) => void = () => {}): SeenStore {
  if (!existsSync(path)) return {};

  /**
   * A corrupt store is reported and set aside, never silently overwritten:
   * the run would otherwise re-deliver everything and then destroy the only
   * copy of 60 days of history, with no clue as to why.
   */
  const salvage = (reason: string): SeenStore => {
    const backup = `${path}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    try {
      renameSync(path, backup);
      onWarn(`seen store at ${path} ${reason}; moved it to ${backup} and starting fresh`);
    } catch {
      onWarn(`seen store at ${path} ${reason} and could not be set aside; starting fresh`);
    }
    return {};
  };

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return salvage('is not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return salvage('is not a JSON object');
  }

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

/** Loose comparison form: case and punctuation insensitive. */
const flatten = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** ATS records carry location, dates and a full description; Serper has a snippet. */
const SOURCE_RANK: Record<ScoredJob['source'], number> = {
  greenhouse: 3,
  lever: 3,
  ashby: 3,
  serper: 1,
};

/**
 * The identifiers in a job URL that could name the posting: the path segments
 * that look like ids, plus any query value (Greenhouse's embedded boards pass
 * the job id as `gh_jid`).
 */
const IDENTIFIER = /^[0-9]+$|^[0-9a-f]{8}-[0-9a-f-]{8,}$/i;

function urlIdentifiers(rawUrl: string): string[] {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return [];
  }

  const fromPath = url.pathname.split('/').filter((segment) => IDENTIFIER.test(segment));
  const fromQuery = [...url.searchParams.values()].filter((value) => IDENTIFIER.test(value));
  return [...fromPath, ...fromQuery].map((id) => id.toLowerCase());
}

/**
 * Whether two records are provably the same posting reached two ways.
 *
 * Requires the same company and title AND a shared posting identifier. Title
 * alone is not enough: boards routinely carry several reqs called "Backend
 * Engineer" (a second headcount, another team, another location), and
 * collapsing those loses a real job. A duplicate in the digest is a nuisance;
 * a job that is never reported is invisible.
 */
function isSamePosting(a: ScoredJob, b: ScoredJob): boolean {
  if (flatten(a.company) !== flatten(b.company)) return false;
  if (flatten(a.title) !== flatten(b.title)) return false;

  const aIds = urlIdentifiers(a.url);
  const bIds = urlIdentifiers(b.url);
  if (aIds.length === 0 || bIds.length === 0) return false;
  return aIds.some((id) => bIds.includes(id));
}

/**
 * Remove jobs already reported, and collapse records of one posting found
 * twice in a single run.
 *
 * Suppression against previous runs is by job id only. Matching the store on
 * company + title would mean a repost or a second headcount at a target
 * company is never reported again for the whole retention window.
 */
export function dropSeen<T extends ScoredJob>(jobs: T[], seen: SeenStore): T[] {
  const kept: T[] = [];

  for (const job of jobs) {
    if (seen[job.id]) continue;

    // Same normalized URL reached twice in one run.
    const byId = kept.findIndex((other) => other.id === job.id);
    if (byId !== -1) {
      kept[byId] = mergeDuplicate(kept[byId]!, job);
      continue;
    }

    const twin = kept.findIndex((other) => isSamePosting(other, job));
    if (twin !== -1) {
      kept[twin] = mergeDuplicate(kept[twin]!, job);
      continue;
    }

    kept.push(job);
  }

  return kept;
}

/**
 * Keep the richer of two records of one posting, remembering the other's id
 * so later runs suppress the posting however it is found next time.
 */
function mergeDuplicate<T extends ScoredJob>(existing: T, incoming: T): T {
  const preferIncoming =
    SOURCE_RANK[incoming.source] > SOURCE_RANK[existing.source] ||
    (SOURCE_RANK[incoming.source] === SOURCE_RANK[existing.source] &&
      incoming.score > existing.score);

  const winner = preferIncoming ? incoming : existing;
  const loser = preferIncoming ? existing : incoming;

  const duplicateIds = [
    ...new Set([...(winner.duplicateIds ?? []), ...(loser.duplicateIds ?? []), loser.id]),
  ].filter((id) => id !== winner.id);

  return { ...winner, duplicateIds };
}

/** Record the delivered jobs so later runs do not report them again. */
export function recordSeen(store: SeenStore, jobs: ScoredJob[], now: Date): SeenStore {
  const updated: SeenStore = { ...store };
  for (const job of jobs) {
    const entry = { firstSeen: now.toISOString(), title: job.title, company: job.company };
    updated[job.id] ??= entry;
    // Record the ids of records collapsed into this one, so the posting stays
    // suppressed whichever source finds it next time.
    for (const id of job.duplicateIds ?? []) updated[id] ??= entry;
  }
  return updated;
}
