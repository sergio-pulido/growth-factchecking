# Conversation capture API — real-stack run, 2026-11-21

Ticket: GF-02 (API side). Spec: `docs/specs/conversation-capture.md`.
Code under test: this commit's tree (built from the GF-02 worktree on top of `e75365b`).

## Evidence level

- **Implemented**: unit tests with fakes, `npm test` 30/30 (15 new in `apps/api/test/conversations.test.js`).
- **Run on a real stack, by the Claude Code agent**: real OpenAI (Responses, Embeddings, Decisions, Realtime
  client secrets) and Postgres 17.12 + pgvector 0.8.7, corpus = the 8 placeholder facts.
- Not yet **verified** under the Alodai definition (a human run). No extension capture exists yet, so every
  utterance below was posted by a script, not read from a real call.

## Stack

`openai` 7.62.0, Node 22.23.5. Extraction: `gpt-6-luna`, `reasoning.effort=low`, `store: false`, 10 s timeout.
Fact-checks: the live pipeline with default thresholds. Transcription token: `gpt-live-transcribe`, TTL 600 s.
Local deviations as in `2026-11-21-live-smoke.md`: db on host port 55432, server on 3100 via a scratch launcher
that imports `createApp` from `apps/api/dist/app.js`.

```bash
cd /Users/nectios/workspace-os/hackathons/codex-devday-exchange/growth-factcheking
export DATABASE_URL=postgres://factcheck:factcheck@127.0.0.1:55432/factcheck
npm run build && npm test          # 30/30
npm run db:migrate                 # Applied 001_facts.sql, Applied 002_conversations.sql
```

## Run 1 (before fixes)

Batch 1 returned `200` with `extraction: failed`: extraction shared the fact-check client's 2.5 s timeout
(`APIConnectionTimeoutError`). The 5 utterances were stored anyway, as designed. Batch 2 extracted
"The slide says humans have 30 pairs of chromosomes." (attribution kept in the claim).

Fixes: a separate OpenAI client for extraction and tokens (`CLAIM_EXTRACTION_TIMEOUT_MS`, default 10 000), and an
instruction to extract the relayed claim itself ("the slide says X" → X).

## Reasoning effort probe (6 English lines, 2 runs each)

| Effort | Latency | Claims |
| --- | --- | --- |
| model default | 2065, 1844 ms | Eiffel Tower in Rome; humans 30 chromosome pairs; water boils at 100 °C |
| low | 1092, 1077 ms | same 3 |
| none | 1077, 1112 ms | same 3 |

The greeting, the opinion and "Next quarter we will probably double revenue" were skipped in every run.
Default set to `low`.

## Run 2 (after fixes), English, 3 named speakers

| Step | Result |
| --- | --- |
| `POST /api/conversations` (meet, captions) | 201, 48 ms |
| Batch 1: 5 utterances | 200, 1923 ms, `extraction: ok`, 3 claims |
| Batch 2: 3 utterances | 200, 2333 ms, `extraction: ok`, 1 claim |
| Re-send `c5` | `{"accepted":0,"duplicates":1,"extraction":"skipped","claims":[]}` |
| `GET /api/conversations/:id` | 200, 8 utterances, 4 claims |
| `POST /api/transcription/token` | 200, 639 ms, `gpt-live-transcribe`, expires in 600 s, `ek_…` (value not recorded) |
| `POST …/end`, then post again | 204, then 409 |
| `DELETE /api/conversations/:id` | 204; rows left: conversations 0, utterances 0, claims 0; `GET` → 404 |

Claims:

| Speaker | Utterance | Claim | Verdict |
| --- | --- | --- | --- |
| Ben | "Quick fact for the trip deck: the Eiffel Tower is in Rome." | The Eiffel Tower is in Rome. | no |
| Ana | "Also, humans have 30 pairs of chromosomes, right? No wait, I mean that is what the slide says." | Humans have 30 pairs of chromosomes. | no |
| Ben | "And water boils at 100 degrees Celsius at sea level." | Water boils at 100 degrees Celsius at sea level. | yes |
| Ana | "From the slide. It says they have 30 pairs." (context: the chromosome question) | Humans have 30 pairs of chromosomes. | no |

Skipped: "Hi everyone, can you hear me?", "I think the deck looks great.", "Where did you get the chromosome
number?", "Next quarter we will probably double revenue." The 4th claim shows context resolution ("they" →
humans) from earlier utterances.

## Run 3, Spanish, audio-style speakers (`self` / `others`)

Batch of 4 utterances: 200, 3263 ms, `extraction: ok`.

| Speaker | Claim | Verdict | Source |
| --- | --- | --- | --- |
| Others | La Torre Eiffel está en París. | yes | The Eiffel Tower is located in Paris, France. |
| Others | El agua hierve a 90 grados a nivel del mar. | no | Water boils at 100 degrees Celsius at sea level. |
| Me | Barcelona es la capital de Cataluña. | yes | Barcelona is the capital of Catalonia. |

One utterance held two claims and was split. The greeting and "Me encanta esta idea, seguro que funcionará"
were skipped. Spanish claims matched English facts. The conversation was deleted afterwards.

## Not covered

- No real capture: captions, page text and tab audio are not implemented in the extension yet (Codex).
- The Realtime token was minted, but no audio was streamed with it.
- 3 short scripted conversations and an 8-fact placeholder corpus. This is not an accuracy evaluation.
- Batch latency (1.9–3.3 s) is extraction (~1.1 s) plus parallel fact-checks; not measured under load.
