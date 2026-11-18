import type { RulesConfig } from './config.js';
import type { Job, LocationBucket } from './types.js';
import { containsAnyTerm, containsTerm, matchingTerms } from './util/text.js';

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

/** Text a job offers for keyword matching: Serper jobs only have a snippet. */
export function jobText(job: Job): string {
  return [job.title, job.description, job.snippet]
    .filter((t): t is string => Boolean(t))
    .join('\n');
}

export type FilterResult = {
  passed: boolean;
  /** Why it was rejected; undefined when it passed. */
  reason?: string;
  matchedKeywords: string[];
};

/**
 * Include/exclude rules from rules.yaml.
 *
 * Serper results are treated leniently: a Google snippet is a couple of lines
 * of text with no location field, so demanding a stack keyword or a location
 * match there would throw away most of what the queries found. The queries
 * themselves already encode the stack and the geography.
 */
export function passesFilter(job: Job, rules: RulesConfig): FilterResult {
  const lenient = job.source === 'serper';
  const text = jobText(job);
  const matchedKeywords = matchingTerms(text, rules.mustMatchAny);

  const excluded = rules.titleExclude.find((term) => containsTerm(job.title, term));
  if (excluded) {
    return { passed: false, reason: `titleExclude: "${excluded}"`, matchedKeywords };
  }

  if (!containsAnyTerm(job.title, rules.titleInclude)) {
    return { passed: false, reason: 'title matched no titleInclude term', matchedKeywords };
  }

  if (matchedKeywords.length === 0 && !lenient) {
    return {
      passed: false,
      reason: 'mustMatchAny: no stack keyword in title or description',
      matchedKeywords,
    };
  }

  const { uk, remote, lagos } = rules.locationTargets;
  const locationText = [job.location ?? '', job.remote ? 'remote' : ''].join(' ');
  const locationMatches = containsAnyTerm(locationText, [...uk, ...remote, ...lagos]);
  if (!locationMatches && !lenient) {
    return {
      passed: false,
      reason: `location "${job.location ?? 'unknown'}" matched no location target`,
      matchedKeywords,
    };
  }

  return { passed: true, matchedKeywords };
}
