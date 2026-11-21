# Evaluación del pitch para inversores

El piloto simula una reunión en español entre Inés, inversora, y Leo, fundador de Prisma Turnos, una empresa ficticia. La evaluación usa la API de conversaciones GF‑02 con su extracción y su verificación. La relevancia se explora con una llamada a Decisions por afirmación, usando la transcripción y el vínculo con el turno que ya devuelve GF‑02.

## Criterios

- **Veracidad** conserva el veredicto y la fuente de GF‑02. Cada caso fija el resultado esperado según el corpus del ejercicio.
- **Relevancia** mide si la afirmación ayuda a responder la pregunta activa del inversor o a sostener o cuestionar una tesis explícita. La respuesta incluye el turno que identifica ese contexto. Los valores propuestos son `alta`, `parcial`, `baja` y `contexto_insuficiente`.
- Una afirmación contradicha puede ser pertinente. Una afirmación respaldada puede aportar poco. Una cifra interna sin evidencia puede responder de lleno a la pregunta.
- La muestra compara veredicto, fuente, relevancia y turno de contexto. Incluye preguntas, opinión y proyección para controlar la extracción.

La entrega incluye un corpus aislado, un guion etiquetado, un corredor contra la API real y evidencia de ejecución. La propuesta de respuesta para la interfaz pasa por revisión de Jaume y UX/UI.
