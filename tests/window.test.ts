import { describe, expect, test } from 'vitest';
import { withinWindow } from '../src/sources/window.js';

const now = new Date('2026-11-18T12:00:00.000Z');
const hoursAgo = (h: number): string => new Date(now.getTime() - h * 3_600_000).toISOString();

describe('withinWindow', () => {
  test('keeps a job posted inside the max age', () => {
    expect(withinWindow(hoursAgo(10), now, 48)).toBe(true);
  });

  test('drops a job older than the max age', () => {
    expect(withinWindow(hoursAgo(72), now, 48)).toBe(false);
  });

  test('keeps a job exactly at the boundary', () => {
    expect(withinWindow(hoursAgo(48), now, 48)).toBe(true);
  });

  test('keeps a job with an unknown posting date, since boards often omit it', () => {
    expect(withinWindow(null, now, 48)).toBe(true);
  });

  test('keeps a job whose posting date is unparseable rather than silently dropping it', () => {
    expect(withinWindow('last Tuesday', now, 48)).toBe(true);
  });

  test('widens to a full week when the week window is requested', () => {
    expect(withinWindow(hoursAgo(100), now, 48, 'week')).toBe(true);
    expect(withinWindow(hoursAgo(200), now, 48, 'week')).toBe(false);
  });

  test('never narrows below the configured max age in the week window', () => {
    expect(withinWindow(hoursAgo(300), now, 400, 'week')).toBe(true);
  });

  test('tolerates a slightly future-dated posting (timezone skew on a board)', () => {
    expect(withinWindow(hoursAgo(-3), now, 48)).toBe(true);
  });

  test('rejects a posting dated absurdly far in the future', () => {
    expect(withinWindow(hoursAgo(-24 * 30), now, 48)).toBe(false);
  });
});
