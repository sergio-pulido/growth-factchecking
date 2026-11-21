# Growth FactChecking

Punto de partida para una extensión de Chrome que mostrará verificaciones sobre Google Meet, X y otras páginas web.

| Espacio de trabajo | Contenido inicial |
| --- | --- |
| `apps/extension` | Extensión Manifest V3 con escenarios de verificación y simulación de una conversación de Google Meet. |
| `apps/api` | API local con `GET /health`, `POST /api/fact-check` y `POST /api/meet/demo/check`. |
| `packages/shared` | Contrato TypeScript compartido por la extensión y la API. |

## Arranque local

Con Node.js 22.14 o posterior y npm, ejecuta desde la raíz.

```bash
npm ci
npm run build
npm test
npm start
```

En otra terminal, comprueba que la API responde.

```bash
curl -fsS http://127.0.0.1:3000/health
```

Para abrir el panel, entra en `chrome://extensions`, activa **Modo de desarrollador**, pulsa **Cargar descomprimida** y selecciona `apps/extension/dist`. Abre una página web y pulsa el icono de la extensión. Opcionalmente, selecciona texto antes de abrirla. En el panel, elige un escenario y pulsa **Probar**.

El modo simulado solo necesita Node.js.

## Simulación de Google Meet

En el panel de la extensión, pulsa **Simular Google Meet** y **Reproducir**. Clara, una inversora, pide a Mateo cifras de su empresa ficticia. El panel reproduce seis intervenciones y muestra cuatro afirmaciones verificables del emprendedor, con sus veredictos y fuentes de ejemplo. Las reglas de extracción están ajustadas a esta transcripción.

El modo **Simulado** sirve para trabajar con resultados reproducibles. Para usar **OpenAI Decisions** en el mismo panel, configura `OPENAI_API_KEY` en el entorno del servidor y vuelve a iniciarlo. Por ejemplo, si guardaste la clave en un archivo `.env` local, desde la raíz ejecuta:

```bash
node --env-file=.env apps/api/dist/index.js
```

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

La captura de conversaciones reales y la búsqueda de evidencia en PostgreSQL forman parte del flujo previsto.

[Especificación inicial](docs/specs/fact-checking-mvp.md) · [Estado del proyecto](docs/PROJECT_STATE.md) · [Decisiones de arquitectura](docs/DECISIONS.md)
