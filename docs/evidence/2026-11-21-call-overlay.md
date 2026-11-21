# Call overlay: agent runs, 2026-11-21

Spec: [docs/specs/call-overlay.md](../specs/call-overlay.md). Run by the Claude Code agent, not by a human. The
extension was not loaded in Chrome, and no real Meet, Zoom or Teams call was used.

## Checks

| Command | Result |
| --- | --- |
| `npm run typecheck` | pass |
| `npm run lint` | pass (1 pre-existing warning in `apps/api/src/conversations/service.ts`) |
| `npm run build` | pass; `dist/` holds background, call-content, offscreen (.js + .html), x-content, x-demo |
| `npm test` | API 26/26 (the 4 simulator tests were removed with the simulator), extension segmenter 12/12 |

## Stack

Worktree build. API on 127.0.0.1:3170 via a scratch launcher importing `createApp` (3000 and 3100 were in use by
other sessions). OpenAI and Postgres from the main checkout's `.env`, Postgres on host port 55432. Three fictional
facts were seeded for the runs and deleted afterwards; every test conversation was erased (0 rows left).

## Run 1: caption path (before the generalisation)

The panel, caption reader and segmenter ran against a Meet-like page with Meet's caption markup, against the real
API. Start, captions turned on by the panel, 11 utterances and 5 claims stored, verdicts as the corpus allows
(42 customers yes, €32.000 MRR no, others neutral), Stop and Erase (rows 0/0/0). A caption draft revised on screen
("32 000" -> "32.000") was sent once. That test page has since been deleted, as asked. The caption readers for Meet,
Zoom and Teams have not met real calls.

## Run 2: OpenAI live transcription handshake

A scratch page opened a WebRTC connection to `POST https://api.openai.com/v1/realtime/calls` with a client secret
from `POST /api/transcription/token` and played a Spanish clip made with macOS `say`.

| Finding | Effect on the code |
| --- | --- |
| `201`, peer `connected`, `session.created` with `turn_detection: null` | Handshake as implemented works |
| Only `conversation.item.input_audio_transcription.delta` events, one item, never `completed` | Content side now cuts the delta stream into sentences |
| No language hint: "L train to Yuno de octubre de dos mil vinte e seis… quarenta… trinta" | Language picker added |
| Hint `es`: "Hola a todos, el treinta y uno de octubre de dos mil veintiséis teníamos cuarenta y dos clientes de pago…" | Default from the browser language |

## Run 3: tab-audio path end to end

The real `offscreen.ts`, `audio-source.ts`, session and panel ran in a scratch page; a stub `chrome` object played
the background worker and a recorded clip replaced the `tabCapture` stream. Real OpenAI and real API.

| Step | Result |
| --- | --- |
| Consent card in audio mode | "Verificar el audio de esta pestaña", language picker, Start |
| Hint `en` (browser default in the test pane) | "treinta y dos mil" heard as "train to Y dos mil"; a wrong claim got flagged |
| Hint `es` | Claims "Nebula Salud tenía cuarenta y dos clientes de pago." → yes; "…registró treinta y dos mil euros de ingresos recurrentes mensuales." → no |
| Stop | Conversation ended; 7 utterances, 3 claims stored |
| Erase | 0 rows left |

At the very end of the clip the model released the last words seconds apart ("Creo que vamos muy" … "bien.").
Unfinished sentences now wait 8 s before being cut; the last word still arrived as its own line because the clip
ended in silence.

## Review fixes after run 3 (not re-run in a browser)

An independent code review of the Chrome integration led to these fixes: a reloaded tab now releases its audio capture
(reloads carry no url change); the background stops the capture when the tab no longer listens; the tab stream id is
requested after the slow token and offscreen steps; a stop during start or reconnect no longer leaves a capture or
peer connection behind; a stale capture record no longer blocks other tabs; deltas are forwarded in order; an
orphaned content script from before an extension reload is replaced. Typecheck, lint, build and tests pass after
them; the browser runs above predate them.

Known limitation: after a short pause, the model can still release a few words said just before the pause; they are
stored as a fragment after resume. Nothing said during the pause is sent.

## Not covered

- The extension loaded in Chrome: content scripts, toolbar toggle, `tabCapture`, offscreen document lifecycle.
- Real Meet, Zoom web and Teams web caption markup.
- Pause in audio mode, reconnection with a fresh secret, the API-down path, "Reintentar".
