# Growth FactChecking

Punto de partida para una extensión de Chrome que mostrará verificaciones sobre Google Meet, X y otras páginas web.

| Espacio de trabajo | Contenido inicial |
| --- | --- |
| `apps/extension` | Extensión Manifest V3. Abre un panel sobre la pestaña al pulsar el icono y muestra el texto seleccionado, si lo hay. |
| `apps/api` | API local con `GET /health` y la ruta reservada `POST /api/fact-check`. |
| `packages/shared` | Contrato TypeScript que compartirán la extensión y la API. |

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

Para abrir el panel, entra en `chrome://extensions`, activa **Modo de desarrollador**, pulsa **Cargar descomprimida** y selecciona `apps/extension/dist`. Abre una página web, selecciona texto y pulsa el icono de la extensión.

El arranque local solo necesita Node.js. `.env.example` reserva los nombres de las variables para cuando se conecten OpenAI y la base de datos.

## Flujo previsto

```text
Afirmación → Extensión → API
                          ├─ OpenAI Embeddings convierte la afirmación en un vector
                          ├─ PostgreSQL + pgvector recupera hechos del corpus
                          └─ OpenAI Decisions clasifica la afirmación con esos hechos
```

El panel mostrará **Sí**, **Probablemente sí**, **Neutral**, **Probablemente no** o **No**, con enlaces a las fuentes recuperadas. En este primer commit, la ruta de verificación devuelve HTTP 501. La captura automática de afirmaciones y las integraciones con OpenAI y PostgreSQL quedan para las siguientes iteraciones.

[Especificación inicial](docs/specs/fact-checking-mvp.md) · [Estado del proyecto](docs/PROJECT_STATE.md) · [Decisiones de arquitectura](docs/DECISIONS.md)
