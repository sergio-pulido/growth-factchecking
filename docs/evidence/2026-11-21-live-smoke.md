# Live fact-check smoke run — 2026-11-21

Ticket: GF-01. Route under test: `POST /api/fact-check/live`.
Code under test: `main` at `aebb287` (route wired in `07946e2`, relevance-predicate fix in `aebb287`).

## Evidence level

- **Implemented**: merged to `main`, unit tests green (`npm test` 13/13, fakes only).
- **Run on a real stack**: real OpenAI Embeddings + Decisions and a real Postgres 17 + pgvector, executed by the
  Claude Code agent on Sergio's machine on 2026-11-21. This meets the ticket's "verified" bar.
- Under the Alodai definition, **verified** requires a human run. Re-running the commands below by hand
  makes this **verified**, and with this file it becomes **proven**. Until then, treat it as agent-run evidence.

## Stack

| Item | Version |
| --- | --- |
| Node.js | 22.23.5 |
| `openai` SDK | 7.62.0 (`client.decisions.create`, `client.embeddings.create`) |
| `pg` | 8.23.1 |
| Postgres image | `pgvector/pgvector:pg17` → PostgreSQL 17.12, extension `vector` 0.8.7 |
| Embedding model | `text-embedding-3-small`, 1536 dims (defaults) |
| Decisions model | `gpt-6-luna` (default) |
| Thresholds | defaults, unchanged: `FACT_TOP_K=5`, `FACT_MIN_SIMILARITY=0.35`, `VERDICT_MIN_RELEVANCE=0.5`, `VERDICT_MIN_CONFIDENCE=0.6` |
| Corpus | `data/facts.sample.json`: 8 placeholder facts, example.org sources |

## Local deviations (this machine only)

- Port 5432 was taken by a native Postgres and 5433 by another container, so the db ran on host port 55432
  (`FACTCHECK_DB_PORT`, added in `cc27916`). `DATABASE_URL` was passed on the command line; `.env` only holds
  `OPENAI_API_KEY`.
- Port 3000 (hard-coded in `apps/api/src/index.ts`) was in use by another API process. The server was started
  through a scratch launcher that imports the same `createApp` from `apps/api/dist/app.js` and listens on 3100/3101.
  Behaviour is identical to `npm run start:live` apart from the port and request logging.

## Commands run

```bash
cd /Users/nectios/workspace-os/hackathons/codex-devday-exchange/growth-factcheking
FACTCHECK_DB_PORT=55432 docker compose up -d db
export DATABASE_URL=postgres://factcheck:factcheck@127.0.0.1:55432/factcheck
npm run build
npm test                              # 13/13
npm run db:migrate                    # Applied 001_facts.sql
npm run seed -- data/facts.sample.json   # Seeded 8/8 (8 rows, vector_dims 1536)
```

Launcher (scratch, not committed):

```js
const { createApp } = await import(process.argv[2]);   // .../apps/api/dist/app.js
const app = createApp(process.env.LOG === '1');
await app.listen({ host: '127.0.0.1', port: Number(process.env.PORT ?? 3100) });
```

```bash
cd /Users/nectios/workspace-os/hackathons/codex-devday-exchange/growth-factcheking/apps/api
PORT=3100 LOG=1 FACT_CHECK_CACHE_TTL_MS=0 node --env-file-if-exists=../../.env serve.mjs "$PWD/dist/app.js"
curl -s -D - -X POST localhost:3100/api/fact-check/live -H 'content-type: application/json' -d '{"claim":"..."}'
```

## Smoke results (final code, cache disabled)

