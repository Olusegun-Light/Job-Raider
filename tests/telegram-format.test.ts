import { describe, expect, test } from 'vitest';
import {
  TELEGRAM_LIMIT,
  escapeHtml,
  formatJobBlock,
  formatRelativeAge,
  renderTelegramMessages,
} from '../src/deliver/telegram.js';
import { makeScoredJob, makeStats } from './helpers.js';

const now = new Date('2026-11-18T12:00:00.000Z');
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();

describe('escapeHtml', () => {
  test('escapes the three characters telegram HTML mode reserves', () => {
    expect(escapeHtml('a < b > c & d')).toBe('a &lt; b &gt; c &amp; d');
  });

  test('escapes ampersands before angle brackets, so entities are not doubled', () => {
    expect(escapeHtml('<b>')).toBe('&lt;b&gt;');
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });

  test('leaves ordinary text alone', () => {
    expect(escapeHtml('Backend Engineer (Node.js)')).toBe('Backend Engineer (Node.js)');
  });

  test('escapes a title that contains markup, so the message cannot break', () => {
    expect(escapeHtml('Engineer <script>alert(1)</script>')).not.toContain('<script>');
  });
});

describe('formatRelativeAge', () => {
  test.each([
    [0.5, 'just now'],
    [1, '1h ago'],
    [6, '6h ago'],
    [23, '23h ago'],
    [24, '1d ago'],
    [49, '2d ago'],
  ])('renders %s hours ago as %s', (hours, expected) => {
    expect(formatRelativeAge(hoursAgo(hours), now)).toBe(expected);
  });

  test('says nothing when the posting date is unknown', () => {
    expect(formatRelativeAge(null, now)).toBeNull();
  });
});

describe('formatJobBlock', () => {
  const job = makeScoredJob({
    title: 'Backend Engineer (Node.js)',
    company: 'Monzo',
    location: 'London, UK',
    sponsorship: 'yes',
    score: 12,
    url: 'https://boards.greenhouse.io/monzo/jobs/1',
    source: 'greenhouse',
    postedAt: hoursAgo(6),
  });

  test('renders the plan’s three-line job block', () => {
    const block = formatJobBlock(job, now);
    expect(block).toContain('🟢 <b>Backend Engineer (Node.js)</b> — Monzo');
    expect(block).toContain('📍 London, UK');
    expect(block).toContain('🛂 Sponsorship: yes');
    expect(block).toContain('⭐ 12');
    expect(block).toContain('<a href="https://boards.greenhouse.io/monzo/jobs/1">Apply</a>');
    expect(block).toContain('greenhouse');
    expect(block).toContain('6h ago');
  });

  test('uses a white circle for unknown sponsorship', () => {
    expect(formatJobBlock(makeScoredJob({ sponsorship: 'unknown' }), now)).toContain('⚪');
  });

  test('adds the licensed-sponsor badge when the company is on the register', () => {
    expect(formatJobBlock(makeScoredJob({ ukSponsorLicensed: true }), now)).toContain('🏛️');
  });

  test('omits the badge when the company is not on the register', () => {
    expect(formatJobBlock(makeScoredJob({ ukSponsorLicensed: false }), now)).not.toContain('🏛️');
  });

  test('escapes the title and company so a stray angle bracket cannot break the message', () => {
    const block = formatJobBlock(makeScoredJob({ title: 'Engineer <b>', company: 'A & B' }), now);
    expect(block).toContain('Engineer &lt;b&gt;');
    expect(block).toContain('A &amp; B');
  });

  test('says the location is unknown rather than printing null', () => {
    expect(formatJobBlock(makeScoredJob({ location: null }), now)).not.toContain('null');
  });
});

