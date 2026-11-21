# Verificación sobre la página

## Demo de interfaz

La extensión de Chrome muestra una afirmación seleccionada o un texto de ejemplo y permite elegir un escenario de prueba. La API local devuelve resultados simulados con el contrato compartido. La demo cubre cinco veredictos, neutral sin fuentes y un error recuperable. El panel identifica los datos como simulados y muestra el estado de carga y los enlaces.

`POST /api/fact-check` acepta una afirmación y un parámetro de consulta opcional `scenario`. Sin escenario, recorre el corpus local simulado: genera un vector determinista, recupera coincidencias y devuelve sí solo para una afirmación textual idéntica; en el resto devuelve neutral. La ingestión local acepta lotes de hechos con ID estable, texto y URL. El sandbox en la raíz de la API permite importar y consultar el corpus sin credenciales. El resultado de cada escenario es fijo. Las fuentes son ficticias y usan dominios de ejemplo. La demo arranca sin credenciales ni base de datos.

## Primer flujo funcional

1. El usuario elige una afirmación desde la extensión.
2. La API convierte la afirmación en un embedding y busca hechos relevantes en PostgreSQL con pgvector.
3. OpenAI Decisions clasifica la afirmación usando los hechos recuperados. La API devuelve el veredicto y los enlaces a las fuentes.
4. La extensión muestra un panel sobre la página con **Sí**, **Probablemente sí**, **Neutral**, **Probablemente no** o **No**.

Si el corpus carece de evidencia suficiente, el resultado debe ser **Neutral**. Los fallos del servicio deben aparecer como errores. La clave de OpenAI estará en el servidor. La verificación continua de subtítulos y la detección automática de afirmaciones en Meet pertenecen a una fase posterior.
