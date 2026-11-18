import { createHash } from 'node:crypto';

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
