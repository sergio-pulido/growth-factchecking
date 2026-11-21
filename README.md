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

## Verificación en el feed de X

Con la API local en marcha y un corpus real importado, abre **Inicio** de X en Chrome y elige la pestaña **Politics**. Pulsa el icono de la extensión y **Verificar publicaciones en X**. Aparecen verificaciones y enlaces a las fuentes debajo de las publicaciones visibles con texto completo. Las publicaciones sin evidencia directa muestran **Información insuficiente**. Al desplazarte, la extensión comprueba las publicaciones que entran en pantalla. Para parar, abre el panel y pulsa **Desactivar verificaciones en X**.

La [demo local de publicaciones](http://127.0.0.1:3000/x-demo) usa el mismo renderizador y la API real sin instalar la extensión. Para cargar los hechos que necesita, ejecuta `npm run seed -- data/demo/x-politics.json` después de migrar la base de datos. Reinicia la API para limpiar los veredictos guardados.

## Simulación de Google Meet

En el panel de la extensión, pulsa **Simular Google Meet** y **Reproducir**. Clara, una inversora, pide a Mateo cifras de su empresa ficticia. El panel reproduce seis intervenciones y muestra cuatro afirmaciones verificables del emprendedor, con sus veredictos y fuentes de ejemplo. Las reglas de extracción están ajustadas a esta transcripción.

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
