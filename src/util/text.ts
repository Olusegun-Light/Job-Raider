/** Escape a term for use inside a RegExp. */
function escapeRe(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Whole-word, case-insensitive substring test.
 *
 * Word-boundary anchored so "remote" does not match inside "remotely" and
 * "node" does not match inside "nodemon", while still matching terms that
 * contain punctuation ("node.js", "back-end", "full stack").
 */
export function containsTerm(haystack: string | null | undefined, term: string): boolean {
  if (!haystack || !term) return false;
  const t = term.trim();
  if (!t) return false;
  // \b is useless next to a non-word char (e.g. the "+" in "c++"), so only
  // anchor the ends that actually start/end with a word character.
  const left = /^\w/.test(t) ? '\\b' : '';
  const right = /\w$/.test(t) ? '\\b' : '';
  return new RegExp(`${left}${escapeRe(t)}${right}`, 'i').test(haystack);
}

export function containsAnyTerm(haystack: string | null | undefined, terms: string[]): boolean {
  return terms.some((term) => containsTerm(haystack, term));
}

/** Every term from `terms` that appears in `haystack`, in the order given. */
export function matchingTerms(haystack: string | null | undefined, terms: string[]): string[] {
  return terms.filter((term) => containsTerm(haystack, term));
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
  hellip: '...',
  middot: '·',
  bull: '·',
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (m, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

/**
 * Decode HTML entities, then strip tags, to plain text.
 *
 * Greenhouse ships the body as entity-encoded HTML inside JSON, so the markup
 * only becomes markup after one decode pass; a literal `&lt;` in the decoded
 * text must survive as text rather than being read as a tag. So: decode once,
 * strip tags, then decode what is left.
 */
export function htmlToText(html: string | null | undefined): string | null {
  if (!html) return null;

  const looksEncoded = /&lt;|&gt;|&quot;|&#\d/.test(html) && !/<[a-z/][^>]*>/i.test(html);
  const markup = looksEncoded ? decodeEntities(html) : html;

  const stripped = markup
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|ul|ol|table)\s*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  const text = decodeEntities(stripped)
    .replace(/[ \t ]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text.length > 0 ? text : null;
}
