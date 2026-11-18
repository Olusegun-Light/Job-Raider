import { join } from 'node:path';
import { parseArgs, USAGE } from './cli.js';
import { loadConfig, loadDotEnv, loadEnv } from './config.js';
import { createLogger } from './util/log.js';
import { runPipeline } from './pipeline.js';
import { allSources } from './sources/index.js';
import { sampleSource } from './sources/sample.js';
import { chooseDeliverer } from './deliver/index.js';
import { loadSponsorIndex } from './sponsorship.js';
import type { Deliverer } from './types.js';

export type RunDeps = {
  env?: Record<string, string | undefined>;
  configDir?: string;
  seenPath?: string;
  discoveredPath?: string;
  sponsorsPath?: string;
  /** Injected in tests; otherwise chosen from the flags and credentials. */
  deliverer?: Deliverer;
  now?: Date;
};

/**
 * One run, end to end, returning the process exit code.
 *
 * Everything after the alert channel is established runs inside the try, so a
 * bad config file or a missing secret still produces a Telegram alert. Those
 * are the failures most likely to repeat silently for days: without an alert
 * the only signal is a red dot in the Actions tab.
 */
export async function runCli(argv: string[], deps: RunDeps = {}): Promise<number> {
  const cwd = process.cwd();
  // Only for a real process run: tests pass deps.env explicitly.
  const loadedDotEnv = deps.env ? false : loadDotEnv(join(cwd, '.env'));
  const rawEnv = deps.env ?? process.env;

  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE);
    return 0;
  }

  // The log level is the only thing needed before the alert channel exists;
  // an unusable value must not stop us from reporting the problem.
  let env;
  try {
    env = loadEnv(rawEnv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  const log = createLogger({ level: env.logLevel });
  if (loadedDotEnv) log.debug('loaded credentials from .env');

  let stage = 'startup';
  let deliverer: Deliverer;
  try {
    // Built before the config loads, so a config error has somewhere to go.
    deliverer =
      deps.deliverer ?? chooseDeliverer(parseArgs(argv.filter((a) => a !== '--sample')), env, log);
  } catch (error) {
    // No deliverer means no alert channel; the message goes to the log only.
    log.error('cannot start', { error: error instanceof Error ? error.message : String(error) });
    return 1;
  }

  try {
    stage = 'arguments';
    const options = parseArgs(argv.filter((a) => a !== '--sample'));

    stage = 'configuration';
    const config = loadConfig(deps.configDir ? { configDir: deps.configDir } : {});

    stage = 'startup';
    const sponsorIndex = loadSponsorIndex(
      deps.sponsorsPath ?? join(cwd, 'data', 'uk-sponsors.csv'),
    );
    if (sponsorIndex) log.info('uk sponsor register loaded', { names: sponsorIndex.names.size });
    else log.debug('no uk sponsor register at data/uk-sponsors.csv; skipping that check');

    let sources = allSources();
    if (argv.includes('--sample')) {
      log.warn('using the hardcoded sample source');
      sources = [sampleSource()];
    }

    stage = 'pipeline';
    await runPipeline({
      sources,
      config,
      options,
      env,
      log,
      deliverer,
      now: deps.now ?? new Date(),
      sponsorIndex,
      ...(deps.seenPath ? { seenPath: deps.seenPath } : {}),
      ...(deps.discoveredPath ? { discoveredPath: deps.discoveredPath } : {}),
    });
    return 0;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error('run failed', { stage, error: err.message });
    // A failing alert must not mask the error that caused it.
    try {
      await deliverer.deliverError(err, stage);
    } catch (alertError) {
      log.error('could not send the failure alert', {
        error: alertError instanceof Error ? alertError.message : String(alertError),
      });
    }
    return 1;
  }
}
