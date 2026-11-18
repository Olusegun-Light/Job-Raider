import { afterEach, describe, expect, test } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadDotEnv } from '../src/config.js';

const touched = ['JOB_RADAR_TEST_A', 'JOB_RADAR_TEST_B', 'LOG_LEVEL_TEST'];

afterEach(() => {
  for (const key of touched) delete process.env[key];
});

function envFile(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'job-radar-dotenv-'));
  const path = join(dir, '.env');
  writeFileSync(path, contents);
  return path;
}

describe('loadDotEnv', () => {
  test('puts the file’s values into process.env', () => {
    loadDotEnv(envFile('JOB_RADAR_TEST_A=hello\n'));

    expect(process.env.JOB_RADAR_TEST_A).toBe('hello');
  });

  test('reports that it loaded the file', () => {
    expect(loadDotEnv(envFile('JOB_RADAR_TEST_A=1\n'))).toBe(true);
  });

  test('does not override a variable already set in the real environment', () => {
    // A CI secret must win over a stale .env left in the working copy.
    process.env.JOB_RADAR_TEST_A = 'from-ci';

    loadDotEnv(envFile('JOB_RADAR_TEST_A=from-file\n'));

    expect(process.env.JOB_RADAR_TEST_A).toBe('from-ci');
  });

  test('returns false when there is no .env, which is the normal CI case', () => {
    expect(loadDotEnv(join(tmpdir(), 'definitely-absent-job-radar', '.env'))).toBe(false);
  });

  test('returns false for an empty .env rather than pretending it configured anything', () => {
    expect(loadDotEnv(envFile(''))).toBe(false);
  });

  test('ignores comments and blank lines', () => {
    loadDotEnv(envFile('# a comment\n\nJOB_RADAR_TEST_B=value\n'));

    expect(process.env.JOB_RADAR_TEST_B).toBe('value');
  });

  test('does not throw on a malformed file', () => {
    expect(() => loadDotEnv(envFile('this is not an assignment\n'))).not.toThrow();
  });
});
