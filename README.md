# Growth FactChecking

Punto de partida para una extensión de Chrome que mostrará verificaciones sobre Google Meet, X y otras páginas web.

| Espacio de trabajo | Contenido inicial |
| --- | --- |
| `apps/extension` | Extensión Manifest V3. Abre un panel sobre la pestaña para probar veredictos, fuentes y errores con datos simulados. |
| `apps/api` | API local con `GET /health` y la ruta de demostración `POST /api/fact-check`. |
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

El arranque local solo necesita Node.js. `.env.example` reserva los nombres de las variables para cuando se conecten OpenAI y la base de datos.

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

La captura automática de afirmaciones y las integraciones con OpenAI y PostgreSQL quedan para las siguientes iteraciones.

[Especificación inicial](docs/specs/fact-checking-mvp.md) · [Estado del proyecto](docs/PROJECT_STATE.md) · [Decisiones de arquitectura](docs/DECISIONS.md)
