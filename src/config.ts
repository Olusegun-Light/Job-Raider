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
        num: z.number().int().min(1).max(100).default(20),
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
    remote: z.array(z.string().min(1)).default([]),
    lagos: z.array(z.string().min(1)).default([]),
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
