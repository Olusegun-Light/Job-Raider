#!/usr/bin/env node
import { join } from 'node:path';
import { parseArgs, USAGE } from './cli.js';
import { loadConfig, loadEnv } from './config.js';
import { createLogger } from './util/log.js';
import { runPipeline } from './pipeline.js';
import { allSources } from './sources/index.js';
import { sampleSource } from './sources/sample.js';
import { chooseDeliverer } from './deliver/index.js';
import { loadSponsorIndex } from './sponsorship.js';
import type { Deliverer } from './types.js';

async function main(argv: string[]): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE);
    return 0;
  }

  const options = parseArgs(argv.filter((a) => a !== '--sample'));
  const env = loadEnv();
  const log = createLogger({ level: env.logLevel });
  const config = loadConfig();

  let sources = allSources();
  if (sources.length === 0 || argv.includes('--sample')) {
    log.warn('using the hardcoded sample source (no live sources registered yet)');
    sources = [sampleSource()];
  }

  // Optional enrichment: absent until `npm run update-sponsors` is run.
  const sponsorPath = join(process.cwd(), 'data', 'uk-sponsors.csv');
  const sponsorIndex = loadSponsorIndex(sponsorPath);
  if (sponsorIndex) log.info('uk sponsor register loaded', { names: sponsorIndex.names.size });
  else log.debug('no uk sponsor register at data/uk-sponsors.csv; skipping that check');

  const deliverer: Deliverer = chooseDeliverer(options, env, log);
  log.debug('delivering via', { deliverer: deliverer.name });

  try {
    await runPipeline({
      sources,
      config,
      options,
      env,
      log,
      deliverer,
      now: new Date(),
      sponsorIndex,
    });
    return 0;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error('run failed', { error: err.message });
    // The alert matters more than the original failure's exit path, but a
    // failing alert must not mask the error that caused it.
    try {
      await deliverer.deliverError(err, 'pipeline');
    } catch (alertError) {
      log.error('could not send the failure alert', {
        error: alertError instanceof Error ? alertError.message : String(alertError),
      });
    }
    return 1;
  }
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
