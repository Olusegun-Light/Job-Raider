import type { RulesConfig } from './config.js';
import type { Job, LocationBucket } from './types.js';
import { containsAnyTerm } from './util/text.js';

export type LocationTargets = RulesConfig['locationTargets'];

/**
 * Which digest section a job belongs to.
 *
 * Precedence is uk > lagos > remote > other: a remote-in-London role is a UK
 * role (sponsorship matters there), and "Lagos" is more specific than the
 * "nigeria" term that also sits in the remote bucket.
 */
export function bucketFor(job: Job, targets: LocationTargets): LocationBucket {
  const haystack = [job.location ?? '', job.remote ? 'remote' : ''].join(' ');

  if (containsAnyTerm(haystack, targets.uk)) return 'uk';
  if (containsAnyTerm(haystack, targets.lagos)) return 'lagos';
  if (containsAnyTerm(haystack, targets.remote)) return 'remote';
  return 'other';
}
