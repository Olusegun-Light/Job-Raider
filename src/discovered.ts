import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { CompaniesConfig } from './config.js';
import type { Job } from './types.js';

export type AtsName = 'greenhouse' | 'lever' | 'ashby';

export type DiscoveredBoard = {
  ats: AtsName;
  slug: string;
  /** How many postings from this board Serper has surfaced in total. */
  count: number;
  lastSeen: string;
};

export type DiscoveredStore = Record<string, DiscoveredBoard>;

const boardSchema = z.object({
  ats: z.enum(['greenhouse', 'lever', 'ashby']),
  slug: z.string().min(1),
  count: z.number().int().nonnegative(),
  lastSeen: z.string(),
});

/** Hosts whose first path segment is the company's board slug. */
const ATS_HOSTS: Record<string, AtsName> = {
  'boards.greenhouse.io': 'greenhouse',
  'job-boards.greenhouse.io': 'greenhouse',
  'boards.eu.greenhouse.io': 'greenhouse',
  'jobs.lever.co': 'lever',
  'jobs.ashbyhq.com': 'ashby',
};

/** The ATS and board slug a URL belongs to, or null if it is not one we poll. */
export function atsFromUrl(raw: string): { ats: AtsName; slug: string } | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  const ats = ATS_HOSTS[url.hostname.toLowerCase()];
  if (!ats) return null;

  const slug = url.pathname.split('/').filter((s) => s.length > 0)[0];
  return slug ? { ats, slug } : null;
}

/**
 * Note every ATS board Serper surfaced, so `npm run discover` can suggest
 * polling it directly. Only Serper results are recorded: the ATS sources
 * already poll the boards in companies.yaml.
 */
export function recordDiscovered(store: DiscoveredStore, jobs: Job[], now: Date): DiscoveredStore {
  const updated: DiscoveredStore = { ...store };

  for (const job of jobs) {
    if (job.source !== 'serper') continue;
    const found = atsFromUrl(job.url);
    if (!found) continue;

    const key = `${found.ats}:${found.slug}`;
    const existing = updated[key];
    updated[key] = {
      ats: found.ats,
      slug: found.slug,
      count: (existing?.count ?? 0) + 1,
      lastSeen: now.toISOString(),
    };
  }

  return updated;
}

/** Boards seen by Serper that companies.yaml does not already poll. */
export function suggestSlugs(
  store: DiscoveredStore,
  companies: CompaniesConfig,
): DiscoveredBoard[] {
  const configured = new Set<string>();
  for (const ats of ['greenhouse', 'lever', 'ashby'] as const) {
    for (const slug of companies[ats]) configured.add(`${ats}:${slug.toLowerCase()}`);
  }

  return Object.values(store)
    .filter((board) => !configured.has(`${board.ats}:${board.slug.toLowerCase()}`))
    .sort((a, b) => b.count - a.count || a.slug.localeCompare(b.slug));
}

export function loadDiscovered(path: string): DiscoveredStore {
  if (!existsSync(path)) return {};

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};

  const store: DiscoveredStore = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const parsed = boardSchema.safeParse(value);
    if (parsed.success) store[key] = parsed.data;
  }
  return store;
}

export function saveDiscovered(path: string, store: DiscoveredStore): void {
  mkdirSync(dirname(path), { recursive: true });
  const sorted: DiscoveredStore = {};
  for (const key of Object.keys(store).sort()) sorted[key] = store[key]!;
  writeFileSync(path, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');
}
