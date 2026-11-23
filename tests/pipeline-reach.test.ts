import { describe, expect, test } from 'vitest';
import { runPipeline } from '../src/pipeline.js';
import { createLogger } from '../src/util/log.js';
import { parseArgs } from '../src/cli.js';
import type { Source } from '../src/sources/index.js';
import type { AppConfig } from '../src/config.js';
import type { Deliverer, Job, RunStats, ScoredJob } from '../src/types.js';
import { makeJob } from './helpers.js';

const config: AppConfig = {
  queries: [],
  companies: { greenhouse: [], lever: [], ashby: [] },
  rules: {
    titleInclude: ['backend'],
    titleExclude: [],
    mustMatchAny: ['node', 'typescript'],
    locationTargets: {
      uk: ['uk', 'london'],
      lagos: ['lagos', 'nigeria'],
      remote: ['emea', 'africa', 'worldwide'],
      europe: ['germany', 'berlin'],
      gulf: ['dubai'],
      apac: ['singapore'],
      americas: ['canada'],
      exclude: ['united states', 'usa', 'india'],
    },
    maxAgeHours: 48,
    minScore: 0,
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
    domains: [],
  },
};

const now = new Date('2026-11-23T12:00:00.000Z');

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

function run(jobs: Job[], argv: string[] = ['--dry-run']) {
  const deliverer = recorder();
  const source: Source = {
    name: 'serper',
    async fetch() {
      return { jobs, errors: [] };
    },
  };
  return runPipeline({
    sources: [source],
    config,
    options: parseArgs(argv),
    env: { logLevel: 'error' },
    log: createLogger({ level: 'error', sink: () => {} }),
    deliverer,
    now,
  }).then((stats) => ({ stats, delivered: deliverer.sent[0]?.jobs ?? [] }));
}

/** Serper jobs skip the location gate, so the reach rule is what must catch them. */
const fromGoogle = (overrides: Partial<Job> = {}): Job =>
  makeJob({
    title: 'Backend Engineer (Node.js)',
    source: 'serper',
    description: null,
    snippet: 'Backend engineer, Node.js and TypeScript.',
    postedAt: new Date(now.getTime() - 3_600_000).toISOString(),
    ...overrides,
  });

describe('runPipeline reachability', () => {
  test('drops a remote role fenced into a region outside the targets', async () => {
    const { delivered } = await run([
      fromGoogle({ id: 'us', url: 'https://x/us', location: 'Remote - United States' }),
    ]);
    expect(delivered).toEqual([]);
  });

  test('keeps that role under --keep-unreachable', async () => {
    const { delivered } = await run(
      [fromGoogle({ id: 'us', url: 'https://x/us', location: 'Remote - United States' })],
      ['--dry-run', '--keep-unreachable'],
    );
    expect(delivered).toHaveLength(1);
  });

  test('keeps it under the older --keep-no-sponsor spelling too', async () => {
    const { delivered } = await run(
      [fromGoogle({ id: 'us', url: 'https://x/us', location: 'Remote - United States' })],
      ['--dry-run', '--keep-no-sponsor'],
    );
    expect(delivered).toHaveLength(1);
  });

  test('drops a European role that states it cannot sponsor', async () => {
    const { delivered } = await run([
      fromGoogle({
        id: 'de',
        url: 'https://x/de',
        location: 'Berlin, Germany',
        snippet: 'Node.js role. We cannot offer visa sponsorship.',
      }),
    ]);
    expect(delivered).toEqual([]);
  });

  test('keeps a European role that simply does not mention visas', async () => {
    const { delivered } = await run([
      fromGoogle({ id: 'de2', url: 'https://x/de2', location: 'Berlin, Germany' }),
    ]);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]!.bucket).toBe('europe');
  });

  test('a no-sponsorship note does not drop an open-remote role, which needs no visa', async () => {
    const { delivered } = await run([
      fromGoogle({
        id: 'emea',
        url: 'https://x/emea',
        location: 'Remote - EMEA',
        snippet: 'Node.js role. We are unable to sponsor visas.',
      }),
    ]);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]!.bucket).toBe('remote');
  });
});
