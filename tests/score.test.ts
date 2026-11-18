import { describe, expect, test } from 'vitest';
import { scoreJob } from '../src/score.js';
import type { RulesConfig } from '../src/config.js';
import { makeJob } from './helpers.js';

const rules: RulesConfig = {
  titleInclude: ['backend'],
  titleExclude: [],
  mustMatchAny: ['node', 'node.js', 'typescript'],
  locationTargets: {
    uk: ['uk', 'london'],
    remote: ['remote', 'emea', 'europe', 'anywhere', 'worldwide', 'africa', 'nigeria'],
    lagos: ['lagos', 'nigeria'],
  },
  maxAgeHours: 48,
  minScore: 4,
  weights: {
    titleBackend: 3,
    titleNodeTs: 3,
    descriptionNodeTs: 2,
    sponsorshipYes: 4,
    ukSponsorLicensed: 2,
    remoteOpen: 3,
    domainMatch: 1,
    domainMatchMax: 2,
    postedLast24h: 1,
  },
  domains: ['fintech', 'payments', 'health', 'telecom'],
};

const now = new Date('2026-11-18T12:00:00.000Z');
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
const bare = {
  title: 'Engineer',
  description: null,
  snippet: null,
  location: 'Tokyo',
  remote: false,
  postedAt: null,
  sponsorship: 'unknown' as const,
  ukSponsorLicensed: null,
};

describe('scoreJob', () => {
  test('scores a bare job that signals nothing at zero', () => {
    expect(scoreJob(makeJob(bare), rules, now)).toBe(0);
  });

  test('adds 3 for backend in the title', () => {
    expect(scoreJob(makeJob({ ...bare, title: 'Backend Engineer' }), rules, now)).toBe(3);
  });

  test('counts back-end as backend in the title', () => {
    expect(scoreJob(makeJob({ ...bare, title: 'Back-End Engineer' }), rules, now)).toBe(3);
  });

  test('adds 3 for node or typescript in the title', () => {
    expect(scoreJob(makeJob({ ...bare, title: 'Engineer (Node.js)' }), rules, now)).toBe(3);
  });

  test('adds 2 for node or typescript in the description', () => {
    expect(scoreJob(makeJob({ ...bare, description: 'We use TypeScript' }), rules, now)).toBe(2);
  });

  test('does not double count the description bonus when the title already has it', () => {
    const job = makeJob({
      ...bare,
      title: 'Backend Engineer (Node.js)',
      description: 'Node.js all day',
    });
    expect(scoreJob(job, rules, now)).toBe(3 + 3 + 2);
  });

  test('adds 4 for confirmed sponsorship', () => {
    expect(scoreJob(makeJob({ ...bare, sponsorship: 'yes' }), rules, now)).toBe(4);
  });

  test('adds nothing for sponsorship unknown or no', () => {
    expect(scoreJob(makeJob({ ...bare, sponsorship: 'unknown' }), rules, now)).toBe(0);
    expect(scoreJob(makeJob({ ...bare, sponsorship: 'no' }), rules, now)).toBe(0);
  });

  test('adds 2 when the company is a licensed UK sponsor', () => {
    expect(scoreJob(makeJob({ ...bare, ukSponsorLicensed: true }), rules, now)).toBe(2);
  });

  test('adds 3 for a remote role open to EMEA, Africa or anywhere', () => {
    expect(
      scoreJob(makeJob({ ...bare, location: 'Remote (EMEA)', remote: true }), rules, now),
    ).toBe(3);
  });

  test('does not add the remote bonus for a UK-only remote role', () => {
    expect(
      scoreJob(makeJob({ ...bare, location: 'Remote - London, UK', remote: true }), rules, now),
    ).toBe(0);
  });

  test('adds 1 per domain match, capped at 2', () => {
    const one = makeJob({ ...bare, description: 'A fintech company' });
    const three = makeJob({ ...bare, description: 'fintech payments health telecom' });
    expect(scoreJob(one, rules, now)).toBe(1);
    expect(scoreJob(three, rules, now)).toBe(2);
  });

  test('adds 1 when posted in the last 24 hours', () => {
    expect(scoreJob(makeJob({ ...bare, postedAt: hoursAgo(5) }), rules, now)).toBe(1);
  });

  test('adds nothing for a job posted 30 hours ago', () => {
    expect(scoreJob(makeJob({ ...bare, postedAt: hoursAgo(30) }), rules, now)).toBe(0);
  });

  test('treats senior in the title as neutral', () => {
    const plain = makeJob({ ...bare, title: 'Backend Engineer' });
    const senior = makeJob({ ...bare, title: 'Senior Backend Engineer' });
    expect(scoreJob(senior, rules, now)).toBe(scoreJob(plain, rules, now));
  });

  test('scores an ideal UK sponsored Node role high', () => {
    const job = makeJob({
      title: 'Senior Backend Engineer (Node.js)',
      description:
        'TypeScript services for payments and fintech. Skilled worker visa sponsorship available.',
      location: 'London, UK',
      remote: false,
      sponsorship: 'yes',
      ukSponsorLicensed: true,
      postedAt: hoursAgo(3),
    });
    // backend 3 + node title 3 + node desc 2 + sponsor 4 + licensed 2 + domains 2 + fresh 1
    expect(scoreJob(job, rules, now)).toBe(17);
  });

  test('takes the open-remote terms from rules.yaml rather than a hardcoded list', () => {
    const custom = {
      ...rules,
      locationTargets: { ...rules.locationTargets, remote: ['remote', 'latam'] },
    };
    const job = makeJob({ ...bare, location: 'Remote (LATAM)', remote: true });

    expect(scoreJob(job, custom, now)).toBe(3);
  });

  test('does not score a bare "remote" as open beyond the UK', () => {
    // "Remote" alone says nothing about which countries are eligible.
    expect(scoreJob(makeJob({ ...bare, location: 'Remote', remote: true }), rules, now)).toBe(0);
  });

  test('uses the snippet in place of the description for serper jobs', () => {
    const job = makeJob({
      ...bare,
      source: 'serper',
      description: null,
      snippet: 'We use Node.js',
    });
    expect(scoreJob(job, rules, now)).toBe(2);
  });
});
