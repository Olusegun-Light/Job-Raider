import { z } from 'zod';
import type { Job } from '../types.js';
import type { Source, SourceContext, SourceResult } from './index.js';
import { jobId, normalizeUrl } from '../dedupe.js';
import { fetchBoards } from './greenhouse.js';

const postingSchema = z.object({
  id: z.string(),
  /** Lever's title field is `text`, not `title` (verified against the live API). */
  text: z.string(),
  hostedUrl: z.string(),
  applyUrl: z.string().nullish(),
  createdAt: z.number().nullish(),
  workplaceType: z.string().nullish(),
  country: z.string().nullish(),
  categories: z
    .object({
      location: z.string().nullish(),
      allLocations: z.array(z.string()).nullish(),
      team: z.string().nullish(),
      department: z.string().nullish(),
      commitment: z.string().nullish(),
    })
    .nullish(),
  descriptionPlain: z.string().nullish(),
  additionalPlain: z.string().nullish(),
});

const boardSchema = z.array(postingSchema);

export function parseLeverBoard(slug: string, payload: unknown): Job[] {
  const parsed = boardSchema.safeParse(payload);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(
      `lever board "${slug}": unexpected response shape: ${first?.message ?? 'invalid'}${
        first && first.path.length > 0 ? ` at \`${first.path.join('.')}\`` : ''
      }`,
    );
  }

  return parsed.data.map((raw): Job => {
    const url = normalizeUrl(raw.hostedUrl);
    const locations = raw.categories?.allLocations ?? [];
    const location =
      raw.categories?.location ?? (locations.length > 0 ? locations.join(', ') : null);
    const workplace = raw.workplaceType?.toLowerCase() ?? null;
    const description = [raw.descriptionPlain, raw.additionalPlain]
      .filter((part): part is string => Boolean(part))
      .join('\n\n');

    return {
      id: jobId(url),
      title: raw.text,
      // Lever's posting API returns no company name; the slug is the company.
      company: slug,
      url,
      location,
      remote: workplace === null ? null : workplace === 'remote',
      postedAt: raw.createdAt ? new Date(raw.createdAt).toISOString() : null,
      source: 'lever',
      description: description.length > 0 ? description : null,
      snippet: null,
      sponsorship: 'unknown',
      ukSponsorLicensed: null,
      score: 0,
      matchedKeywords: [],
    };
  });
}

export function leverSource(): Source {
  return {
    name: 'lever',
    async fetch(ctx: SourceContext): Promise<SourceResult> {
      return fetchBoards({
        ctx,
        slugs: ctx.config.companies.lever,
        url: (slug) => `https://api.lever.co/v0/postings/${slug}?mode=json`,
        parse: parseLeverBoard,
        label: 'lever',
      });
    },
  };
}
