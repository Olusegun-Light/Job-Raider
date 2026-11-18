import pLimit from 'p-limit';
import { z } from 'zod';
import type { TimeWindow } from '../cli.js';
import type { Job } from '../types.js';
import type { Source, SourceContext, SourceResult } from './index.js';
import { jobId, normalizeUrl } from '../dedupe.js';
import { fetchJson } from '../util/http.js';

export const SERPER_ENDPOINT = 'https://google.serper.dev/search';

/**
 * Serper proxies Google, so results are shaped by Google and fields come and
 * go per result. Everything but `link` is therefore optional, and unknown
 * keys pass through rather than failing the run.
 */
const serperResponseSchema = z
  .object({
    organic: z
      .array(
        z
          .object({
            title: z.string().nullish(),
            link: z.string().nullish(),
            snippet: z.string().nullish(),
            date: z.string().nullish(),
            position: z.number().nullish(),
          })
          .passthrough(),
      )
      .nullish(),
    credits: z.number().nullish(),
    searchParameters: z.record(z.unknown()).nullish(),
  })
  .passthrough();

export type SerperResponse = z.infer<typeof serperResponseSchema>;

/**
 * Google's time-range operator.
 *
 * A daily run asks for two days, not one: GitHub's scheduler fires minutes to
 * an hour late, so an exactly-24h window leaves a gap between consecutive
 * runs that nothing else covers (Serper results carry no posting date, so
 * there is no age fallback). Dedupe absorbs the overlap; a gap cannot be
 * recovered.
 */
export function tbsForWindow(window: TimeWindow): string {
  return window === 'week' ? 'qdr:w' : 'qdr:d2';
}

/** `{slug}` position in the path for each ATS host we recognise. */
const ATS_SLUG_INDEX: Record<string, number> = {
  'boards.greenhouse.io': 0,
  'job-boards.greenhouse.io': 0,
  'jobs.lever.co': 0,
  'jobs.ashbyhq.com': 0,
  'apply.workable.com': 0,
  'jobs.workable.com': 0,
  'boards.eu.greenhouse.io': 0,
};

/** The company a job URL belongs to; the hostname when the site is unknown. */
export function companyFromUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }

  const host = url.hostname.toLowerCase();
  const index = ATS_SLUG_INDEX[host];
  if (index !== undefined) {
    const segments = url.pathname.split('/').filter((s) => s.length > 0);
    const slug = segments[index];
    if (slug) return slug;
  }
  return host;
}

const SEPARATORS = ['-', '–', '—', '|', '@', 'at', ','];

/** Loose comparison key, so "acme-ltd" matches "Acme Ltd". */
const key = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Google titles usually end in the company ("Backend Engineer - Monzo").
 * Only strip that tail when it actually matches the company from the URL, so
 * a real title like "Backend Engineer - Payments" is left alone.
 */
export function stripCompanySuffix(title: string, company: string): string {
  const target = key(company);
  if (!target) return title;

  for (const sep of SEPARATORS) {
    const at = title.toLowerCase().lastIndexOf(` ${sep} `);
    if (at === -1) continue;
    const head = title.slice(0, at);
    const tail = title.slice(at + sep.length + 2);
    if (key(tail) === target) return head.trim();
  }
  return title.trim();
}

export function parseSerperResponse(payload: unknown, queryName: string): Job[] {
  const parsed = serperResponseSchema.safeParse(payload);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(
      `serper query "${queryName}": unexpected response shape: ${first?.message ?? 'invalid'}${
        first && first.path.length > 0 ? ` at \`${first.path.join('.')}\`` : ''
      }`,
    );
  }

  const jobs: Job[] = [];
  for (const result of parsed.data.organic ?? []) {
    // A result with no link is not a job we can apply to or dedupe.
    if (!result.link) continue;

    const url = normalizeUrl(result.link);
    const company = companyFromUrl(url);
    jobs.push({
      id: jobId(url),
      title: stripCompanySuffix(result.title ?? '(untitled)', company),
      company,
      url,
      location: null,
      remote: null,
      // Google's "2 days ago" is both relative and unreliable; the tbs window
      // already bounds recency, and the ATS sources carry real timestamps.
      postedAt: null,
      source: 'serper',
      description: null,
      snippet: result.snippet ?? null,
      sponsorship: 'unknown',
      ukSponsorLicensed: null,
      score: 0,
      matchedKeywords: [],
    });
  }
  return jobs;
}

export type SerperOptions = {
  /** Overridden in tests to point at a local server. */
  endpoint?: string;
};

export function serperSource(options: SerperOptions = {}): Source {
  const endpoint = options.endpoint ?? SERPER_ENDPOINT;
  return {
    name: 'serper',
    async fetch(ctx: SourceContext): Promise<SourceResult> {
      const apiKey = ctx.env.serperApiKey;
      if (!apiKey) {
        ctx.log.warn('serper skipped: SERPER_API_KEY is not set');
        return { jobs: [], errors: ['serper: SERPER_API_KEY is not set'] };
      }

      const limit = pLimit(3);
      const tbs = tbsForWindow(ctx.options.window);
      const errors: string[] = [];
      const jobs: Job[] = [];
      let credits = 0;

      const runQuery = async (
        query: { name: string; q: string; gl: string; num: number },
        page: number,
      ): Promise<Job[]> => {
        const body = {
          q: query.q,
          gl: query.gl,
          num: query.num,
          tbs,
          ...(page > 1 ? { page } : {}),
        };
        const response = await fetchJson(endpoint, serperResponseSchema, {
          method: 'POST',
          json: body,
          headers: { 'X-API-KEY': apiKey },
        });
        // Serper bills per successful query; the body reports it when it can.
        credits += response.credits ?? 1;
        return parseSerperResponse(response, query.name);
      };

      await Promise.all(
        ctx.config.queries.map((query) =>
          limit(async () => {
            try {
              // Keep page 1 before attempting page 2: a 429 on the second
              // request must not throw away results already paid for.
              const first = await runQuery(query, 1);
              jobs.push(...first);
              ctx.log.debug('serper query done', { query: query.name, results: first.length });

              // Only pay for page 2 when page 1 came back full.
              if (first.length >= query.num) {
                const second = await runQuery(query, 2);
                jobs.push(...second);
                ctx.log.debug('serper page 2 done', { query: query.name, results: second.length });
              }
            } catch (error) {
              const message = `serper/${query.name}: ${
                error instanceof Error ? error.message : String(error)
              }`;
              ctx.log.warn('serper query failed', { query: query.name, error: message });
              errors.push(message);
            }
          }),
        ),
      );

      ctx.log.info('serper credits used', { credits, queries: ctx.config.queries.length, tbs });
      return { jobs, errors, credits };
    },
  };
}
