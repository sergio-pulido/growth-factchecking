# Estado del proyecto

La extensión y la API están conectadas en modo de demostración. El panel muestra texto seleccionado o una afirmación de ejemplo. Los escenarios fijos cubren los cinco veredictos, fuentes de ejemplo, ausencia de fuentes y un error de servicio.

La simulación de Meet reproduce una conversación ficticia entre una inversora y un emprendedor. Extrae cuatro afirmaciones con reglas específicas del guion y admite veredictos simulados o una llamada a OpenAI Decisions con el mismo corpus ficticio.

## Próximos hitos

1. Conectar Embeddings y PostgreSQL con pgvector. Importar un corpus inicial con fuentes.
2. Probar Decisions con una clave del proyecto y revisar los resultados de la demo.
3. Evaluar la extracción de afirmaciones con transcripciones variadas, incluido el manejo de hablantes y proyecciones.
4. Diseñar cómo capturar afirmaciones en Meet con consentimiento explícito. Google ha anunciado el cierre de Meet Media API el 15 de enero de 2027. [Notas de Google Meet](https://developers.google.com/workspace/meet/release-notes)
