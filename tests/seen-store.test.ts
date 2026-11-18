import { describe, expect, test } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  dropSeen,
  loadSeen,
  pruneSeen,
  recordSeen,
  saveSeen,
  type SeenStore,
} from '../src/dedupe.js';
import { makeScoredJob } from './helpers.js';

const now = new Date('2026-11-18T12:00:00.000Z');
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();

function tempFile(contents?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'job-radar-seen-'));
  const path = join(dir, 'seen.json');
  if (contents !== undefined) writeFileSync(path, contents);
  return path;
}

describe('loadSeen', () => {
  test('returns an empty store when the file does not exist yet', () => {
    expect(loadSeen(tempFile())).toEqual({});
  });

  test('reads an existing store', () => {
    const path = tempFile(
      JSON.stringify({ abc: { firstSeen: daysAgo(1), title: 'T', company: 'C' } }),
    );
    expect(loadSeen(path).abc?.title).toBe('T');
  });

  test('returns an empty store rather than crashing on corrupt json', () => {
    expect(loadSeen(tempFile('{not json'))).toEqual({});
  });

  test('reports a corrupt store instead of failing silently', () => {
    const warnings: string[] = [];
    loadSeen(tempFile('{not json'), (msg) => warnings.push(msg));

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/seen/i);
  });

  test('preserves a corrupt store beside the new one, so history is recoverable', () => {
    const path = tempFile('{not json');

    loadSeen(path, () => {});

    const salvaged = readdirSync(dirname(path)).filter((f) => f.includes('corrupt'));
    expect(salvaged).toHaveLength(1);
    expect(readFileSync(join(dirname(path), salvaged[0]!), 'utf8')).toBe('{not json');
  });

  test('returns an empty store when the json is the wrong shape', () => {
    expect(loadSeen(tempFile('[1,2,3]'))).toEqual({});
  });

  test('skips individual entries that are malformed but keeps the good ones', () => {
    const path = tempFile(
      JSON.stringify({ good: { firstSeen: daysAgo(1), title: 'T', company: 'C' }, bad: 42 }),
    );
    const store = loadSeen(path);
    expect(Object.keys(store)).toEqual(['good']);
  });
});

describe('saveSeen', () => {
  test('writes a store that loadSeen can read back', () => {
    const path = tempFile();
    const store: SeenStore = { abc: { firstSeen: daysAgo(0), title: 'T', company: 'C' } };

    saveSeen(path, store);

    expect(loadSeen(path)).toEqual(store);
  });

  test('creates the parent directory when it is missing', () => {
    const path = join(
      mkdtempSync(join(tmpdir(), 'job-radar-seen-')),
      'nested',
      'deep',
      'seen.json',
    );

    saveSeen(path, {});

    expect(existsSync(path)).toBe(true);
  });

  test('writes readable, diff-friendly json since the file is committed by CI', () => {
    const path = tempFile();
    saveSeen(path, { abc: { firstSeen: daysAgo(0), title: 'T', company: 'C' } });
    expect(readFileSync(path, 'utf8')).toContain('\n');
  });
});

describe('pruneSeen', () => {
  test('removes entries older than the retention window', () => {
    const store: SeenStore = {
      old: { firstSeen: daysAgo(61), title: 'Old', company: 'C' },
      fresh: { firstSeen: daysAgo(10), title: 'Fresh', company: 'C' },
    };

    expect(Object.keys(pruneSeen(store, now, 60))).toEqual(['fresh']);
  });

  test('keeps an entry exactly at the boundary', () => {
    const store: SeenStore = { edge: { firstSeen: daysAgo(60), title: 'E', company: 'C' } };
    expect(Object.keys(pruneSeen(store, now, 60))).toEqual(['edge']);
  });

  test('drops an entry whose timestamp cannot be parsed', () => {
    const store: SeenStore = { bad: { firstSeen: 'whenever', title: 'B', company: 'C' } };
    expect(pruneSeen(store, now, 60)).toEqual({});
  });

  test('leaves an empty store empty', () => {
    expect(pruneSeen({}, now, 60)).toEqual({});
  });
});

