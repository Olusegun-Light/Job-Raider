import { describe, expect, test } from 'vitest';
import { chooseDeliverer } from '../src/deliver/index.js';
import { parseArgs } from '../src/cli.js';
import { createLogger } from '../src/util/log.js';

const log = createLogger({ level: 'error', sink: () => {} });
const creds = { logLevel: 'info' as const, telegramBotToken: 't', telegramChatId: '1' };

describe('chooseDeliverer', () => {
  test('prints to the console on a dry run even when telegram is configured', () => {
    expect(chooseDeliverer(parseArgs(['--dry-run']), creds, log).name).toBe('console');
  });

  test('sends to telegram on a real run when both credentials are present', () => {
    expect(chooseDeliverer(parseArgs([]), creds, log).name).toBe('telegram');
  });

  test('refuses a real run with no telegram credentials, rather than silently printing', () => {
    expect(() => chooseDeliverer(parseArgs([]), { logLevel: 'info' }, log)).toThrow(
      /TELEGRAM_BOT_TOKEN/,
    );
  });

  test('names the missing variable when only the chat id is absent', () => {
    expect(() =>
      chooseDeliverer(parseArgs([]), { logLevel: 'info', telegramBotToken: 't' }, log),
    ).toThrow(/TELEGRAM_CHAT_ID/);
  });

  test('suggests --dry-run in the error, since that is the way to run without credentials', () => {
    expect(() => chooseDeliverer(parseArgs([]), { logLevel: 'info' }, log)).toThrow(/--dry-run/);
  });
});
