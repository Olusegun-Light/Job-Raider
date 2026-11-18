import { describe, expect, test } from 'vitest';
import { bucketFor } from '../src/filter.js';
import { makeJob } from './helpers.js';

const targets = {
  uk: ['uk', 'united kingdom', 'london', 'manchester', 'edinburgh', 'england', 'scotland'],
  remote: ['remote', 'emea', 'europe', 'anywhere', 'worldwide', 'africa', 'nigeria'],
  lagos: ['lagos', 'nigeria'],
};

describe('bucketFor', () => {
  test('puts a London job in the uk bucket', () => {
    expect(bucketFor(makeJob({ location: 'London, United Kingdom' }), targets)).toBe('uk');
  });

  test('prefers uk over remote when a job is remote within the UK', () => {
    expect(bucketFor(makeJob({ location: 'Remote - London, UK' }), targets)).toBe('uk');
  });

  test('puts a Lagos job in the lagos bucket', () => {
    expect(bucketFor(makeJob({ location: 'Lagos, Nigeria' }), targets)).toBe('lagos');
  });

  test('puts an EMEA-wide remote job in the remote bucket', () => {
    expect(bucketFor(makeJob({ location: 'Remote (EMEA)' }), targets)).toBe('remote');
  });

  test('falls back to remote when the location is blank but the job is flagged remote', () => {
    expect(bucketFor(makeJob({ location: null, remote: true }), targets)).toBe('remote');
  });

  test('buckets a serper job from its snippet, since google gives no location field', () => {
    // Otherwise every hit from the uk-sponsor query lands in "Other" and the
    // UK no-sponsor drop never applies to it.
    const serperJob = makeJob({
      source: 'serper',
      location: null,
      remote: null,
      description: null,
      snippet: 'London, UK. Node.js/TypeScript. We offer Skilled Worker visa sponsorship.',
    });
    expect(bucketFor(serperJob, targets)).toBe('uk');
  });

  test('buckets a serper job from its title when the snippet says nothing', () => {
    const serperJob = makeJob({
      source: 'serper',
      title: 'Backend Engineer, Lagos',
      location: null,
      remote: null,
      description: null,
      snippet: 'A great place to work',
    });
    expect(bucketFor(serperJob, targets)).toBe('lagos');
  });

  test('does not read an ATS job\u2019s description for its location', () => {
    // An ATS board states the location; the description mentioning London
    // (an office, a client) must not override "Tokyo".
    const atsJob = makeJob({
      source: 'greenhouse',
      location: 'Tokyo, Japan',
      remote: false,
      description: 'Our London and Lagos offices collaborate closely.',
    });
    expect(bucketFor(atsJob, targets)).toBe('other');
  });

  test('returns other for a location that matches no bucket', () => {
    expect(bucketFor(makeJob({ location: 'San Francisco, CA', remote: false }), targets)).toBe(
      'other',
    );
  });

  test('matches whole words only, so "Nigeria" does not match inside another word', () => {
    expect(
      bucketFor(makeJob({ location: 'Remotely-Managed Office, Tokyo', remote: false }), targets),
    ).toBe('other');
  });
});
