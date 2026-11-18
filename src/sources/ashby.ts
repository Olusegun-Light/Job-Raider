import { z } from 'zod';
import type { Job } from '../types.js';
import type { Source, SourceContext, SourceResult } from './index.js';
import { jobId, normalizeUrl } from '../dedupe.js';
import { htmlToText } from '../util/text.js';
import { fetchBoards } from './greenhouse.js';

const boardSchema = z.object({
  jobs: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      location: z.string().nullish(),
      secondaryLocations: z.array(z.object({ location: z.string().nullish() })).nullish(),
      publishedAt: z.string().nullish(),
      isListed: z.boolean().nullish(),
      isRemote: z.boolean().nullish(),
      workplaceType: z.string().nullish(),
      jobUrl: z.string(),
      descriptionPlain: z.string().nullish(),
      descriptionHtml: z.string().nullish(),
      department: z.string().nullish(),
      team: z.string().nullish(),
    }),
  ),
  apiVersion: z.string().nullish(),
});

function toIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function parseAshbyBoard(slug: string, payload: unknown): Job[] {
  const parsed = boardSchema.safeParse(payload);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(
      `ashby board "${slug}": unexpected response shape: ${first?.message ?? 'invalid'}${
        first && first.path.length > 0 ? ` at \`${first.path.join('.')}\`` : ''
      }`,
    );
  }

  return parsed.data.jobs
    .filter((raw) => raw.isListed !== false)
    .map((raw): Job => {
      const url = normalizeUrl(raw.jobUrl);
      const secondary = (raw.secondaryLocations ?? [])
        .map((l) => l.location)
        .filter((l): l is string => Boolean(l));
      const location = raw.location ?? (secondary.length > 0 ? secondary.join(', ') : null);

      return {
        id: jobId(url),
        title: raw.title,
        company: slug,
        url,
        location,
        remote:
          raw.isRemote ?? (raw.workplaceType ? raw.workplaceType.toLowerCase() === 'remote' : null),
        postedAt: toIso(raw.publishedAt),
        source: 'ashby',
        description: raw.descriptionPlain ?? htmlToText(raw.descriptionHtml),
        snippet: null,
        sponsorship: 'unknown',
        ukSponsorLicensed: null,
        score: 0,
        matchedKeywords: [],
      };
    });
}

export function ashbySource(): Source {
  return {
    name: 'ashby',
    async fetch(ctx: SourceContext): Promise<SourceResult> {
      return fetchBoards({
        ctx,
        slugs: ctx.config.companies.ashby,
        url: (slug) => `https://api.ashbyhq.com/posting-api/job-board/${slug}`,
        parse: parseAshbyBoard,
        label: 'ashby',
      });
    },
  };
}
