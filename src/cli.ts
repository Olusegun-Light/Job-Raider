import type { SourceName } from './types.js';

export const ALL_SOURCES: SourceName[] = ['serper', 'greenhouse', 'lever', 'ashby'];

export type TimeWindow = 'day' | 'week';

export type CliOptions = {
  dryRun: boolean;
  window: TimeWindow;
  sources: SourceName[];
  keepNoSponsor: boolean;
  /** Overrides rules.yaml minScore when given. */
  minScore: number | undefined;
};

export const USAGE = `job-radar

  npm run jobs                       full run: deliver to Telegram, update seen.json
  npm run jobs -- --dry-run          print to console, no Telegram, no state write
  npm run jobs -- --source=a,b       limit sources (${ALL_SOURCES.join(', ')})
  npm run jobs -- --window=week      widen the window (first run / catch-up)
  npm run jobs -- --keep-no-sponsor  keep UK jobs that say they cannot sponsor
  npm run jobs -- --min-score=6      override the rules.yaml minScore
  npm run jobs -- --help`;

export function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    dryRun: false,
    window: 'day',
    sources: [...ALL_SOURCES],
    keepNoSponsor: false,
    minScore: undefined,
  };

  for (const arg of argv) {
    const [flag, rawValue] = arg.includes('=')
      ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)]
      : [arg, undefined];

    switch (flag) {
      case '--dry-run':
        opts.dryRun = true;
        break;

      case '--keep-no-sponsor':
        opts.keepNoSponsor = true;
        break;

      case '--window': {
        if (rawValue !== 'day' && rawValue !== 'week') {
          throw new Error(`--window must be "day" or "week" (got "${rawValue ?? ''}")`);
        }
        opts.window = rawValue;
        break;
      }

      case '--source': {
        const names = (rawValue ?? '')
          .split(',')
          .map((s) => s.trim().toLowerCase())
          .filter((s) => s.length > 0);
        if (names.length === 0) throw new Error('--source needs at least one source name');
        for (const name of names) {
          if (!ALL_SOURCES.includes(name as SourceName)) {
            throw new Error(`unknown source "${name}" (known: ${ALL_SOURCES.join(', ')})`);
          }
        }
        opts.sources = names as SourceName[];
        break;
      }

      case '--min-score': {
        const n = Number(rawValue);
        if (!Number.isFinite(n))
          throw new Error(`--min-score must be a number (got "${rawValue ?? ''}")`);
        opts.minScore = n;
        break;
      }

      default:
        throw new Error(`unknown flag "${flag}"\n\n${USAGE}`);
    }
  }

  return opts;
}
