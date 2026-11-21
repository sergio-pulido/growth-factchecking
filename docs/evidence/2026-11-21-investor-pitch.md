# Evaluación de un pitch para inversores · 21 de noviembre de 2026

Probamos una conversación ficticia de Prisma Turnos con la API GF‑02 de `5c8f15b`, OpenAI y PostgreSQL con pgvector. El guion tiene 16 intervenciones en cinco lotes y siete afirmaciones etiquetadas. El corpus contiene cuatro registros internos ficticios y una publicación primaria de Eurostat. El hecho público se repite bajo dos contextos para comprobar que el veredicto se mantiene y la relevancia cambia. [Guion y etiquetas](../../data/demo/investor-pitch/pitch.json) · [Corpus](../../data/demo/investor-pitch/facts.json) · [Documentos](../../data/demo/investor-pitch/sources.md)

## Resultado

En dos ejecuciones del método final, las siete afirmaciones etiquetadas obtuvieron el veredicto, la fuente, el nivel de relevancia y el contexto esperados. En la segunda ejecución el extractor añadió además una tesis cualitativa que el guion esperaba omitir. Los saludos, las preguntas, la opinión y la proyección quedaron fuera en ambas.

| Afirmación | Veredicto esperado y obtenido | Fuente citada | Relevancia esperada y obtenida | Contexto citado | Decisions A / B |
| --- | --- | --- | --- | --- | ---: |
| 42 clientes de pago al cierre de octubre | Sí | Registro de clientes, ficticio | Contexto insuficiente | Ninguno. La apertura deja el tema por definir. | 0 / 0 ms |
| 32.000 € de MRR al cierre de octubre | No | Cierre de MRR, ficticio. Registra 27.800 €. | Alta | Pregunta por el MRR de octubre | 297 / 181 ms |
| 90 % de retención de la cohorte de julio al día 90 | Sí | Informe de cohortes, fila de julio, ficticio | Alta | Pregunta por la cohorte de julio | 350 / 318 ms |
| 45,2 % de compra de servicios de nube en la encuesta de la UE, durante la pregunta de retención | Sí | Eurostat, publicación del 8 de diciembre de 2023 | Baja | Pregunta por la cohorte de julio | 354 / 368 ms |
| 75 % de retención de la cohorte de agosto al día 90 | Sí | Informe de cohortes, fila de agosto, ficticio | Parcial | Pregunta por el agregado julio–septiembre | 348 / 196 ms |
| Acuerdo de piloto con el Hospital Mirador | Neutral | Sin fuente disponible en el corpus | Alta | Pregunta por pilotos hospitalarios de octubre | 372 / 302 ms |
| La misma cifra de Eurostat, tras la tesis de adopción de nube | Sí | Eurostat, publicación del 8 de diciembre de 2023 | Alta | Tesis de Leo sobre adopción de nube en la UE | 475 / 211 ms |

El código evalúa relevancia con la afirmación, su turno y hasta seis turnos anteriores devueltos por GF‑02. La transcripción conserva los nombres de los hablantes. Para elegir el contexto, el prototipo ofrece preguntas y tesis marcadas explícitamente. Una opción de Decisions une el turno y el nivel para que el resultado cite exactamente lo que está evaluando. Sin un candidato explícito devuelve «Contexto insuficiente» localmente. La explicación breve proviene de una plantilla del nivel y se presenta junto a la cita. [Referencia de OpenAI Decisions](https://developers.openai.com/api/docs/guides/decisions)

La API tardó **1,57–3,82 s por lote** en las dos ejecuciones. Las medianas fueron **2,29 s** y **2,42 s**. Las llamadas de relevancia de los casos etiquetados tardaron **181–475 ms**. Se midieron después de leer la transcripción guardada, con solicitudes concurrentes. Estas cifras describen esta muestra y cada etapa en su recorrido de prueba. [Salida íntegra de la ejecución B](2026-11-21-investor-pitch-results.json)

## Fallos observados

- **El nivel y la cita discrepaban al preguntar por separado.** El dato verdadero de Eurostat recibió contexto insuficiente o relevancia baja sin cita. La comparación en ambas ejecuciones dio 6/7 con preguntas independientes. Una opción conjunta con todos los turnos siguió citando una respuesta del fundador en lugar de la pregunta. La opción conjunta con preguntas y tesis explícitas llegó a 7/7 en las dos ejecuciones.
- **La extracción puede confundir una tesis con un dato comprobable.** En la ejecución B, también se extrajo «ya había una adopción amplia», una tesis sin umbral numérico. Recibió veredicto neutral y el piloto le atribuyó una pregunta anterior sobre retención. El caso está en el JSON para discutir con Jaume cómo tratar tesis vagas y cambios de tema.
- **Un lote puede quedar guardado sin afirmaciones analizadas.** Una pasada exploratoria devolvió `extraction: failed` para el primer lote y guardó sus cuatro intervenciones. No se recogió el error del proveedor en esa pasada. Las repeticiones completaron la extracción. UX/UI necesita mostrar ese estado separado de «sin afirmaciones verificables».
- **El contexto de una reunión real puede ser menos explícito.** Quedan por evaluar preguntas sin puntuación, preguntas elípticas, cambios de interlocutor y tesis expresadas dentro del turno que se está comprobando.

## Reproducir

Con Node.js, Docker y `OPENAI_API_KEY` en el entorno local:

```bash
npm ci
npm run build
npm test
node --env-file=.env scripts/evaluate-investor-pitch.mjs --compare > /tmp/investor-pitch-results.json
```

En un worktree, apunta `--env-file` al archivo local del repositorio original. El script inicia un PostgreSQL temporal en loopback, aplica las migraciones, importa el corpus, levanta la API en un puerto libre y elimina su contenedor al terminar. Ejecuta solicitudes reales con la caché de veredictos desactivada. La salida indica por caso si coinciden la extracción, el veredicto, la fuente, la relevancia y la cita. `--compare` incluye también la evaluación con preguntas independientes. `PITCH_EVAL_LOG=1` envía los avisos de la API a stderr.

[Propuesta para Jaume y UX/UI](../specs/argument-relevance-proposal.md) · [Ejemplo de respuesta](../../data/demo/investor-pitch/ux-response.example.json)
