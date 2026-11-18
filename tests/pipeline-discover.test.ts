import { describe, expect, test } from 'vitest';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPipeline } from '../src/pipeline.js';
import { loadDiscovered } from '../src/discovered.js';
import { createLogger } from '../src/util/log.js';
import { parseArgs } from '../src/cli.js';
import type { Source } from '../src/sources/index.js';
import type { AppConfig } from '../src/config.js';
import type { Deliverer, Job } from '../src/types.js';
import { makeJob } from './helpers.js';

const config: AppConfig = {
  queries: [],
  companies: { greenhouse: [], lever: [], ashby: [] },
  rules: {
    titleInclude: ['backend'],
    titleExclude: [],
    mustMatchAny: ['node'],
    locationTargets: { uk: ['uk', 'london'], remote: ['remote'], lagos: ['lagos'] },
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
const noop: Deliverer = { name: 'noop', async deliver() {}, async deliverError() {} };

function tempDir(): { seenPath: string; discoveredPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'job-radar-disc-pipe-'));
  return { seenPath: join(dir, 'seen.json'), discoveredPath: join(dir, 'discovered.json') };
}

function serper(jobs: Job[]): Source {
  return {
    name: 'serper',
    async fetch() {
      return { jobs, errors: [] };
    },
  };
}

const serperJob = (url: string): Job =>
  makeJob({
    id: url,
    url,
    source: 'serper',
    description: null,
    snippet: 'Node.js',
    location: 'London, UK',
  });

function run(paths: ReturnType<typeof tempDir>, sources: Source[], argv: string[] = []) {
  return runPipeline({
    sources,
    config,
    options: parseArgs(argv),
    env: { logLevel: 'error' },
    log: createLogger({ level: 'error', sink: () => {} }),
    deliverer: noop,
    now,
    ...paths,
  });
}

describe('runPipeline discovery recording', () => {
  test('records the ATS boards serper surfaced', async () => {
    const paths = tempDir();

    await run(paths, [serper([serperJob('https://jobs.lever.co/newco/abc')])]);

    expect(loadDiscovered(paths.discoveredPath)['lever:newco']).toMatchObject({
      ats: 'lever',
      slug: 'newco',
      count: 1,
    });
  });

  test('records a board even when the job itself was filtered out', async () => {
    const paths = tempDir();
    const rejected = makeJob({
      id: 'r',
      url: 'https://jobs.lever.co/newco/rejected',
      source: 'serper',
      title: 'Chief Marketing Officer',
      description: null,
      snippet: 'marketing',
    });

    await run(paths, [serper([rejected])]);

    // The board is still worth polling even if this one posting is not a match.
    expect(loadDiscovered(paths.discoveredPath)['lever:newco']?.count).toBe(1);
  });

  test('does not write the discovery store on a dry run', async () => {
    const paths = tempDir();

    await run(paths, [serper([serperJob('https://jobs.lever.co/newco/abc')])], ['--dry-run']);

    expect(existsSync(paths.discoveredPath)).toBe(false);
  });

  test('accumulates counts across runs', async () => {
    const paths = tempDir();
    const job = serperJob('https://jobs.lever.co/newco/abc');

    await run(paths, [serper([job])]);
    await run(paths, [serper([job])]);

    expect(loadDiscovered(paths.discoveredPath)['lever:newco']?.count).toBe(2);
  });
});
