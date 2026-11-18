import { existsSync, readFileSync } from 'node:fs';
import type { SponsorshipVerdict } from './types.js';

/**
 * Patterns that mean the employer will sponsor.
 *
 * Patterns rather than substrings, because the negated forms interleave words
 * ("cannot offer *visa* sponsorship"), and a plain substring check for
 * "visa sponsorship" reads those as a yes.
 */
const POSITIVE: RegExp[] = [
  /\b(visa|work|immigration)\s+sponsorship\b/,
  /\bsponsorship\s+(is\s+)?(available|offered|provided|possible)\b/,
  /\b(we|they)\s+(can|do|will|would)\s+sponsor\b/,
  /\b(happy|able|willing|open)\s+to\s+sponsor\b/,
  /\b(can|do|will)\s+(offer|provide)\s+(visa\s+)?sponsorship\b/,
  /\bsponsor\s+(your|a|the)\s+(visa|work\s+permit)\b/,
  /\bskilled\s+worker\s+visa\b/,
  /\btier\s*2\s+visa\b/,
  /\brelocation\s+(support|package|assistance|allowance)\b/,
  /\bvisa\s+support\b/,
  /\bwe\s+sponsor\b/,
];

/**
 * Patterns that mean the employer will not sponsor. Checked first and allowed
 * to win, because a posting that mentions both ("Visa sponsorship: we are
 * unable to sponsor") is saying no.
 */
const NEGATIVE: RegExp[] = [
  // A negation followed, within one clause, by "sponsor"/"sponsorship":
  // catches "cannot offer visa sponsorship", "are unable to sponsor", etc.
  /\b(cannot|can\s?not|can't|could\s+not|couldn't|won't|will\s+not|unable|not\s+able|not\s+in\s+a\s+position|do\s+not|don't|does\s+not|doesn't|no\s+longer)\b[^.!?]{0,40}?\bsponsor(ship|ing)?\b/,
  /\bsponsorship\s+is\s+(not|un)\s*available\b/,
  /\bno\s+(visa\s+|work\s+)?sponsorship\b/,
  /\bwithout\s+(visa\s+)?sponsorship\b/,
  /\bnot\s+eligible\s+for\s+(visa\s+)?sponsorship\b/,
  /\bnot\s+offering\s+(visa\s+)?sponsorship\b/,
  /\bmust\s+(already\s+)?have\s+the\s+right\s+to\s+work\b/,
  /\b(existing|current)\s+right\s+to\s+work\b/,
  /\balready\s+have\s+the\s+right\s+to\s+work\b/,
  /\bmust\s+(already\s+)?be\s+(eligible|authorised|authorized)\s+to\s+work\b/,
  /\b(unable|not\s+able)\s+to\s+support\s+visa\b/,
];

const matchesAny = (haystack: string, patterns: RegExp[]): boolean =>
  patterns.some((pattern) => pattern.test(haystack));

/**
 * Whether the posting says it sponsors visas.
 *
 * Takes several text fields (title, description, snippet) because the
 * statement can live in any of them.
 */
export function detectSponsorship(...texts: (string | null | undefined)[]): SponsorshipVerdict {
  const haystack = texts
    .filter((t): t is string => Boolean(t))
    .join('\n')
    .toLowerCase()
    .replace(/\s+/g, ' ');
  if (!haystack) return 'unknown';

  if (matchesAny(haystack, NEGATIVE)) return 'no';
  if (matchesAny(haystack, POSITIVE)) return 'yes';
  return 'unknown';
}

/**
 * Legal-entity suffixes only. Descriptive words such as "uk", "group" or
 * "holdings" are left alone: they can distinguish two real entities, and the
 * prefix matching below already bridges "form3" to "form3 financial cloud uk".
 */
const SUFFIXES = [
  'ltd',
  'limited',
  'plc',
  'llp',
  'llc',
  'inc',
  'incorporated',
  'corp',
  'corporation',
];

/** Lowercase, punctuation-free, legal-suffix-free form of a company name. */
export function normalizeCompanyName(name: string): string {
  let out = name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  // Strip trailing suffixes repeatedly: "Form3 Financial Cloud (UK) Limited".
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of SUFFIXES) {
      if (out.endsWith(` ${suffix}`)) {
        out = out.slice(0, -(suffix.length + 1)).trim();
        changed = true;
      }
    }
  }
  return out.replace(/\s+/g, ' ').trim();
}

export type SponsorIndex = {
  /** Normalized registered names. */
  names: Set<string>;
  /** First word of each registered name, for prefix matching board slugs. */
  firstWords: Map<string, string[]>;
};

export function buildSponsorIndex(registeredNames: string[]): SponsorIndex {
  const names = new Set<string>();
  const firstWords = new Map<string, string[]>();

  for (const raw of registeredNames) {
    const normalized = normalizeCompanyName(raw);
    if (!normalized) continue;
    names.add(normalized);
    const first = normalized.split(' ')[0];
    if (first) {
      const list = firstWords.get(first) ?? [];
      list.push(normalized);
      firstWords.set(first, list);
    }
  }

  return { names, firstWords };
}

/** Shortest fragment allowed to match, so "W" does not match "Wise Payments". */
const MIN_MATCH_LENGTH = 3;

/**
 * Fuzzy match of a job's company (often an ATS slug like "form3") against the
 * Home Office register. Deliberately conservative: it is a +2 scoring hint,
 * not a filter, so a false positive is cheap but should still be rare.
 */
export function isLicensedSponsor(company: string, index: SponsorIndex): boolean {
  const name = normalizeCompanyName(company);
  if (name.length < MIN_MATCH_LENGTH) return false;
  if (index.names.has(name)) return true;

  const first = name.split(' ')[0] ?? name;
  if (first.length < MIN_MATCH_LENGTH) return false;

  // "monzo" should match "monzo bank", and "monzo bank" should match "monzo".
  for (const candidate of index.firstWords.get(first) ?? []) {
    if (
      candidate === name ||
      candidate.startsWith(`${name} `) ||
      name.startsWith(`${candidate} `)
    ) {
      return true;
    }
  }
  return false;
}

/** Headings the Home Office CSV has used for the organisation name. */
const NAME_COLUMNS = ['organisation name', 'organisation', 'name', 'sponsor name'];

/** CSV field splitter that respects quoted fields containing commas. */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields.map((f) => f.trim());
}

/** Organisation names from the Home Office register CSV. */
export function parseSponsorCsv(csv: string): string[] {
  const lines = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];

  const header = splitCsvLine(lines[0]!).map((h) => h.toLowerCase());
  let column = header.findIndex((h) => NAME_COLUMNS.includes(h));
  if (column === -1) column = header.findIndex((h) => h.includes('name'));
  if (column === -1) column = 0;

  return lines
    .slice(1)
    .map((line) => splitCsvLine(line)[column] ?? '')
    .filter((name) => name.length > 0);
}

/**
 * Load the register from disk, or null when it is not there.
 *
 * A missing file is not an error: the register is an optional enrichment the
 * user downloads by hand with `npm run update-sponsors`.
 */
export function loadSponsorIndex(path: string): SponsorIndex | null {
  if (!existsSync(path)) return null;
  try {
    const names = parseSponsorCsv(readFileSync(path, 'utf8'));
    return names.length > 0 ? buildSponsorIndex(names) : null;
  } catch {
    return null;
  }
}
