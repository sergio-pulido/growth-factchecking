# Live fact-check pipeline

Status: **implemented** (unit tests with fakes). Not yet **verified** against real OpenAI + Postgres.

## Flow

```text
POST /api/fact-check/live { claim }
  1. normalize + cache lookup (in-memory, TTL)        -> hit: return
  2. OpenAI Embeddings (text-embedding-3-small, 1536)  -> claim vector
  3. pgvector HNSW cosine top-k (FACT_TOP_K=5)         -> drop facts below FACT_MIN_SIMILARITY
  4. no facts left                                     -> neutral, sources [] (no Decisions call)
  5. OpenAI Decisions (gpt-6-luna), ONE call, two questions on shared input:
       predicate evidence_addresses_claim -> relevance probability
       choice    verdict                  -> yes | probably_yes | neutral | probably_no | no (+ confidence)
  6. mapVerdict (conservative)
       refusal / unknown value         -> neutral
       relevance < VERDICT_MIN_RELEVANCE -> neutral (off_topic)
       yes/no with confidence < VERDICT_MIN_CONFIDENCE -> probably_yes / probably_no
  7. response = shared FactCheckResult { verdict, sources[] }
     headers: X-Fact-Check-Mode: live, Server-Timing: embed/search/decide/total
```

The mock route `POST /api/fact-check?scenario=...` stays untouched for the UX demo.

## Why these choices

- **Decisions over Responses**: closed answer set, typed answer with probabilities, ~10x lower latency per OpenAI. Choice values are the shared verdict ids, so no translation layer.
- **Evidence as `input_json`**: claim + numbered evidence passed as structured data, judge instructions as a developer message.
- **Relevance predicate**: vector similarity alone cannot tell "same topic" from "same assertion". The predicate gates the verdict so off-topic evidence never yields a confident yes/no.
- **No retries, short timeout** (`OPENAI_TIMEOUT_MS=2500`): real-time UI; a failure returns 503 and the extension can re-ask.
- **Cache**: Meet captions and X timelines repeat claims; normalized-claim cache avoids repeated paid calls.

## Run locally

```bash
docker compose up -d db
cp .env.example .env   # fill OPENAI_API_KEY; DATABASE_URL default matches docker-compose
npm run build
npm run db:migrate
npm run seed -- data/facts.sample.json
```

`data/facts.sample.json` is a placeholder corpus with example.org sources. Replace it with a real sourced corpus before any demo claim of accuracy.

## Open items

1. Wire the route in `apps/api/src/app.ts`: `import { registerLiveFactCheck } from './live/route.js';` then `registerLiveFactCheck(app);` inside `createApp`.
2. Extension: switch endpoint to `/api/fact-check/live` behind a setting (mock stays the default for UX work).
3. Contract: consider adding `confidence` and per-source `similarity` to `FactCheckResult` once the UX needs them.
4. Calibrate the three thresholds with ~30 labelled claims; measure p50/p95 from `Server-Timing`.
5. Claim extraction (Meet captions, X posts): a separate step before this pipeline. Not in scope here.
