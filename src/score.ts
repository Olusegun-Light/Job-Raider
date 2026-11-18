import type { RulesConfig } from './config.js';
import type { Job } from './types.js';
import { jobText } from './filter.js';
import { containsAnyTerm, matchingTerms } from './util/text.js';

const BACKEND_TERMS = ['backend', 'back-end', 'back end'];
const STACK_TERMS = ['node', 'node.js', 'nodejs', 'typescript', 'ts'];

/**
 * Remote reach that actually helps someone applying from Lagos, taken from
 * rules.yaml so editing the config changes scoring as well as filtering.
 *
 * The bare word "remote" is excluded: on its own it says nothing about which
 * countries are eligible, and "Remote - London" still needs UK right to work.
 */
function openRemoteTerms(rules: RulesConfig): string[] {
  return rules.locationTargets.remote.filter((term) => term.trim().toLowerCase() !== 'remote');
}

const FRESH_HOURS = 24;

/**
 * Relevance score from the weights in rules.yaml (plan §6).
 *
 * "Senior" is deliberately worth nothing either way: senior roles routinely
 * fit 4+ years of experience, so they should neither be favoured nor punished.
 */
export function scoreJob(job: Job, rules: RulesConfig, now: Date): number {
  const w = rules.weights;
  const text = jobText(job);
  const body = [job.description, job.snippet].filter((t): t is string => Boolean(t)).join('\n');
  let score = 0;

  if (containsAnyTerm(job.title, BACKEND_TERMS)) score += w.titleBackend;

  const stackInTitle = containsAnyTerm(job.title, STACK_TERMS);
  if (stackInTitle) score += w.titleNodeTs;
  if (containsAnyTerm(body, STACK_TERMS)) score += w.descriptionNodeTs;

  if (job.sponsorship === 'yes') score += w.sponsorshipYes;
  if (job.ukSponsorLicensed === true) score += w.ukSponsorLicensed;

  // Remote only counts when it is open beyond the UK: a "Remote - London"
  // role still needs the right to work in the UK.
  const locationText = [job.location ?? '', job.remote ? 'remote' : ''].join(' ');
  const ukOnly = containsAnyTerm(locationText, rules.locationTargets.uk);
  const openRemote = containsAnyTerm(locationText, openRemoteTerms(rules));
  if (openRemote && !ukOnly) score += w.remoteOpen;

  const domainHits = matchingTerms(text, rules.domains).length;
  score += Math.min(domainHits, w.domainMatchMax) * w.domainMatch;

  if (job.postedAt) {
    const ageHours = (now.getTime() - new Date(job.postedAt).getTime()) / 3_600_000;
    if (Number.isFinite(ageHours) && ageHours <= FRESH_HOURS) score += w.postedLast24h;
  }

  return score;
}
