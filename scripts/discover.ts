#!/usr/bin/env node
/**
 * Suggest ATS board slugs to add to config/companies.yaml, from the boards
 * Serper has surfaced on previous runs (data/discovered.json).
 *
 * Polling a board directly is better than finding it through Serper: it costs
 * no credits and returns real locations, posting dates and descriptions.
 */
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';
import { loadDiscovered, suggestSlugs } from '../src/discovered.js';

const STORE = join(process.cwd(), 'data', 'discovered.json');

function main(): number {
  const store = loadDiscovered(STORE);
  if (Object.keys(store).length === 0) {
    console.log(
      'Nothing discovered yet. data/discovered.json fills up as real (non-dry) runs\n' +
        'return ATS results from Serper, so run `npm run jobs` a few times first.',
    );
    return 0;
  }

  const { companies } = loadConfig();
  const suggestions = suggestSlugs(store, companies);

  if (suggestions.length === 0) {
    console.log(
      `All ${Object.keys(store).length} discovered boards are already in config/companies.yaml.`,
    );
    return 0;
  }

  console.log(`${suggestions.length} board(s) Serper found that you do not poll directly:\n`);
  for (const board of suggestions) {
    const seen = board.lastSeen.slice(0, 10);
    console.log(
      `  ${board.ats.padEnd(10)} ${board.slug.padEnd(24)} ${String(board.count).padStart(3)} hit(s), last seen ${seen}`,
    );
  }

  console.log(
    '\nTo poll them directly, add the slugs under the matching key in config/companies.yaml:',
  );
  for (const ats of ['greenhouse', 'lever', 'ashby'] as const) {
    const forAts = suggestions.filter((b) => b.ats === ats);
    if (forAts.length === 0) continue;
    console.log(`\n${ats}:`);
    for (const board of forAts) console.log(`  - ${board.slug}`);
  }
  console.log(
    '\nCheck a slug really exists before adding it; a dead slug logs a warning every run.',
  );
  return 0;
}

process.exit(main());
