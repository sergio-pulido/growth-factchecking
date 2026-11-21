# Growth FactChecking

Chrome extension that fact-checks what is said live on Google Meet, Zoom, Teams or any tab with audio, and posts on X.

| Espacio de trabajo | Contenido inicial |
| --- | --- |
| `apps/extension` | Manifest V3 extension: call overlay, selected-text checks and X checks. |
| `apps/api` | Local API: `GET /health`, `POST /api/fact-check`, `POST /api/fact-check/live`, conversations (`/api/conversations`) and `POST /api/transcription/token`. |
| `packages/shared` | Contrato TypeScript compartido por la extensión y la API. |

## Arranque local

Con Node.js 22.14 o posterior y npm, ejecuta desde la raíz.

```bash
npm ci
npm run dev
```

En otra terminal, comprueba que la API responde.

```bash
curl -fsS http://127.0.0.1:3000/health
```

Para abrir el panel, entra en `chrome://extensions`, activa **Modo de desarrollador**, pulsa **Cargar descomprimida** y selecciona `apps/extension/dist`. Abre una página web y pulsa el icono de la extensión.

## Fuente de verificación

Chrome recuerda la opción elegida en el panel. **Simulado** es la opción inicial y permite elegir un escenario de prueba. Para usar **Real**, selecciona una afirmación en la página, abre el panel y pulsa **Verificar**. La API busca evidencia en el corpus de PostgreSQL y envía los casos con evidencia a OpenAI Decisions.

Configura `OPENAI_API_KEY` y `DATABASE_URL` en `.env`. Para preparar la base de datos e importar hechos con fuentes, sigue las [instrucciones del backend real](docs/specs/live-pipeline.md).

## Local mocked stack

Open http://127.0.0.1:3000 after `npm run dev`. The sandbox lets you ingest JSON facts, inspect the corpus, search evidence, check a claim, and simulate every verdict or an HTTP 503. No API keys, database, Docker, or network access is needed at runtime. The API binds to loopback only. Restart it to reset the in-memory corpus to two fictional seed facts.

`npm run dev` builds the API, shared package and unpacked extension, then starts the server. Restart it after source edits; reload the extension in Chrome after rebuilding.

### Exercise the full flow

1. Open the sandbox and ingest the prefilled planetarium fact.
2. Repeat ingestion: the response should report `skipped: 1`.
3. Use `El planetario de Puerto Aurora abre los viernes.` as the claim and choose **Local pipeline**. Retrieval returns the ingested source and the mock verdict is `yes`.
4. Try an unrelated claim: expect neutral without sources. Try a similar but changed claim: the mock classifier returns neutral, even if retrieval finds related evidence.
5. Select a fixed scenario to exercise each verdict or the service error state.
6. Load `apps/extension/dist` in Chrome to exercise the extension’s fixed scenarios separately.

### Local API

| Route | Input / behavior |
| --- | --- |
| `GET /api/facts` | List the current fictional corpus |
| `POST /api/facts/ingest` | `{ "facts": [{ "id": "planetarium", "statement": "A fact", "sourceUrl": "https://example.com/source" }] }` |
| `POST /api/facts/search` | `{ "claim": "A fact" }`; returns up to five matches with cosine scores |
| `POST /api/fact-check` | `{ "claim": "A fact" }`; retrieves from the current corpus |
| `POST /api/fact-check?scenario=no` | Fixed demo response; bypasses corpus |

IDs are stable keys: a changed statement or source updates that fact, while exact replays are skipped. Batches accept 1–100 facts, reject duplicate IDs and invalid sources before writing, and never fetch the source URLs. Each app instance owns its store.

Mock embeddings are normalized 256-dimensional hashed word counts with a fixed similarity cutoff of 0.6. They exercise the vector plumbing; they do not model semantic meaning. Mock classification returns `yes` only for an exact stored statement (case and surrounding whitespace ignored), otherwise `neutral`. Importing a statement does not verify its truth. The separate live route uses OpenAI and PostgreSQL when configured.

`npm run lint` and `npm run typecheck` are local checks. CI builds and runs the complete API tests. See the [live backend instructions](docs/specs/live-pipeline.md) to run PostgreSQL, import a sourced corpus and call `/api/fact-check/live`.

## Live fact checks on X

Open the **Politics** timeline, X **Bookmarks** with demo posts saved, or an individual post from the [curated demo](docs/demo-x-posts.md). After installing or reloading the extension, refresh the X page. The extension checks complete, visible post text through the local API and OpenAI. It shows verdicts and source links below posts, and **Insufficient information** when the local corpus lacks direct evidence. On a post page it checks the linked post and skips the replies. Use **Pause inline checks** in the toolbar panel to stop.

