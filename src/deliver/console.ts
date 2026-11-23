import type { Deliverer, LocationBucket, RunStats, ScoredJob } from '../types.js';

/**
 * Digest sections, most reachable first.
 *
 * UK leads because it is the stated top target and the only region with a
 * licensed-sponsor register to check against. Open remote and Lagos follow,
 * as neither needs a visa. Then the relocation regions in rough order of how
 * routine employer sponsorship is for a Nigerian backend engineer.
 *
 * Every LocationBucket must appear here exactly once: a bucket with no
 * section would be counted as delivered, recorded in seen.json, and never
 * shown to anyone.
 */
export const SECTIONS: { bucket: LocationBucket; label: string }[] = [
  { bucket: 'uk', label: '🇬🇧 UK + sponsorship' },
  { bucket: 'remote', label: '🌍 Remote' },
  { bucket: 'lagos', label: '🇳🇬 Lagos' },
  { bucket: 'europe', label: '🇪🇺 Europe' },
  { bucket: 'gulf', label: '🕌 Gulf' },
  { bucket: 'apac', label: '🌏 APAC' },
  { bucket: 'americas', label: '🍁 Canada' },
  { bucket: 'other', label: 'Other' },
];

const SPONSOR_ICON = { yes: '🟢', no: '🔴', unknown: '⚪' } as const;

/** Section order is fixed; jobs inside a section are highest score first. */
export function groupByBucket(jobs: ScoredJob[]): { label: string; jobs: ScoredJob[] }[] {
  return SECTIONS.map(({ bucket, label }) => ({
    label,
    jobs: jobs.filter((j) => j.bucket === bucket).sort((a, b) => b.score - a.score),
  })).filter((section) => section.jobs.length > 0);
}

export function headerLine(stats: RunStats): string {
  const day = new Date(stats.startedAt).toUTCString().slice(5, 11).trim();
  return `Job Radar — ${day} · ${stats.delivered} new (from ${stats.scanned} scanned)`;
}

export function renderConsoleDigest(jobs: ScoredJob[], stats: RunStats): string {
  const lines: string[] = [headerLine(stats), ''];

  if (jobs.length === 0) {
    lines.push('No new matches today.');
    return lines.join('\n');
  }

  for (const section of groupByBucket(jobs)) {
    lines.push(`== ${section.label} (${section.jobs.length}) ==`);
    for (const job of section.jobs) {
      const badge = job.ukSponsorLicensed ? ' 🏛️' : '';
      lines.push(`  ${SPONSOR_ICON[job.sponsorship]} ${job.title} — ${job.company}`);
      lines.push(
        `     📍 ${job.location ?? 'location unknown'} · 🛂 ${job.sponsorship}${badge} · ⭐ ${job.score}`,
      );
      lines.push(`     ${job.url}  [${job.source}${job.postedAt ? ` · ${job.postedAt}` : ''}]`);
      if (job.matchedKeywords.length > 0) {
        lines.push(`     matched: ${job.matchedKeywords.join(', ')}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n').trimEnd();
}

export function createConsoleDeliverer(
  sink: (text: string) => void = (text) => console.log(text),
): Deliverer {
  return {
    name: 'console',
    async deliver(jobs, stats) {
      sink(renderConsoleDigest(jobs, stats));
    },
    async deliverError(error, context) {
      sink(`Job Radar run failed during ${context}: ${error.message}`);
    },
  };
}
