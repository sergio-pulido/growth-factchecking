# Latencia desde el final de la frase hasta el veredicto

Comparación del 21 de noviembre de 2026. Generé voz sintética en macOS con `say` y convertí los clips a PCM mono de 24 kHz. Envié los clips a velocidad normal a OpenAI Realtime con `gpt-live-transcribe` y sin confirmación explícita del turno, como en la extensión. Las versiones 0.5.1 y 0.5.2 recibieron simultáneamente los mismos fragmentos de texto, cada una en su propia conversación. Usé la API local con el corpus cargado y `FACT_CHECK_CACHE_TTL_MS=0` en una instancia temporal.

Los tiempos se miden desde la última palabra audible hasta el momento en que la extensión recibe el veredicto. La prueba usa WebSocket para enviar el audio y ejecuta los módulos de la extensión fuera de Chrome. El destello y la captura de Meet en primer y segundo plano quedan fuera de esta medición.

| Afirmación del guion | Duración de la locución | Último fragmento tras la última palabra | 0.5.1 | 0.5.2 | Resultado en ambas |
| --- | ---: | ---: | ---: | ---: | --- |
| ChatGPT salió el 30 de noviembre de 2022 como vista previa gratuita | 5,81 s | 0,43 s | 5,50 s | 3,53 s | Sí, con fuente |
| GPT-5 salió en enero de 2025 | 3,79 s | 0,52 s | 5,43 s | 3,36 s | No, con fuentes |
| OpenAI se fundó en diciembre de 2015 | 2,91 s | 0,58 s | 5,25 s | 3,19 s | Neutral, sin fuentes recuperadas |

En 0.5.2 la petición de contraste salió entre 1,48 y 1,55 s después de la última palabra. La API tardó de 1,64 a 2,04 s en extraer y comprobar las afirmaciones. El tiempo desde el primer sonido fue de 7,15 s para GPT-5 y de 9,33 s para ChatGPT, incluida la locución.

También probé confirmar el turno tras 550 ms de silencio y usar el ajuste de transcripción `minimal`. Confirmar el turno no adelantó de forma consistente el texto final en estas muestras. En un clip en español con Lumen Labs, `minimal` devolvió «cincuenta million» al dictar «cincuenta mil». Conservé la configuración de la versión 0.5.2. [Transcripción en tiempo real de OpenAI](https://developers.openai.com/api/docs/guides/realtime-transcription)

Para comprobar el objetivo de 5 s en Meet, selecciona **English** y dicta las dos primeras afirmaciones por separado. Mide desde la última palabra hasta el destello. Anota cuándo aparece la frase en **Transcript** para distinguir el tiempo de captura y transcripción del tiempo de verificación. Repite con Meet en Picture-in-Picture.
