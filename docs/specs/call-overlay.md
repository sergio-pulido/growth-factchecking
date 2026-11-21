# Call overlay: live fact-checking over any call

Status: **implemented** (build, typecheck, lint, unit tests green; Meet e2e acceptance test green against the real
API). The tab-audio path was agent-run end to end against real OpenAI and Postgres on 2026-11-21
([evidence](../evidence/2026-11-21-call-overlay.md)). Not yet run with the extension loaded in Chrome, and the caption
readers have not met a real Meet, Zoom or Teams call.

UI source: the "FactCheck Prototype" design (collapsed pill, verdict bubbles, glass panel, screen-edge flash).
Backend contract: [conversation capture](conversation-capture.md). Previous Meet caption engine: [GF-03](meet-captions-capture.md).
There are no simulators: the overlay only runs over real pages.

## Where it runs

| Page | How the overlay appears | Source |
| --- | --- | --- |
| Google Meet call (`meet.google.com/xxx-xxxx-xxx`) | Pill appears on its own; toolbar icon grants tab capture | Microphone and tab audio, transcribed by OpenAI |
| Zoom web client (`*.zoom.us/wc/…`) | Same | Zoom captions (speaker names when Zoom shows them) |
| Teams web (`teams.microsoft.com`, `teams.live.com`, `teams.cloud.microsoft`) during a call | Same | Teams live captions |
| Any other tab | Toolbar icon opens it | Tab audio, transcribed by OpenAI |

Desktop apps (Zoom, Teams) are out of reach for a Chrome extension; their web clients work.

## Flow

```text
pill / toolbar icon -> panel with consent text (+ language picker in audio mode)
"Start checking" --- call-start ---> background ---> POST /api/conversations { platform, capture }
  captions: turn on the app's captions if off; skip what is already on screen
  audio:    tabCapture stream id -> offscreen document -> WebRTC to OpenAI live transcription
            (client secret from POST /api/transcription/token, language hint from the picker)
final segments, batched (1.2 s or 4 queued) --- call-send ---> POST /:id/utterances -> claims + verdicts
verdict -> bubble (collapsed) or card (open) + edge glow
Pause: nothing is sent (audio track muted); finished sentences said before the pause are kept, a half-said one is dropped
Stop -> POST /:id/end · Erase -> DELETE /:id · failed claim "Reintentar" -> POST /api/fact-check/live (not stored)
```

## Captions

**Zoom and Teams** (`call/platforms.ts`, `caption-source.ts`, `segmenter.ts`):

- One reader per app: region selector, block / speaker / text selectors, a structural fallback (first line of a block
  is the speaker), a hint shown when captions are missing, and the pill's distance from the app's own controls.
  The selectors are best-effort and the first thing to check when capture stops.
- Caption blocks rewrite themselves while someone speaks. A segment is final when its block has been stable for
  1.8 s, a newer block appears below it, it leaves the screen, or (in a long turn) a sentence ends and four more
  words follow. Re-alignment compares joined letters, so "32 000" -> "32.000" is sent once.

## Tab audio (`apps/extension/src/call/audio-source.ts`, `audio-capture.ts`, `offscreen.ts`)

- The toolbar click grants `activeTab`, which lets the background worker get a `tabCapture` stream id for that tab.
  One tab at a time; the captured tab id lives in `chrome.storage.session` so a suspended worker keeps routing.
- The offscreen document restores playback of the captured tab. In Meet, it mixes the microphone and the remote audio into one track. On other tabs it clones the tab track. It sends the result to OpenAI Realtime over WebRTC with the short-lived client secret. Pause disables the outgoing track and Stop closes both inputs. A dropped connection can reconnect with a fresh secret.
- Meet asks for microphone permission on a visible extension page. The user can close that page and start a new check from Meet once the permission is granted. The outgoing stream runs in the offscreen document as the user changes tabs or enters Picture-in-Picture. Meet's mute button controls the microphone for the call itself. FactCheck has its own Pause and Stop controls. [Chrome microphone capture example](https://github.com/GoogleChrome/chrome-extensions-samples/tree/main/functional-samples/cookbook.offscreen-user-media)
- `gpt-live-transcribe` sessions have no turn detection: they stream `…input_audio_transcription.delta` events into
  one open item and never send `completed`. The content side cuts that stream into sentences (a sentence is finished
  when another word follows it, a finished tail after 1.5 s of silence, an unfinished one after 8 s, run-ons at 60
  words). `completed` events are used only for items that sent no deltas (other models).
- The language picker (Español, English, Other = automatic) defaults to the browser language. The hint matters: in the
  run without it, "treinta y dos mil" came back as "train to Y dos mil".
- Speaker is **Call audio** in Meet and **Tab audio** elsewhere (`speakerKind: unknown`). The mixed audio has no participant labels.

## Panel (`apps/extension/src/call/panel.ts`, `cards.ts`, `alerts.ts`, `call.css`)

Closed shadow root, DOM APIs only (Meet enforces Trusted Types). English UI, as on main. Tabs: All, Needs attention, Transcript.
Cards show speaker, minute, claim, verdict and five-step scale, a one-line reading of the verdict and the sources.
The consent card also links to the selection check (the older panel, now mounted from the overlay).

## Privacy

Nothing is read before Start; captions already on screen at Start and speech said while paused are never sent; the
"Transcribing" indicator stays visible; the consent text asks the user to inform participants; "Delete
conversation" deletes the conversation, utterances and claims. Audio is never stored: it goes from the offscreen
document to OpenAI, and only text reaches the local API. The OpenAI key stays on the server; the extension only
holds 10-minute client secrets. The page URL sent with a conversation is origin and path only, and must match the
tab that sent it.

## Changes from the prototype

| Prototype | Here | Why |
| --- | --- | --- |
| "Skipped" tab | "Transcript" tab | The API does not return skipped sentences. |
| Suggested question, "¿Correcto?" feedback | Not shown | No data or storage for them yet. |
| Only the founder is checked | Every speaker is checked | Claim extraction is speaker-agnostic. Open question. |
| Motion library from a CDN, Inter font | Web Animations API, system font | MV3 forbids remote code. |
| Settings toolbar | Fixed defaults (flash on, bubbles for every verdict) | Prototype controls only. |

## Removed

All simulated calls: the "Simulate Google Meet" view of the old panel, `POST /api/meet/demo/check` with its scripted
transcript and tests, the Meet-like demo page, and the offline interview demo (`interview-demo.ts`) merged from
main. From GF-03, the capture session, controller, service-worker bridge and placeholder panel were replaced by the
overlay's session and panel; its DOM reader, consolidator, their unit tests and the e2e acceptance test stay (the
e2e test now drives `meet-source` + `session`).

## Open items

1. Load the extension in Chrome and run it in real Meet, Zoom web and Teams web calls; fix selectors.
2. Run the tab-audio path from the extension itself (the run in the evidence used the real modules with a stubbed
   `chrome` API and a recorded clip instead of `tabCapture`).
3. Decide whether to check every speaker or only selected participants.
4. Persist re-checks of failed claims in the conversation (needs an API route).
5. Verify the microphone permission and both sides of a real Chrome Meet call with version 0.4.6.
