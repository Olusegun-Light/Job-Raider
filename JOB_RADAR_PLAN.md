# Job Radar — Build Plan

> Hand this file to Claude Code. Put it in an empty repo and say:
> "Read JOB_RADAR_PLAN.md and build it milestone by milestone. Check in with me after each milestone."

## 1. Goal

A Node.js + TypeScript CLI that runs once a day, finds **newly posted** backend engineering jobs, filters and scores them against my profile, drops any I've already seen, and sends me a digest on Telegram. It runs by itself on a GitHub Actions cron and can also be run by hand with `npm run jobs`.

**About me (for the filters and scoring):**
- Backend Engineer, Node.js/TypeScript, 4+ years (fintech, healthtech, telecom)
- Based in Lagos, Nigeria (UTC+1)
- Targets, in priority order:
  1. UK roles **with visa sponsorship**
  2. Remote roles open to Nigeria / EMEA / "anywhere"
  3. Lagos-based roles

## 2. Tech stack (use these, don't swap without asking)

- Node 20+, TypeScript (strict), ESM
- `tsx` to run, `vitest` for tests
- Native `fetch` (no axios)
- `zod` to validate config files and API responses
- `yaml` to parse config
- `p-limit` to cap concurrency
- No database at first. State lives in a JSON file committed back to the repo (see §7)
- Lint/format: eslint + prettier, basic config

## 3. Project structure

```
job-radar/
├─ src/
│  ├─ index.ts              # CLI entry: parse flags, run pipeline
│  ├─ pipeline.ts           # orchestrates: fetch → normalize → filter → score → dedupe → deliver
│  ├─ types.ts              # Job type + shared types
│  ├─ config.ts             # loads + validates config/*.yaml and env vars with zod
│  ├─ sources/
│  │  ├─ serper.ts          # Google results via Serper.dev
│  │  ├─ greenhouse.ts
│  │  ├─ lever.ts
│  │  ├─ ashby.ts
│  │  └─ index.ts           # registry of enabled sources
│  ├─ filter.ts             # include/exclude rules
│  ├─ score.ts              # relevance scoring
│  ├─ sponsorship.ts        # sponsorship text detection + UK sponsor register lookup
│  ├─ dedupe.ts             # seen-store read/write, URL normalization
│  ├─ deliver/
│  │  ├─ telegram.ts
│  │  └─ console.ts         # pretty print for --dry-run
│  └─ util/
│     ├─ http.ts            # fetch wrapper: timeout, retry w/ backoff, user-agent
│     └─ log.ts
├─ config/
│  ├─ queries.yaml          # boolean Google queries
│  ├─ companies.yaml        # ATS company slugs to poll directly
│  └─ rules.yaml            # keywords, exclusions, scoring weights
├─ data/
│  ├─ seen.json             # dedupe store (committed by CI)
│  └─ uk-sponsors.csv       # UK Home Office register of licensed sponsors (optional, see §6)
├─ tests/
├─ .github/workflows/daily.yml
├─ .env.example
└─ README.md
```

## 4. The normalized Job type

Every source must output this shape:

```ts
type Job = {
  id: string;              // stable hash of normalized URL
  title: string;
  company: string;
  url: string;             // normalized: strip utm_*, ref, gh_src, trailing slashes
  location: string | null; // raw location text
  remote: boolean | null;
  postedAt: string | null; // ISO; null if unknown
  source: 'serper' | 'greenhouse' | 'lever' | 'ashby';
  description: string | null; // plain text, HTML stripped; null for Serper (snippet goes here instead)
  snippet: string | null;
  sponsorship: 'yes' | 'no' | 'unknown';
  ukSponsorLicensed: boolean | null;
  score: number;
  matchedKeywords: string[];
};
```

## 5. Sources

**Before writing each source, check its current public docs or response shape with a real request. Don't trust the endpoints below blindly.** Write a fixture from a real response into `tests/fixtures/` and test the parser against it.

### 5a. Serper.dev (Google results)
- `POST https://google.serper.dev/search`, header `X-API-KEY`, JSON body `{ q, gl, num, tbs }`
- Use `tbs: "qdr:d"` (past 24h) by default. Add a `--window=week` flag that switches to `qdr:w` for the first run or a catch-up run
- `num: 20`, and fetch page 2 only if page 1 was full
- Run every query in `config/queries.yaml`. Concurrency 3
- Map `organic[]` results → Job (title/link/snippet). Parse the company from the URL path for known ATS domains (e.g. `jobs.lever.co/{company}/...`)
- Log how many credits were used per run

### 5b. Greenhouse
- `GET https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true`
- Use `updated_at` / `first_published` for `postedAt` when present
- Description HTML is entity-encoded: decode, then strip tags

