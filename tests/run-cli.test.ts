import { describe, expect, test } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from '../src/run.js';
import type { Deliverer, RunStats, ScoredJob } from '../src/types.js';

function recorder(): Deliverer & { errors: { error: Error; context: string }[]; digests: number } {
  const rec = {
    name: 'recorder',
    errors: [] as { error: Error; context: string }[],
    digests: 0,
    async deliver(_jobs: ScoredJob[], _stats: RunStats) {
      rec.digests += 1;
    },
    async deliverError(error: Error, context: string) {
      rec.errors.push({ error, context });
    },
  };
  return rec;
}

const GOOD_CONFIG = {
  'queries.yaml': 'queries:\n  - name: q\n    q: backend\n    gl: uk\n',
  'companies.yaml': 'greenhouse: []\nlever: []\nashby: []\n',
  'rules.yaml':
    'titleInclude: [backend]\nmustMatchAny: [node]\nlocationTargets:\n  uk: [london]\n  remote: [remote]\n  lagos: [lagos]\n',
};

function configDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'job-radar-run-'));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
}

function dataPaths() {
  const dir = mkdtempSync(join(tmpdir(), 'job-radar-run-data-'));
  return { seenPath: join(dir, 'seen.json'), discoveredPath: join(dir, 'discovered.json') };
}

describe('runCli error alerting', () => {
  test('alerts when a config file is unreadable, rather than dying silently', async () => {
    const deliverer = recorder();

    const code = await runCli(['--source=greenhouse'], {
      configDir: configDir({ ...GOOD_CONFIG, 'queries.yaml': 'queries: [ unclosed' }),
      deliverer,
      env: { TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: '1', LOG_LEVEL: 'error' },
      ...dataPaths(),
    });

    expect(code).toBe(1);
    expect(deliverer.errors).toHaveLength(1);
    expect(deliverer.errors[0]!.error.message).toMatch(/queries\.yaml/);
  });

  test('names the configuration stage in the alert it sends', async () => {
    const deliverer = recorder();

    await runCli([], {
      configDir: configDir({ ...GOOD_CONFIG, 'rules.yaml': 'titleInclude: []\n' }),
      deliverer,
      env: { TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: '1', LOG_LEVEL: 'error' },
      ...dataPaths(),
    });

    expect(deliverer.errors[0]!.context).toMatch(/config/i);
  });

  test('returns 0 and delivers once on a healthy run', async () => {
    const deliverer = recorder();

    const code = await runCli(['--source=greenhouse'], {
      configDir: configDir(GOOD_CONFIG),
      deliverer,
      env: { TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: '1', LOG_LEVEL: 'error' },
      ...dataPaths(),
    });

    expect(code).toBe(0);
    expect(deliverer.digests).toBe(1);
    expect(deliverer.errors).toEqual([]);
  });

  test('prints usage and exits 0 for --help', async () => {
    const deliverer = recorder();

    const code = await runCli(['--help'], {
      configDir: configDir(GOOD_CONFIG),
      deliverer,
      env: { LOG_LEVEL: 'error' },
      ...dataPaths(),
    });

    expect(code).toBe(0);
    expect(deliverer.digests).toBe(0);
  });

  test('alerts when an unknown flag is passed, so a typo in CI is visible', async () => {
    const deliverer = recorder();

    const code = await runCli(['--dryrun'], {
      configDir: configDir(GOOD_CONFIG),
      deliverer,
      env: { TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: '1', LOG_LEVEL: 'error' },
      ...dataPaths(),
    });

    expect(code).toBe(1);
    expect(deliverer.errors[0]!.error.message).toMatch(/--dryrun/);
  });
});
