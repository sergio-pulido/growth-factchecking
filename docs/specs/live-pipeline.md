# Live fact-check pipeline

Status: **Available** at `POST /api/fact-check/live` when configured.

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
docker compose up -d db
cp .env.example .env   # fill OPENAI_API_KEY; DATABASE_URL default matches docker-compose
npm run build
npm run db:migrate
npm run seed -- /absolute/path/to/demo-facts.json
npm run start:live --workspace @growth-factcheking/api
```

The importer accepts a JSON array or `{"facts":[...]}`. Each entry needs a stable `id`, a `statement`, and an HTTP(S) `sourceUrl`. The optional `sourceTitle` identifies the original publication. The importer validates the full file and commits it in one transaction. Reusing an ID replaces the stored fact. Restart the API after importing while it is running to clear cached verdicts. Use sourced demo facts in place of the placeholder `data/facts.sample.json`.

## Open items

2. Extension: switch endpoint to `/api/fact-check/live` behind a setting (mock stays the default for UX work).
3. Contract: consider adding `confidence` and per-source `similarity` to `FactCheckResult` once the UX needs them.
4. Calibrate the three thresholds with ~30 labelled claims; measure p50/p95 from `Server-Timing`.
5. Claim extraction (Meet captions, X posts): a separate step before this pipeline. Not in scope here.