### 5c. Lever
- `GET https://api.lever.co/v0/postings/{slug}?mode=json`
- `createdAt` is epoch ms. `categories.location`, `workplaceType` → remote

### 5d. Ashby
- `GET https://api.ashbyhq.com/posting-api/job-board/{slug}`
- Use `publishedAt`, `location`, `isRemote`, `descriptionPlain`

**For all ATS sources:** keep only jobs with `postedAt` inside the window (default 48h, configurable). If one company's board 404s or errors, log a warning and carry on. Never fail the whole run because of one source.

## 6. Filtering, sponsorship and scoring

### Filter (`config/rules.yaml`)
```yaml
titleInclude:   [backend, back-end, "back end", "software engineer", "node", "api engineer", "platform engineer", "full stack", "fullstack"]
titleExclude:   [staff, principal, "head of", director, manager, intern, "front end", frontend, ios, android, "data scientist", "machine learning"]
mustMatchAny:   [node, "node.js", nodejs, typescript, javascript, nestjs, express]   # checked in title+description/snippet
locationTargets:
  uk:     [uk, "united kingdom", london, manchester, edinburgh, england, scotland]
  remote: [remote, emea, europe, "anywhere", worldwide, africa, nigeria]
  lagos:  [lagos, nigeria]
maxAgeHours: 48
```
- A job passes if the title matches `titleInclude`, doesn't match `titleExclude`, matches at least one `mustMatchAny` term (Serper jobs: check title + snippet and be lenient), and matches at least one location bucket.
- "Senior" is **not** excluded. Many senior roles fit 4+ years.

### Sponsorship detection (`sponsorship.ts`)
- Positive phrases → `yes`: "visa sponsorship", "sponsor your visa", "skilled worker visa", "we can sponsor", "relocation support", "sponsorship available"
- Negative phrases → `no` (these take priority): "unable to sponsor", "cannot sponsor", "no sponsorship", "not able to offer sponsorship", "must have the right to work in the uk", "existing right to work"
- Otherwise `unknown`
- **UK sponsor register:** the UK Home Office publishes a CSV "Register of licensed sponsors: workers" on gov.uk. Add a script `npm run update-sponsors` that I run by hand to download it into `data/uk-sponsors.csv`. Load it into a Set of normalized company names (lowercase, strip "ltd", "limited", "plc", punctuation). Set `ukSponsorLicensed` with a fuzzy match. If the file is missing, skip this step silently.
- UK jobs with `sponsorship: 'no'` are dropped by default (`--keep-no-sponsor` flag keeps them).

### Score (weights in rules.yaml)
| Signal | Points |
|---|---|
| Title contains backend/back-end | +3 |
| Node/TypeScript in title | +3 |
| Node/TypeScript in description | +2 |
| Sponsorship `yes` | +4 |
| `ukSponsorLicensed` true | +2 |
| Remote open to Nigeria/EMEA/anywhere | +3 |
| Domain match: fintech, payments, health, telecom | +1 each (max 2) |
| Posted in last 24h | +1 |
| "Senior" in title | 0 (neutral) |

Sort the digest by score (highest first). Drop anything under `minScore` (default 4).

## 7. Dedupe

- `data/seen.json`: `{ [jobId]: { firstSeen: ISO, title, company } }`
- The ID is a hash of the normalized URL. Also do a second fuzzy check on `company + normalized title`, so the same job found via Serper **and** Greenhouse only shows up once (prefer the ATS version since it has more data)
- Prune entries older than 60 days on each run
- `--dry-run` must never write `seen.json`

## 8. Delivery: Telegram

- Env: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
- Use `sendMessage` with `parse_mode: HTML` (escape `<`, `>` and `&` in job text)
- Format each job like this:
  ```
  🟢 <b>Backend Engineer (Node.js)</b> — Monzo
  📍 London, UK · 🛂 Sponsorship: yes · ⭐ 12
  <a href="...">Apply</a> · greenhouse · 6h ago
  ```
  Sponsorship icon: 🟢 yes / ⚪ unknown / licensed-sponsor badge 🏛️
- Group into sections: **🇬🇧 UK + sponsorship**, **🌍 Remote**, **🇳🇬 Lagos**, **Other**
- Telegram's limit is 4096 characters per message, so split on job boundaries
- Header line: `Job Radar — 18 Nov · 14 new (from 212 scanned)`
- If there are no new jobs, send one short line ("No new matches today"), so I know it ran
- If the run fails, send an error message to the same chat with the source and error summary

Write the delivery layer behind a small interface (`deliver(jobs, stats)`) so email or Google Sheets can be added later. **Don't build those now.**

## 9. CLI

```
npm run jobs                  # full run, delivers to Telegram, updates seen.json
npm run jobs -- --dry-run     # prints to console, no Telegram, no state write
npm run jobs -- --source=greenhouse,lever
npm run jobs -- --window=week # wider window for first run / catch-up
npm run jobs -- --keep-no-sponsor
npm run update-sponsors
```

