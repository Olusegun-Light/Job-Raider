import { describe, expect, test } from 'vitest';
import { extractSponsorCsvUrl } from '../src/sponsorship.js';

// Shaped like the gov.uk publication page's attachment markup.
const PAGE = `
<html><body>
<h1>Register of licensed sponsors: workers</h1>
<section class="attachment">
  <h2><a href="https://assets.publishing.service.gov.uk/media/6af59528cc0dbfec767a5080/SP_-_Worker_and_Temporary_Worker_Web_Register_-_2026-11-12.csv">Register of Worker and Temporary Worker licensed sponsors</a></h2>
  <p>CSV, 10.4 MB</p>
  <a href="/csv-preview/6af59528cc0dbfec767a5080/SP_-_Worker_and_Temporary_Worker_Web_Register_-_2026-11-12.csv">View online</a>
</section>
</body></html>`;

describe('extractSponsorCsvUrl', () => {
  test('finds the assets.publishing csv link on the publication page', () => {
    expect(extractSponsorCsvUrl(PAGE)).toBe(
      'https://assets.publishing.service.gov.uk/media/6af59528cc0dbfec767a5080/SP_-_Worker_and_Temporary_Worker_Web_Register_-_2026-11-12.csv',
    );
  });

  test('ignores the relative csv-preview link, which is not a download', () => {
    expect(extractSponsorCsvUrl(PAGE)).not.toContain('csv-preview');
  });

  test('picks the register csv when the page also links unrelated csv files', () => {
    const page = `
      <a href="https://assets.publishing.service.gov.uk/media/aaa/Some_Other_Stats_-_2026-01-01.csv">Other</a>
      ${PAGE}`;
    expect(extractSponsorCsvUrl(page)).toContain('Worker_and_Temporary_Worker');
  });

  test('handles single-quoted and escaped attribute markup', () => {
    const page = `<a href='https://assets.publishing.service.gov.uk/media/x/SP_-_Worker_and_Temporary_Worker_Web_Register_-_2026-11-12.csv'>x</a>`;
    expect(extractSponsorCsvUrl(page)).toMatch(/\.csv$/);
  });

  test('returns null when the page has no csv attachment at all', () => {
    expect(extractSponsorCsvUrl('<html><body>nothing here</body></html>')).toBeNull();
  });

  test('returns null rather than a non-csv asset link', () => {
    const page = `<a href="https://assets.publishing.service.gov.uk/media/x/guidance.pdf">PDF</a>`;
    expect(extractSponsorCsvUrl(page)).toBeNull();
  });
});
