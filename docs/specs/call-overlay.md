# Call overlay: live fact-checking over any call

Status: **implemented** (build, typecheck, lint, unit tests green). The tab-audio path was agent-run end to end
against real OpenAI and Postgres on 2026-11-21 ([evidence](../evidence/2026-11-21-call-overlay.md)). Not yet run
with the extension loaded in Chrome, and the caption readers have not met a real Meet, Zoom or Teams call.

UI source: the "FactCheck Prototype" design (collapsed pill, verdict bubbles, glass panel, screen-edge flash).
Backend contract: [conversation capture](conversation-capture.md). There are no simulators: the overlay only runs
over real pages.

## Where it runs

| Page | How the overlay appears | Source |
| --- | --- | --- |
| Google Meet call (`meet.google.com/xxx-xxxx-xxx`) | Pill appears on its own; toolbar icon toggles it | Meet captions |
| Zoom web client (`*.zoom.us/wc/…`) | Same | Zoom captions (speaker names when Zoom shows them) |
| Teams web (`teams.microsoft.com`, `teams.live.com`, `teams.cloud.microsoft`) during a call | Same | Teams live captions |
| Any other tab | Toolbar icon opens it | Tab audio, transcribed by OpenAI |

Desktop apps (Zoom, Teams) are out of reach for a Chrome extension; their web clients work.

## Flow

```text
pill / toolbar icon -> panel with consent text (+ language picker in audio mode)
"Empezar a verificar" --- call-start ---> background ---> POST /api/conversations { platform, capture }
  captions: turn on the app's captions if off; skip what is already on screen
  audio:    tabCapture stream id -> offscreen document -> WebRTC to OpenAI live transcription
            (client secret from POST /api/transcription/token, language hint from the picker)
final segments, batched (1.2 s or 4 queued) --- call-send ---> POST /:id/utterances -> claims + verdicts
verdict -> bubble (collapsed) or card (open) + edge glow
Pause: nothing is sent (audio track muted); finished sentences said before the pause are kept, a half-said one is dropped
Stop -> POST /:id/end · Erase -> DELETE /:id · failed claim "Reintentar" -> POST /api/fact-check/live (not stored)
```

## Captions (`apps/extension/src/call/platforms.ts`, `caption-source.ts`, `segmenter.ts`)

- One reader per app: region selector, block / speaker / text selectors, a structural fallback (first line of a block
  is the speaker), a hint shown when captions are missing, and the pill's distance from the app's own controls.
  The selectors are best-effort and the first thing to check when capture stops.
- Caption blocks rewrite themselves while someone speaks. A segment is final when its block has been stable for
  1.8 s, a newer block appears below it, it leaves the screen, or (in a long turn) a sentence ends and four more
  words follow. Re-alignment compares joined letters, so "32 000" -> "32.000" is sent once.

## Tab audio (`apps/extension/src/call/audio-source.ts`, `audio-capture.ts`, `offscreen.ts`)

- The toolbar click grants `activeTab`, which lets the background worker get a `tabCapture` stream id for that tab.
  One tab at a time; the captured tab id lives in `chrome.storage.session` so a suspended worker keeps routing.
- The offscreen document opens the stream, plays it back (capturing a tab mutes it otherwise), and sends a cloned
  track to `https://api.openai.com/v1/realtime/calls` over WebRTC with the short-lived client secret. Pause disables
  the cloned track only. It reconnects up to three times with a fresh secret if the connection drops.
- `gpt-live-transcribe` sessions have no turn detection: they stream `…input_audio_transcription.delta` events into
  one open item and never send `completed`. The content side cuts that stream into sentences (a sentence is finished
  when another word follows it, a finished tail after 1.5 s of silence, an unfinished one after 8 s, run-ons at 60
  words). `completed` events are used only for items that sent no deltas (other models).
- The language picker (Español, English, Otro = automatic) defaults to the browser language. The hint matters: in the
  run without it, "treinta y dos mil" came back as "train to Y dos mil".
- Speaker is "Audio de la pestaña" (`speakerKind: unknown`). Only the tab's audio is captured: the user's own
  microphone is not.

## Panel (`apps/extension/src/call/panel.ts`, `cards.ts`, `alerts.ts`, `call.css`)

Closed shadow root, DOM APIs only (Meet enforces Trusted Types). Tabs: Todas, Requieren atención, Transcripción.
Cards show speaker, minute, claim, verdict and five-step scale, a one-line reading of the verdict and the sources.
The consent card also links to the selection check (the older panel, now mounted from the overlay).

## Privacy

Nothing is read before Start; captions already on screen at Start and speech said while paused are never sent; the
"Transcribiendo" indicator stays visible; the consent text asks the user to inform participants; "Borrar
conversación" deletes the conversation, utterances and claims. Audio is never stored: it goes from the offscreen
document to OpenAI, and only text reaches the local API. The OpenAI key stays on the server; the extension only
holds 10-minute client secrets. The page URL sent with a conversation is origin and path only, and must match the
tab that sent it.

## Changes from the prototype

| Prototype | Here | Why |
| --- | --- | --- |
| "Omitidas" tab | "Transcripción" tab | The API does not return skipped sentences. |
| Suggested question, "¿Correcto?" feedback | Not shown | No data or storage for them yet. |
| Only the founder is checked | Every speaker is checked | Claim extraction is speaker-agnostic. Open question. |
| Motion library from a CDN, Inter font | Web Animations API, system font | MV3 forbids remote code. |
| Settings toolbar | Fixed defaults (flash on, bubbles for every verdict) | Prototype controls only. |

## Removed

The Meet simulators: the "Simular Google Meet" view of the old panel, `POST /api/meet/demo/check` with its scripted
transcript and tests, and the Meet-like demo page.

## Open items

1. Load the extension in Chrome and run it in real Meet, Zoom web and Teams web calls; fix selectors.
2. Run the tab-audio path from the extension itself (the run in the evidence used the real modules with a stubbed
   `chrome` API and a recorded clip instead of `tabCapture`).
3. Decide whether to check every speaker or only selected participants.
4. Persist re-checks of failed claims in the conversation (needs an API route).
5. Include the user's microphone in audio mode (needs mic permission and mixing).
