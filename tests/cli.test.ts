import { describe, expect, test } from 'vitest';
import { parseArgs } from '../src/cli.js';

describe('parseArgs', () => {
  test('defaults to a live run over all sources in the day window', () => {
    expect(parseArgs([])).toEqual({
      dryRun: false,
      window: 'day',
      sources: ['serper', 'greenhouse', 'lever', 'ashby'],
      keepUnreachable: false,
      minScore: undefined,
    });
  });

  test('recognises --dry-run', () => {
    expect(parseArgs(['--dry-run']).dryRun).toBe(true);
  });

  test('narrows the sources from a comma separated --source list', () => {
    expect(parseArgs(['--source=greenhouse,lever']).sources).toEqual(['greenhouse', 'lever']);
  });

  test('rejects an unknown source name', () => {
    expect(() => parseArgs(['--source=monster'])).toThrow(/monster/);
  });

  test('switches the window with --window=week', () => {
    expect(parseArgs(['--window=week']).window).toBe('week');
  });

  test('rejects an unknown window', () => {
    expect(() => parseArgs(['--window=decade'])).toThrow(/window/);
  });

  test('recognises --keep-unreachable', () => {
    expect(parseArgs(['--keep-unreachable']).keepUnreachable).toBe(true);
  });

  test('still recognises the older --keep-no-sponsor spelling', () => {
    expect(parseArgs(['--keep-no-sponsor']).keepUnreachable).toBe(true);
  });

  test('reads a numeric --min-score override', () => {
    expect(parseArgs(['--min-score=7']).minScore).toBe(7);
  });

  test('rejects a non-numeric --min-score', () => {
    expect(() => parseArgs(['--min-score=high'])).toThrow(/min-score/);
  });

  test('rejects an unknown flag instead of silently ignoring it', () => {
    expect(() => parseArgs(['--dryrun'])).toThrow(/--dryrun/);
  });
});
