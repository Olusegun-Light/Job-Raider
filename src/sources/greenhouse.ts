import pLimit from 'p-limit';
import { z } from 'zod';
import type { Job } from '../types.js';
import type { Source, SourceContext, SourceResult } from './index.js';
import { jobId, normalizeUrl } from '../dedupe.js';
import { containsAnyTerm, htmlToText } from '../util/text.js';
import { fetchJson } from '../util/http.js';
import { withinWindow } from './window.js';

const boardSchema = z.object({
  jobs: z.array(
    z.object({
      id: z.number(),
      title: z.string(),
      absolute_url: z.string(),
      company_name: z.string().nullish(),
      location: z.object({ name: z.string().nullish() }).nullish(),
      updated_at: z.string().nullish(),
      first_published: z.string().nullish(),
      content: z.string().nullish(),
      offices: z.array(z.object({ name: z.string().nullish() })).nullish(),
    }),
  ),
});

/** Greenhouse has no remote flag, so the location text is all there is to go on. */
const REMOTE_HINTS = ['remote', 'anywhere', 'distributed', 'work from home', 'wfh'];

function toIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function parseGreenhouseBoard(slug: string, payload: unknown): Job[] {
  const parsed = boardSchema.safeParse(payload);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(
      `greenhouse board "${slug}": unexpected response shape: ${first?.message ?? 'invalid'}${
        first && first.path.length > 0 ? ` at \`${first.path.join('.')}\`` : ''
      }`,
    );
  }

  return parsed.data.jobs.map((raw): Job => {
    const url = normalizeUrl(raw.absolute_url);
    const location = raw.location?.name ?? raw.offices?.[0]?.name ?? null;
    return {
      id: jobId(url),
      title: raw.title,
      company: raw.company_name ?? slug,
      url,
      location,
      remote: location === null ? null : containsAnyTerm(location, REMOTE_HINTS),
      // first_published is the real posting date; updated_at moves whenever a
      // recruiter edits the copy, which would resurface year-old jobs daily.
      postedAt: toIso(raw.first_published) ?? toIso(raw.updated_at),
      source: 'greenhouse',
      description: htmlToText(raw.content),
      snippet: null,
      sponsorship: 'unknown',
      ukSponsorLicensed: null,
      score: 0,
      matchedKeywords: [],
    };
  });
}

export function greenhouseSource(): Source {
  return {
    name: 'greenhouse',
    async fetch(ctx: SourceContext): Promise<SourceResult> {
      return fetchBoards({
        ctx,
        slugs: ctx.config.companies.greenhouse,
        url: (slug) => `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`,
        parse: parseGreenhouseBoard,
        label: 'greenhouse',
      });
    },
  };
}

/** Shared board-polling loop: one bad slug warns and the rest carry on. */
export async function fetchBoards(args: {
  ctx: SourceContext;
  slugs: string[];
  url: (slug: string) => string;
  parse: (slug: string, payload: unknown) => Job[];
  label: string;
  concurrency?: number;
}): Promise<SourceResult> {
  const { ctx, slugs, url, parse, label } = args;
  const limit = pLimit(args.concurrency ?? 4);
  const errors: string[] = [];
  const jobs: Job[] = [];

  await Promise.all(
    slugs.map((slug) =>
      limit(async () => {
        try {
          const payload = await fetchJson(url(slug), z.unknown());
          const parsedJobs = parse(slug, payload);
          const fresh = parsedJobs.filter((job) =>
            withinWindow(job.postedAt, ctx.now, ctx.config.rules.maxAgeHours, ctx.options.window),
          );
          ctx.log.debug('board polled', {
            source: label,
            slug,
            total: parsedJobs.length,
            inWindow: fresh.length,
          });
          jobs.push(...fresh);
        } catch (error) {
          const message = `${label}/${slug}: ${error instanceof Error ? error.message : String(error)}`;
          ctx.log.warn('board failed', { source: label, slug, error: message });
          errors.push(message);
        }
      }),
    ),
  );

  return { jobs, errors };
}