La [demo local de publicaciones](http://127.0.0.1:3000/x-demo) usa el mismo renderizador y la API real sin instalar la extensión. Para cargar los hechos que necesita, ejecuta `npm run seed -- data/demo/x-politics.json` después de migrar la base de datos. Reinicia la API para limpiar los veredictos guardados. To restore the public-source corpus with its existing embeddings, follow the [snapshot instructions](docs/demo-x-posts.md#restore-the-demo-corpus). To regenerate only the real X demo facts, run `npm run seed -- data/demo/x-sourced-facts.json`.

## Overlay design (Michella and Tomás)

Design and UI contribution for the browser extension by Michella and Tomás. Tomás built the interactive prototype (`FactCheck Prototype.html`); its interaction model is the call overlay described below.

**Goal.** Show fact checks next to the content a person is already watching, reading or listening to, in a panel that stays out of the way: each claim with a verdict and links to its sources, without leaving the page.

**Selection panel** (`apps/extension/src/overlay.css`, `overlay.ts`): floating glass panel, movable by its header, minimisable, with a soft glow while a check runs; English verdict labels (True, Likely true, Neutral, Likely false, False) and source links with their domain. It checks the text selected on a page and controls the X checks.

**Call overlay** (`apps/extension/src/call/`), from Tomás's prototype:

- A collapsed pill with live waves, pause and stop, that morphs into a glass panel.
- Summary line (checked, in progress, needs attention) with a bar showing the mix of verdicts.
- Tabs: All, Needs attention (False and Likely false) and Transcript.
- Each claim card: speaker, minute, 5-step verdict scale, a one-line reading of the verdict and its sources; "Not checked" with Retry when the check fails.
- The screen edge briefly tints with the verdict colour when a result arrives; with the panel collapsed, new verdicts appear as bubbles above the pill, and clicking one opens the panel on that claim.

## Live fact-checking on calls

Click the extension icon on the call's tab to open the FactCheck overlay. On Google Meet, Zoom (web client) and Microsoft Teams (web), the **Check this call** pill also appears on its own once you are in a call. The panel says what it will do; tell the participants, then press **Start checking**.

- **Meet, Zoom web and Teams web:** the extension reads the app's own captions, with the speaker's name, and turns them on if they are off. Meet captions go through the GF-03 caption engine ([spec](docs/specs/meet-captions-capture.md)).
- **Any other tab** (another video service, a webinar, a YouTube interview…): the extension captures the tab's audio and transcribes it with OpenAI. Pick the conversation language before starting. Audio is never stored and speakers are not named. Your own microphone is not part of the tab's audio.

Each sentence is stored by the local API, which extracts the checkable claims and checks them against the corpus. **Pause** stops sending what is said, **Stop** ends the conversation and **Delete conversation** erases it from the database. There are no simulated calls: the overlay only runs over real pages.

**Use case 1: video meeting.** A person in a video call keeps the pill in the corner. As each person speaks, the checkable statements (figures, dates, agreements) are checked against the documents in the corpus for that meeting, such as the founder's pitch deck, and flagged when the sources contradict them. The extension does not speak in the call; it only informs the person using it.

- Example: a founder pitches on a video call hosted by itnig, with OpenAI in the role of the investor. While the founder presents, the investor checks the figures they say (customers, revenue, retention, signed pilots) against the numbers in the founder's pitch deck and the documents shared before the call. Where the spoken figure and the deck differ, the panel flags it.
- This example is **illustrative and hypothetical**. itnig and OpenAI are named only to describe the setting of the hackathon demo; it does not describe a real meeting and implies no affiliation, partnership or endorsement.

**Use case 2: video interview.** Someone watching a long-form interview on YouTube clicks the extension icon and checks the audio of that tab. Verdicts describe whether the available sources support a statement; they do not evaluate the speaker, a party or a policy.

It needs the API with `OPENAI_API_KEY` and `DATABASE_URL`, a migrated database and an imported corpus. The Zoom and Teams desktop apps are out of reach for a Chrome extension: use their web versions. The Meet acceptance test runs a scripted caption timeline against the real API: `API_ORIGIN=http://127.0.0.1:3000 npm run test:e2e --workspace @growth-factcheking/extension` (corpus: `data/demo/meet-startup.json`).

For a check against a public source, run `npm run seed -- data/demo/public-facts.json`. Then say “Francia tiene a Roma como capital” or “La capital de Francia es París” in a live call and check that the result cites the EU country profile.

[Call overlay spec](docs/specs/call-overlay.md)

## Escenarios de prueba

La API devuelve resultados fijos según el parámetro `scenario`. Las fuentes son ficticias y el texto de la afirmación sirve para probar cómo se muestra en el panel.

| `scenario` | Resultado |
| --- | --- |
| `yes` | Sí, con dos fuentes |
| `probably_yes` | Probablemente sí |
| `neutral` | Neutral, con dos fuentes contradictorias |
| `probably_no` | Probablemente no |
| `no` | No |
| `no_evidence` o sin parámetro | Neutral, sin fuentes |
| `error` | Error de servicio simulado (HTTP 503) |

```bash
curl -fsS 'http://127.0.0.1:3000/api/fact-check?scenario=yes' \
  -H 'Content-Type: application/json' \
  -d '{"claim":"La biblioteca de Puerto Aurora abre los sábados."}'
```

## Flujo previsto

```text
Afirmación → Extensión → API
                          ├─ OpenAI Embeddings convierte la afirmación en un vector
                          ├─ PostgreSQL + pgvector recupera hechos del corpus
                          └─ OpenAI Decisions clasifica la afirmación con esos hechos
```

Conversations are captured from Meet, Zoom web and Teams web captions, or from any tab's audio.

[Especificación inicial](docs/specs/fact-checking-mvp.md) · [Estado del proyecto](docs/PROJECT_STATE.md) · [Decisiones de arquitectura](docs/DECISIONS.md)
