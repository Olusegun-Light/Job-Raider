import { describe, expect, test } from 'vitest';
import { passesFilter } from '../src/filter.js';
import type { RulesConfig } from '../src/config.js';
import { makeJob } from './helpers.js';

const rules: RulesConfig = {
  titleInclude: ['backend'],
  titleExclude: [],
  mustMatchAny: ['node'],
  locationTargets: {
    uk: ['uk', 'london'],
    lagos: ['lagos', 'nigeria'],
    remote: ['emea', 'africa', 'worldwide', 'anywhere'],
    europe: ['germany', 'berlin'],
    gulf: ['dubai'],
    apac: ['singapore'],
    americas: ['canada', 'toronto'],
    exclude: ['united states', 'usa', 'latam', 'india'],
  },
  maxAgeHours: 48,
  minScore: 0,
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
  domains: [],
};

const ats = (location: string) =>
  makeJob({
    title: 'Backend Engineer',
    location,
    remote: /remote/i.test(location),
    source: 'ashby',
  });

describe('the location gate', () => {
  test.each([
    'Lagos, Nigeria',
    'London',
    'Remote - EMEA',
    'Remote',
    'Berlin, Germany',
    'Dubai',
    'Singapore',
    'Toronto, Canada',
  ])('keeps %s', (location) => {
    expect(passesFilter(ats(location), rules).passed).toBe(true);
  });

  test('rejects a remote role fenced into a region we do not target', () => {
    const verdict = passesFilter(ats('Remote - United States'), rules);
    expect(verdict.passed).toBe(false);
    expect(verdict.reason).toMatch(/United States/);
  });

  test('rejects an onsite role somewhere we do not target', () => {
    expect(passesFilter(ats('Reykjavik'), rules).passed).toBe(false);
  });

  test('stays lenient for Serper, whose snippet rarely states a location', () => {
    const fromGoogle = makeJob({
      title: 'Backend Engineer',
      location: null,
      remote: null,
      source: 'serper',
      description: null,
      snippet: 'We are hiring a backend engineer.',
    });
    expect(passesFilter(fromGoogle, rules).passed).toBe(true);
  });
});
