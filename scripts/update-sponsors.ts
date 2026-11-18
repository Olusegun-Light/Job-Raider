#!/usr/bin/env node
/**
 * Download the Home Office "Register of licensed sponsors: workers" into
 * data/uk-sponsors.csv.
 *
 * gov.uk publishes no stable URL for the file, so the current link is read off
 * the publication page each time. Run this by hand every month or two.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { extractSponsorCsvUrl, parseSponsorCsv } from '../src/sponsorship.js';
import { USER_AGENT } from '../src/util/http.js';
import { createLogger } from '../src/util/log.js';

const PUBLICATION_PAGE =
  'https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers';

const OUTPUT = join(process.cwd(), 'data', 'uk-sponsors.csv');

async function main(): Promise<number> {
  const log = createLogger({ level: 'info' });

  log.info('finding the current register download', { page: PUBLICATION_PAGE });
  const pageResponse = await fetch(PUBLICATION_PAGE, {
    headers: { 'user-agent': USER_AGENT },
    signal: AbortSignal.timeout(30_000),
  });
  if (!pageResponse.ok) {
    log.error('could not load the gov.uk publication page', { status: pageResponse.status });
    return 1;
  }

  const csvUrl = extractSponsorCsvUrl(await pageResponse.text());
  if (!csvUrl) {
    log.error('no CSV attachment found on the publication page', {
      hint: 'gov.uk may have changed the page layout; check it by hand',
      page: PUBLICATION_PAGE,
    });
    return 1;
  }

  log.info('downloading the register', { url: csvUrl });
  const csvResponse = await fetch(csvUrl, {
    headers: { 'user-agent': USER_AGENT },
    signal: AbortSignal.timeout(180_000),
  });
  if (!csvResponse.ok) {
    log.error('register download failed', { status: csvResponse.status, url: csvUrl });
    return 1;
  }

  const csv = await csvResponse.text();
  const names = parseSponsorCsv(csv);
  if (names.length === 0) {
    log.error('the downloaded file parsed to zero organisation names; not overwriting', {
      bytes: csv.length,
      firstLine: csv.split('\n')[0]?.slice(0, 120),
    });
    return 1;
  }

  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, csv, 'utf8');
  log.info('register saved', {
    path: 'data/uk-sponsors.csv',
    organisations: names.length,
    mb: Math.round((csv.length / 1_048_576) * 10) / 10,
    sample: names.slice(0, 3).join(' | '),
  });
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
