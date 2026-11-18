import { describe, expect, test } from 'vitest';
import { passesFilter } from '../src/filter.js';
import type { RulesConfig } from '../src/config.js';
import { makeJob } from './helpers.js';

const rules: RulesConfig = {
  titleInclude: [
    'backend',
    'back-end',
    'back end',
    'software engineer',
    'node',
    'api engineer',
    'platform engineer',
    'full stack',
    'fullstack',
  ],
  titleExclude: [
    'staff',
    'principal',
    'head of',
    'director',
    'manager',
    'intern',
    'front end',
    'frontend',
    'ios',
    'android',
    'data scientist',
    'machine learning',
  ],
  mustMatchAny: ['node', 'node.js', 'nodejs', 'typescript', 'javascript', 'nestjs', 'express'],
  locationTargets: {
    uk: ['uk', 'united kingdom', 'london'],
    remote: ['remote', 'emea', 'europe', 'anywhere', 'worldwide', 'africa', 'nigeria'],
    lagos: ['lagos', 'nigeria'],
  },
  maxAgeHours: 48,
  minScore: 4,
  weights: {
    titleBackend: 3,
    titleNodeTs: 3,
    descriptionNodeTs: 2,
    sponsorshipYes: 4,
    ukSponsorLicensed: 2,
    remoteOpen: 3,
    domainMatch: 1,
    domainMatchMax: 2,
    postedLast24h: 1,
  },
  domains: ['fintech', 'payments', 'health', 'telecom'],
};

const job = (overrides: Parameters<typeof makeJob>[0]) => makeJob(overrides);

describe('passesFilter: title rules', () => {
  test.each([
    ['Backend Engineer', true],
    ['Senior Backend Engineer (Node)', true],
    ['Back-End Developer', true],
    ['Software Engineer', true],
    ['Platform Engineer', true],
    ['Full Stack Engineer', true],
    ['Staff Backend Engineer', false],
    ['Principal Backend Engineer', false],
    ['Head of Backend Engineering', false],
    ['Engineering Manager, Backend', false],
    ['Backend Engineering Intern', false],
    ['Frontend Engineer', false],
    ['iOS Engineer', false],
    ['Android Engineer', false],
    ['Data Scientist', false],
    ['Machine Learning Engineer', false],
    ['Product Designer', false],
    ['Account Executive', false],
  ])('%s -> %s', (title, expected) => {
    const result = passesFilter(
      job({ title, location: 'London, UK', description: 'Node.js' }),
      rules,
    );
    expect(result.passed).toBe(expected);
  });

  test('keeps senior roles, which fit 4+ years of experience', () => {
    expect(
      passesFilter(
        job({ title: 'Senior Backend Engineer (Node)', location: 'London', description: 'node' }),
        rules,
      ).passed,
    ).toBe(true);
  });

  test('explains why a job was rejected', () => {
    expect(
      passesFilter(
        job({ title: 'Staff Backend Engineer', location: 'London', description: 'node' }),
        rules,
      ).reason,
    ).toMatch(/titleExclude|staff/i);
  });
});

describe('passesFilter: must-match keywords', () => {
  test('keeps a job whose description mentions the stack', () => {
    expect(
      passesFilter(
        job({ title: 'Backend Engineer', description: 'We use TypeScript', location: 'London' }),
        rules,
      ).passed,
    ).toBe(true);
  });

  test('rejects a job that never mentions the stack', () => {
    const result = passesFilter(
      job({ title: 'Backend Engineer', description: 'We use Go and Rust', location: 'London' }),
      rules,
    );
    expect(result.passed).toBe(false);
    expect(result.reason).toMatch(/mustMatchAny|stack/i);
  });

  test('checks the title too, not only the description', () => {
    expect(
      passesFilter(
        job({ title: 'Backend Engineer, Node.js', description: 'We use Go', location: 'London' }),
        rules,
      ).passed,
    ).toBe(true);
  });

  test('is lenient for serper jobs, where only a snippet is available', () => {
    const serperJob = job({
      title: 'Backend Engineer',
      description: null,
      snippet: 'London based team',
      source: 'serper',
      location: null,
    });
    expect(passesFilter(serperJob, rules).passed).toBe(true);
  });

  test('still uses the snippet when a serper job has stack keywords in it', () => {
    const serperJob = job({
      title: 'Backend Engineer',
      description: null,
      snippet: 'Node.js and TypeScript',
      source: 'serper',
      location: null,
    });
    expect(passesFilter(serperJob, rules).matchedKeywords).toContain('node.js');
  });

  test('reports which keywords matched', () => {
    const result = passesFilter(
      job({
        title: 'Backend Engineer',
        description: 'Node.js, TypeScript and Express',
        location: 'London',
      }),
      rules,
    );
    expect(result.matchedKeywords).toEqual(
      expect.arrayContaining(['node.js', 'typescript', 'express']),
    );
  });
});

describe('passesFilter: location rules', () => {
  test('keeps a UK job', () => {
    expect(
      passesFilter(
        job({ title: 'Backend Engineer', location: 'London, UK', description: 'node' }),
        rules,
      ).passed,
    ).toBe(true);
  });

  test('keeps a remote EMEA job', () => {
    expect(
      passesFilter(
        job({ title: 'Backend Engineer', location: 'Remote (EMEA)', description: 'node' }),
        rules,
      ).passed,
    ).toBe(true);
  });

  test('keeps a Lagos job', () => {
    expect(
      passesFilter(
        job({ title: 'Backend Engineer', location: 'Lagos, Nigeria', description: 'node' }),
        rules,
      ).passed,
    ).toBe(true);
  });

  test('rejects a job located somewhere none of the buckets cover', () => {
    const result = passesFilter(
      job({
        title: 'Backend Engineer',
        location: 'Tokyo, Japan',
        remote: false,
        description: 'node',
      }),
      rules,
    );
    expect(result.passed).toBe(false);
    expect(result.reason).toMatch(/location/i);
  });

  test('is lenient for a serper job with no location at all', () => {
    const serperJob = job({
      title: 'Backend Engineer',
      location: null,
      remote: null,
      source: 'serper',
      snippet: 'node',
      description: null,
    });
    expect(passesFilter(serperJob, rules).passed).toBe(true);
  });

  test('rejects an ATS job with no location, because the board should have told us', () => {
    const result = passesFilter(
      job({ title: 'Backend Engineer', location: null, remote: false, description: 'node' }),
      rules,
    );
    expect(result.passed).toBe(false);
  });
});
