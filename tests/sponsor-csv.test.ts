import { describe, expect, test } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isLicensedSponsor, loadSponsorIndex, parseSponsorCsv } from '../src/sponsorship.js';

// Shaped like the Home Office "Register of licensed sponsors: workers" CSV.
const REAL_SHAPE = `Organisation Name,Town/City,County,Type & Rating,Route
Monzo Bank Ltd,London,,"Worker (A rating)",Skilled Worker
"Smith, Jones & Co Limited",Manchester,,"Worker (A rating)",Skilled Worker
Wise Payments Limited,London,,"Worker (A rating)","Skilled Worker, Global Business Mobility"
`;

describe('parseSponsorCsv', () => {
  test('reads the organisation name column', () => {
    expect(parseSponsorCsv(REAL_SHAPE)).toEqual([
      'Monzo Bank Ltd',
      'Smith, Jones & Co Limited',
      'Wise Payments Limited',
    ]);
  });

  test('handles a quoted field that contains a comma', () => {
    expect(parseSponsorCsv(REAL_SHAPE)[1]).toBe('Smith, Jones & Co Limited');
  });

  test('finds the name column even when it is not first', () => {
    const csv = 'Town,Organisation Name\nLondon,Monzo Bank Ltd\n';
    expect(parseSponsorCsv(csv)).toEqual(['Monzo Bank Ltd']);
  });

  test('falls back to the first column when no heading mentions a name', () => {
    const csv = 'a,b\nAcme Ltd,x\n';
    expect(parseSponsorCsv(csv)).toEqual(['Acme Ltd']);
  });

  test('skips blank lines and a trailing newline', () => {
    expect(parseSponsorCsv('Organisation Name\nAcme Ltd\n\n\n')).toEqual(['Acme Ltd']);
  });

  test('returns an empty list for an empty file', () => {
    expect(parseSponsorCsv('')).toEqual([]);
  });

  test('returns an empty list for a header-only file', () => {
    expect(parseSponsorCsv('Organisation Name\n')).toEqual([]);
  });
});

describe('loadSponsorIndex', () => {
  test('loads a csv from disk into a usable index', () => {
    const dir = mkdtempSync(join(tmpdir(), 'job-radar-csv-'));
    const path = join(dir, 'uk-sponsors.csv');
    writeFileSync(path, REAL_SHAPE);

    const index = loadSponsorIndex(path)!;

    expect(index).not.toBeNull();
    expect(isLicensedSponsor('Monzo', index)).toBe(true);
    expect(isLicensedSponsor('Revolut', index)).toBe(false);
  });

  test('returns null when the file is absent, so the step is skipped silently', () => {
    expect(loadSponsorIndex(join(tmpdir(), 'definitely-not-here-xyz.csv'))).toBeNull();
  });
});
