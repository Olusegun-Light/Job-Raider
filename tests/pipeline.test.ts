import { describe, expect, test } from 'vitest';
import { runPipeline } from '../src/pipeline.js';
import { createLogger } from '../src/util/log.js';
import { parseArgs } from '../src/cli.js';
import type { Source } from '../src/sources/index.js';
import type { Deliverer, Job, RunStats, ScoredJob, SourceName } from '../src/types.js';
import type { AppConfig } from '../src/config.js';
import { makeJob } from './helpers.js';

const config: AppConfig = {
  queries: [{ name: 'q', q: 'backend', gl: 'uk', num: 20 }],
  companies: { greenhouse: [], lever: [], ashby: [] },
  rules: {
    titleInclude: ['backend'],
    titleExclude: [],
    mustMatchAny: ['node'],
    locationTargets: { uk: ['london'], remote: ['remote'], lagos: ['lagos'] },
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

function stubSource(name: SourceName, jobs: Job[], extra: { credits?: number } = {}): Source {
  return {
    name,
    async fetch() {
      return { jobs, errors: [], ...extra };
    },
  };
}

function failingSource(name: SourceName, message: string): Source {
  return {
    name,
    async fetch() {
      throw new Error(message);
    },
  };
}

function recordingDeliverer(): Deliverer & { sent: { jobs: ScoredJob[]; stats: RunStats }[] } {
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

function run(sources: Source[], deliverer: Deliverer, argv: string[] = ['--dry-run']) {
  return runPipeline({
    sources,
    config,
    options: parseArgs(argv),
    env: { logLevel: 'error' },
    log: createLogger({ level: 'error', sink: () => {} }),
    deliverer,
    now: new Date('2026-11-18T06:00:00.000Z'),
  });
}

describe('runPipeline', () => {
  test('delivers the jobs collected from every enabled source', async () => {
    const deliverer = recordingDeliverer();

    await run(
      [
        stubSource('greenhouse', [makeJob({ id: 'gh-1', url: 'https://x/1' })]),
        stubSource('lever', [
          makeJob({
            id: 'lv-1',
            url: 'https://x/2',
            source: 'lever',
            title: 'Backend Engineer, Payments',
          }),
        ]),
      ],
      deliverer,
    );

    expect(deliverer.sent).toHaveLength(1);
    expect(deliverer.sent[0]!.jobs.map((j) => j.id).sort()).toEqual(['gh-1', 'lv-1']);
  });

  test('assigns a location bucket to every delivered job', async () => {
    const deliverer = recordingDeliverer();

    await run([stubSource('greenhouse', [makeJob({ location: 'London, UK' })])], deliverer);

    expect(deliverer.sent[0]!.jobs[0]!.bucket).toBe('uk');
  });

  test('keeps going and records the error when one source throws', async () => {
    const deliverer = recordingDeliverer();

    const stats = await run(
      [
        failingSource('greenhouse', 'board 404'),
        stubSource('lever', [makeJob({ id: 'lv-1', source: 'lever' })]),
      ],
      deliverer,
    );

    expect(deliverer.sent[0]!.jobs.map((j) => j.id)).toEqual(['lv-1']);
    const gh = stats.perSource.find((s) => s.source === 'greenhouse')!;
    expect(gh.errors).toEqual(['board 404']);
    expect(gh.fetched).toBe(0);
  });

  test('reports per-source fetched counts and the total scanned', async () => {
    const stats = await run(
      [
        stubSource('greenhouse', [makeJob({ id: 'a' }), makeJob({ id: 'b', url: 'https://x/b' })]),
        stubSource('lever', [makeJob({ id: 'c', url: 'https://x/c', source: 'lever' })]),
      ],
      recordingDeliverer(),
    );

    expect(stats.scanned).toBe(3);
    expect(stats.perSource.find((s) => s.source === 'greenhouse')!.fetched).toBe(2);
    expect(stats.perSource.find((s) => s.source === 'lever')!.fetched).toBe(1);
  });

  test('sums the serper credits reported by sources', async () => {
    const stats = await run(
      [stubSource('serper', [makeJob({ source: 'serper' })], { credits: 7 })],
      recordingDeliverer(),
    );

    expect(stats.serperCredits).toBe(7);
  });

  test('runs only the sources named by --source', async () => {
    const deliverer = recordingDeliverer();

    await run(
      [
        stubSource('greenhouse', [makeJob({ id: 'gh' })]),
        stubSource('lever', [makeJob({ id: 'lv', source: 'lever' })]),
      ],
      deliverer,
      ['--dry-run', '--source=lever'],
    );

    expect(deliverer.sent[0]!.jobs.map((j) => j.id)).toEqual(['lv']);
  });
});
