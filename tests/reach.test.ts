import { describe, expect, test } from 'vitest';
import { assessReach } from '../src/reach.js';

describe('assessReach', () => {
  test('a Lagos role needs nothing', () => {
    expect(assessReach({ bucket: 'lagos', scope: 'none', sponsorship: 'unknown' })).toEqual({
      reachable: true,
    });
  });

  test('an open-remote role is reachable however quiet it is about visas', () => {
    expect(assessReach({ bucket: 'remote', scope: 'open', sponsorship: 'unknown' })).toEqual({
      reachable: true,
    });
  });

  test('bare "remote" is kept, since it may yet be open to anyone', () => {
    expect(assessReach({ bucket: 'remote', scope: 'unstated', sponsorship: 'unknown' })).toEqual({
      reachable: true,
    });
  });

  test('a remote role fenced into a region we do not target is unreachable', () => {
    const reach = assessReach({ bucket: 'other', scope: 'restricted', sponsorship: 'unknown' });
    expect(reach.reachable).toBe(false);
    expect(reach.reachable === false && reach.reason).toMatch(/restricted/i);
  });

  test('...even when it scores well, because no visa route exists for it', () => {
    expect(assessReach({ bucket: 'other', scope: 'restricted', sponsorship: 'no' }).reachable).toBe(
      false,
    );
  });

  test('an explicit sponsorship offer rescues a region we do not otherwise target', () => {
    expect(assessReach({ bucket: 'other', scope: 'restricted', sponsorship: 'yes' })).toEqual({
      reachable: true,
    });
  });

  test('remote-within-a-target-region stays reachable: sponsorship decides it', () => {
    expect(assessReach({ bucket: 'uk', scope: 'restricted', sponsorship: 'unknown' })).toEqual({
      reachable: true,
    });
    expect(assessReach({ bucket: 'europe', scope: 'restricted', sponsorship: 'unknown' })).toEqual({
      reachable: true,
    });
  });

  test.each(['uk', 'europe', 'gulf', 'apac', 'americas'] as const)(
    'a %s role that states it cannot sponsor is unreachable',
    (bucket) => {
      const reach = assessReach({ bucket, scope: 'none', sponsorship: 'no' });
      expect(reach.reachable).toBe(false);
      expect(reach.reachable === false && reach.reason).toMatch(/sponsor/i);
    },
  );

  test('a no-sponsorship statement does not drop a Lagos or remote role', () => {
    expect(assessReach({ bucket: 'lagos', scope: 'none', sponsorship: 'no' }).reachable).toBe(true);
    expect(assessReach({ bucket: 'remote', scope: 'open', sponsorship: 'no' }).reachable).toBe(
      true,
    );
  });
});
