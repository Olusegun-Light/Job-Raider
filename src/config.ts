import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

const queriesSchema = z.object({
  queries: z
    .array(
      z.object({
        name: z.string().min(1),
        q: z.string().min(1),
        gl: z.string().min(2).default('us'),
        /**
         * Serper's free tier returns a 400 ("Query pattern not allowed for
         * free accounts") for num > 10 when the query uses site: operators,
         * and caps results at 10 regardless. Paid accounts can raise it.
         */
        num: z.number().int().min(1).max(100).default(10),
      }),
    )
    .min(1),
});

const companiesSchema = z.object({
  greenhouse: z.array(z.string().min(1)).default([]),
  lever: z.array(z.string().min(1)).default([]),
  ashby: z.array(z.string().min(1)).default([]),
});

const weightsSchema = z.object({
  titleBackend: z.number().default(3),
  titleNodeTs: z.number().default(3),
  descriptionNodeTs: z.number().default(2),
  sponsorshipYes: z.number().default(4),
  ukSponsorLicensed: z.number().default(2),
  remoteOpen: z.number().default(3),
  domainMatch: z.number().default(1),
  domainMatchMax: z.number().default(2),
  postedLast24h: z.number().default(1),
});

const rulesSchema = z.object({
  titleInclude: z.array(z.string().min(1)).min(1),
  titleExclude: z.array(z.string().min(1)).default([]),
  mustMatchAny: z.array(z.string().min(1)).min(1),
  locationTargets: z.object({
    uk: z.array(z.string().min(1)).default([]),
    /**
     * Open-remote scopes only - terms that imply Nigeria is eligible, such as
     * EMEA or worldwide. The bare word "remote" deliberately does NOT belong
     * here: on its own it says nothing about which countries may apply, and
     * treating it as a target is what let "Remote - United States" through.
     */
    remote: z.array(z.string().min(1)).default([]),
    lagos: z.array(z.string().min(1)).default([]),
    /**
     * Relocation regions, optional so a rules.yaml predating them still
     * loads. Each is a digest section and a sponsorship-route group.
     */
    europe: z.array(z.string().min(1)).optional(),
    gulf: z.array(z.string().min(1)).optional(),
    apac: z.array(z.string().min(1)).optional(),
    americas: z.array(z.string().min(1)).optional(),
    /**
     * Places that are never reachable, named so the code can tell
     * "Remote - United States" from a bare "Remote". Without this list a
     * country we simply never listed reads as an unstated scope, and a
     * US-only remote role passes as though it were open to anyone.
     *
     * Matching one of these demotes a job even if it also matches a target
     * region, which is what handles the common "Remote - US & Canada".
     */
    exclude: z.array(z.string().min(1)).optional(),
  }),
  maxAgeHours: z.number().positive().default(48),
  minScore: z.number().default(4),
  weights: weightsSchema.default({}),
  domains: z.array(z.string().min(1)).default([]),
});

export type QueryConfig = z.infer<typeof queriesSchema>['queries'][number];
export type CompaniesConfig = z.infer<typeof companiesSchema>;
export type RulesConfig = z.infer<typeof rulesSchema>;
export type Weights = z.infer<typeof weightsSchema>;

export type AppConfig = {
  queries: QueryConfig[];
  companies: CompaniesConfig;
  rules: RulesConfig;
};

/** zod's issue list is noisy; surface the first problem with its file and path. */
function explain(file: string, error: z.ZodError): Error {
  const first = error.issues[0];
  const where = first && first.path.length > 0 ? ` at \`${first.path.join('.')}\`` : '';
  return new Error(`${file}: ${first?.message ?? 'invalid'}${where}`);
}

function loadYamlFile<T extends z.ZodTypeAny>(dir: string, file: string, schema: T): z.infer<T> {
  let raw: string;
  try {
    raw = readFileSync(join(dir, file), 'utf8');
  } catch (cause) {
    throw new Error(`${file}: cannot read ${join(dir, file)}`, { cause });
  }

  let doc: unknown;
  try {
    doc = parseYaml(raw);
  } catch (cause) {
    throw new Error(`${file}: not valid YAML`, { cause });
  }

  const parsed = schema.safeParse(doc ?? {});
  if (!parsed.success) throw explain(file, parsed.error);
  return parsed.data;
}

export function loadConfig(opts: { configDir?: string } = {}): AppConfig {
  const dir = opts.configDir ?? join(process.cwd(), 'config');
  return {
    queries: loadYamlFile(dir, 'queries.yaml', queriesSchema).queries,
    companies: loadYamlFile(dir, 'companies.yaml', companiesSchema),
    rules: loadYamlFile(dir, 'rules.yaml', rulesSchema),
  };
}

/**
 * Load a .env file into process.env, if one exists.
 *
 * Node does not read .env on its own, and the README tells the user to create
 * one, so without this their credentials would simply be ignored and the run
 * would report missing secrets. Values already present in the real
 * environment win: a CI secret must beat a stale .env in the working copy.
 *
 * Returns whether anything was actually loaded.
 */
export function loadDotEnv(path: string = join(process.cwd(), '.env')): boolean {
  let contents: string;
  try {
    contents = readFileSync(path, 'utf8');
  } catch {
    return false;
  }

  let loaded = 0;
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;

    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    // Strip one layer of matching quotes, as dotenv does.
    if (value.length >= 2 && /^(".*"|'.*')$/s.test(value)) value = value.slice(1, -1);

    if (!key || process.env[key] !== undefined) continue;
    process.env[key] = value;
    loaded += 1;
  }

  return loaded > 0;
}

const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export type Env = {
  serperApiKey?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
  logLevel: LogLevel;
};

/** Blank-but-present env vars are how CI passes an unset secret; treat them as absent. */
function optional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function loadEnv(env: Record<string, string | undefined> = process.env): Env {
  const level = optional(env.LOG_LEVEL) ?? 'info';
  if (!LOG_LEVELS.includes(level as LogLevel)) {
    throw new Error(`LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')} (got "${level}")`);
  }

  const result: Env = { logLevel: level as LogLevel };
  const serper = optional(env.SERPER_API_KEY);
  const token = optional(env.TELEGRAM_BOT_TOKEN);
  const chat = optional(env.TELEGRAM_CHAT_ID);
  if (serper !== undefined) result.serperApiKey = serper;
  if (token !== undefined) result.telegramBotToken = token;
  if (chat !== undefined) result.telegramChatId = chat;
  return result;
}
