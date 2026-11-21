# Call fact-check timeouts — load runs, 2026-11-21

Branch: `fix/call-check-timeouts`. Run by the Claude Code agent against real OpenAI and Postgres; not a human run.

## Problem

Claims found in a call were fact-checked with the interactive route's OpenAI client: 2.5 s per call, no retries.
During PR #7's e2e run one claim came back unchecked (`status: failed`); a direct re-check answered in 0.7 s and the
re-run passed, which points to a rare upstream spike above 2.5 s.

## Change

Conversation capture builds its fact-checker with its own client: `CLAIM_CHECK_TIMEOUT_MS` (default 5000) and
`CLAIM_CHECK_RETRIES` (default 1; the SDK retries timeouts, connection errors, 429 and 5xx). The interactive route
`/api/fact-check/live` keeps 2.5 s and no retries. Extraction is unchanged (10 s, no retry). Worst case for one
batch ≈ 10 s extraction + 2 calls × (5 s + retry 5 s + backoff) ≈ 32 s, under the extension's 45 s request timeout.

## Runs

Isolated database `relevance_eval` with the investor-pitch corpus (5 facts). Each round posts the 16-utterance
pitch as N conversations in parallel (5 batches each, `FACT_CHECK_CACHE_TTL_MS=0`); "failed" = claims returned
with `status: failed`.

| Setup | Rounds | Claims | Failed | Batch p50 / max (ms) |
| --- | --- | --- | --- | --- |
| main (2.5 s, 0 retries) | 3 × N=4, 2 × N=10 | 230 | 0 | 2032–2273 / 3055–4359 |
| this branch, defaults (5 s, 1 retry) | N=10, N=4 | 100 | 0 | 1941–2125 / 2473–3511 |
| fault injection: 400 ms, 0 retries | N=10, N=4 | 98 | **16** | 2003–2042 / 3693–3913 |
| fault injection: 400 ms, 1 retry | N=10, N=4 | 98 | **1** | 2068–2069 / 3436–4106 |

- The natural failure did not reproduce in 230 claims on main: it is rare.
- With calls forced to exceed the timeout, one retry cut failures from 16 % to 1 %.
- Defaults add no measurable latency.
- Meet e2e on this branch: pass (yes / no), 0 server errors. API tests 31/31, extension 28/28, lint clean.

## Not covered

Extraction retries (a failed extraction leaves a batch without claims; transcript is kept) and real call traffic.