| # | Claim | Expected | HTTP | Verdict | Sources | Server-Timing |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Water boils at 100 degrees Celsius at sea level | yes / probably_yes | 200 | **yes** | sample-001 (water boiling point) | `embed;dur=413, search;dur=25, decide;dur=526, total;dur=963` |
| 2 | The Eiffel Tower is in Rome | no / probably_no | 200 | **no** | sample-002 (Eiffel Tower is in Paris) | `embed;dur=226, search;dur=9, decide;dur=306, total;dur=541` |
| 3 | Bitcoin closed above 100k yesterday | neutral, no sources, no Decisions call | 200 | **neutral** | `[]` | `embed;dur=256, search;dur=7, decide;dur=0, total;dur=264` |
| 4 | Water boils… with `OPENAI_TIMEOUT_MS=1` | 503 | **503** | — | — | none (error path); log: `APIConnectionTimeoutError` |

Response bodies:

```json
{"verdict":"yes","sources":[{"statement":"Water boils at 100 degrees Celsius at sea level.","sourceUrl":"https://example.org/sample/water-boiling-point"}]}
{"verdict":"no","sources":[{"statement":"The Eiffel Tower is located in Paris, France.","sourceUrl":"https://example.org/sample/eiffel-tower"}]}
{"verdict":"neutral","sources":[]}
{"message":"Fact-check service unavailable. Try again."}
```

All responses carry `X-Fact-Check-Mode: live`. Request #3 logged `reason: no_evidence`, `decideMs: 0`.

## Finding: relevance predicate rejected contradicting evidence (fixed in `aebb287`)

On the first smoke run (code at `07946e2`), claim #2 returned `neutral` (`reason: off_topic`, relevance 0.23,
choice `no`, confidence 1). The predicate asked whether evidence addressed "the same assertion", which the model
read as "agrees with". A direct probe of Decisions with one evidence item per claim:

| Claim | Evidence | Old wording: relevance | New wording: relevance | Choice (conf) |
| --- | --- | --- | --- | --- |
| The Eiffel Tower is in Rome | Eiffel Tower is in Paris | 0.23 | 0.69 | no (1.00) |
| The Eiffel Tower is in Paris | Eiffel Tower is in Paris | 1.00 | 1.00 | yes (1.00) |
| The Earth orbits the Sun every 300 days | Earth orbits every 365.25 days | 0.00 | 0.69 | no (0.81) |
| Humans have 30 pairs of chromosomes | Humans have 23 pairs | 0.00 | 0.98 | no (0.99) |
| The Eiffel Tower was built in 1889 | Eiffel Tower is in Paris | 0.43 | 0.00 | neutral (1.00) |
| Paris has the best food in Europe | Eiffel Tower is in Paris | 0.00 | 0.00 | neutral (1.00) |

With the old wording an off-topic pair (0.43) outscored every contradiction (0.00–0.23), so no
`VERDICT_MIN_RELEVANCE` value could separate them. The thresholds were therefore left unchanged and the predicate
wording was fixed instead ("same subject and the same property … answer true when the evidence contradicts").
The probe used 6 hand-picked pairs; it is not a calibration set.

## Latency (final code, 20 sequential calls, `FACT_CHECK_CACHE_TTL_MS=0`)

Claims cycled 5× over: water (true), Eiffel/Rome (false), 30 chromosome pairs (false), Earth 300 days (false).
All 20 reached Decisions and returned 200. Verdicts: 5× yes, 15× no (stable across repeats).

| Stage | p50 (ms) | p95 (ms) | min | max |
| --- | --- | --- | --- | --- |
| embed | 237 | 802 | 170 | 1126 |
| search | 7 | 13 | 2 | 18 |
| decide | 348 | 441 | 204 | 503 |
| **total** | **618** | **1132** | 390 | 1469 |

Target "< 800 ms total at p50": **met** (618 ms). The p95 tail comes from the Embeddings call (two outliers
at 802 and 1126 ms); Decisions stayed under 510 ms on all 20 calls and pgvector search under 20 ms. Percentiles
are nearest-rank over 20 samples from one machine on one network, so p95 is the 19th value and is noisy.

## Not covered

- No real corpus: 8 placeholder facts. Accuracy claims need a sourced corpus and a labelled set.
- No extension → live route call (extension still targets the mock route).
- Concurrency and cold-start behaviour were not measured.
