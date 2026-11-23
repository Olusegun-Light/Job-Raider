import { join } from 'node:path';
import type { AppConfig, Env } from './config.js';
import type { CliOptions } from './cli.js';
import type { Logger } from './util/log.js';
import type { Source, SourceContext } from './sources/index.js';
import type { Deliverer, Job, RunStats, ScoredJob, SourceStats } from './types.js';
import { bucketFor, jobText, passesFilter, remoteScope } from './filter.js';
import { assessReach } from './reach.js';
import { dropSeen, loadSeen, pruneSeen, recordSeen, saveSeen } from './dedupe.js';
import { loadDiscovered, recordDiscovered, saveDiscovered } from './discovered.js';
import { scoreJob } from './score.js';
import { detectSponsorship, isLicensedSponsor, type SponsorIndex } from './sponsorship.js';

export type PipelineDeps = {
  sources: Source[];
  config: AppConfig;
  options: CliOptions;
  env: Env;
  log: Logger;
  deliverer: Deliverer;
  now: Date;
  /** UK Home Office register, when data/uk-sponsors.csv is present. */
  sponsorIndex?: SponsorIndex | null;
  /** Dedupe store location; defaults to data/seen.json. */
  seenPath?: string;
  /** Discovered-boards store; defaults to data/discovered.json. */
  discoveredPath?: string;
  /** How long a job stays remembered. */
  retentionDays?: number;
};

type SourceOutcome = { stats: SourceStats; jobs: Job[]; credits?: number | undefined };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * fetch → normalize (in the source) → bucket → deliver.
 *
 * One source failing must never fail the run: each source's errors are
 * collected into its own stats row and the rest of the pipeline continues.
 */
export async function runPipeline(deps: PipelineDeps): Promise<RunStats> {
  const { sources, config, options, env, log, deliverer, now } = deps;
  const sponsorIndex = deps.sponsorIndex ?? null;
  const minScore = options.minScore ?? config.rules.minScore;
  const seenPath = deps.seenPath ?? join(process.cwd(), 'data', 'seen.json');
  const discoveredPath = deps.discoveredPath ?? join(process.cwd(), 'data', 'discovered.json');
  const retentionDays = deps.retentionDays ?? 60;
  const seen = loadSeen(seenPath, (message) => log.warn(message));
  const started = Date.now();

  const enabled = sources.filter((s) => options.sources.includes(s.name));
  if (enabled.length === 0) {
    log.warn('no sources enabled', { requested: options.sources.join(',') });
  }

  const ctx: SourceContext = { config, options, env, log, now };

  const results = await Promise.all(
    enabled.map(async (source): Promise<SourceOutcome> => {
      const stats: SourceStats = {
        source: source.name,
        fetched: 0,
        passedFilter: 0,
        new: 0,
        errors: [],
      };
      try {
        const result = await source.fetch(ctx);
        stats.fetched = result.jobs.length;
        stats.errors.push(...result.errors);
        return { stats, jobs: result.jobs, credits: result.credits };
      } catch (error) {
        stats.errors.push(errorMessage(error));
        log.warn('source failed', { source: source.name, error: errorMessage(error) });
        return { stats, jobs: [] };
      }
    }),
  );

  const credits = results.map((r) => r.credits).filter((c): c is number => c !== undefined);
  /**
   * filter -> enrich (sponsorship, register) -> reach -> score -> cut.
   *
   * A job nobody in Lagos could take is dropped however well it scores: see
   * assessReach for the two rules. --keep-unreachable keeps them.
   */
  const evaluate = (job: Job): ScoredJob | null => {
    const verdict = passesFilter(job, config.rules);
    if (!verdict.passed) {
      log.debug('filtered out', { title: job.title, reason: verdict.reason });
      return null;
    }

    const bucket = bucketFor(job, config.rules.locationTargets);
    const sponsorship = detectSponsorship(jobText(job));
    const ukSponsorLicensed = sponsorIndex ? isLicensedSponsor(job.company, sponsorIndex) : null;

    const reach = assessReach({
      bucket,
      scope: remoteScope(job, config.rules.locationTargets),
      sponsorship,
    });
    if (!reach.reachable && !options.keepUnreachable) {
      log.debug('dropped: unreachable', {
        title: job.title,
        company: job.company,
        reason: reach.reason,
      });
      return null;
    }

    const enriched: Job = {
      ...job,
      sponsorship,
      ukSponsorLicensed,
      matchedKeywords: verdict.matchedKeywords,
    };
    const score = scoreJob(enriched, config.rules, now);
    if (score < minScore) {
      log.debug('dropped: below minScore', { title: job.title, score, minScore });
      return null;
    }

    return { ...enriched, score, bucket };
  };

  // Attribute counts to the source that produced the job, not to job.source:
  // a Serper hit on a Greenhouse board still belongs to the Serper run.
  const scored: ScoredJob[] = [];
  const perSource: SourceStats[] = [];
  // Keyed by job id, not object identity: dedupe merges two records of one
  // posting into a new object, which an identity-keyed map would lose from
  // the per-source counts.
  const producedBy = new Map<string, SourceStats['source']>();
  for (const result of results) {
    const jobs = result.jobs.map(evaluate).filter((job): job is ScoredJob => job !== null);
    for (const job of jobs) producedBy.set(job.id, result.stats.source);
    result.stats.passedFilter = jobs.length;
    result.stats.new = jobs.length;
    perSource.push(result.stats);
    scored.push(...jobs);
  }

  // Dedupe across sources and against previous runs, then rank.
  const fresh = dropSeen(scored, seen);
  for (const stats of perSource) {
    stats.new = fresh.filter((job) => producedBy.get(job.id) === stats.source).length;
  }
  fresh.sort((a, b) => b.score - a.score);

  const stats: RunStats = {
    startedAt: new Date(started).toISOString(),
    durationMs: Date.now() - started,
    scanned: results.reduce((total, r) => total + r.jobs.length, 0),
    delivered: fresh.length,
    perSource,
    serperCredits: credits.length > 0 ? credits.reduce((a, b) => a + b, 0) : null,
  };

  await deliverer.deliver(fresh, stats);

  // --dry-run must never touch the store, so a dry run can be repeated.
  if (options.dryRun) {
    log.debug('dry run: seen.json left untouched', { path: seenPath });
  } else {
    saveSeen(seenPath, pruneSeen(recordSeen(seen, fresh, now), now, retentionDays));

    // Recorded from everything fetched, not just what was delivered: a board
    // is worth polling directly even when today's posting from it was not a
    // match. `npm run discover` reads this.
    const allFetched = results.flatMap((r) => r.jobs);
    saveDiscovered(
      discoveredPath,
      recordDiscovered(loadDiscovered(discoveredPath), allFetched, now),
    );
  }

  for (const s of perSource) {
    log.info('source summary', {
      source: s.source,
      fetched: s.fetched,
      passed: s.passedFilter,
      new: s.new,
      errors: s.errors.length,
    });
  }
  log.info('run complete', {
    scanned: stats.scanned,
    delivered: stats.delivered,
    credits: stats.serperCredits ?? 'n/a',
    ms: stats.durationMs,
  });

  return stats;
}
