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
