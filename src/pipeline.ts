import type { AppConfig, Env } from './config.js';
import type { CliOptions } from './cli.js';
import type { Logger } from './util/log.js';
import type { Source, SourceContext } from './sources/index.js';
import type { Deliverer, Job, RunStats, ScoredJob, SourceStats } from './types.js';
import { bucketFor } from './filter.js';

export type PipelineDeps = {
  sources: Source[];
  config: AppConfig;
  options: CliOptions;
  env: Env;
  log: Logger;
  deliverer: Deliverer;
  now: Date;
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
  const withBucket = (job: Job): ScoredJob => ({
    ...job,
    bucket: bucketFor(job, config.rules.locationTargets),
  });

  // Attribute counts to the source that produced the job, not to job.source:
  // a Serper hit on a Greenhouse board still belongs to the Serper run.
  const scored: ScoredJob[] = [];
  const perSource: SourceStats[] = [];
  for (const result of results) {
    const jobs = result.jobs.map(withBucket);
    result.stats.passedFilter = jobs.length;
    result.stats.new = jobs.length;
    perSource.push(result.stats);
    scored.push(...jobs);
  }

  const stats: RunStats = {
    startedAt: new Date(started).toISOString(),
    durationMs: Date.now() - started,
    scanned: scored.length,
    delivered: scored.length,
    perSource,
    serperCredits: credits.length > 0 ? credits.reduce((a, b) => a + b, 0) : null,
  };

  await deliverer.deliver(scored, stats);

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
