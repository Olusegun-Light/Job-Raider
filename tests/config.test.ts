import { describe, expect, test } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, loadEnv } from '../src/config.js';

function configDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'job-radar-cfg-'));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
}

const VALID = {
  'queries.yaml': `queries:\n  - name: uk\n    q: backend node\n    gl: uk\n`,
  'companies.yaml': `greenhouse: [monzo]\nlever: []\nashby: []\n`,
  'rules.yaml': `titleInclude: [backend]
titleExclude: [intern]
mustMatchAny: [node]
locationTargets:
  uk: [london]
  remote: [remote]
  lagos: [lagos]
maxAgeHours: 48
minScore: 4
weights:
  titleBackend: 3
  titleNodeTs: 3
  descriptionNodeTs: 2
  sponsorshipYes: 4
  ukSponsorLicensed: 2
  remoteOpen: 3
  domainMatch: 1
  domainMatchMax: 2
  postedLast24h: 1
domains: [fintech]
`,
};

describe('loadConfig', () => {
  test('loads and validates the three yaml files', () => {
    const cfg = loadConfig({ configDir: configDir(VALID) });

    // num defaults to 10: Serper's free tier rejects num > 10 outright when a
    // query uses site: operators ("Query pattern not allowed for free
    // accounts"), and returns at most 10 results in any case.
    expect(cfg.queries).toEqual([{ name: 'uk', q: 'backend node', gl: 'uk', num: 10 }]);
    expect(cfg.companies.greenhouse).toEqual(['monzo']);
    expect(cfg.rules.maxAgeHours).toBe(48);
    expect(cfg.rules.weights.sponsorshipYes).toBe(4);
  });

  test('honours an explicit num, so a paid account can ask for more', () => {
    const files = {
      ...VALID,
      'queries.yaml': `queries:\n  - name: uk\n    q: backend\n    num: 20\n`,
    };

    expect(loadConfig({ configDir: configDir(files) }).queries[0]!.num).toBe(20);
  });

  test('rejects a query missing its q field with a readable error', () => {
    const files = { ...VALID, 'queries.yaml': `queries:\n  - name: uk\n    gl: uk\n` };

    expect(() => loadConfig({ configDir: configDir(files) })).toThrow(/queries\.yaml/);
  });

  test('rejects a negative maxAgeHours', () => {
    const files = {
      ...VALID,
      'rules.yaml': VALID['rules.yaml'].replace('maxAgeHours: 48', 'maxAgeHours: -1'),
    };

    expect(() => loadConfig({ configDir: configDir(files) })).toThrow(/rules\.yaml/);
  });

  test('defaults companies lists to empty when the keys are absent', () => {
    const files = { ...VALID, 'companies.yaml': `greenhouse: [monzo]\n` };

    const cfg = loadConfig({ configDir: configDir(files) });

    expect(cfg.companies.lever).toEqual([]);
    expect(cfg.companies.ashby).toEqual([]);
  });

  test('throws naming the missing file when a config file does not exist', () => {
    const files = { ...VALID };
    delete (files as Record<string, string>)['rules.yaml'];

    expect(() => loadConfig({ configDir: configDir(files) })).toThrow(/rules\.yaml/);
  });
});

describe('loadEnv', () => {
  test('returns the telegram and serper credentials when present', () => {
    const env = loadEnv({
      SERPER_API_KEY: 'k',
      TELEGRAM_BOT_TOKEN: 't',
      TELEGRAM_CHAT_ID: '123',
    });

    expect(env).toEqual({
      serperApiKey: 'k',
      telegramBotToken: 't',
      telegramChatId: '123',
      logLevel: 'info',
    });
  });

  test('treats blank credentials as absent rather than empty strings', () => {
    const env = loadEnv({ SERPER_API_KEY: '   ', TELEGRAM_BOT_TOKEN: '' });

    expect(env.serperApiKey).toBeUndefined();
    expect(env.telegramBotToken).toBeUndefined();
  });

  test('rejects an unknown log level', () => {
    expect(() => loadEnv({ LOG_LEVEL: 'chatty' })).toThrow(/LOG_LEVEL/);
  });
});
