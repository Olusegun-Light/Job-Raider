import type { LocationBucket, SponsorshipVerdict } from './types.js';
import { isRelocationBucket } from './types.js';
import type { RemoteScope } from './filter.js';

export type Reach = { reachable: true } | { reachable: false; reason: string };

const REACHABLE: Reach = { reachable: true };

/**
 * Whether someone applying from Lagos could actually take this job.
 *
 * Two rules, in order:
 *
 * 1. A remote role fenced into a region we do not target is out. "Remote -
 *    United States" is remote in name only: it means "must already be
 *    authorised to work in the US", and nobody sponsors a visa for a remote
 *    hire. An explicit sponsorship offer overrides this, because a company
 *    that says it sponsors has answered the question itself.
 *
 * 2. A role in a region that needs a visa, which states it cannot sponsor, is
 *    out. This is deliberately lenient: silence is not a refusal, and plenty
 *    of UK and EU employers sponsor without advertising it, so only an
 *    explicit "no" drops the job.
 *
 * Lagos roles and genuinely open remote roles need neither test.
 */
export function assessReach(job: {
  bucket: LocationBucket;
  scope: RemoteScope;
  sponsorship: SponsorshipVerdict;
}): Reach {
  if (job.scope === 'restricted' && !isRelocationBucket(job.bucket) && job.sponsorship !== 'yes') {
    return {
      reachable: false,
      reason: 'remote but restricted to a region outside the targets, with no sponsorship offered',
    };
  }

  if (isRelocationBucket(job.bucket) && job.sponsorship === 'no') {
    return { reachable: false, reason: 'states it cannot sponsor' };
  }

  return REACHABLE;
}
