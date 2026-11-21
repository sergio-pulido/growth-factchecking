# Growth FactChecking

Punto de partida para una extensión de Chrome que mostrará verificaciones sobre Google Meet, X y otras páginas web.

| Espacio de trabajo | Contenido inicial |
| --- | --- |
| `apps/extension` | Extensión Manifest V3 con verificación real, escenarios simulados y una conversación ficticia de Google Meet. |
| `apps/api` | API local con `GET /health`, `POST /api/fact-check`, `POST /api/fact-check/live` y `POST /api/meet/demo/check`. |
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

## Overlay design and demo scenarios (Michella and Tomás)

Design and UI contribution for the browser extension by Michella and Tomás. Tomás built the interactive prototype (`FactCheck Prototype.html`); its interaction model is ported into the extension below.

**Goal.** Show fact checks next to the content a person is already watching, reading or listening to, in a panel that stays out of the way: each claim with a verdict, a short explanation and links to its sources, without leaving the page.

**Panel design** (`apps/extension/src/overlay.css`, `overlay.ts`)

- Floating glass panel: dark translucent background with blur, Helvetica, rounded controls.
- Resizable from the bottom-right corner, movable by dragging the header, and can be minimised to its header and restored.
- A soft moving glow around the border only while a check is running; no glow when idle.
- English UI text across the panel, background messages and verdict labels: True, Likely true, Neutral, Likely false, False.
- Source links shown at the end of every answer, with the domain of each source.

**Features from Tomás's prototype** (`apps/extension/src/interview-demo.ts`)

- Summary line (checked, in progress, needs attention) with a bar showing the mix of verdicts.
- Tabs: All, Needs attention (False and Likely false) and Skipped.
- Sentences that are not checkable facts (questions, opinions, personal beliefs, projections) are listed under Skipped with the reason, instead of receiving a verdict.
- Each claim card: 5-step verdict scale, explanation, suggested follow-up question with Copy, and sources.
- A "Not checked" state with Retry when sources cannot be reached.
- The screen edge briefly tints with the verdict colour when a result arrives.
- When the panel is minimised, new verdicts appear as small cards; clicking one reopens the panel.
- Select text on the page to show a Check button for that text.

### Use case 1: video meeting

A person in a video call keeps the panel open beside the call. As each person speaks, the extension takes the spoken sentences, separates checkable statements (figures, dates, agreements) from questions, opinions and projections, and checks each statement against the documents available for that meeting, such as the founder's pitch deck. The panel shows the verdict, the evidence, and a suggested follow-up question the listener can ask while the call is still going. The extension does not speak in the call; it only informs the person using it.

- Example: a founder pitches on a video call hosted by itnig, with OpenAI in the role of the investor. While the founder presents, the investor checks the figures they say (customers, revenue, retention, signed pilots) against the numbers in the founder's pitch deck and the documents shared before the call. Where the spoken figure and the deck differ, the panel flags it and suggests a question to ask.
- This example is **illustrative and hypothetical**. itnig and OpenAI are named only to describe the setting of the hackathon demo; it does not describe a real meeting and implies no affiliation, partnership or endorsement.
- Tomás's prototype shows this flow end to end with captions, the collapsed panel and verdict cards.
- In the repository, the simulated call is `apps/extension/src/meet-demo.ts` with the API endpoint `POST /api/meet/demo/check` (see "Simulación de Google Meet" below). Its company, people, sources and verdicts are fictional.

### Use case 2: video interview

A person watching a long-form video interview opens the panel on YouTube. On YouTube (and Google Meet) the panel opens the offline **interview demo**: press **Play interview demo**, then **Play interview**. It replays excerpts of an interview (The Wild Project, Jordi Wild with Pedro Sánchez, November 2026) and checks the statements made in it. It is one example scenario; the same flow applies to any speaker or topic.

- Runs entirely in the extension: no API, no network, no OpenAI key.
- Statements are paraphrased from press coverage of the interview, and timestamps are approximate.
- Verdicts and sources are **sample results for the demo**, not published fact checks. They describe whether the available sources support a statement; they do not evaluate the speaker, a party or a policy.
- Opinions and personal beliefs are skipped rather than rated.

## Simulación de Google Meet

El código de esta simulación sigue en `apps/extension/src/meet-demo.ts`; es el caso de uso 1 descrito arriba (reunión por vídeo); el panel abre ahora la demo de entrevista (caso de uso 2). En la versión anterior del panel se pulsaba **Simular Google Meet** y **Reproducir**. Clara, una inversora, pide a Mateo cifras de su empresa ficticia. El panel reproduce seis intervenciones y muestra cuatro afirmaciones verificables del emprendedor, con sus veredictos y fuentes de ejemplo. Las reglas de extracción están ajustadas a esta transcripción.

El modo **Simulado** sirve para trabajar con resultados reproducibles. Para usar **OpenAI Decisions**, guarda `OPENAI_API_KEY` en el archivo `.env` de la raíz, reinicia la API con `npm start` y elige ese motor en el panel.

La llamada a Decisions usa las afirmaciones de la demo y sus fuentes ficticias. El piloto sin documentación queda neutral. La demo se puede consultar directamente con:

```bash
curl -fsS 'http://127.0.0.1:3000/api/meet/demo/check' \
  -H 'Content-Type: application/json' \
  -d '{"turnId":"traction","mode":"mock"}'
```

[Especificación de la simulación](docs/specs/meet-demo.md) · [OpenAI Decisions](https://developers.openai.com/api/docs/guides/decisions)

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

La captura de conversaciones reales forma parte del flujo previsto.

[Especificación inicial](docs/specs/fact-checking-mvp.md) · [Estado del proyecto](docs/PROJECT_STATE.md) · [Decisiones de arquitectura](docs/DECISIONS.md)
