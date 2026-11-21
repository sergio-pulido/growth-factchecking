# Decisiones de arquitectura

## 001 · Monorepo con npm workspaces

La extensión y la API tienen ciclos de ejecución propios y comparten los tipos de la verificación. Un solo archivo de bloqueo permite instalar los tres espacios de trabajo desde la raíz.

## 002 · Panel bajo demanda

La extensión usa Manifest V3 y activa el panel al pulsar su icono. El permiso temporal sobre la pestaña permite probar el mismo flujo inicial en X, Meet y otras webs.

## 003 · Recuperación y veredicto

La integración prevista usará Embeddings y PostgreSQL con pgvector para recuperar hechos. Decisions clasificará la afirmación a partir de esos hechos. La API será responsable de las credenciales y devolverá las referencias junto al veredicto.

[Embeddings de OpenAI](https://developers.openai.com/api/docs/guides/embeddings) · [Decisions de OpenAI](https://developers.openai.com/api/docs/guides/decisions) · [pgvector](https://github.com/pgvector/pgvector)

## 004 · Escenarios fijos para la demo

La API devuelve un resultado fijo por escenario mediante el mismo formato previsto para el flujo funcional. El panel identifica los datos simulados y permite reproducir cada caso desde un selector. Sin escenario, la ruta consulta el corpus local.

## 005 · Contraste por turno de Meet (retirada)

Retirada el 21-11-2026: la simulación de Meet se ha eliminado y las llamadas reales usan el panel de llamadas (decisión 008).

## 006 · Pila local completamente simulada

Primero se valida el flujo completo sin servicios externos. Cada instancia de la API tiene un corpus en memoria, vectores deterministas y clasificación simulada. La ingestión es idempotente por ID y conserva la fuente. El sandbox web permite importar y consultar datos; la ruta de verificación consulta ese mismo corpus cuando la solicitud no elige un escenario fijo. Los escenarios existentes siguen disponibles para errores y estados de interfaz. La similitud nunca determina un veredicto afirmativo: solo la coincidencia textual exacta produce el sí simulado.

## 007 · Fuente de verificación elegida en Chrome

La extensión guarda la preferencia en el almacenamiento local de Chrome. **Simulado** es el valor inicial. **Real** requiere texto seleccionado y el botón **Verificar** para enviarlo al backend. El panel comprueba el modo indicado por la API antes de presentar el resultado.

## 008 · Panel de llamadas: subtítulos primero, audio de la pestaña como alternativa

El mismo panel funciona sobre cualquier llamada. En Meet (con el motor de subtítulos de GF-03), Zoom web y Teams web lee los subtítulos de la aplicación, que ya traen el nombre de quien habla y no cuestan transcripción. En cualquier otra pestaña captura su audio con `tabCapture`, lo envía desde un documento offscreen a la transcripción en directo de OpenAI con un permiso temporal emitido por la API local, y la clave de OpenAI nunca sale del servidor. No hay bots que se unan a la llamada ni simulaciones. Especificación: [call-overlay.md](specs/call-overlay.md).

## 009 · Subtítulos en la ventana flotante de Meet

Tras iniciar la captura, la extensión usa los subtítulos de Document Picture-in-Picture cuando Meet los muestra allí. Los cambios del documento flotante y su temporizador alimentan el mismo consolidador de subtítulos. Al cerrar la ventana se vuelve a leer la pestaña dentro de la misma conversación.

## 010 · Audio para Google Meet

La versión 0.4.6 sustituye el lector de subtítulos de Meet. Chrome concede el permiso de micrófono en una página de la extensión. Tras **Start checking**, el documento offscreen mezcla el micrófono con el audio de la pestaña y envía la mezcla a OpenAI Realtime. Una sesión de transcripción por llamada conserva el flujo en segundo plano y agrupa ambas voces bajo **Call audio**. **Pause** silencia el envío y **Stop** cierra las capturas.
