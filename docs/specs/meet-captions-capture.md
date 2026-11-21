# [GF-03] Google Meet captions capture (first milestone)

Status: **implemented** on branch `feat/meet-captions-capture` (extension tests 30/30, API tests 30/30).
End-to-end acceptance run against the real API on 2026-11-21: see
[docs/evidence/2026-11-21-meet-captions.md](../evidence/2026-11-21-meet-captions.md).
**Not yet run on a live Meet call**: the DOM selectors come from public 2026 caption readers and must be checked
in a real call with informed participants (protocol below).

Builds on `docs/specs/conversation-capture.md` (API) and `packages/shared/src/conversations.ts` (contract).

## What it does

An investor opens a Meet call, clicks the extension icon, presses **Start transcribing** and every visible
caption (investor questions included, for context) is consolidated into final utterances and sent to
`/api/conversations/:id/utterances`. Claims and verdicts come back and are shown in the panel. **Stop** stops
reading at once, sends what is pending and ends the conversation.

```text
meet.google.com tab (content script meet-capture.js)                         service worker            API
  readCaptionRows(document) every 300 ms ─┐
                                          ▼
  caption-consolidator: rows -> final utterances (stable clientId, speaker, spokenAt)
                                          ▼
  capture-session: batches (10 / 3 s), retries same clientIds, drain on stop ──► conversation-bridge ──► /api/conversations…
                                          ▼                                       (ends the conversation
  capture-controller: start/stop/state/subscribe ──► panel (or UX/UI code)         if the tab closes)
```

| File | Role |
| --- | --- |
| `apps/extension/src/meet/meet-captions-dom.ts` | Everything Meet-specific: region, row, speaker and text selectors; notice filter; button/icon stripping. |
| `apps/extension/src/meet/caption-consolidator.ts` | Partial captions → one utterance per intervention. Matches by speaker + words, never by DOM node. |
| `apps/extension/src/meet/capture-session.ts` | Conversation lifecycle, batching, retries, error kinds. Chrome-free. |
| `apps/extension/src/meet/capture-controller.ts` | Public controller for the UI. Chrome-free. |
| `apps/extension/src/meet/conversation-bridge.ts` | Service-worker proxy to the local API; ends open conversations on tab close. |
| `apps/extension/src/meet/meet-panel.ts` | Minimal default panel (replaceable). |
| `apps/extension/src/meet-capture.ts` | Content-script entry for `https://meet.google.com/*`; loads idle. |

## Consolidation rules

- A caption row belongs to the open turn of the same speaker when its words are a revision of it: growth, a shorter
  redraw (the fuller text is kept), or a rewrite that keeps the first 3 words or ≥ 60 % of the first 16 words.
- A turn is final when it has not changed for 1.2 s **and** it left the screen or a newer caption appeared, or
  after 4 s without changes. Stop flushes every open turn.
- A caption still on screen after it was emitted is never re-sent; words added later to the same block become a new
  utterance with only the new words (e.g. a pause inside one block).
- `clientId` = `meet-<8 hex per capture session>-<n>`, assigned when the caption first appears; retries re-send the
  queued object, so the same id. `spokenAt` = when the caption first appeared.
- Speaker: the name Meet shows; `Tú`/`You` → `speakerKind: "self"`; no name → `"Unknown"`, `"unknown"`.

## UX/UI integration points

The controller lives in the extension's isolated world on Meet tabs. Any script the extension injects there
(e.g. a redesigned panel) can use it:

```ts
const capture = window.growthMeetCapture!;   // installed by meet-capture.js
capture.start(): Promise<MeetCaptureState>   // explicit start (user gesture). Creates the conversation.
capture.stop():  Promise<MeetCaptureState>   // stops reading now, drains pending, ends the conversation.
capture.getState(): MeetCaptureState
capture.subscribe(listener) => unsubscribe   // called immediately and on every change
capture.showPanel()                          // opens the default panel (the icon click does this on Meet)
```

`MeetCaptureState` (`apps/extension/src/meet/capture-controller.ts`):

