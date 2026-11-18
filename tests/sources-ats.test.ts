import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseGreenhouseBoard } from '../src/sources/greenhouse.js';
import { parseLeverBoard } from '../src/sources/lever.js';
import { parseAshbyBoard } from '../src/sources/ashby.js';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8'));

describe('parseGreenhouseBoard (real monzo board response)', () => {
  const jobs = parseGreenhouseBoard('monzo', fixture('greenhouse-monzo.json'));

  test('parses every job in the board', () => {
    expect(jobs).toHaveLength(3);
  });

  test('takes the title, company and absolute url', () => {
    const job = jobs.find((j) => j.title === 'Backend Engineer III ')!;
    expect(job.company).toBe('Monzo');
    expect(job.url).toMatch(/greenhouse\.io\/monzo\/jobs\/\d+$/);
    expect(job.source).toBe('greenhouse');
  });

  test('flattens location.name into the location string', () => {
    expect(jobs[0]!.location).toBe('Cardiff, London or Remote (UK)');
  });

  test('infers remote from the location text', () => {
    expect(jobs[0]!.remote).toBe(true);
    expect(jobs.find((j) => j.location === 'Barcelona')!.remote).toBe(false);
  });

  test('prefers first_published over updated_at, so edits do not look like new postings', () => {
    const raw = (fixture('greenhouse-monzo.json') as { jobs: { first_published: string }[] })
      .jobs[0]!;
    expect(jobs[0]!.postedAt).toBe(new Date(raw.first_published).toISOString());
  });

  test('decodes the entity-encoded description into plain text', () => {
    const text = jobs[0]!.description!;
    expect(text).not.toContain('&lt;');
    expect(text).not.toMatch(/<\/?(div|p|strong)[ >]/);
    expect(text.length).toBeGreaterThan(200);
  });

  test('gives every job a stable id derived from its url', () => {
    const ids = jobs.map((j) => j.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toMatch(/^[0-9a-f]{16}$/);
  });

  test('leaves scoring fields at their defaults for later stages', () => {
    expect(jobs[0]).toMatchObject({ score: 0, sponsorship: 'unknown', matchedKeywords: [] });
  });

  test('throws a descriptive error when the payload is not a greenhouse board', () => {
    expect(() => parseGreenhouseBoard('monzo', { nope: true })).toThrow(/greenhouse/i);
  });
});

describe('parseLeverBoard (real spotify board response)', () => {
  const jobs = parseLeverBoard('spotify', fixture('lever-spotify.json'));

  test('reads the title from the text field, not a title field', () => {
    expect(jobs[0]!.title).toBe('Backend Engineer - Data Platform');
  });

  test('derives the company from the board slug, which lever does not return', () => {
    expect(jobs[0]!.company).toBe('spotify');
  });

  test('converts the epoch-millisecond createdAt into an ISO timestamp', () => {
    const raw = (fixture('lever-spotify.json') as { createdAt: number }[])[0]!;
    expect(jobs[0]!.postedAt).toBe(new Date(raw.createdAt).toISOString());
  });

  test('uses categories.location for the location', () => {
    expect(jobs[0]!.location).toBe('Stockholm');
  });

  test('maps workplaceType to the remote flag', () => {
    expect(jobs[0]!.remote).toBe(false); // spotify fixture is "hybrid"
  });

  test('uses hostedUrl as the job url', () => {
    expect(jobs[0]!.url).toMatch(/^https:\/\/jobs\.lever\.co\//);
  });

  test('keeps the plain-text description including the additional section', () => {
    expect(jobs[0]!.description).toContain('Spotify');
    expect(jobs[0]!.description!.length).toBeGreaterThan(200);
  });

  test('throws when the payload is not a lever posting list', () => {
    expect(() => parseLeverBoard('spotify', { jobs: [] })).toThrow(/lever/i);
  });
});

describe('parseAshbyBoard (real griffin board response)', () => {
  const jobs = parseAshbyBoard('griffin', fixture('ashby-griffin.json'));

  test('parses the jobs array', () => {
    expect(jobs).toHaveLength(4);
    expect(jobs[0]!.title).toBe('Treasury Lead');
  });

  test('uses publishedAt for postedAt', () => {
    const raw = (fixture('ashby-griffin.json') as { jobs: { publishedAt: string }[] }).jobs[0]!;
    expect(jobs[0]!.postedAt).toBe(new Date(raw.publishedAt).toISOString());
  });

  test('takes isRemote directly rather than guessing from text', () => {
    expect(jobs[0]!.remote).toBe(true);
  });

  test('uses the location string and the jobUrl', () => {
    expect(jobs[0]!.location).toBe('London or remote within the UK');
    expect(jobs[0]!.url).toMatch(/^https:\/\/jobs\.ashbyhq\.com\/griffin\//);
  });

  test('uses descriptionPlain without needing html stripping', () => {
    expect(jobs[0]!.description).toContain('Griffin');
    expect(jobs[0]!.description).not.toContain('<p>');
  });

  test('derives the company from the slug', () => {
    expect(jobs[0]!.company).toBe('griffin');
  });

  test('throws when the payload is not an ashby board', () => {
    expect(() => parseAshbyBoard('griffin', [{ title: 'x' }])).toThrow(/ashby/i);
  });
});
