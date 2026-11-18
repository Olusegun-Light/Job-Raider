import { afterEach, describe, expect, test } from 'vitest';
import { createServer, type Server } from 'node:http';
import { z } from 'zod';
import { HttpError, fetchJson } from '../src/util/http.js';

type Received = { method: string; url: string; headers: Record<string, unknown>; body: string };

type Handler = (
  req: Received,
  attempt: number,
) => {
  status?: number;
  body?: string;
  delayMs?: number;
};

let server: Server | undefined;

async function serve(
  handler: Handler,
): Promise<{ base: string; attempts: () => number; received: Received[] }> {
  let attempts = 0;
  const received: Received[] = [];
  server = createServer((req, res) => {
    attempts += 1;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const entry: Received = {
        method: req.method ?? 'GET',
        url: req.url ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      };
      received.push(entry);
      const out = handler(entry, attempts);
      const send = () => {
        res.writeHead(out.status ?? 200, { 'content-type': 'application/json' });
        res.end(out.body ?? '{}');
      };
      if (out.delayMs) setTimeout(send, out.delayMs);
      else send();
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { base: `http://127.0.0.1:${port}`, attempts: () => attempts, received };
}

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
});

const schema = z.object({ ok: z.boolean() });
const fast = { retries: 2, backoffMs: 1, timeoutMs: 500 };

describe('fetchJson error text', () => {
  test('includes the response body, which is where APIs explain a rejection', async () => {
    // A bare "HTTP 403" sent me on a three-step hunt for a stray character in
    // an API key; the body said "Unauthorized." all along.
    const { base } = await serve(() => ({
      status: 403,
      body: '{"message":"Unauthorized.","statusCode":403}',
    }));

    await expect(fetchJson(`${base}/x`, schema, fast)).rejects.toThrow(/Unauthorized/);
  });

  test('truncates a long error body instead of dumping a whole html page', async () => {
    const { base } = await serve(() => ({ status: 500, body: `{"e":"${'x'.repeat(5000)}"}` }));

    await expect(fetchJson(`${base}/x`, schema, { ...fast, retries: 0 })).rejects.toThrow(
      /\.{3}|…/,
    );
  });

  test('redacts a telegram bot token, which lives in the url path', async () => {
    const { base } = await serve(() => ({ status: 404, body: '{}' }));

    await expect(
      fetchJson(`${base}/bot123456:AAEsecret/sendMessage`, schema, fast),
    ).rejects.toThrow(/REDACTED/);
  });

  test('does not leak the token itself into the error message', async () => {
    const { base } = await serve(() => ({ status: 404, body: '{}' }));

    await expect(
      fetchJson(`${base}/bot123456:AAEsecret/sendMessage`, schema, fast),
    ).rejects.not.toThrow(/AAEsecret/);
  });
});

describe('fetchJson', () => {
  test('returns the parsed body when the response validates', async () => {
    const { base } = await serve(() => ({ body: '{"ok":true}' }));

    await expect(fetchJson(`${base}/x`, schema, fast)).resolves.toEqual({ ok: true });
  });

  test('sends a descriptive user-agent so boards can identify the client', async () => {
    let seen: unknown;
    const { base } = await serve((req) => {
      seen = req.headers['user-agent'];
      return { body: '{"ok":true}' };
    });

    await fetchJson(`${base}/x`, schema, fast);

    expect(String(seen)).toMatch(/job-radar/i);
  });

  test('retries a 500 and succeeds on a later attempt', async () => {
    const { base, attempts } = await serve((_req, attempt) =>
      attempt < 3 ? { status: 500, body: '{}' } : { body: '{"ok":true}' },
    );

    await expect(fetchJson(`${base}/x`, schema, fast)).resolves.toEqual({ ok: true });
    expect(attempts()).toBe(3);
  });

  test('retries a 429', async () => {
    const { base, attempts } = await serve((_req, attempt) =>
      attempt < 2 ? { status: 429, body: '{}' } : { body: '{"ok":true}' },
    );

    await fetchJson(`${base}/x`, schema, fast);

    expect(attempts()).toBe(2);
  });

  test('does not retry a 404, because a bad board slug will never become good', async () => {
    const { base, attempts } = await serve(() => ({ status: 404, body: '{}' }));

    await expect(fetchJson(`${base}/x`, schema, fast)).rejects.toThrow(HttpError);
    expect(attempts()).toBe(1);
  });

  test('exposes the status code on the thrown HttpError', async () => {
    const { base } = await serve(() => ({ status: 404, body: '{}' }));

    await expect(fetchJson(`${base}/x`, schema, fast)).rejects.toMatchObject({ status: 404 });
  });

  test('gives up after the configured number of retries', async () => {
    const { base, attempts } = await serve(() => ({ status: 503, body: '{}' }));

    await expect(fetchJson(`${base}/x`, schema, fast)).rejects.toThrow(/503/);
    expect(attempts()).toBe(3);
  });

  test('times out a response that never arrives', async () => {
    const { base } = await serve(() => ({ body: '{"ok":true}', delayMs: 300 }));

    await expect(
      fetchJson(`${base}/slow`, schema, { retries: 0, backoffMs: 1, timeoutMs: 50 }),
    ).rejects.toThrow(/timed out/i);
  });

  test('rejects a body that does not match the schema, naming the field', async () => {
    const { base } = await serve(() => ({ body: '{"ok":"yes"}' }));

    await expect(fetchJson(`${base}/x`, schema, fast)).rejects.toThrow(/ok/);
  });

  test('rejects a body that is not JSON at all', async () => {
    const { base } = await serve(() => ({ body: '<html>nope</html>' }));

    await expect(fetchJson(`${base}/x`, schema, fast)).rejects.toThrow(/json/i);
  });

  test('posts the given JSON body with a POST method and json content-type', async () => {
    const { base, received } = await serve(() => ({ body: '{"ok":true}' }));

    await fetchJson(`${base}/search`, schema, { ...fast, method: 'POST', json: { q: 'backend' } });

    expect(received[0]!.method).toBe('POST');
    expect(received[0]!.body).toBe('{"q":"backend"}');
    expect(received[0]!.headers['content-type']).toContain('application/json');
  });

  test('sends extra headers such as an api key', async () => {
    const { base, received } = await serve(() => ({ body: '{"ok":true}' }));

    await fetchJson(`${base}/x`, schema, { ...fast, headers: { 'X-API-KEY': 'secret' } });

    expect(received[0]!.headers['x-api-key']).toBe('secret');
  });
});
