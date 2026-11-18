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
