import type { CliOptions } from '../cli.js';
import type { Env } from '../config.js';
import type { Logger } from '../util/log.js';
import type { Deliverer } from '../types.js';
import { createConsoleDeliverer } from './console.js';
import { createTelegramDeliverer } from './telegram.js';

/**
 * Pick where the digest goes.
 *
 * A real run with no Telegram credentials is an error rather than a quiet
 * fall back to the console: the run would look successful in CI while no
 * digest ever arrived, and `seen.json` would still be updated, so those jobs
 * would never be reported again.
 */
export function chooseDeliverer(options: CliOptions, env: Env, log: Logger): Deliverer {
  if (options.dryRun) return createConsoleDeliverer();

  const missing = [
    env.telegramBotToken ? null : 'TELEGRAM_BOT_TOKEN',
    env.telegramChatId ? null : 'TELEGRAM_CHAT_ID',
  ].filter((name): name is string => name !== null);

  if (missing.length > 0) {
    throw new Error(
      `cannot deliver: ${missing.join(' and ')} not set. Set them, or use --dry-run to print to the console instead.`,
    );
  }

  return createTelegramDeliverer({
    botToken: env.telegramBotToken!,
    chatId: env.telegramChatId!,
    log,
  });
}
