import { describe, expect, test } from 'vitest';
import { runPipeline } from '../src/pipeline.js';
import { createLogger } from '../src/util/log.js';
import { parseArgs } from '../src/cli.js';
import { buildSponsorIndex } from '../src/sponsorship.js';
import type { Source } from '../src/sources/index.js';
import type { AppConfig } from '../src/config.js';
import type { Deliverer, Job, RunStats, ScoredJob } from '../src/types.js';
import { makeJob } from './helpers.js';

const config: AppConfig = {
  queries: [],
  companies: { greenhouse: [], lever: [], ashby: [] },
  rules: {
    titleInclude: ['backend', 'software engineer'],
    titleExclude: ['staff', 'intern'],
    mustMatchAny: ['node', 'node.js', 'typescript'],
    locationTargets: {
      uk: ['uk', 'london'],
      remote: ['remote', 'emea', 'africa', 'nigeria'],
      lagos: ['lagos', 'nigeria'],
    },
    maxAgeHours: 48,
    minScore: 4,
    weights: {
      titleBackend: 3,
      titleNodeTs: 3,
      descriptionNodeTs: 2,
      sponsorshipYes: 4,
      ukSponsorLicensed: 2,
      remoteOpen: 3,
      domainMatch: 1,
      domainMatchMax: 2,
      postedLast24h: 1,
    },
    domains: ['fintech', 'payments'],
  },
};

function source(jobs: Job[]): Source {
  return {
    name: 'greenhouse',
    async fetch() {
      return { jobs, errors: [] };
    },
  };
}

function recorder(): Deliverer & { sent: { jobs: ScoredJob[]; stats: RunStats }[] } {
  const sent: { jobs: ScoredJob[]; stats: RunStats }[] = [];
  return {
    name: 'recorder',
    sent,
    async deliver(jobs, stats) {
      sent.push({ jobs, stats });
    },
    async deliverError() {},
  };
}

const now = new Date('2026-11-18T12:00:00.000Z');

function run(
  jobs: Job[],
  argv: string[] = ['--dry-run'],
  extra: Partial<Parameters<typeof runPipeline>[0]> = {},
) {
  const deliverer = recorder();
  return runPipeline({
    sources: [source(jobs)],
    config,
    options: parseArgs(argv),
    env: { logLevel: 'error' },
    log: createLogger({ level: 'error', sink: () => {} }),
    deliverer,
    now,
    ...extra,
  }).then((stats) => ({ stats, delivered: deliverer.sent[0]?.jobs ?? [] }));
}

const strong = (overrides: Partial<Job> = {}): Job =>
  makeJob({
    title: 'Senior Backend Engineer (Node.js)',
    description: 'TypeScript payments platform. Visa sponsorship available.',
    location: 'London, UK',
    postedAt: new Date(now.getTime() - 3_600_000).toISOString(),
    ...overrides,
  });

describe('runPipeline filtering, sponsorship and scoring', () => {
  test('drops a job the title rules exclude', async () => {
    const { delivered } = await run([strong({ title: 'Staff Backend Engineer' })]);
    expect(delivered).toEqual([]);
  });

  test('drops a job whose score is below minScore', async () => {
    // Passes the filter (title + stack + location) but scores only 3+0.
    const weak = makeJob({
      title: 'Software Engineer',
      description: 'We use Node.',
      location: 'London',
      postedAt: null,
      id: 'weak',
      url: 'https://x/weak',
    });
    const { delivered } = await run([weak]);
    expect(delivered.map((j) => j.id)).not.toContain('weak');
  });

  test('keeps a job at or above minScore', async () => {
    const { delivered } = await run([strong()]);
    expect(delivered).toHaveLength(1);
  });

  test('honours a --min-score override', async () => {
    const { delivered } = await run([strong()], ['--dry-run', '--min-score=99']);
    expect(delivered).toEqual([]);
  });

  test('detects sponsorship from the description and scores it', async () => {
    const { delivered } = await run([strong()]);
    expect(delivered[0]!.sponsorship).toBe('yes');
    expect(delivered[0]!.score).toBeGreaterThanOrEqual(13);
  });

  test('records the matched stack keywords on the delivered job', async () => {
    const { delivered } = await run([strong()]);
    expect(delivered[0]!.matchedKeywords).toEqual(
      expect.arrayContaining(['node.js', 'typescript']),
    );
  });

  test('drops a UK job that says it cannot sponsor', async () => {
    const job = strong({
      description: 'TypeScript. We are unable to sponsor visas.',
      id: 'nosp',
      url: 'https://x/nosp',
    });
    const { delivered } = await run([job]);
    expect(delivered).toEqual([]);
  });

  test('keeps that job under --keep-no-sponsor', async () => {
    const job = strong({
      description: 'TypeScript. We are unable to sponsor visas.',
      id: 'nosp',
      url: 'https://x/nosp',
    });
    const { delivered } = await run([job], ['--dry-run', '--keep-no-sponsor', '--min-score=0']);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]!.sponsorship).toBe('no');
  });

  test('does not drop a non-UK job that says it cannot sponsor', async () => {
    const job = strong({
      location: 'Lagos, Nigeria',
      description: 'Node.js and TypeScript for payments. We cannot sponsor visas.',
      id: 'lagos',
      url: 'https://x/lagos',
    });
    const { delivered } = await run([job]);
    expect(delivered.map((j) => j.bucket)).toEqual(['lagos']);
  });

  test('marks a company found on the sponsor register', async () => {
    const { delivered } = await run([strong({ company: 'Monzo' })], ['--dry-run'], {
      sponsorIndex: buildSponsorIndex(['Monzo Bank Ltd']),
    });
    expect(delivered[0]!.ukSponsorLicensed).toBe(true);
  });

  test('leaves ukSponsorLicensed null when no register is loaded', async () => {
    const { delivered } = await run([strong({ company: 'Monzo' })]);
    expect(delivered[0]!.ukSponsorLicensed).toBeNull();
  });

  test('sorts the delivered jobs by descending score', async () => {
    const high = strong({ id: 'high', url: 'https://x/high' });
    const lower = strong({
      id: 'low',
      url: 'https://x/low',
      // A different role, so the fuzzy dedupe pass does not collapse the two.
      title: 'Backend Engineer, Platform (Node.js)',
      description: 'TypeScript platform.',
      postedAt: null,
    });
    const { delivered } = await run([lower, high]);
    expect(delivered.map((j) => j.id)).toEqual(['high', 'low']);
  });

  test('counts scanned, filtered and delivered separately in the stats', async () => {
    const { stats } = await run([
      strong(),
      strong({ title: 'Intern Backend Engineer', id: 'i', url: 'https://x/i' }),
    ]);
    expect(stats.scanned).toBe(2);
    expect(stats.delivered).toBe(1);
    expect(stats.perSource[0]!.fetched).toBe(2);
    expect(stats.perSource[0]!.passedFilter).toBe(1);
  });
});
