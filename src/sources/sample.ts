import type { Source } from './index.js';
import type { Job } from '../types.js';

/**
 * Hardcoded jobs so the pipeline and the console digest can be exercised
 * without network access or API keys (`--sample`). Not a real source: it is
 * never part of `allSources()`.
 */
const SAMPLE: Job[] = [
  {
    id: 'sample-1',
    title: 'Senior Backend Engineer (Node.js)',
    company: 'Monzo',
    url: 'https://boards.greenhouse.io/monzo/jobs/4100001',
    location: 'London, UK',
    remote: false,
    postedAt: null,
    source: 'greenhouse',
    description:
      'We build our banking platform on Node.js and TypeScript. Skilled worker visa sponsorship available.',
    snippet: null,
    sponsorship: 'yes',
    ukSponsorLicensed: true,
    score: 13,
    matchedKeywords: ['backend', 'node.js', 'typescript', 'visa sponsorship'],
  },
  {
    id: 'sample-2',
    title: 'Backend Engineer, Payments',
    company: 'Paystack',
    url: 'https://jobs.lever.co/paystack/0000-aaaa',
    location: 'Lagos, Nigeria',
    remote: false,
    postedAt: null,
    source: 'lever',
    description: 'TypeScript and Node.js services for payments across Africa.',
    snippet: null,
    sponsorship: 'unknown',
    ukSponsorLicensed: null,
    score: 8,
    matchedKeywords: ['backend', 'typescript', 'payments'],
  },
  {
    id: 'sample-3',
    title: 'Backend Engineer (Remote, EMEA)',
    company: 'Deel',
    url: 'https://jobs.ashbyhq.com/deel/abc-123',
    location: 'Remote (EMEA)',
    remote: true,
    postedAt: null,
    source: 'ashby',
    description: 'Node.js, NestJS, Postgres. Open to candidates anywhere in EMEA.',
    snippet: null,
    sponsorship: 'unknown',
    ukSponsorLicensed: null,
    score: 9,
    matchedKeywords: ['backend', 'node.js', 'nestjs'],
  },
  {
    id: 'sample-4',
    title: 'Software Engineer, Platform',
    company: 'Babylon Health',
    url: 'https://boards.greenhouse.io/babylonhealth/jobs/5500002',
    location: 'Manchester, England',
    remote: true,
    postedAt: null,
    source: 'serper',
    description: null,
    snippet: 'Node.js/TypeScript platform team. We cannot offer visa sponsorship for this role.',
    sponsorship: 'no',
    ukSponsorLicensed: true,
    score: 5,
    matchedKeywords: ['software engineer', 'node.js'],
  },
];

export function sampleSource(): Source {
  return {
    name: 'greenhouse',
    async fetch({ now }) {
      // Stamp "posted" times relative to the run so the age window behaves.
      const jobs = SAMPLE.map((job, i) => ({
        ...job,
        postedAt: new Date(now.getTime() - (i + 1) * 5 * 3600_000).toISOString(),
      }));
      return { jobs, errors: [] };
    },
  };
}
