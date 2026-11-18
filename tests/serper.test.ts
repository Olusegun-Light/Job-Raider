import { describe, expect, test } from 'vitest';
import { companyFromUrl, parseSerperResponse, tbsForWindow } from '../src/sources/serper.js';

const response = {
  searchParameters: { q: 'backend engineer', gl: 'uk', type: 'search', engine: 'google' },
  organic: [
    {
      title: 'Backend Engineer (Node.js) - Monzo',
      link: 'https://job-boards.greenhouse.io/monzo/jobs/7343996?gh_src=abc',
      snippet: 'We use Node.js and TypeScript. Skilled worker visa sponsorship available.',
      date: '2 days ago',
      position: 1,
    },
    {
      title: 'Senior Backend Developer - Griffin',
      link: 'https://jobs.ashbyhq.com/griffin/fa9db3fd-9272-45ed-b48c-51f7e102c60a',
      snippet: 'London or remote within the UK. TypeScript services.',
      position: 2,
    },
    {
      title: 'Backend Engineer at Paystack',
      link: 'https://jobs.lever.co/paystack/0000-aaaa/apply',
      snippet: 'Lagos, Nigeria.',
      position: 3,
    },
  ],
  credits: 1,
};

describe('tbsForWindow', () => {
  test('uses a two-day window for a daily run, to survive a late cron', () => {
    // GitHub's scheduler runs minutes-to-an-hour late, so an exactly-24h
    // window leaves a permanent gap between consecutive runs. Dedupe absorbs
    // the overlap; a gap cannot be recovered.
    expect(tbsForWindow('day')).toBe('qdr:d2');
  });

  test('restricts to the past week for a catch-up run', () => {
    expect(tbsForWindow('week')).toBe('qdr:w');
  });
});

describe('companyFromUrl', () => {
  test('reads the company slug out of a greenhouse board url', () => {
    expect(companyFromUrl('https://job-boards.greenhouse.io/monzo/jobs/7343996')).toBe('monzo');
    expect(companyFromUrl('https://boards.greenhouse.io/wise/jobs/1')).toBe('wise');
  });

  test('reads the company slug out of a lever url', () => {
    expect(companyFromUrl('https://jobs.lever.co/paystack/0000-aaaa')).toBe('paystack');
  });

  test('reads the company slug out of an ashby url', () => {
    expect(companyFromUrl('https://jobs.ashbyhq.com/griffin/abc-123')).toBe('griffin');
  });

  test('reads the company slug out of a workable url', () => {
    expect(companyFromUrl('https://apply.workable.com/acme-ltd/j/ABC123/')).toBe('acme-ltd');
  });

  test('falls back to the hostname for an unknown job site', () => {
    expect(companyFromUrl('https://careers.somecorp.com/jobs/42')).toBe('careers.somecorp.com');
  });

  test('returns the raw input when it is not a url', () => {
    expect(companyFromUrl('garbage')).toBe('garbage');
  });
});

describe('parseSerperResponse', () => {
  const jobs = parseSerperResponse(response, 'uk-backend-node');

  test('maps every organic result to a job', () => {
    expect(jobs).toHaveLength(3);
  });

  test('marks the source as serper', () => {
    expect(jobs.every((j) => j.source === 'serper')).toBe(true);
  });

  test('puts the google snippet in snippet and leaves description null', () => {
    expect(jobs[0]!.snippet).toContain('Node.js');
    expect(jobs[0]!.description).toBeNull();
  });

  test('normalizes the url, stripping the gh_src tracking parameter', () => {
    expect(jobs[0]!.url).toBe('https://job-boards.greenhouse.io/monzo/jobs/7343996');
  });

  test('derives the company from the ATS url path', () => {
    expect(jobs.map((j) => j.company)).toEqual(['monzo', 'griffin', 'paystack']);
  });

  test('strips the trailing company suffix from a google result title', () => {
    expect(jobs[0]!.title).toBe('Backend Engineer (Node.js)');
    expect(jobs[1]!.title).toBe('Senior Backend Developer');
    expect(jobs[2]!.title).toBe('Backend Engineer');
  });

  test('leaves postedAt null because google relative dates are not reliable', () => {
    expect(jobs[0]!.postedAt).toBeNull();
  });

  test('leaves location and remote unknown, since a google result has neither', () => {
    expect(jobs[0]!.location).toBeNull();
    expect(jobs[0]!.remote).toBeNull();
  });

  test('gives each job the same id its ATS url would produce', () => {
    expect(jobs[0]!.id).toMatch(/^[0-9a-f]{16}$/);
  });

  test('tolerates a response with no organic results', () => {
    expect(parseSerperResponse({ organic: [], credits: 1 }, 'q')).toEqual([]);
  });

  test('tolerates a missing organic key entirely', () => {
    expect(parseSerperResponse({ credits: 1 }, 'q')).toEqual([]);
  });

  test('skips a result with no link rather than crashing the run', () => {
    const jobs = parseSerperResponse(
      { organic: [{ title: 'No link here', snippet: 's' }, response.organic[0]!], credits: 1 },
      'q',
    );
    expect(jobs).toHaveLength(1);
  });

  test('throws when the payload is not a serper response at all', () => {
    expect(() => parseSerperResponse('nope', 'q')).toThrow(/serper/i);
  });
});
