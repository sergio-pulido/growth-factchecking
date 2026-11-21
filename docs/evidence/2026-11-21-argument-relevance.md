# Argument relevance (optional extra) — real-stack run, 2026-11-21

Ticket: GF-04. Branch: `feat/argument-relevance`. Spec: `docs/specs/argument-relevance.md`.

## Evidence level

- **Implemented**: API tests 39/39 (9 new: flag off unchanged, flag on, failure isolation, paired choice mapping,
  store SQL untouched when off, config default off). Lint clean.
- **Run on a real stack by the Claude Code agent**: conversations API → Postgres 17 + pgvector → OpenAI
  (extraction, fact-check, Decisions for relevance). Not *verified* under the Alodai definition (no human run).

## Setup

Isolated database `relevance_eval` in the local Postgres container (the shared demo DB holds near-duplicate facts
that skew source selection). Corpus and pitch from `codex/pitch-evaluation`: `data/demo/investor-pitch/facts.json`
(5 facts) and `pitch.json` (5 batches, 16 utterances, 7 labelled claims). API built from this branch on
127.0.0.1:3100, `FACT_CHECK_CACHE_TTL_MS=0`. A scratch script posted each batch to
`/api/conversations/:id/utterances` and compared the returned claims with the labels.

```bash
export DATABASE_URL=postgres://factcheck:factcheck@127.0.0.1:55432/relevance_eval
node apps/api/dist/scripts/migrate.js        # 001–004 applied (this migration was 004 then; renumbered 005 after main took 004)
node apps/api/dist/scripts/seed.js facts.json  # Imported 5 facts
ARGUMENT_RELEVANCE_ENABLED=true  …  # runs 1–2;  flag unset … # runs 3–4
```

## Results, extra ON (2 runs, identical)

| Claim | Verdict | Source | Relevance | Cited context | vs label |
| --- | --- | --- | --- | --- | --- |
| 42 clientes de pago | yes | ok | insufficient_context | — | ok |
| MRR 32.000 € | no | ok | high | pregunta-mrr | ok |
| Retención julio 90 % | yes | ok | high | pregunta-julio | ok |
| Eurostat 45,2 % (during retention question) | yes | ok | low | pregunta-julio | ok |
| Retención agosto 75 % | yes | ok | partial | pregunta-trimestre | ok |
| Piloto Hospital Mirador | neutral | ok (none) | high | pregunta-piloto | ok |
| Eurostat 45,2 % (after cloud thesis) | yes | ok | high | tesis-mercado | ok |

**7/7 labelled claims matched in both runs**; no extra claims extracted (opinion and projection skipped). 0 server
errors.

## Results, extra OFF (2 runs, identical)

Same 7 verdicts and sources; no `argumentRelevance` key in batch responses or in `GET /api/conversations/:id`
(7 claims, 0 with the key); no "Argument relevance" startup log.

## Latency (ms per batch, 10 batches each)

| | Batches | Median |
| --- | --- | --- |
| Extra ON | 3766, 2121, 1975, 1630, 2757, 2034, 1899, 1879, 1349, 3027 | ≈ 2005 |
| Extra OFF | 1882, 2199, 1704, 1680, 3660, 2150, 2117, 2179, 1643, 1894 | ≈ 2006 |

No measurable difference at this size: the relevance call runs in parallel with the fact-check of the same claim.
Small sample, one machine.

## Not covered

- Meet-captured conversations (less explicit questions), other pitches, English.
- UI rendering of the field.
