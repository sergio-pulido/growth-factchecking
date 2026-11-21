# Propuesta para revisar · Relevancia durante el pitch

**Para Jaume y UX/UI.** El inversor necesita reconocer la pregunta o tesis activa, ver qué evidencia sostiene la afirmación y entender si el dato le ayuda a seguir la conversación.

## Resultado propuesto

Añadir un campo opcional `argumentRelevance` por afirmación en lotes y en la vista de conversación. Su ausencia indica que el resultado proviene del contrato actual. Los identificadores, `status`, `verdict` y `sources` de GF‑02 conservan su significado.

| Campo | Valores | Presentación |
| --- | --- | --- |
| `status` | `assessed`, `insufficient_context`, `failed` | Disponible, contexto insuficiente o relevancia sin calcular |
| `level` | `high`, `partial`, `low`, `null` | Alta, parcial o baja cuando hay evaluación |
| `context` | `{ utteranceClientId, speaker, text }` o `null` | Cita de la pregunta o tesis activa |
| `reason` | Frase breve | Explica qué aporta el dato a ese contexto |

El backend ya usa una señal llamada `relevance` para decidir si un documento aborda la afirmación. `argumentRelevance` se refiere al contexto de la conversación. El inversor debe poder leer ambos resultados por separado. Los documentos internos del piloto llevan una marca visible de «Fuente ficticia».

[Ejemplo JSON para UX/UI](../../data/demo/investor-pitch/ux-response.example.json)

## Decisiones de integración

- **Jaume** puede confirmar dónde se obtiene y persiste el turno de contexto, cómo se devuelve el nuevo campo en lotes y en `GET`, y cómo se aísla un fallo de relevancia del veredicto. El piloto ofrece las preguntas y tesis explícitas de los turnos anteriores. Las preguntas sin signos de interrogación, las tesis dentro del mismo turno y los cambios de tema requieren casos adicionales.
- **UX/UI** puede confirmar las etiquetas y el espacio para mostrar el contexto citado. Revisar los estados **No · Relevancia alta**, **Sí · Relevancia baja**, **Neutral · Relevancia alta** y **Contexto insuficiente**.
- **Rendimiento.** Conviene cronometrar la verificación y la relevancia en el mismo flujo antes de decidir si el nuevo dato llega con el veredicto o después. La prueba mide las llamadas de relevancia por separado.

La API actual sigue siendo el punto de integración para captura. Los ejemplos anteriores sirven para la revisión del campo opcional.
