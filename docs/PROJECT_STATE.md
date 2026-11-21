# Estado del proyecto

La pila local funciona sin credenciales ni base de datos. `npm run dev` compila y arranca un sandbox en http://127.0.0.1:3000. La API permite importar lotes de hechos con fuentes, repetirlos sin duplicados, actualizar por ID, buscar mediante vectores simulados y devolver un veredicto simulado. El almacenamiento es en memoria y se reinicia con dos hechos ficticios.

La extensión guarda el modo de verificación en Chrome. **Simulado** usa los escenarios fijos. **Real** comprueba el texto que el usuario selecciona con OpenAI y PostgreSQL mediante `/api/fact-check/live`. El sandbox usa el corpus simulado.

Los vectores son conteos de palabras deterministas; el clasificador devuelve sí solo para un texto idéntico y neutral en el resto. El corpus simulado se almacena en memoria. Los tests de CI cubren la ingestión, repetición, actualización, validación, aislamiento y consulta.

La simulación de Meet reproduce una conversación ficticia entre una inversora y un emprendedor. Extrae cuatro afirmaciones con reglas específicas del guion y admite veredictos simulados o una llamada a OpenAI Decisions con el mismo corpus ficticio.

## Próximos hitos

1. Evaluar la recuperación y los veredictos con un corpus revisado de fuentes primarias.
2. Revisar el flujo de la extensión con afirmaciones respaldadas, contradichas y sin evidencia.
3. Evaluar la extracción de afirmaciones con transcripciones variadas, incluido el manejo de hablantes y proyecciones.
4. Diseñar cómo capturar afirmaciones en Meet con consentimiento explícito. Google ha anunciado el cierre de Meet Media API el 15 de enero de 2027. [Notas de Google Meet](https://developers.google.com/workspace/meet/release-notes)
