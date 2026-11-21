# Meet captions capture — acceptance run, 2026-11-21

Ticket: GF-03. Branch: `feat/meet-captions-capture`. Spec: `docs/specs/meet-captions-capture.md`.

## Evidence level

- **Implemented**: extension unit tests 30/30 (consolidator, session, controller, DOM reader with jsdom), API
  tests 30/30, lint clean.
- **End-to-end on a real stack, by the Claude Code agent**: capture controller → real HTTP → API → Postgres 17 +
  pgvector → OpenAI extraction and live fact-check. Captions came from the scripted fixture, not from Meet.
- **Not run on a live Meet call** and not by a human: not *verified* under the Alodai definition.

## Setup

API built from the branch, served on 127.0.0.1:3100 by a scratch launcher importing `createApp`
(port 3000 was taken locally), db on host port 55432. Demo corpus `data/demo/meet-startup.json` (2 fictional
facts) seeded on top of the shared local DB (which also held 8 sample facts and 3 Nébula Salud demo facts).

```bash
export DATABASE_URL=postgres://factcheck:factcheck@127.0.0.1:55432/factcheck
npm run build && npm run lint && npm test           # API 30/30, extension 30/30
npm run db:migrate
npm run seed -- "$PWD/data/demo/meet-startup.json"  # Imported 2 facts
API_ORIGIN=http://127.0.0.1:3100 npm run test:e2e --workspace @growth-factcheking/extension
```

## Acceptance case

Fixture `apps/extension/test/fixtures/meet-call-es.mjs`: Laura Gómez (investor) and Marc Puig (founder), 22 caption
snapshots with growth, a corrected word ("2020" → "2021 en"), a shorter redraw, a 4.7 s pause inside one block and
blocks scrolling out. The first batch's response was dropped after the API stored it, to force a retry.

## Runs

| Run | Code | Result | Supported claim | Contradicted claim |
| --- | --- | --- | --- | --- |
| 1 | initial | fail | "Marc Puig y sus socios fundaron Lumen Labs en Barcelona en 2021." → neutral | → no |
| 2–4 | extraction fix | fail ×3 | "Lumen Labs se fundó en 2021 en Barcelona." → yes | → neutral (off_topic, relevance 0.36) |
| 5–7 | + distinct demo figure | **pass ×3** | → yes (relevance 0.85, confidence 0.98) | → no (relevance 0.64, confidence 0.60) |

Runs 2–4: the demo fact used 27 800 €, the same figure as a Nébula Salud fact already in the shared DB; Decisions
split its source selection between the two. Four direct calls to `/api/fact-check/live` gave relevance 0.36 every
time; after changing the demo figure to 31 200 €, 0.64 every time.

Every run, including the failing ones, stored the same 5 utterances once each with the right speakers:

| Speaker | Utterance |
| --- | --- |
| Laura Gómez | Hola Marc, gracias por venir. |
| Laura Gómez | ¿Cuántos ingresos recurrentes tenéis al mes? |
| Marc Puig | Fundamos Lumen Labs en 2021 en Barcelona. |
| Marc Puig | En octubre cerramos con 50.000 euros de ingresos recurrentes mensuales. |
| Laura Gómez | Me parece un equipo muy sólido. |

Passing-run checks (run 5, conversation `c0275cc5-9c62-4f17-93fa-7c74cb6d4c10`, kept for inspection):

- 5 utterances stored, 5 distinct clientIds; the retried batch came back as `duplicates ≥ 1`.
- Speakers preserved; the investor's question and opinion produced no claims.
- Claims: "Lumen Labs se fundó en 2021 en Barcelona." → **yes**; "Lumen Labs cerró octubre con 50.000 euros de
  ingresos recurrentes mensuales." → **no**.
- Conversation ended (`endedAt` set); after stop, 300 ms of new captions caused no reads and no requests.
- Stop drained the last batch in 3.0–4.0 s.

All conversations except run 5's were deleted afterwards.

After merging `origin/main` at `2a3b1da` (X sourced facts, migration 003, pipeline changes) into the branch:
build, lint and tests green (API 30/30, extension 30/30), migration 003 applied, and the end-to-end test passed
2/2 with the same verdicts (yes / no).

## Not covered

- Live Meet DOM (selectors), real caption quality, speaker labels for the local user, Chrome service-worker
  lifecycle during a long call.
- More than one scripted conversation; accuracy beyond this case.
