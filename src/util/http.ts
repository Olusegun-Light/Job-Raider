import type { z } from 'zod';

export const USER_AGENT =
  'job-radar/0.1 (personal job-alert bot; +https://github.com/topics/job-radar)';

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export type FetchOptions = {
  /** Attempts after the first. Default 2. */
  retries?: number;
  /** First backoff step; doubles each retry. Default 500ms. */
  backoffMs?: number;
  /** Per-attempt timeout. Default 15s. */
  timeoutMs?: number;
  method?: 'GET' | 'POST';
  json?: unknown;
  headers?: Record<string, string>;
};

const RETRYABLE_STATUS = (status: number): boolean => status === 429 || status >= 500;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Keep secrets out of logs and error messages. */
function redact(url: string): string {
  // Telegram puts the bot token in the path, not the query string.
  const withoutToken = url.replace(/\/bot[^/]+/i, '/bot<REDACTED>');
  try {
    const u = new URL(withoutToken);
    for (const key of [...u.searchParams.keys()]) {
      if (/key|token|secret|password/i.test(key)) u.searchParams.set(key, 'REDACTED');
    }
    return u.toString();
  } catch {
    return withoutToken;
  }
}

/**
 * fetch + timeout + bounded retry with exponential backoff + zod validation.
 *
 * Retries 429 and 5xx only: a 404 from a mistyped board slug will never turn
 * into a 200, so retrying it just wastes the run's time budget.
 */
export async function fetchJson<T extends z.ZodTypeAny>(
  url: string,
  schema: T,
  options: FetchOptions = {},
): Promise<z.infer<T>> {
  const retries = options.retries ?? 2;
  const backoffMs = options.backoffMs ?? 500;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const safeUrl = redact(url);

  let lastError: Error = new Error(`${safeUrl}: request never ran`);

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0) await sleep(backoffMs * 2 ** (attempt - 1));

    let response: Response;
    try {
      response = await fetch(url, {
        method: options.method ?? 'GET',
        headers: {
          'user-agent': USER_AGENT,
          accept: 'application/json',
          ...(options.json !== undefined ? { 'content-type': 'application/json' } : {}),
          ...options.headers,
        },
        ...(options.json !== undefined ? { body: JSON.stringify(options.json) } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      const isTimeout =
        cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError');
      lastError = isTimeout
        ? new Error(`${safeUrl}: request timed out after ${timeoutMs}ms`)
        : new Error(
            `${safeUrl}: network error: ${cause instanceof Error ? cause.message : String(cause)}`,
          );
      continue;
    }

    if (!response.ok) {
      lastError = new HttpError(`${safeUrl}: HTTP ${response.status}`, response.status, safeUrl);
      if (!RETRYABLE_STATUS(response.status)) throw lastError;
      continue;
    }

    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      // A board serving an HTML error page is not going to start serving JSON.
      throw new Error(`${safeUrl}: response was not JSON (starts with "${text.slice(0, 40)}")`);
    }

    const result = schema.safeParse(parsed);
    if (!result.success) {
      const first = result.error.issues[0];
      const where = first && first.path.length > 0 ? ` at \`${first.path.join('.')}\`` : '';
      throw new Error(
        `${safeUrl}: unexpected response shape: ${first?.message ?? 'invalid'}${where}`,
      );
    }
    return result.data;
  }

  throw lastError;
}
