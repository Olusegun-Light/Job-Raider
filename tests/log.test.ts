import { describe, expect, test, vi } from 'vitest';
import { createLogger } from '../src/util/log.js';

function capture() {
  const lines: string[] = [];
  return {
    lines,
    sink: (line: string) => {
      lines.push(line);
    },
  };
}

describe('createLogger', () => {
  test('suppresses messages below the configured level', () => {
    const { lines, sink } = capture();
    const log = createLogger({ level: 'warn', sink });

    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');

    expect(lines.map((l) => l.split(' ')[1])).toEqual(['WARN', 'ERROR']);
  });

  test('includes the level and the message text', () => {
    const { lines, sink } = capture();
    const log = createLogger({ level: 'info', sink });

    log.info('fetched 12 jobs');

    expect(lines[0]).toContain('INFO');
    expect(lines[0]).toContain('fetched 12 jobs');
  });

  test('appends structured fields as key=value pairs', () => {
    const { lines, sink } = capture();
    const log = createLogger({ level: 'info', sink });

    log.info('done', { source: 'lever', count: 3 });

    expect(lines[0]).toContain('source=lever');
    expect(lines[0]).toContain('count=3');
  });

  test('defaults to writing through console.log', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const log = createLogger({ level: 'info' });

    log.info('hello');

    expect(spy).toHaveBeenCalledOnce();
  });
});
