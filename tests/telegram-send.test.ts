import { afterEach, describe, expect, test } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createTelegramDeliverer } from '../src/deliver/telegram.js';
import { createLogger } from '../src/util/log.js';
import { makeScoredJob, makeStats } from './helpers.js';

let server: Server | undefined;

type Sent = { path: string; body: Record<string, unknown> };

async function serve(reply: (n: number) => { status?: number; body: unknown }): Promise<{
  base: string;
  sent: Sent[];
}> {
  const sent: Sent[] = [];
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      sent.push({
        path: req.url ?? '',
        body: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>,
      });
      const out = reply(sent.length);
      res.writeHead(out.status ?? 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out.body));
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { base: `http://127.0.0.1:${port}`, sent };
}

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
});

const log = createLogger({ level: 'error', sink: () => {} });
const now = () => new Date('2026-11-18T12:00:00.000Z');

const deliverer = (base: string) =>
  createTelegramDeliverer({ botToken: 'BOT:TOKEN', chatId: '42', log, apiBase: base, now });

describe('createTelegramDeliverer', () => {
  test('posts to the bot sendMessage endpoint for the configured chat', async () => {
    const { base, sent } = await serve(() => ({ body: { ok: true } }));

    await deliverer(base).deliver([makeScoredJob()], makeStats({ delivered: 1 }));

    expect(sent[0]!.path).toBe('/botBOT:TOKEN/sendMessage');
    expect(sent[0]!.body.chat_id).toBe('42');
  });

  test('uses HTML parse mode and suppresses link previews', async () => {
    const { base, sent } = await serve(() => ({ body: { ok: true } }));

    await deliverer(base).deliver([makeScoredJob()], makeStats({ delivered: 1 }));

    expect(sent[0]!.body.parse_mode).toBe('HTML');
    expect(sent[0]!.body.disable_web_page_preview).toBe(true);
  });

  test('sends one message per part when the digest is split', async () => {
    const { base, sent } = await serve(() => ({ body: { ok: true } }));
    const jobs = Array.from({ length: 60 }, (_, i) =>
      makeScoredJob({
        id: `j${i}`,
        url: `https://boards.greenhouse.io/acme/jobs/${i}`,
        title: `Backend Engineer Number ${i} With A Fairly Long Title`,
        company: `Company Number ${i}`,
      }),
    );

    await deliverer(base).deliver(jobs, makeStats({ delivered: 60 }));

    expect(sent.length).toBeGreaterThan(1);
    for (const message of sent) expect(String(message.body.text).length).toBeLessThanOrEqual(4096);
  });

  test('still sends a message when there are no new jobs, so the run is visible', async () => {
    const { base, sent } = await serve(() => ({ body: { ok: true } }));

    await deliverer(base).deliver([], makeStats({ delivered: 0 }));

    expect(sent).toHaveLength(1);
    expect(String(sent[0]!.body.text)).toMatch(/No new matches/i);
  });

  test('throws when telegram answers ok:false, naming the reason it gave', async () => {
    const { base } = await serve(() => ({ body: { ok: false, description: 'chat not found' } }));

    await expect(deliverer(base).deliver([makeScoredJob()], makeStats())).rejects.toThrow(
      /chat not found/,
    );
  });

  test('sends an error alert to the same chat when a run fails', async () => {
    const { base, sent } = await serve(() => ({ body: { ok: true } }));

    await deliverer(base).deliverError(new Error('greenhouse board 500'), 'greenhouse');

    expect(sent).toHaveLength(1);
    const text = String(sent[0]!.body.text);
    expect(text).toMatch(/failed/i);
    expect(text).toContain('greenhouse');
    expect(text).toContain('greenhouse board 500');
  });

  test('escapes markup in an error message so the alert itself cannot fail to send', async () => {
    const { base, sent } = await serve(() => ({ body: { ok: true } }));

    await deliverer(base).deliverError(new Error('bad <tag> & more'), 'parse');

    expect(String(sent[0]!.body.text)).toContain('bad &lt;tag&gt; &amp; more');
  });
});
