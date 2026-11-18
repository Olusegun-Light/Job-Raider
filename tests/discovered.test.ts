import { describe, expect, test } from 'vitest';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  atsFromUrl,
  loadDiscovered,
  recordDiscovered,
  saveDiscovered,
  suggestSlugs,
  type DiscoveredStore,
} from '../src/discovered.js';
import { makeJob } from './helpers.js';

const now = new Date('2026-11-18T12:00:00.000Z');
const tempPath = () => join(mkdtempSync(join(tmpdir(), 'job-radar-disc-')), 'discovered.json');

describe('atsFromUrl', () => {
  test.each([
    ['https://boards.greenhouse.io/monzo/jobs/1', { ats: 'greenhouse', slug: 'monzo' }],
    ['https://job-boards.greenhouse.io/wise/jobs/2', { ats: 'greenhouse', slug: 'wise' }],
    ['https://jobs.lever.co/paystack/abc', { ats: 'lever', slug: 'paystack' }],
    ['https://jobs.ashbyhq.com/griffin/abc', { ats: 'ashby', slug: 'griffin' }],
  ])('recognises %s', (url, expected) => {
    expect(atsFromUrl(url)).toEqual(expected);
  });

  test('returns null for a site that is not a supported ATS', () => {
    expect(atsFromUrl('https://apply.workable.com/acme/j/1')).toBeNull();
    expect(atsFromUrl('https://careers.example.com/jobs/1')).toBeNull();
  });

  test('returns null for a greenhouse url with no slug', () => {
    expect(atsFromUrl('https://boards.greenhouse.io/')).toBeNull();
  });

  test('returns null for an unparseable url', () => {
    expect(atsFromUrl('nonsense')).toBeNull();
  });
});

describe('recordDiscovered', () => {
  test('records an ATS board that serper surfaced', () => {
    const jobs = [makeJob({ source: 'serper', url: 'https://jobs.lever.co/newco/abc' })];

    const store = recordDiscovered({}, jobs, now);

    expect(store['lever:newco']).toMatchObject({ ats: 'lever', slug: 'newco', count: 1 });
    expect(store['lever:newco']!.lastSeen).toBe(now.toISOString());
  });

  test('counts repeat sightings instead of duplicating them', () => {
    const jobs = [
      makeJob({ id: 'a', source: 'serper', url: 'https://jobs.lever.co/newco/a' }),
      makeJob({ id: 'b', source: 'serper', url: 'https://jobs.lever.co/newco/b' }),
    ];

    const store = recordDiscovered({}, jobs, now);

    expect(store['lever:newco']!.count).toBe(2);
  });

  test('accumulates across runs', () => {
    const first = recordDiscovered(
      {},
      [makeJob({ source: 'serper', url: 'https://jobs.lever.co/newco/a' })],
      now,
    );
    const later = new Date(now.getTime() + 86_400_000);

    const second = recordDiscovered(
      first,
      [makeJob({ source: 'serper', url: 'https://jobs.lever.co/newco/b' })],
      later,
    );

    expect(second['lever:newco']!.count).toBe(2);
    expect(second['lever:newco']!.lastSeen).toBe(later.toISOString());
  });

  test('ignores jobs that did not come from serper, since those boards are already polled', () => {
    const jobs = [
      makeJob({ source: 'greenhouse', url: 'https://boards.greenhouse.io/monzo/jobs/1' }),
    ];

    expect(recordDiscovered({}, jobs, now)).toEqual({});
  });

  test('ignores a serper result that is not on a supported ATS', () => {
    const jobs = [makeJob({ source: 'serper', url: 'https://careers.example.com/jobs/1' })];

    expect(recordDiscovered({}, jobs, now)).toEqual({});
  });
});

describe('suggestSlugs', () => {
  const store: DiscoveredStore = {
    'greenhouse:monzo': { ats: 'greenhouse', slug: 'monzo', count: 5, lastSeen: now.toISOString() },
    'lever:newco': { ats: 'lever', slug: 'newco', count: 3, lastSeen: now.toISOString() },
    'ashby:tinyco': { ats: 'ashby', slug: 'tinyco', count: 1, lastSeen: now.toISOString() },
  };

  test('omits boards that are already configured', () => {
    const suggestions = suggestSlugs(store, { greenhouse: ['monzo'], lever: [], ashby: [] });

    expect(suggestions.map((s) => s.slug)).not.toContain('monzo');
  });

  test('suggests boards that are not configured yet, most-seen first', () => {
    const suggestions = suggestSlugs(store, { greenhouse: [], lever: [], ashby: [] });

    expect(suggestions.map((s) => s.slug)).toEqual(['monzo', 'newco', 'tinyco']);
  });

  test('matches configured slugs case-insensitively', () => {
    const suggestions = suggestSlugs(store, { greenhouse: ['MONZO'], lever: [], ashby: [] });

    expect(suggestions.map((s) => s.slug)).not.toContain('monzo');
  });

  test('returns an empty list when everything is already configured', () => {
    expect(
      suggestSlugs(store, { greenhouse: ['monzo'], lever: ['newco'], ashby: ['tinyco'] }),
    ).toEqual([]);
  });
});

describe('loadDiscovered and saveDiscovered', () => {
  test('round-trips a store through disk', () => {
    const path = tempPath();
    const store = recordDiscovered(
      {},
      [makeJob({ source: 'serper', url: 'https://jobs.lever.co/newco/a' })],
      now,
    );

    saveDiscovered(path, store);

    expect(loadDiscovered(path)).toEqual(store);
  });

  test('returns an empty store when the file does not exist', () => {
    expect(loadDiscovered(tempPath())).toEqual({});
  });

  test('returns an empty store for corrupt json rather than throwing', () => {
    const path = tempPath();
    saveDiscovered(path, {});
    expect(existsSync(path)).toBe(true);
    expect(loadDiscovered(join(path, 'nope.json'))).toEqual({});
  });
});
