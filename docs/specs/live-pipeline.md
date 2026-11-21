# Live fact-check pipeline

Status: **implemented** and wired in `createApp` (unit tests 17/17). Agent-run on a real stack (OpenAI + Postgres 17/pgvector) on 2026-11-21: smoke checks pass on `aebb287`, `b365e00` and `14a25ac` (source selection); p50 618 / 519 ms total over two 20-call runs (before `14a25ac`). See [docs/evidence/2026-11-21-live-smoke.md](../evidence/2026-11-21-live-smoke.md). A human re-run makes it **verified**; with that file it becomes **proven**.

## Flow

```text
POST /api/fact-check/live { claim }
  1. normalize + cache lookup (in-memory, TTL)        -> hit: return
  2. OpenAI Embeddings (text-embedding-3-small, 1536)  -> claim vector
  3. pgvector HNSW cosine top-k (FACT_TOP_K=5)         -> drop facts below FACT_MIN_SIMILARITY
  4. no facts left                                     -> neutral, sources [] (no Decisions call)
  5. OpenAI Decisions (gpt-6-luna), ONE call, two questions on shared input:
       choice source                      -> strongest numbered evidence item or none
       choice    verdict                  -> yes | probably_yes | neutral | probably_no | no (+ confidence)
  6. mapVerdict (conservative)
       refusal / unknown value         -> neutral
       no direct source or low source confidence -> neutral with no sources (off_topic)
       yes/no with confidence < VERDICT_MIN_CONFIDENCE -> probably_yes / probably_no
  7. response = shared FactCheckResult { verdict, sources[] }
     headers: X-Fact-Check-Mode: live, Server-Timing: embed/search/decide/total
```

The mock route `POST /api/fact-check?scenario=...` stays untouched for the UX demo.

## Why these choices

- **Decisions over Responses**: closed answer set, typed answer with probabilities, ~10x lower latency per OpenAI. Choice values are the shared verdict ids, so no translation layer.
- **Evidence as `input_json`**: claim + numbered evidence passed as structured data, judge instructions as a developer message.
- **Evidence selection**: Decisions picks the strongest fact that supports or challenges the claim, or `none` if no item addresses it. The API returns only the selected source when its selection confidence reaches `VERDICT_MIN_RELEVANCE`.
- **No retries, short timeout** (`OPENAI_TIMEOUT_MS=2500`): real-time UI; a failure returns 503 and the extension can re-ask.
- **Cache**: Meet captions and X timelines repeat claims; normalized-claim cache avoids repeated paid calls.

## Run locally

```bash
docker compose up -d db   # if 5432 is taken: FACTCHECK_DB_PORT=55432 and use that port in DATABASE_URL
cp .env.example .env   # fill OPENAI_API_KEY; DATABASE_URL default matches docker-compose
npm run build
npm run db:migrate
npm run seed -- /absolute/path/to/demo-facts.json
npm run start:live --workspace @growth-factcheking/api
```

The importer accepts a JSON array or `{"facts":[...]}`. Each entry needs a stable `id`, a `statement`, and an HTTP(S) `sourceUrl`. The optional `sourceTitle` identifies the original publication. The importer validates the full file and commits it in one transaction. Reusing an ID replaces the stored fact. Restart the API after importing while it is running to clear cached verdicts. Use sourced demo facts in place of the placeholder `data/facts.sample.json`.

## Open items

1. ~~Wire the route in `apps/api/src/app.ts`~~ done in `07946e2`.
2. Extension: switch endpoint to `/api/fact-check/live` behind a setting (mock stays the default for UX work). Owner: Codex.
3. Contract: consider adding `confidence` and per-source `similarity` to `FactCheckResult` once the UX needs them (proposal only).
4. Calibrate the three thresholds with ~30 labelled claims over a real corpus. Defaults are unchanged; the smoke run only exercised 4 claims and a 6-pair probe.
5. Latency: p50 618 / 519 ms meets the 800 ms target; p95 1132 / 935 ms comes from OpenAI variance (Embeddings in one run, Decisions in the other). Revisit only if the extension UX needs a tighter tail.
6. Replace `data/facts.sample.json` (8 placeholder facts) with a real sourced corpus (the importer above validates it).
7. Claim extraction (Meet captions, X posts): a separate step before this pipeline. Not in scope here.