## 10. Config seeds

### `config/queries.yaml`
```yaml
queries:
  - name: uk-sponsor-ats
    q: '(site:boards.greenhouse.io OR site:jobs.lever.co OR site:jobs.ashbyhq.com) ("backend engineer" OR "backend developer" OR "software engineer") ("node.js" OR nodejs OR typescript) ("visa sponsorship" OR "skilled worker visa") (London OR UK OR "United Kingdom")'
    gl: uk
  - name: uk-backend-node
    q: '(site:boards.greenhouse.io OR site:jobs.lever.co OR site:jobs.ashbyhq.com OR site:apply.workable.com) "backend" ("node.js" OR typescript) (London OR "United Kingdom")'
    gl: uk
  - name: remote-emea
    q: '(site:boards.greenhouse.io OR site:jobs.lever.co OR site:jobs.ashbyhq.com OR site:apply.workable.com) ("backend engineer" OR "backend developer") ("node.js" OR typescript) (remote) (EMEA OR Africa OR worldwide OR anywhere)'
    gl: us
  - name: remote-fintech
    q: '(site:boards.greenhouse.io OR site:jobs.lever.co OR site:jobs.ashbyhq.com) backend ("node.js" OR typescript) (fintech OR payments) remote'
    gl: us
  - name: lagos
    q: '("backend engineer" OR "backend developer") ("node.js" OR typescript) Lagos (site:jobs.lever.co OR site:boards.greenhouse.io OR site:jobs.ashbyhq.com OR site:apply.workable.com OR site:linkedin.com/jobs)'
    gl: ng
```
Keep it to about 5–10 queries so the daily credit use stays low. Log the credits per run.

### `config/companies.yaml`
```yaml
greenhouse: []   # board slugs, e.g. from boards.greenhouse.io/{slug}
lever: []        # e.g. jobs.lever.co/{slug}
ashby: []        # e.g. jobs.ashbyhq.com/{slug}
```
Seed it with about 10 well-known UK fintech/healthtech companies whose slugs you **check really exist** with a live request. I'll add more over time.
**Bonus helper:** `npm run discover` reads the ATS URLs that Serper returned over the last runs (store them in `data/discovered.json`) and suggests new company slugs to add.

## 11. GitHub Actions (`.github/workflows/daily.yml`)

- Triggers: `schedule: cron: '0 6 * * *'` (06:00 UTC = 07:00 Lagos) + `workflow_dispatch` for manual runs (with a `window` input)
- `permissions: contents: write`
- Steps: checkout → setup-node 20 with npm cache → `npm ci` → `npm run jobs` → if `data/seen.json` changed, commit with message `chore: update seen [skip ci]` and push
- Secrets: `SERPER_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
- `concurrency` group so two runs never overlap
- `timeout-minutes: 10`

## 12. Resilience and etiquette

- HTTP wrapper: 15s timeout, 2 retries with exponential backoff on 429/5xx, a descriptive User-Agent
- Concurrency of 3–5 per source
- **Never scrape google.com directly.** Only use Serper
- Validate every API response with zod. On a schema mismatch, log the first error and skip that source; don't crash
- End of run summary log: per-source counts (fetched / passed filter / new), Serper credits used, duration

## 13. Tests (vitest)

- URL normalization + ID hashing
- Each source parser against a real recorded fixture
- Filter rules: table-driven cases (e.g. "Staff Backend Engineer" excluded, "Senior Backend Engineer (Node)" kept)
- Sponsorship detection: positive, negative, and negative-overrides-positive cases
- Dedupe: same job found via Serper + Greenhouse collapses to the ATS version
- Telegram formatter: escaping and the 4096-character split

## 14. Milestones (stop and check in after each)

1. **Skeleton:** project setup, types, config loading with zod, `--dry-run` printing hardcoded fake jobs
2. **ATS sources:** Greenhouse, Lever, Ashby + fixtures + tests, with a dry run over the seeded companies
3. **Serper source** + queries.yaml + credit logging
4. **Filter, sponsorship and score** + tests. Dry run shows a sorted, sensible list
5. **Dedupe** + seen.json + pruning
6. **Telegram delivery** + error alerts
7. **GitHub Actions** workflow + README (setup steps: create a Telegram bot via @BotFather, get the chat ID, add repo secrets, first run with `--window=week`)
8. **Extras:** `update-sponsors` and `discover` scripts

## 15. Done when

- `npm run jobs -- --dry-run` prints a scored, grouped, deduped list from real sources
- A manual `workflow_dispatch` run sends a Telegram digest and commits `seen.json`
- Running it twice in a row sends "No new matches today" the second time
- One company with a bad slug logs a warning but the run still succeeds
- `npm test` passes
