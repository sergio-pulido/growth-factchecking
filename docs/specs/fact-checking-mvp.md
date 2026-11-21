# Verificación sobre la página

## Entrega inicial

El repositorio incluye una extensión de Chrome, una API local y un contrato compartido. El panel se activa desde el icono de la extensión y puede mostrar texto seleccionado. La API responde a `GET /health` y reserva `POST /api/fact-check` con HTTP 501 hasta que se implemente el flujo.

## Primer flujo funcional

1. El usuario elige una afirmación desde la extensión.
2. La API convierte la afirmación en un embedding y busca hechos relevantes en PostgreSQL con pgvector.
3. OpenAI Decisions clasifica la afirmación usando los hechos recuperados. La API devuelve el veredicto y los enlaces a las fuentes.
4. La extensión muestra un panel sobre la página con **Sí**, **Probablemente sí**, **Neutral**, **Probablemente no** o **No**.

Si el corpus carece de evidencia suficiente, el resultado debe ser **Neutral**. Los fallos del servicio deben aparecer como errores. La clave de OpenAI estará en el servidor. La verificación continua de subtítulos y la detección automática de afirmaciones en Meet pertenecen a una fase posterior.