| Field | Use in the UI |
| --- | --- |
| `active` | **Show the "Transcribing" indicator whenever true** (starting, capturing, stopping). Must stay visible even if the panel is minimized. |
| `status` | `idle` → `starting` → `capturing` → `stopping` → `stopped`; or `error`. Disable Start/Stop during `starting`/`stopping`. |
| `captionsDetected` | `false` while capturing ⇒ prompt "Turn on Meet captions (CC)". |
| `conversationId` | For "view / delete conversation" actions (`GET`/`DELETE /api/conversations/:id`). |
| `sent`, `pending`, `duplicates`, `openTurns` | Progress. `duplicates` > 0 is normal after a retry. |
| `claims: ClaimCheck[]` | Speaker, claim, `verdict` (null when `status: "failed"`), `sources`. Labels: `verdictLabels`. |
| `extractionFailures` | Batches stored without claim analysis. |
| `error: { kind, message, at } \| null` | Latest problem, cleared by the next success. `message` is ready-to-show English copy (the UI is English since PR #4). |

Error kinds: `api_unreachable` (API down; retrying), `service_unavailable` (503: OpenAI/Postgres; retrying),
`conversation_closed` (409/404: capture stopped), `rejected` (400: batch dropped, capture continues).

To replace the default panel, remove the `mountMeetPanel` call in `meet-capture.ts` and render from `subscribe`.
Copy is English, matching the restyled overlay; consent text in the default panel: *"Tell participants before you
start. Only the visible captions in this tab are read."*

## Tests

```bash
cd /Users/nectios/workspace-os/hackathons/codex-devday-exchange/growth-factcheking
npm run build && npm test     # API + extension unit tests (extension: consolidator, session, controller, DOM via jsdom)
```

Reproducible changing-captions test: `apps/extension/test/fixtures/meet-call-es.mjs` (growth, corrected word,
shorter redraw, pause inside a block, scrolling) used by `caption-consolidator.test.mjs` and
`capture-controller.test.mjs`.

End-to-end acceptance (real API, Postgres, OpenAI; Spanish call, 2 people, one supported claim, one contradicted,
one opinion, plus a simulated lost response to prove idempotent retries):

```bash
cd /Users/nectios/workspace-os/hackathons/codex-devday-exchange/growth-factcheking
docker compose up -d db                       # FACTCHECK_DB_PORT=55432 if 5432 is taken; match DATABASE_URL
npm run build && npm run db:migrate
npm run seed -- "$PWD/data/demo/meet-startup.json"
npm run start:live --workspace @growth-factcheking/api      # needs OPENAI_API_KEY + DATABASE_URL in .env
API_ORIGIN=http://127.0.0.1:3000 npm run test:e2e --workspace @growth-factcheking/extension
```

## Manual test on a live Meet call (required before relying on it)

1. Tell every participant the call is being transcribed for fact-checking, and get their OK.
2. Start the API (above). Load `apps/extension/dist` as an unpacked extension (`chrome://extensions`).
3. In Meet: turn captions on (CC) and set the caption language to Spanish.
4. Click the extension icon → **Start transcribing**. Check the red "Transcribing" indicator.
5. Two people say the fixture lines (investor greeting + question, founder founding + revenue claims, investor
   opinion). Then **Stop**.
6. `GET /api/conversations/<id>`: speakers right, each intervention once, two verdicts. Record a dated note under
   `docs/evidence/` with the share of utterances whose speaker is `Unknown` and any missing or merged text.

## Limitations

Observed in our runs (2026-11-21):

- Near-duplicate facts about different entities split Decisions' source selection: with a Nébula Salud fact using
  the same figure in the shared demo DB, the contradicted claim fell to relevance 0.36 → `neutral`. With a distinct
  figure: 0.64 / confidence 0.60 → `no`, right at the softening threshold. Corpus quality decides verdicts.
- Extraction first rewrote "Fundamos Lumen Labs…" as "Marc Puig y sus socios fundaron…" (people never said), which
  evidence cannot confirm → `neutral`. Fixed in the extraction instructions (organization as subject).
- Stop takes 3–4 s: the last batch waits for extraction and fact-checks.

By design / not yet observed live:

- Selectors are unverified on a live call; obfuscated classes (`KcIKyf`, `bh44bd`, …) change without notice.
  The localized `aria-label` (Captions/Subtítulos) is the most stable hook; `captionsDetected` exposes breakage.
- Captions must be on, in the spoken language. Public reports describe them as lossy (paraphrase, missing
  punctuation) and, in some layouts, without a separate speaker element (→ `Unknown`).
- Closing the tab loses at most the last ~3 s of pending utterances; the background still ends the conversation.
- The API origin is hard-coded to `http://127.0.0.1:3000` like the rest of the extension.

**When to fall back to tab audio** (`/api/transcription/token`, GF-02): when, on live calls, `captionsDetected`
stays false with captions on, a large share of utterances end up `Unknown`, text is visibly lost against what
was said, or the platform has no captions. Decide with the numbers from the manual test above.
