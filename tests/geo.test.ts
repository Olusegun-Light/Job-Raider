import { describe, expect, test } from 'vitest';
import { bucketFor, remoteScope } from '../src/filter.js';
import { scoreJob } from '../src/score.js';
import type { LocationTargets } from '../src/filter.js';
import { makeJob } from './helpers.js';

const targets: LocationTargets = {
  uk: ['uk', 'united kingdom', 'london'],
  lagos: ['lagos', 'nigeria'],
  // Open-remote scopes only: the bare word "remote" says nothing about which
  // countries are eligible, so it is not a target term.
  remote: ['emea', 'africa', 'worldwide', 'anywhere', 'global'],
  europe: ['germany', 'berlin', 'netherlands', 'amsterdam', 'europe'],
  gulf: ['dubai', 'uae', 'qatar', 'saudi'],
  apac: ['singapore', 'japan', 'tokyo', 'australia', 'sydney'],
  americas: ['canada', 'toronto'],
  exclude: ['united states', 'usa', 'brazil', 'india'],
};

const at = (location: string, remote = /remote/i.test(location)) =>
  makeJob({ location, remote, source: 'ashby' });

describe('remoteScope', () => {
  test('is none when the role is not remote at all', () => {
    expect(remoteScope(at('London'), targets)).toBe('none');
  });

  test('is open when the remote role names a scope that includes Nigeria', () => {
    expect(remoteScope(at('Remote - EMEA'), targets)).toBe('open');
    expect(remoteScope(at('Remote (Africa)'), targets)).toBe('open');
    expect(remoteScope(at('Remote - Worldwide'), targets)).toBe('open');
  });

  test('is restricted when the remote role is confined to another country', () => {
    expect(remoteScope(at('Remote - United States & Canada'), targets)).toBe('restricted');
    expect(remoteScope(at('Remote, USA'), targets)).toBe('restricted');
    expect(remoteScope(at('Remote - Germany'), targets)).toBe('restricted');
  });

  test('is unstated for bare "remote", which may yet be open', () => {
    expect(remoteScope(at('Remote'), targets)).toBe('unstated');
  });

  test('reads the remote flag even when the location text omits the word', () => {
    expect(remoteScope(at('Anywhere', true), targets)).toBe('open');
    expect(remoteScope(makeJob({ location: null, remote: true }), targets)).toBe('unstated');
  });
});

describe('bucketFor across regions', () => {
  test.each([
    ['Lagos, Nigeria', 'lagos'],
    ['London', 'uk'],
    ['Remote - EMEA', 'remote'],
    ['Remote', 'remote'],
    ['Berlin, Germany', 'europe'],
    ['Dubai, UAE', 'gulf'],
    ['Singapore', 'apac'],
    ['Toronto, Canada', 'americas'],
    ['Remote, USA', 'other'],
    ['Remote - United States & Canada', 'other'],
    ['Reykjavik', 'other'],
  ] as const)('%s lands in the %s bucket', (location, bucket) => {
    expect(bucketFor(at(location), targets)).toBe(bucket);
  });

  test('a remote-in-London role is still a UK role, because sponsorship decides it', () => {
    expect(bucketFor(at('Remote - London'), targets)).toBe('uk');
  });

  test('a remote-in-Nigeria role is Lagos, the most specific match', () => {
    expect(bucketFor(at('Remote - Nigeria'), targets)).toBe('lagos');
  });

  test('an excluded country demotes a role that also names a target region', () => {
    // "Remote - US & Canada" needs North American work authorisation; being
    // partly Canadian must not let it count as a Canadian role.
    expect(bucketFor(at('Remote - United States & Canada'), targets)).toBe('other');
    expect(bucketFor(at('Remote - Canada'), targets)).toBe('americas');
  });
});

describe('the open-remote bonus follows the scope, not the word "remote"', () => {
  const rules = {
    titleInclude: ['backend'],
    titleExclude: [],
    mustMatchAny: ['node'],
    locationTargets: targets,
    maxAgeHours: 48,
    minScore: 0,
    weights: {
      titleBackend: 0,
      titleNodeTs: 0,
      descriptionNodeTs: 0,
      sponsorshipYes: 0,
      ukSponsorLicensed: 0,
      remoteOpen: 3,
      domainMatch: 0,
      domainMatchMax: 0,
      postedLast24h: 0,
    },
    domains: [],
  };
  const now = new Date('2026-11-23T12:00:00.000Z');
  const score = (location: string) => scoreJob(at(location), rules, now);

  test('an open scope earns it', () => {
    expect(score('Remote - EMEA')).toBe(3);
    expect(score('Remote - Africa')).toBe(3);
  });

  test('a restricted scope does not', () => {
    expect(score('Remote - United States')).toBe(0);
    expect(score('Remote - Germany')).toBe(0);
    expect(score('Remote - London')).toBe(0);
  });

  test('bare "remote" does not, since it promises nothing', () => {
    expect(score('Remote')).toBe(0);
  });
});