describe('dropSeen', () => {
  const seen: SeenStore = {
    'known-id': { firstSeen: daysAgo(2), title: 'Backend Engineer', company: 'Monzo' },
  };

  test('drops a job whose id is already in the store', () => {
    const jobs = [
      makeScoredJob({ id: 'known-id' }),
      makeScoredJob({ id: 'new-id', url: 'https://x/2' }),
    ];
    expect(dropSeen(jobs, seen).map((j) => j.id)).toEqual(['new-id']);
  });

  test('keeps every distinct job when the store is empty', () => {
    const jobs = [
      makeScoredJob({ id: 'a', title: 'Backend Engineer', url: 'https://x/1' }),
      makeScoredJob({ id: 'b', title: 'Platform Engineer', url: 'https://x/2' }),
    ];
    expect(dropSeen(jobs, {})).toHaveLength(2);
  });

  test('keeps two distinct requisitions that share a company and a title', () => {
    // Real boards carry same-title reqs routinely: a second headcount, another
    // team, another location. Collapsing them loses a real job permanently, so
    // only a shared posting identifier may collapse two records.
    const london = makeScoredJob({
      id: 'a',
      company: 'Wise',
      title: 'Backend Engineer',
      location: 'London, UK',
      url: 'https://job-boards.greenhouse.io/wise/jobs/111',
    });
    const manchester = makeScoredJob({
      id: 'b',
      company: 'Wise',
      title: 'Backend Engineer',
      location: 'Manchester, UK',
      url: 'https://job-boards.greenhouse.io/wise/jobs/222',
    });

    expect(dropSeen([london, manchester], {})).toHaveLength(2);
  });

  test('delivers a new requisition whose title is already in the seen store', () => {
    // The store suppresses by job id only. Matching on company + title would
    // mean a repost or a second headcount is never reported again.
    const store: SeenStore = {
      'old-id': { firstSeen: daysAgo(30), title: 'Backend Engineer', company: 'Wise' },
    };
    const newReq = makeScoredJob({
      id: 'new-id',
      company: 'Wise',
      title: 'Backend Engineer',
      url: 'https://job-boards.greenhouse.io/wise/jobs/999',
    });

    expect(dropSeen([newReq], store)).toHaveLength(1);
  });

  test('collapses the same job arriving from two sources, preferring the ATS version', () => {
    const viaSerper = makeScoredJob({
      id: 'serper-id',
      source: 'serper',
      title: 'Backend Engineer',
      company: 'monzo',
      description: null,
      snippet: 'Node.js',
      url: 'https://job-boards.greenhouse.io/monzo/jobs/9',
    });
    const viaAts = makeScoredJob({
      id: 'ats-id',
      source: 'greenhouse',
      title: 'Backend Engineer',
      company: 'Monzo',
      description: 'A full description from the board',
      url: 'https://boards.greenhouse.io/monzo/jobs/9?gh_src=x',
    });

    const kept = dropSeen([viaSerper, viaAts], {});

    expect(kept).toHaveLength(1);
    expect(kept[0]!.source).toBe('greenhouse');
    expect(kept[0]!.description).not.toBeNull();
  });

  test('collapses a serper hit onto the ATS record when the job id matches', () => {
    // The serper link carries the Greenhouse job id as gh_jid, which is what
    // proves these two records are one posting.
    const viaSerper = makeScoredJob({
      id: 'a',
      source: 'serper',
      company: 'Monzo',
      title: 'Senior Backend Engineer',
      url: 'https://monzo.com/careers?gh_jid=7343996',
      description: null,
      snippet: 'Node.js',
    });
    const viaAts = makeScoredJob({
      id: 'b',
      source: 'greenhouse',
      company: 'monzo',
      title: 'senior backend engineer',
      url: 'https://job-boards.greenhouse.io/monzo/jobs/7343996',
    });

    const kept = dropSeen([viaSerper, viaAts], {});

    expect(kept).toHaveLength(1);
    expect(kept[0]!.source).toBe('greenhouse');
  });

  test('keeps both when two sources share a title but nothing identifies them as one job', () => {
    // Without a shared identifier these may be two different reqs. A duplicate
    // in the digest is a nuisance; dropping a real job is a silent loss.
    const a = makeScoredJob({
      id: 'a',
      source: 'serper',
      company: 'Monzo',
      title: 'Senior Backend Engineer',
      url: 'https://x/a',
    });
    const b = makeScoredJob({
      id: 'b',
      source: 'lever',
      company: 'monzo',
      title: 'senior backend engineer!',
      url: 'https://y/b',
    });

    expect(dropSeen([a, b], {})).toHaveLength(2);
  });

  test('collapses two records that reached the same url twice in one run', () => {
    const a = makeScoredJob({
      id: 'dup',
      source: 'greenhouse',
      url: 'https://job-boards.greenhouse.io/monzo/jobs/5',
    });
    const b = makeScoredJob({
      id: 'dup',
      source: 'greenhouse',
      url: 'https://boards.greenhouse.io/monzo/jobs/5?gh_src=x',
    });

    expect(dropSeen([a, b], {})).toHaveLength(1);
  });

  test('does not collapse two genuinely different titles at the same company', () => {
    const a = makeScoredJob({
      id: 'a',
      company: 'Monzo',
      title: 'Backend Engineer',
      url: 'https://x/a',
    });
    const b = makeScoredJob({
      id: 'b',
      company: 'Monzo',
      title: 'Platform Engineer',
      url: 'https://x/b',
    });

    expect(dropSeen([a, b], {})).toHaveLength(2);
  });

  test('does not collapse the same title at two different companies', () => {
    const a = makeScoredJob({
      id: 'a',
      company: 'Monzo',
      title: 'Backend Engineer',
      url: 'https://job-boards.greenhouse.io/monzo/jobs/7',
    });
    const b = makeScoredJob({
      id: 'b',
      company: 'Wise',
      title: 'Backend Engineer',
      url: 'https://job-boards.greenhouse.io/wise/jobs/7',
    });

    expect(dropSeen([a, b], {})).toHaveLength(2);
  });

  test('records the collapsed duplicate\u2019s id too, so it stays suppressed later', () => {
    const viaSerper = makeScoredJob({
      id: 'serper-id',
      source: 'serper',
      company: 'Monzo',
      title: 'Backend Engineer',
      url: 'https://monzo.com/careers?gh_jid=7343996',
    });
    const viaAts = makeScoredJob({
      id: 'ats-id',
      source: 'greenhouse',
      company: 'Monzo',
      title: 'Backend Engineer',
      url: 'https://job-boards.greenhouse.io/monzo/jobs/7343996',
    });

    const kept = dropSeen([viaSerper, viaAts], {});
    const store = recordSeen({}, kept, new Date(daysAgo(0)));

    expect(Object.keys(store).sort()).toEqual(['ats-id', 'serper-id']);
  });
});
