import { describe, expect, test } from 'vitest';
import { jobId, normalizeUrl } from '../src/dedupe.js';

describe('normalizeUrl', () => {
  test('strips utm_* tracking parameters', () => {
    expect(normalizeUrl('https://jobs.lever.co/acme/1?utm_source=x&utm_medium=y')).toBe(
      'https://jobs.lever.co/acme/1',
    );
  });

  test('strips greenhouse gh_src and generic ref parameters', () => {
    // The host also canonicalises to job-boards.greenhouse.io; see the alias test below.
    expect(normalizeUrl('https://boards.greenhouse.io/acme/jobs/5?gh_src=abc&ref=linkedin')).toBe(
      'https://job-boards.greenhouse.io/acme/jobs/5',
    );
  });

  test('keeps meaningful query parameters such as a posting token', () => {
    expect(normalizeUrl('https://jobs.example.com/apply?token=abc123&utm_source=x')).toBe(
      'https://jobs.example.com/apply?token=abc123',
    );
  });

  test('removes a trailing slash', () => {
    expect(normalizeUrl('https://jobs.lever.co/acme/1/')).toBe('https://jobs.lever.co/acme/1');
  });

  test('lowercases the host but preserves path case, which job ids depend on', () => {
    expect(normalizeUrl('https://Jobs.Lever.CO/Acme/AbC')).toBe('https://jobs.lever.co/Acme/AbC');
  });

  test('drops the fragment', () => {
    expect(normalizeUrl('https://jobs.lever.co/acme/1#apply')).toBe('https://jobs.lever.co/acme/1');
  });

  test('sorts remaining query parameters so ordering does not change the id', () => {
    expect(normalizeUrl('https://x.com/j?b=2&a=1')).toBe(normalizeUrl('https://x.com/j?a=1&b=2'));
  });

  test('upgrades the greenhouse legacy host to the current one so both find the same job', () => {
    expect(normalizeUrl('https://boards.greenhouse.io/monzo/jobs/7')).toBe(
      normalizeUrl('https://job-boards.greenhouse.io/monzo/jobs/7'),
    );
  });

  test('keeps gh_jid, which identifies the job rather than the referrer', () => {
    // gh_src is tracking; gh_jid is the Greenhouse job id on an embedded
    // careers page. Stripping it collapses every job on that page to one id.
    expect(normalizeUrl('https://acme.com/careers?gh_jid=4567890&gh_src=abc')).toBe(
      'https://acme.com/careers?gh_jid=4567890',
    );
  });

  test('gives two jobs on the same embedded careers page different ids', () => {
    expect(jobId('https://acme.com/careers?gh_jid=4567890')).not.toBe(
      jobId('https://acme.com/careers?gh_jid=1111111'),
    );
  });

  test('upgrades http to https, so one job does not get two ids', () => {
    expect(normalizeUrl('http://jobs.lever.co/acme/1')).toBe('https://jobs.lever.co/acme/1');
  });

  test('strips a www. prefix, so one job does not get two ids', () => {
    expect(normalizeUrl('https://www.jobs.lever.co/acme/1')).toBe('https://jobs.lever.co/acme/1');
  });

  test('treats the EU greenhouse host as the same board', () => {
    expect(jobId('https://boards.eu.greenhouse.io/wise/jobs/5')).toBe(
      jobId('https://job-boards.greenhouse.io/wise/jobs/5'),
    );
  });

  test('returns the input unchanged when it is not a parseable url', () => {
    expect(normalizeUrl('not a url')).toBe('not a url');
  });
});

describe('jobId', () => {
  test('is stable for the same url', () => {
    expect(jobId('https://x.com/j/1')).toBe(jobId('https://x.com/j/1'));
  });

  test('ignores tracking parameters, so the same job gets one id', () => {
    expect(jobId('https://x.com/j/1?utm_source=google')).toBe(jobId('https://x.com/j/1'));
  });

  test('differs for different jobs', () => {
    expect(jobId('https://x.com/j/1')).not.toBe(jobId('https://x.com/j/2'));
  });

  test('is a short hex digest', () => {
    expect(jobId('https://x.com/j/1')).toMatch(/^[0-9a-f]{16}$/);
  });
});
