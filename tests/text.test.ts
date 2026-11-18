import { describe, expect, test } from 'vitest';
import { containsTerm, htmlToText, matchingTerms } from '../src/util/text.js';

describe('htmlToText', () => {
  test('decodes the entity-encoded html that greenhouse returns', () => {
    expect(htmlToText('&lt;p&gt;We use Node.js&lt;/p&gt;')).toBe('We use Node.js');
  });

  test('strips tags from plain html', () => {
    expect(htmlToText('<p>Hello <strong>world</strong></p>')).toBe('Hello world');
  });

  test('turns block ends and <br> into newlines', () => {
    expect(htmlToText('<p>One</p><p>Two</p>')).toBe('One\nTwo');
    expect(htmlToText('One<br/>Two')).toBe('One\nTwo');
  });

  test('decodes numeric and named entities', () => {
    expect(htmlToText('Caf&#233; &amp; bar &#x2014; open')).toBe('Café & bar — open');
  });

  test('drops script and style contents', () => {
    expect(htmlToText('<p>Keep</p><script>var x = 1;</script><style>p{color:red}</style>')).toBe(
      'Keep',
    );
  });

  test('collapses runs of whitespace and non-breaking spaces', () => {
    expect(htmlToText('<p>a&nbsp;&nbsp;  b</p>')).toBe('a b');
  });

  test('returns null for null, undefined and empty input', () => {
    expect(htmlToText(null)).toBeNull();
    expect(htmlToText(undefined)).toBeNull();
    expect(htmlToText('')).toBeNull();
  });

  test('does not mistake a literal less-than in text for a tag after decoding', () => {
    expect(htmlToText('&lt;p&gt;5 &amp;lt; 10&lt;/p&gt;')).toBe('5 < 10');
  });
});

describe('containsTerm', () => {
  test('matches case-insensitively on whole words', () => {
    expect(containsTerm('Senior BACKEND Engineer', 'backend')).toBe(true);
  });

  test('does not match inside a longer word', () => {
    expect(containsTerm('nodemon config', 'node')).toBe(false);
    expect(containsTerm('work remotely', 'remote')).toBe(false);
  });

  test('matches terms containing punctuation', () => {
    expect(containsTerm('We use Node.js daily', 'node.js')).toBe(true);
    expect(containsTerm('A back-end role', 'back-end')).toBe(true);
  });

  test('matches multi-word terms', () => {
    expect(containsTerm('Software Engineer, Platform', 'software engineer')).toBe(true);
  });

  test('is false for null or empty input', () => {
    expect(containsTerm(null, 'node')).toBe(false);
    expect(containsTerm('node', '')).toBe(false);
  });
});

describe('matchingTerms', () => {
  test('returns every term found, in the order the terms were given', () => {
    expect(
      matchingTerms('Backend Engineer using Node.js and TypeScript', [
        'typescript',
        'node.js',
        'rust',
      ]),
    ).toEqual(['typescript', 'node.js']);
  });

  test('returns an empty list when nothing matches', () => {
    expect(matchingTerms('Designer', ['node'])).toEqual([]);
  });
});
