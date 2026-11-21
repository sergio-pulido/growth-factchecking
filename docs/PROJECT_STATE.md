# Estado del proyecto

La pila local funciona sin credenciales ni base de datos. `npm run dev` compila y arranca un sandbox en http://127.0.0.1:3000. La API permite importar lotes de hechos con fuentes, repetirlos sin duplicados, actualizar por ID, buscar mediante vectores simulados y devolver un veredicto simulado. El almacenamiento es en memoria y se reinicia con dos hechos ficticios.

La extensión guarda el modo de verificación en Chrome. **Simulado** usa los escenarios fijos. **Real** comprueba el texto que el usuario selecciona con OpenAI y PostgreSQL mediante `/api/fact-check/live`. El sandbox usa el corpus simulado.

Los vectores son conteos de palabras deterministas; el clasificador devuelve sí solo para un texto idéntico y neutral en el resto. El corpus simulado se almacena en memoria. Los tests de CI cubren la ingestión, repetición, actualización, validación, aislamiento y consulta.

El panel de llamadas se abre con el icono de la extensión y aparece automáticamente en Meet, Zoom web y Teams web. En la versión 0.4.6, Meet usa el micrófono y el audio de la pestaña mediante OpenAI Realtime. Zoom web y Teams web usan sus subtítulos. El resto de pestañas usa su propio audio. La API guarda el texto, extrae afirmaciones y coteja las fuentes.

Las pruebas automatizadas verificaron que se envían las dos pistas de Meet, que el micrófono queda fuera de la reproducción local y que Stop cierra ambas capturas. Se comprobó la transcripción de un audio sintético con OpenAI. Queda por verificar el permiso y la calidad de la captura en una llamada real de Chrome.

## Próximos hitos

1. Evaluar la recuperación y los veredictos con un corpus revisado de fuentes primarias.
2. Revisar el flujo de la extensión con afirmaciones respaldadas, contradichas y sin evidencia.
3. Evaluar la extracción de afirmaciones con transcripciones variadas, incluido el manejo de hablantes y proyecciones.
4. Probar los lectores de subtítulos en llamadas reales de Meet, Zoom web y Teams web, y la extensión cargada en Chrome. Google ha anunciado el cierre de Meet Media API el 15 de enero de 2027. [Notas de Google Meet](https://developers.google.com/workspace/meet/release-notes)
