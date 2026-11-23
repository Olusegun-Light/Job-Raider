import type { RulesConfig } from './config.js';
import type { Job, LocationBucket, RelocationBucket } from './types.js';
import { RELOCATION_BUCKETS } from './types.js';
import { containsAnyTerm, containsTerm, matchingTerms } from './util/text.js';

export type LocationTargets = RulesConfig['locationTargets'];

/**
 * The text a job's location can be read from.
 *
 * A Google result has no location field, so the only place a location can be
 * read from is the title and snippet. Without that fallback, every hit from
 * the uk-sponsor query lands in "Other" and the sponsorship rules never fire.
 * Only for Serper: an ATS board states the location outright, and a
 * description mentioning London must not override "Tokyo".
 */
export function locationHaystack(job: Job): string {
  const fallback = job.source === 'serper' ? `${job.title} ${job.snippet ?? ''}` : '';
  return [job.location ?? '', job.remote ? 'remote' : '', fallback].join(' ');
}

/** Terms for a region that rules.yaml may not define at all. */
const termsFor = (targets: LocationTargets, region: RelocationBucket): string[] =>
  region === 'uk' ? targets.uk : (targets[region] ?? []);

/**
 * How far a remote role's eligibility actually reaches.
 *
 * - `open`       names a scope that includes Nigeria (EMEA, Africa, worldwide)
 * - `restricted` remote, but confined to another country ("Remote - USA")
 * - `unstated`   bare "remote", which may yet be open to anyone
 * - `none`       not a remote role
 *
 * The distinction is the whole point: "Remote" and "Remote - United States"
 * are the same word to a keyword match, and only one of them can be applied
 * to from Lagos.
 */
export type RemoteScope = 'none' | 'open' | 'restricted' | 'unstated';

export function remoteScope(job: Job, targets: LocationTargets): RemoteScope {
  const haystack = locationHaystack(job);
  if (job.remote !== true && !containsTerm(haystack, 'remote')) return 'none';

  // Nigeria counts as open: a role remote-within-Nigeria needs no visa.
  if (containsAnyTerm(haystack, [...targets.remote, ...targets.lagos])) return 'open';

  const namesSomewhere =
    containsAnyTerm(haystack, targets.exclude ?? []) ||
    RELOCATION_BUCKETS.some((region) => containsAnyTerm(haystack, termsFor(targets, region)));
  return namesSomewhere ? 'restricted' : 'unstated';
}

/**
 * Which digest section a job belongs to.
 *
 * Precedence keeps uk > lagos ahead of everything, as before: a
 * remote-in-London role is a UK role because sponsorship is what decides it,
 * and "Lagos" is more specific than the "nigeria" term that also reads as an
 * open-remote scope.
 *
 * Open remote then wins over the named regions, so "Remote - EMEA" is a
 * remote job rather than a European one. A restricted remote role falls
 * through to its actual region, which is how "Remote - United States" stops
 * masquerading as something reachable from Lagos.
 */
export function bucketFor(job: Job, targets: LocationTargets): LocationBucket {
  const haystack = locationHaystack(job);
  const scope = remoteScope(job, targets);

  if (containsAnyTerm(haystack, targets.uk)) return 'uk';
  if (containsAnyTerm(haystack, targets.lagos)) return 'lagos';
  if (scope === 'open') return 'remote';

  // Checked ahead of the regions so "Remote - US & Canada" is demoted rather
  // than counted as Canadian.
  if (containsAnyTerm(haystack, targets.exclude ?? [])) return 'other';

  for (const region of ['europe', 'gulf', 'apac', 'americas'] as const) {
    if (containsAnyTerm(haystack, termsFor(targets, region))) return region;
  }

  // Bare "remote" with no scope at all: keep it, it may be open to anyone.
  if (scope === 'unstated') return 'remote';
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

  /**
   * Placeable in a target region, or not wanted. `bucketFor` already answers
   * this: it returns 'other' only for a location that matches no region and
   * is not open-or-unstated remote, which is exactly the set we cannot use.
   * A remote role fenced into a non-target country ("Remote - United
   * States") lands here rather than passing on the word "remote" alone.
   */
  if (!lenient && bucketFor(job, rules.locationTargets) === 'other') {
    return {
      passed: false,
      reason: `location "${job.location ?? 'unknown'}" matched no target region`,
      matchedKeywords,
    };
  }

  return { passed: true, matchedKeywords };
}