describe('renderTelegramMessages', () => {
  test('puts the header on the first message', () => {
    const [first] = renderTelegramMessages(
      [makeScoredJob()],
      makeStats({ delivered: 1, scanned: 212 }),
      now,
    );
    expect(first).toMatch(/Job Radar/);
    expect(first).toMatch(/1 new/);
    expect(first).toMatch(/212 scanned/);
  });

  test('sends one short message when there are no new jobs, so the run is visibly alive', () => {
    const messages = renderTelegramMessages([], makeStats({ delivered: 0 }), now);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/No new matches today/i);
    expect(messages[0]!.length).toBeLessThan(200);
  });

  test('groups jobs into the four sections in order', () => {
    const messages = renderTelegramMessages(
      [
        makeScoredJob({ id: '1', bucket: 'other', title: 'O', url: 'https://x/1' }),
        makeScoredJob({ id: '2', bucket: 'lagos', title: 'L', url: 'https://x/2' }),
        makeScoredJob({ id: '3', bucket: 'remote', title: 'R', url: 'https://x/3' }),
        makeScoredJob({ id: '4', bucket: 'uk', title: 'U', url: 'https://x/4' }),
      ],
      makeStats({ delivered: 4 }),
      now,
    );
    const text = messages.join('\n');
    expect(text.indexOf('🇬🇧')).toBeLessThan(text.indexOf('🌍'));
    expect(text.indexOf('🌍')).toBeLessThan(text.indexOf('🇳🇬'));
    expect(text.indexOf('🇳🇬')).toBeLessThan(text.indexOf('Other'));
  });

  test('omits sections that have no jobs', () => {
    const messages = renderTelegramMessages(
      [makeScoredJob({ bucket: 'uk' })],
      makeStats({ delivered: 1 }),
      now,
    );
    expect(messages.join('\n')).not.toContain('🇳🇬');
  });

  test('keeps every message within telegram’s 4096 character limit', () => {
    const jobs = Array.from({ length: 60 }, (_, i) =>
      makeScoredJob({
        id: `job-${i}`,
        url: `https://boards.greenhouse.io/acme/jobs/${i}`,
        title: `Backend Engineer Number ${i} With A Fairly Long Title`,
        company: `Company Number ${i}`,
        location: 'London, United Kingdom (hybrid, 2 days in office)',
      }),
    );

    const messages = renderTelegramMessages(jobs, makeStats({ delivered: 60 }), now);

    expect(messages.length).toBeGreaterThan(1);
    for (const message of messages) expect(message.length).toBeLessThanOrEqual(TELEGRAM_LIMIT);
  });

  test('splits on job boundaries, never mid-job', () => {
    const jobs = Array.from({ length: 60 }, (_, i) =>
      makeScoredJob({
        id: `job-${i}`,
        url: `https://boards.greenhouse.io/acme/jobs/${i}`,
        title: `Backend Engineer Number ${i} With A Fairly Long Title`,
      }),
    );

    const messages = renderTelegramMessages(jobs, makeStats({ delivered: 60 }), now);

    for (const message of messages) {
      const opens = (message.match(/<b>/g) ?? []).length;
      const closes = (message.match(/<\/b>/g) ?? []).length;
      expect(opens).toBe(closes);
      const anchors = (message.match(/<a href=/g) ?? []).length;
      const anchorEnds = (message.match(/<\/a>/g) ?? []).length;
      expect(anchors).toBe(anchorEnds);
    }
  });

  test('includes every job across the split messages', () => {
    const jobs = Array.from({ length: 40 }, (_, i) =>
      makeScoredJob({
        id: `job-${i}`,
        url: `https://boards.greenhouse.io/acme/jobs/${i}`,
        title: `Backend Engineer Number ${i} With A Fairly Long Title Indeed`,
      }),
    );

    const text = renderTelegramMessages(jobs, makeStats({ delivered: 40 }), now).join('\n');

    for (let i = 0; i < 40; i += 1) expect(text).toContain(`Number ${i} `);
  });

  test('reports the serper credits used when the run spent any', () => {
    const messages = renderTelegramMessages(
      [makeScoredJob()],
      makeStats({ delivered: 1, serperCredits: 7 }),
      now,
    );
    expect(messages.join('\n')).toMatch(/7/);
  });

  test('escapes the ampersand inside the apply href', () => {
    const job = makeScoredJob({ url: 'https://jobs.example.com/apply?a=1&b=2' });
    expect(formatJobBlock(job, now)).toContain('?a=1&amp;b=2');
  });

  test('keeps HTML balanced when one job block would exceed the limit on its own', () => {
    // An absurd title must not produce a message with an unclosed tag:
    // Telegram answers 400 and the whole digest is lost.
    const job = makeScoredJob({ title: 'Backend Engineer '.repeat(400), company: 'A'.repeat(500) });

    for (const message of renderTelegramMessages([job], makeStats({ delivered: 1 }), now)) {
      expect(message.length).toBeLessThanOrEqual(TELEGRAM_LIMIT);
      expect((message.match(/<b>/g) ?? []).length).toBe((message.match(/<\/b>/g) ?? []).length);
      expect((message.match(/<a href=/g) ?? []).length).toBe(
        (message.match(/<\/a>/g) ?? []).length,
      );
    }
  });

  test('splits a single section that is itself too long for one message', () => {
    const jobs = Array.from({ length: 30 }, (_, i) =>
      makeScoredJob({
        id: `job-${i}`,
        bucket: 'uk',
        url: `https://boards.greenhouse.io/acme/jobs/${i}`,
        title: `Senior Backend Engineer, Platform and Payments, Position ${i}`,
        company: `A Company With A Long Name ${i}`,
      }),
    );

    const messages = renderTelegramMessages(jobs, makeStats({ delivered: 30 }), now);

    expect(messages.length).toBeGreaterThan(1);
    for (const message of messages) expect(message.length).toBeLessThanOrEqual(TELEGRAM_LIMIT);
  });
});
