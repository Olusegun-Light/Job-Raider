import { describe, expect, test } from 'vitest';
import { SECTIONS } from '../src/deliver/console.js';
import type { LocationBucket } from '../src/types.js';

const ALL_BUCKETS: LocationBucket[] = [
  'uk',
  'remote',
  'lagos',
  'europe',
  'gulf',
  'apac',
  'americas',
  'other',
];

describe('digest sections', () => {
  test('every bucket has a section, so no job can be delivered yet invisible', () => {
    const covered = SECTIONS.map((s) => s.bucket);
    for (const bucket of ALL_BUCKETS) expect(covered).toContain(bucket);
  });

  test('no bucket appears twice, which would print it twice', () => {
    const covered = SECTIONS.map((s) => s.bucket);
    expect(new Set(covered).size).toBe(covered.length);
  });

  test('sections run most reachable first', () => {
    expect(SECTIONS.map((s) => s.bucket)).toEqual([
      'uk',
      'remote',
      'lagos',
      'europe',
      'gulf',
      'apac',
      'americas',
      'other',
    ]);
  });

  test('every section has a non-empty label', () => {
    for (const section of SECTIONS) expect(section.label.trim().length).toBeGreaterThan(0);
  });
});
