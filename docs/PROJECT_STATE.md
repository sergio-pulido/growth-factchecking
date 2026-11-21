# Estado del proyecto

La pila local funciona sin credenciales ni base de datos. `npm run dev` compila y arranca un sandbox en http://127.0.0.1:3000. La API permite importar lotes de hechos con fuentes, repetirlos sin duplicados, actualizar por ID, buscar mediante vectores simulados y devolver un veredicto simulado. El almacenamiento es en memoria y se reinicia con dos hechos ficticios.

La extensión guarda el modo de verificación en Chrome. **Simulado** usa los escenarios fijos. **Real** comprueba el texto que el usuario selecciona con OpenAI y PostgreSQL mediante `/api/fact-check/live`. El sandbox usa el corpus simulado.

Los vectores son conteos de palabras deterministas; el clasificador devuelve sí solo para un texto idéntico y neutral en el resto. El corpus simulado se almacena en memoria. Los tests de CI cubren la ingestión, repetición, actualización, validación, aislamiento y consulta.

El panel de llamadas (diseño del prototipo FactCheck) se abre con el icono de la extensión en cualquier pestaña y aparece solo en Meet, Zoom web y Teams web. Después de **Empezar a verificar**, lee los subtítulos de la aplicación o, en cualquier otra pestaña, transcribe su audio con OpenAI; guarda la transcripción en PostgreSQL, extrae afirmaciones y muestra los veredictos. Las simulaciones de Meet se han eliminado. El audio se ha probado de extremo a extremo contra OpenAI y PostgreSQL con un audio de prueba; los lectores de subtítulos aún no se han probado en llamadas reales.

La compilación local 0.4.1 lee los subtítulos de la ventana flotante de Meet mientras la pestaña queda en segundo plano. Las pruebas simulan abrir y cerrar esa ventana durante la captura y comprueban que cada intervención se conserva una sola vez. Queda pendiente probar la ventana flotante de una llamada real en Chrome.

## Próximos hitos

1. Evaluar la recuperación y los veredictos con un corpus revisado de fuentes primarias.
2. Revisar el flujo de la extensión con afirmaciones respaldadas, contradichas y sin evidencia.
3. Evaluar la extracción de afirmaciones con transcripciones variadas, incluido el manejo de hablantes y proyecciones.
4. Probar los lectores de subtítulos en llamadas reales de Meet, Zoom web y Teams web, y la extensión cargada en Chrome. Google ha anunciado el cierre de Meet Media API el 15 de enero de 2027. [Notas de Google Meet](https://developers.google.com/workspace/meet/release-notes)
