import { afterEach, describe, expect, test } from 'vitest';
import { createServer, type Server } from 'node:http';
import { serperSource } from '../src/sources/serper.js';
import { createLogger } from '../src/util/log.js';
import { parseArgs } from '../src/cli.js';
import type { SourceContext } from '../src/sources/index.js';
import type { AppConfig } from '../src/config.js';

let server: Server | undefined;

type Req = { body: unknown; headers: Record<string, unknown> };

function isStatusReply(r: unknown): r is { status: number; body: unknown } {
  return typeof r === 'object' && r !== null && 'status' in r && 'body' in r;
}

async function serve(
  reply: (req: Req, n: number) => unknown,
): Promise<{ url: string; seen: Req[] }> {
  const seen: Req[] = [];
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const entry: Req = {
        body: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'),
        headers: req.headers,
      };
      seen.push(entry);
      const out = reply(entry, seen.length);
      const status = isStatusReply(out) ? out.status : 200;
      const body = isStatusReply(out) ? out.body : out;
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { url: `http://127.0.0.1:${port}/search`, seen };
}

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
});

const result = (link: string) => ({ title: 'Backend Engineer', link, snippet: 'Node.js' });

function context(queries: AppConfig['queries'], apiKey?: string): SourceContext {
  return {
    config: {
      queries,
      companies: { greenhouse: [], lever: [], ashby: [] },
      rules: {
        titleInclude: ['backend'],
        titleExclude: [],
        mustMatchAny: ['node'],
        locationTargets: { uk: [], remote: [], lagos: [] },
        maxAgeHours: 48,
        minScore: 0,
        weights: {
          titleBackend: 3,
          titleNodeTs: 3,
          descriptionNodeTs: 2,
          sponsorshipYes: 4,
          ukSponsorLicensed: 2,
          remoteOpen: 3,
          domainMatch: 1,
          domainMatchMax: 2,
          postedLast24h: 1,
        },
        domains: [],
      },
    },
    options: parseArgs(['--dry-run']),
    env: apiKey === undefined ? { logLevel: 'error' } : { logLevel: 'error', serperApiKey: apiKey },
    log: createLogger({ level: 'error', sink: () => {} }),
    now: new Date('2026-11-18T12:00:00.000Z'),
  };
}

const query = (name: string, num = 2) => ({ name, q: `${name} backend`, gl: 'uk', num });

describe('serperSource', () => {
  test('skips with an error note instead of throwing when the api key is missing', async () => {
    const { jobs, errors } = await serperSource().fetch(context([query('a')]));

    expect(jobs).toEqual([]);
    expect(errors[0]).toMatch(/SERPER_API_KEY/);
  });

  test('sends the api key header, the query and the time window', async () => {
    const { url, seen } = await serve(() => ({
      organic: [result('https://jobs.lever.co/a/1')],
      credits: 1,
    }));

    await serperSource({ endpoint: url }).fetch(context([query('a')], 'secret-key'));

    expect(seen[0]!.headers['x-api-key']).toBe('secret-key');
    expect(seen[0]!.body).toMatchObject({ q: 'a backend', gl: 'uk', num: 2, tbs: 'qdr:d2' });
  });

  test('uses the week time window when asked for a catch-up run', async () => {
    const { url, seen } = await serve(() => ({ organic: [], credits: 1 }));
    const ctx = { ...context([query('a')], 'k'), options: parseArgs(['--window=week']) };

    await serperSource({ endpoint: url }).fetch(ctx);

    expect((seen[0]!.body as { tbs: string }).tbs).toBe('qdr:w');
  });

  test('runs every configured query', async () => {
    const { url, seen } = await serve(() => ({ organic: [], credits: 1 }));

    await serperSource({ endpoint: url }).fetch(context([query('a'), query('b'), query('c')], 'k'));

    expect(seen).toHaveLength(3);
  });

  test('reports the credits the responses charged', async () => {
    const { url } = await serve(() => ({ organic: [], credits: 2 }));

    const { credits } = await serperSource({ endpoint: url }).fetch(
      context([query('a'), query('b')], 'k'),
    );

    expect(credits).toBe(4);
  });

  test('fetches page 2 only when page 1 came back full', async () => {
    const { url, seen } = await serve((req) => {
      const body = req.body as { q: string };
      // "full" query returns num results; "thin" returns one.
      const links = body.q.startsWith('full')
        ? [result('https://jobs.lever.co/a/1'), result('https://jobs.lever.co/a/2')]
        : [result('https://jobs.lever.co/b/1')];
      return { organic: links, credits: 1 };
    });

    await serperSource({ endpoint: url }).fetch(context([query('full'), query('thin')], 'k'));

    const pages = seen.map((s) => (s.body as { page?: number }).page);
    expect(pages.filter((p) => p === 2)).toHaveLength(1);
    expect(seen).toHaveLength(3);
  });

  test('keeps page 1 when page 2 fails, instead of discarding a paid-for page', async () => {
    const { url } = await serve((req, n) => {
      const body = req.body as { page?: number };
      if (body.page === 2) return { status: 500, body: { error: 'boom' } };
      void n;
      return {
        status: 200,
        body: {
          organic: [result('https://jobs.lever.co/a/1'), result('https://jobs.lever.co/a/2')],
          credits: 1,
        },
      };
    });

    const { jobs, errors } = await serperSource({ endpoint: url }).fetch(
      context([query('full', 2)], 'k'),
    );

    expect(jobs).toHaveLength(2);
    expect(errors).toHaveLength(1);
  });

  test('one failing query does not lose the results of the others', async () => {
    const { url } = await serve((req) => {
      const body = req.body as { q: string };
      if (body.q.startsWith('bad')) return { organic: 'not-an-array' };
      return { organic: [result('https://jobs.lever.co/a/1')], credits: 1 };
    });

    const { jobs, errors } = await serperSource({ endpoint: url }).fetch(
      context([query('bad'), query('good')], 'k'),
    );

    expect(jobs).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/bad/);
  });
});
