# Job Radar

A CLI that runs once a day, finds **newly posted** backend engineering jobs, scores them
against my profile, drops the ones I have already seen, and sends a digest to Telegram.

Targets, in priority order:

1. UK roles **with visa sponsorship**
2. Remote roles open to Nigeria / EMEA / "anywhere"
3. Lagos-based roles

It runs itself on a GitHub Actions cron (06:00 UTC = 07:00 Lagos) and can be run by hand.

---

## Quick start

```bash
npm install
cp .env.example .env     # then fill it in (see "Credentials" below)
npm run jobs -- --dry-run --window=week
```

`--dry-run` prints to the console, sends nothing, and does not write `data/seen.json`,
so it is safe to repeat as often as you like.

## Commands

| Command                                     | What it does                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------------- |
| `npm run jobs`                              | Full run: fetch, filter, score, dedupe, deliver to Telegram, update `seen.json` |
| `npm run jobs -- --dry-run`                 | Print to the console. No Telegram, no state written                             |
| `npm run jobs -- --window=week`             | Widen the window to 7 days (first run or catch-up)                              |
| `npm run jobs -- --source=greenhouse,lever` | Only run some sources (`serper`, `greenhouse`, `lever`, `ashby`)                |
| `npm run jobs -- --keep-no-sponsor`         | Keep UK roles that state they cannot sponsor                                    |
| `npm run jobs -- --min-score=6`             | Override the `minScore` in `rules.yaml`                                         |
| `npm run jobs -- --sample`                  | Run the pipeline over built-in fake jobs; no network, no keys                   |
| `npm run update-sponsors`                   | Download the UK sponsor register into `data/uk-sponsors.csv`                    |
| `npm run discover`                          | Suggest new ATS company slugs from what Serper has returned                     |
| `npm test`                                  | Run the test suite                                                              |
| `npm run typecheck` / `npm run lint`        | Types / lint                                                                    |

A real run with no Telegram credentials **fails** rather than quietly printing. That is
deliberate: a silent fallback would look like a successful run in CI while no digest
arrived, and `seen.json` would still be updated, so those jobs would never be sent again.

## Credentials

### Serper (Google results)

1. Sign up at <https://serper.dev> (the free tier includes 2,500 queries).
2. Copy the API key into `SERPER_API_KEY`.

Each run spends roughly one credit per query in `config/queries.yaml` (5 by default), plus
one more for any query whose first page came back full. The credits used are logged at the
end of every run and shown in the digest header.

Without this key the other three sources still run; Serper logs a warning and is skipped.

### Telegram

1. In Telegram, message **@BotFather**, send `/newbot`, and follow the prompts.
   BotFather replies with a token like `123456789:AAEx...`. That is `TELEGRAM_BOT_TOKEN`.
2. Send your new bot any message (a bot cannot start a conversation with you).
3. Get your chat id:

   ```bash
   curl -s "https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates" | grep -o '"chat":{"id":[-0-9]*'
   ```

   The number is `TELEGRAM_CHAT_ID`. It is negative for a group.

4. Check it works:

   ```bash
   curl -s "https://api.telegram.org/bot<YOUR_TOKEN>/sendMessage" \
     -H 'content-type: application/json' \
     -d '{"chat_id":"<YOUR_CHAT_ID>","text":"Job Radar test"}'
   ```

## Running on GitHub Actions

