import type { LogLevel } from '../config.js';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export type Fields = Record<string, unknown>;

export type Logger = {
  level: LogLevel;
  debug(msg: string, fields?: Fields): void;
  info(msg: string, fields?: Fields): void;
  warn(msg: string, fields?: Fields): void;
  error(msg: string, fields?: Fields): void;
};

function render(fields: Fields | undefined): string {
  if (!fields) return '';
  const parts = Object.entries(fields)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`);
  return parts.length > 0 ? ` ${parts.join(' ')}` : '';
}

export function createLogger(opts: { level: LogLevel; sink?: (line: string) => void }): Logger {
  const sink = opts.sink ?? ((line: string) => console.log(line));
  const threshold = ORDER[opts.level];

  const emit = (level: LogLevel) => (msg: string, fields?: Fields) => {
    if (ORDER[level] < threshold) return;
    const stamp = new Date().toISOString().slice(11, 19);
    sink(`${stamp} ${level.toUpperCase()} ${msg}${render(fields)}`);
  };

  return {
    level: opts.level,
    debug: emit('debug'),
    info: emit('info'),
    warn: emit('warn'),
    error: emit('error'),
  };
}
