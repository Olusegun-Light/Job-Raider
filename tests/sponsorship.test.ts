import { describe, expect, test } from 'vitest';
import {
  detectSponsorship,
  normalizeCompanyName,
  buildSponsorIndex,
  isLicensedSponsor,
} from '../src/sponsorship.js';

describe('detectSponsorship', () => {
  test.each([
    'We offer visa sponsorship for this role',
    'We can sponsor your visa',
    'Skilled Worker visa available',
    'We are happy to sponsor the right candidate',
    'Relocation support and sponsorship available',
    'Sponsorship available for exceptional candidates',
  ])('reads "%s" as yes', (text) => {
    expect(detectSponsorship(text)).toBe('yes');
  });

  test.each([
    'Unfortunately we are unable to sponsor visas',
    'We cannot sponsor work visas at this time',
    'No sponsorship is available',
    'We are not able to offer sponsorship',
    'You must have the right to work in the UK',
    'Candidates need an existing right to work in the UK',
  ])('reads "%s" as no', (text) => {
    expect(detectSponsorship(text)).toBe('no');
  });

  test.each([
    'We cannot offer visa sponsorship for this role',
    'We are unable to offer visa sponsorship at this time',
    'We do not offer visa sponsorship',
    'Unfortunately we are not able to provide visa sponsorship',
    'We will not sponsor visas for this position',
    'No visa sponsorship is available for this role',
    'This role is not eligible for visa sponsorship',
    'Sponsorship is not available',
    'We are unable to support visa applications',
  ])('reads the negated form "%s" as no, not yes', (text) => {
    expect(detectSponsorship(text)).toBe('no');
  });

  test('returns unknown when the text says nothing about visas', () => {
    expect(detectSponsorship('We use Node.js and TypeScript')).toBe('unknown');
  });

  test('returns unknown for empty or missing text', () => {
    expect(detectSponsorship(null)).toBe('unknown');
    expect(detectSponsorship('')).toBe('unknown');
  });

  test('lets a negative phrase override a positive one in the same text', () => {
    const text = 'Visa sponsorship: we are unable to sponsor for this particular role.';
    expect(detectSponsorship(text)).toBe('no');
  });

  test('reads across several text fields, such as title and snippet', () => {
    expect(detectSponsorship('Backend Engineer', 'Skilled worker visa offered')).toBe('yes');
  });
});

describe('normalizeCompanyName', () => {
  test.each([
    ['Monzo Bank Ltd', 'monzo bank'],
    ['Wise Payments Limited', 'wise payments'],
    ['Starling Bank PLC', 'starling bank'],
    ['GoCardless Ltd.', 'gocardless'],
    ['Form3 Financial Cloud (UK) Limited', 'form3 financial cloud uk'],
    ['THE TRADE DESK LLP', 'the trade desk'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeCompanyName(input)).toBe(expected);
  });

  test('collapses punctuation and repeated whitespace', () => {
    expect(normalizeCompanyName('  A.C.M.E   Co.,  Ltd  ')).toBe('a c m e co');
  });
});

describe('isLicensedSponsor', () => {
  const index = buildSponsorIndex([
    'Monzo Bank Ltd',
    'Wise Payments Limited',
    'Form3 Financial Cloud (UK) Limited',
  ]);

  test('matches a company that is on the register', () => {
    expect(isLicensedSponsor('Monzo', index)).toBe(true);
  });

  test('matches despite a suffix difference', () => {
    expect(isLicensedSponsor('Monzo Bank', index)).toBe(true);
  });

  test('matches a board slug against the registered trading name', () => {
    expect(isLicensedSponsor('wise', index)).toBe(true);
    expect(isLicensedSponsor('form3', index)).toBe(true);
  });

  test('does not match a company that is absent', () => {
    expect(isLicensedSponsor('Revolut', index)).toBe(false);
  });

  test('does not match on a one-or-two letter fragment', () => {
    expect(isLicensedSponsor('W', index)).toBe(false);
  });

  test('returns false for an empty index, so a missing csv is simply skipped', () => {
    expect(isLicensedSponsor('Monzo', buildSponsorIndex([]))).toBe(false);
  });
});
