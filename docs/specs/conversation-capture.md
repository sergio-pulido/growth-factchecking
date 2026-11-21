# [GF-02] Conversation capture, transcript storage and claim extraction

Status: API side **implemented** (tests 30/30) and agent-run on a real stack on 2026-11-21, see
[docs/evidence/2026-11-21-conversation-capture.md](../evidence/2026-11-21-conversation-capture.md).
Extension capture: implemented for Meet captions (GF-03 engine, `docs/specs/meet-captions-capture.md`), Zoom web
and Teams web captions and tab audio, all behind the call overlay ([call-overlay.md](call-overlay.md)).

## Goal

Capture what every participant says or writes in a call or on a page (Google Meet, Teams, Zoom web, YouTube,
X, any page), store the transcript in Postgres, extract the checkable claims and fact-check each one with the
live pipeline (`docs/specs/live-pipeline.md`).

## Decisions (Sergio, 2026-11-21)

| Topic | Decision |
| --- | --- |
| Capture | Captions and page text first (speaker names come from the page); tab audio + OpenAI live transcription as fallback. |
| Facts | Extract claims, fact-check them, save transcript + claims + verdicts. Claims never enter the evidence corpus. |
| Split | API side: Claude Code. Capture inside the extension: Codex, against the contract below. |
| Consent | Nothing is captured until the user presses Start on that tab. A visible "Transcribing" indicator stays on while capture runs. The user informs participants. Data stays in the local database. |

## Architecture

```text
Extension (Codex)                                   API (this spec)                          Postgres
-----------------                                   ---------------                          --------
Start pressed on a tab
  POST /api/conversations ------------------------> create conversation -------------------> conversations
  captions / chat / page text  ┐
  tab audio -> OpenAI Realtime ┘ (token from POST /api/transcription/token)
  final utterances, batched
  POST /api/conversations/:id/utterances ---------> 1. store (dedupe by clientId) ---------> utterances
                                                    2. extract claims (OpenAI Responses,
                                                       Structured Outputs, recent context)
                                                    3. fact-check each claim (live pipeline)
                                                    4. store claims + verdicts ------------> claims
  <------------------------------------------------ claims with verdicts
  show verdicts in the overlay
Stop pressed
  POST /api/conversations/:id/end
Review / erase
  GET    /api/conversations/:id                     transcript + claims
  DELETE /api/conversations/:id                     cascade delete (GDPR erasure)
```

Audio never reaches the API: the extension streams it straight to OpenAI with a short-lived client secret,
and posts only the final transcript text back. The API key stays on the server.

## Contract (`packages/shared/src/conversations.ts`)

- `POST /api/conversations` `{ platform, capture, title?, pageUrl?, language? }` → `201 { id }`
  - `platform`: free lowercase id, `^[a-z0-9_-]{1,32}$` (e.g. `meet`, `teams`, `zoom`, `youtube`, `x`, `web`).
  - `capture`: `captions | page_text | audio`.
- `POST /api/conversations/:id/utterances` `{ utterances: UtteranceInput[] }` (1–50 per batch) →
  `200 { accepted, duplicates, extraction: ok | skipped | failed, claims: ClaimCheck[] }`
  - `UtteranceInput`: `{ clientId, speaker, speakerKind: named | self | others | unknown, text, spokenAt }`.
  - Send **final** utterances only (a finished caption line, a finished audio transcript item).
    Live captions rewrite themselves while someone speaks; send the line once it stops changing.
  - `clientId` is stable per utterance (`^[A-Za-z0-9_.:-]{1,128}$`). Re-sending it is a no-op.
  - Utterances are stored before extraction. If extraction fails, `extraction: failed` and the transcript is kept.
  - A claim whose fact-check fails is stored with `status: failed` and no verdict.
- `GET /api/conversations/:id` → conversation, utterances in order, claims with verdicts.
- `POST /api/conversations/:id/end` → `204`.
- `DELETE /api/conversations/:id` → `204`; removes the conversation, its utterances and claims.
- `POST /api/transcription/token` `{ language? }` (send `{}` when there is no hint) → `{ value, expiresAt, model }`, a Realtime client secret for a
  `transcription` session (`TRANSCRIPTION_MODEL`, default `gpt-live-transcribe`), valid 10 minutes.
- All routes answer `503` when `OPENAI_API_KEY` or `DATABASE_URL` is missing, `404` for an unknown conversation,
  `409` when posting to an ended conversation.

## Claim extraction

- Model: `CLAIM_EXTRACTION_MODEL` (default `gpt-6-luna`), Responses API with a strict JSON schema,
  `CLAIM_EXTRACTION_EFFORT` (default `low`), `store: false`, own client with `CLAIM_EXTRACTION_TIMEOUT_MS`
  (default 10 000; the fact-check client's 2.5 s timeout was too short for extraction).
- Input: the new utterances (`u1…un`) plus up to `CLAIM_CONTEXT_UTTERANCES` (default 6) previous ones as
  context only.
- Extract statements about the world that records could confirm or refute (numbers, dates, places, events,
  attributions). Skip questions, opinions, predictions, plans, hypotheticals and small talk.
- Each claim is rewritten to stand alone (pronouns resolved from context), in the speaker's language, without
  adding information. A relayed claim ("the slide says X") is extracted as X. References to unknown utterances
  are dropped; at most 20 claims per batch.

## Data (`db/migrations/002_conversations.sql`)

`conversations` (uuid) → `utterances` (unique `conversation_id, client_id`) → `claims` (verdict, sources jsonb,
reason, relevance, confidence, status). Deleting a conversation cascades.

## Privacy

- Capture starts only on an explicit Start, per tab; the indicator is always visible while capturing.
- The API binds to 127.0.0.1. The token endpoint has no auth and must stay local-only.
- Speaker names and words are personal data. Store only what the page shows; no audio is stored anywhere.
- `DELETE /api/conversations/:id` is the erasure path. Retention: manual for the hackathon (open item).

## Out of scope

Meeting bots, speaker identification from audio, a hosted deployment, auth, retention automation.

## Open items

1. Capture in the extension: done for captions and tab audio ([call-overlay.md](call-overlay.md)); chat and page-text
   readers remain.
2. Retention policy. The call overlay has a "delete this conversation" control.
3. Evaluate extraction on varied real transcripts (Spanish and English, cross-talk, numbers).