1. Push this repo to GitHub.
2. Add three repository secrets under **Settings → Secrets and variables → Actions**:
   `SERPER_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.
3. Allow the workflow to push: **Settings → Actions → General → Workflow permissions →
   Read and write permissions**. (The workflow commits `data/seen.json` after each run.)
4. Do the first run by hand: **Actions → Job Radar → Run workflow**, with `window: week`.
   A wider first window catches jobs posted in the last few days; after that the daily
   `qdr:d` window is enough.
5. It then runs itself at 06:00 UTC daily. GitHub's scheduler can be late under load, so
   treat the time as approximate.

A run with no new jobs still sends "No new matches today", so a silent day is
distinguishable from a broken cron.

## Configuration

Everything tunable lives in `config/`, validated with zod at startup — a typo fails the
run with the file and field named, rather than silently doing nothing.

### `config/rules.yaml`

- `titleInclude` / `titleExclude` — a job must match an include term and no exclude term.
  **"senior" is deliberately not excluded**: plenty of senior roles fit 4+ years.
- `mustMatchAny` — stack keywords, checked against title + description.
- `locationTargets` — the `uk` / `remote` / `lagos` buckets, which also become the digest
  sections. A job matching none of them is dropped.
- `maxAgeHours` (default 48) — how recent an ATS posting must be.
- `minScore` (default 4) — the cut.
- `weights` — the scoring table below.
- `domains` — fintech/payments/health/telecom-style bonus terms.

| Signal                                               | Points          |
| ---------------------------------------------------- | --------------- |
| `backend` / `back-end` in the title                  | +3              |
| Node/TypeScript in the title                         | +3              |
| Node/TypeScript in the description                   | +2              |
| Sponsorship `yes`                                    | +4              |
| Company on the UK sponsor register                   | +2              |
| Remote and open beyond the UK (EMEA/Africa/anywhere) | +3              |
| Domain match (fintech, payments, health, telecom)    | +1 each, max +2 |
| Posted in the last 24h                               | +1              |
| "Senior" in the title                                | 0 (neutral)     |

Remote only scores when the role is open **beyond** the UK: "Remote — London" still needs
the right to work in the UK, so it is scored as a UK role, not a remote one.

### `config/companies.yaml`

ATS board slugs polled directly, which costs no Serper credits. Every seeded slug was
checked against the live board API. Add more with `npm run discover`, or by hand:

- Greenhouse — the `{slug}` in `boards.greenhouse.io/{slug}`
- Lever — the `{slug}` in `jobs.lever.co/{slug}`
- Ashby — the `{slug}` in `jobs.ashbyhq.com/{slug}`

A slug that 404s logs a warning; the run continues and still delivers.

### `config/queries.yaml`

Boolean Google queries, run through Serper. Keep it to about 5–10 so daily credit use
stays low. Google is never scraped directly.

## How a run works

```
fetch (4 sources, concurrently)
  → normalize to one Job shape
  → filter   (title rules, stack keywords, location buckets)
  → enrich   (sponsorship detection, UK sponsor register)
  → score    (weights above)
  → cut      (below minScore; UK roles that cannot sponsor)
  → dedupe   (job id, then company + title across sources)
  → deliver  (Telegram, or the console on --dry-run)
  → record   (data/seen.json, pruned at 60 days)
```

One source failing never fails the run: its error is collected, reported in the run
summary, and the remaining sources still deliver.

### Sponsorship detection

Phrases like "visa sponsorship" or "skilled worker visa" mean `yes`; phrases like "unable
to sponsor" or "must have the right to work in the UK" mean `no`, and **negatives win**.
That ordering matters more than it looks: "we cannot offer visa sponsorship" contains the
literal string "visa sponsorship", so a naive check reads it as a yes and recommends a
job that is unreachable without sponsorship.

UK roles that say `no` are dropped unless you pass `--keep-no-sponsor`.

### The UK sponsor register (optional)

```bash
npm run update-sponsors
```

Downloads the Home Office "Register of licensed sponsors: workers" to
`data/uk-sponsors.csv` (about 143,000 organisations, 10.4 MB). Companies on it score +2
and show a 🏛️ badge. If the file is absent the check is skipped silently, so this is
entirely optional.

gov.uk publishes no stable URL for the register — the filename carries the release date
and the path a content id, both of which change on most working days — so the script
scrapes the current link off the
[publication page](https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers)
each time. If gov.uk changes that page's layout, the script says so and exits non-zero
rather than writing a truncated file.

The CSV is **not committed** (10.4 MB, republished most working days, so each refresh
would add another 10 MB to git history). The workflow downloads it on each run instead,
in a `continue-on-error` step: the register only adds a scoring signal, so gov.uk being
unreachable should not cost you the day's digest.

## Dedupe

`data/seen.json` maps a job id to `{ firstSeen, title, company }`. The id is a hash of the
normalized URL (tracking parameters stripped). A second pass matches on company + title,
so a posting found via **both** Serper and its ATS board is reported once — the ATS copy
wins, because it has the real location, posting date and description.

Entries older than 60 days are pruned on each write, and `--dry-run` never writes.

## Tests

```bash
npm test
```

The source parsers are tested against **real recorded responses** in `tests/fixtures/`,
not hand-written mocks. That is what caught Lever returning a posting's title in a field
called `text` rather than `title`, and Greenhouse's `updated_at` moving whenever a
recruiter edits the copy — which would have resurfaced year-old jobs as "new" daily.

## Adding another delivery channel

`Deliverer` in `src/types.ts` is the whole interface:

```ts
type Deliverer = {
  name: string;
  deliver(jobs: ScoredJob[], stats: RunStats): Promise<void>;
  deliverError(error: Error, context: string): Promise<void>;
};
```

Implement it, then return it from `chooseDeliverer` in `src/deliver/index.ts`.
