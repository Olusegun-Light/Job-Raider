import type { AppConfig, Env } from '../config.js';
import type { CliOptions } from '../cli.js';
import type { Logger } from '../util/log.js';
import type { Job, SourceName } from '../types.js';

export type SourceContext = {
  config: AppConfig;
  options: CliOptions;
  env: Env;
  log: Logger;
  /** Injected so tests and the age window are deterministic. */
  now: Date;
};

export type SourceResult = {
  jobs: Job[];
  /** Non-fatal problems (a 404 board, a schema mismatch) to surface in the summary. */
  errors: string[];
  /** Serper credits consumed, when this source spends any. */
  credits?: number;
};

export type Source = {
  name: SourceName;
  fetch(ctx: SourceContext): Promise<SourceResult>;
};

/** Milestone 1 placeholder: real sources are registered in milestones 2 and 3. */
export function allSources(): Source[] {
  return [];
}
