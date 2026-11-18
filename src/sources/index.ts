import type { AppConfig, Env } from '../config.js';
import type { CliOptions } from '../cli.js';
import type { Logger } from '../util/log.js';
import type { Job, SourceName } from '../types.js';
import { greenhouseSource } from './greenhouse.js';
import { leverSource } from './lever.js';
import { ashbySource } from './ashby.js';

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

/** Every live source, in the order they appear in run summaries. */
export function allSources(): Source[] {
  // serperSource() is registered in milestone 3.
  return [greenhouseSource(), leverSource(), ashbySource()];
}
