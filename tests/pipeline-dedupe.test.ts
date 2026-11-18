import { describe, expect, test } from 'vitest';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPipeline } from '../src/pipeline.js';
import { loadSeen, saveSeen, type SeenStore } from '../src/dedupe.js';
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
    mustMatchAny: ['node', 'node.js', 'typescript'],
    locationTargets: { uk: ['uk', 'london'], remote: ['remote', 'emea'], lagos: ['lagos'] },
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

const now = new Date('2026-11-18T12:00:00.000Z');

function source(jobs: Job[], name: Source['name'] = 'greenhouse'): Source {
  return {
    name,
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

function seenPath(initial?: SeenStore): string {
  const path = join(mkdtempSync(join(tmpdir(), 'job-radar-pipe-')), 'seen.json');
  if (initial) saveSeen(path, initial);
  return path;
}

async function run(opts: { sources: Source[]; argv?: string[]; seenPath: string }) {
  const deliverer = recorder();
  const stats = await runPipeline({
    sources: opts.sources,
    config,
    options: parseArgs(opts.argv ?? []),
    env: { logLevel: 'error' },
    log: createLogger({ level: 'error', sink: () => {} }),
    deliverer,
    now,
    seenPath: opts.seenPath,
  });
  return { stats, delivered: deliverer.sent[0]?.jobs ?? [] };
}

const job = (overrides: Partial<Job> = {}): Job =>
  makeJob({
    title: 'Backend Engineer',
    description: 'Node.js',
    location: 'London, UK',
    ...overrides,
  });

describe('runPipeline dedupe and seen.json', () => {
  test('delivers a job the first time and not the second', async () => {
    const path = seenPath();
    const sources = [source([job({ id: 'j1', url: 'https://x/1' })])];

    const first = await run({ sources, seenPath: path });
    const second = await run({ sources, seenPath: path });

    expect(first.delivered).toHaveLength(1);
    expect(second.delivered).toHaveLength(0);
  });

  test('writes the delivered jobs into seen.json', async () => {
    const path = seenPath();

    await run({ sources: [source([job({ id: 'j1', url: 'https://x/1' })])], seenPath: path });

    const store = loadSeen(path);
    expect(Object.keys(store)).toHaveLength(1);
    expect(Object.values(store)[0]).toMatchObject({ title: 'Backend Engineer', company: 'Monzo' });
  });

  test('never writes seen.json on a dry run', async () => {
    const path = seenPath();

    await run({
      sources: [source([job({ id: 'j1', url: 'https://x/1' })])],
      argv: ['--dry-run'],
      seenPath: path,
    });

    expect(existsSync(path)).toBe(false);
  });

  test('a dry run still skips jobs recorded by an earlier real run', async () => {
    const path = seenPath({
      known: { firstSeen: now.toISOString(), title: 'Backend Engineer', company: 'Monzo' },
    });

    const { delivered } = await run({
      sources: [source([job({ id: 'known', url: 'https://x/1' })])],
      argv: ['--dry-run'],
      seenPath: path,
    });

    expect(delivered).toHaveLength(0);
  });

  test('collapses the same job found by serper and by its ATS board', async () => {
    const path = seenPath();
    const url = 'https://job-boards.greenhouse.io/monzo/jobs/9';
    const { delivered } = await run({
      seenPath: path,
      sources: [
        source(
          [
            job({
              id: 's1',
              url: `${url}?gh_src=x`,
              source: 'serper',
              description: null,
              snippet: 'Node.js',
              company: 'monzo',
            }),
          ],
          'serper',
        ),
        source([job({ id: 'g1', url, source: 'greenhouse', company: 'monzo' })], 'greenhouse'),
      ],
    });

    expect(delivered).toHaveLength(1);
    expect(delivered[0]!.source).toBe('greenhouse');
  });

  test('prunes entries older than the retention window when it writes', async () => {
    const old = new Date(now.getTime() - 61 * 86_400_000).toISOString();
    const path = seenPath({ ancient: { firstSeen: old, title: 'Old', company: 'C' } });

    await run({ sources: [source([job({ id: 'j1', url: 'https://x/1' })])], seenPath: path });

    expect(Object.keys(loadSeen(path))).toEqual(['j1']);
  });

  test('reports how many jobs were new in the stats', async () => {
    const path = seenPath({
      known: { firstSeen: now.toISOString(), title: 'Backend Engineer', company: 'Monzo' },
    });

    const { stats } = await run({
      seenPath: path,
      sources: [
        source([
          job({ id: 'known', url: 'https://x/1' }),
          job({ id: 'fresh', url: 'https://x/2', title: 'Backend Engineer, Payments' }),
        ]),
      ],
    });

    expect(stats.scanned).toBe(2);
    expect(stats.delivered).toBe(1);
    expect(stats.perSource[0]!.new).toBe(1);
    expect(stats.perSource[0]!.passedFilter).toBe(2);
  });

  test('does not record jobs when delivery throws, so they are retried tomorrow', async () => {
    // The core data-integrity invariant: a failed digest must cost duplicates,
    // never a job that is recorded as sent but never arrived.
    const path = seenPath();
    const failing: Deliverer = {
      name: 'failing',
      async deliver() {
        throw new Error('telegram 400');
      },
      async deliverError() {},
    };

    await expect(
      runPipeline({
        sources: [source([job({ id: 'j1', url: 'https://x/1' })])],
        config,
        options: parseArgs([]),
        env: { logLevel: 'error' },
        log: createLogger({ level: 'error', sink: () => {} }),
        deliverer: failing,
        now,
        seenPath: path,
      }),
    ).rejects.toThrow(/telegram 400/);

    expect(loadSeen(path)).toEqual({});
  });

  test('leaves seen.json valid json that a later run can read', async () => {
    const path = seenPath();
    await run({ sources: [source([job({ id: 'j1', url: 'https://x/1' })])], seenPath: path });
    expect(() => JSON.parse(readFileSync(path, 'utf8'))).not.toThrow();
  });
});
