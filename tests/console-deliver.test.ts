import { describe, expect, test } from 'vitest';
import { renderConsoleDigest } from '../src/deliver/console.js';
import { makeScoredJob, makeStats } from './helpers.js';

describe('renderConsoleDigest', () => {
  test('orders sections uk, remote, lagos, other and omits empty ones', () => {
    const text = renderConsoleDigest(
      [
        makeScoredJob({ id: 'a', bucket: 'other', title: 'A', score: 1 }),
        makeScoredJob({ id: 'b', bucket: 'lagos', title: 'B', score: 2 }),
        makeScoredJob({ id: 'c', bucket: 'uk', title: 'C', score: 3 }),
      ],
      makeStats(),
    );

    const headings = text
      .split('\n')
      .filter((l) => l.startsWith('=='))
      .map((l) => l.toLowerCase());
    expect(headings).toHaveLength(3);
    expect(headings[0]).toContain('uk');
    expect(headings[1]).toContain('lagos');
    expect(headings[2]).toContain('other');
  });

  test('sorts jobs within a section by descending score', () => {
    const text = renderConsoleDigest(
      [
        makeScoredJob({ id: 'low', title: 'Low role', score: 5, bucket: 'uk' }),
        makeScoredJob({ id: 'high', title: 'High role', score: 11, bucket: 'uk' }),
      ],
      makeStats(),
    );

    expect(text.indexOf('High role')).toBeLessThan(text.indexOf('Low role'));
  });

  test('shows the scanned and new counts in the header', () => {
    const text = renderConsoleDigest([makeScoredJob()], makeStats({ scanned: 212, delivered: 1 }));

    expect(text).toMatch(/1 new/);
    expect(text).toMatch(/212 scanned/);
  });

  test('says so plainly when there are no new jobs', () => {
    const text = renderConsoleDigest([], makeStats({ delivered: 0 }));

    expect(text).toMatch(/no new matches/i);
  });

  test('prints company, location, sponsorship, score and url for a job', () => {
    const text = renderConsoleDigest(
      [
        makeScoredJob({
          title: 'Backend Engineer',
          company: 'Monzo',
          location: 'London, UK',
          sponsorship: 'yes',
          score: 12,
          url: 'https://example.com/job/1',
        }),
      ],
      makeStats(),
    );

    expect(text).toContain('Backend Engineer');
    expect(text).toContain('Monzo');
    expect(text).toContain('London, UK');
    expect(text).toContain('yes');
    expect(text).toContain('12');
    expect(text).toContain('https://example.com/job/1');
  });
});
