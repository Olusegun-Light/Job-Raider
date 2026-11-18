import type { Job, RunStats, ScoredJob } from '../src/types.js';

export function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'id-1',
    title: 'Backend Engineer (Node.js)',
    company: 'Monzo',
    url: 'https://boards.greenhouse.io/monzo/jobs/1',
    location: 'London, UK',
    remote: false,
    postedAt: '2026-11-18T06:00:00.000Z',
    source: 'greenhouse',
    description: 'We use Node.js and TypeScript.',
    snippet: null,
    sponsorship: 'unknown',
    ukSponsorLicensed: null,
    score: 0,
    matchedKeywords: [],
    ...overrides,
  };
}

export function makeScoredJob(overrides: Partial<ScoredJob> = {}): ScoredJob {
  return { ...makeJob(overrides), bucket: 'uk', ...overrides };
}

export function makeStats(overrides: Partial<RunStats> = {}): RunStats {
  return {
    startedAt: '2026-11-18T06:00:00.000Z',
    durationMs: 1234,
    scanned: 212,
    delivered: 14,
    perSource: [],
    serperCredits: null,
    ...overrides,
  };
}
