# Demo de Google Meet

La extensión reproduce una transcripción ficticia por turnos. Clara, una inversora, pregunta por la tracción de una empresa. Mateo, el emprendedor, comparte cifras, una proyección y una opinión. El panel muestra quién habla, el minuto de la intervención y el resultado de cada afirmación extraída.

Por cada turno, la API recibe el identificador del segmento y extrae las frases verificables del emprendedor con reglas ajustadas a esta conversación. Las preguntas, opiniones, proyecciones y afirmaciones de la inversora quedan fuera. Cada afirmación se contrasta con los registros ficticios pertinentes.

- **Simulado** es el modo inicial. Devuelve resultados fijos para poder probar el flujo sin credenciales.
- **OpenAI Decisions** envía únicamente las afirmaciones del ejemplo con sus registros ficticios. La API agrupa las afirmaciones de un turno en una solicitud y recibe un veredicto de cinco niveles para cada una.
- Cuando no hay evidencia pertinente, la afirmación queda neutral sin consultar al proveedor. Si Decisions falla, el panel conserva el turno y los resultados anteriores, muestra que falta contrastarlo y continúa la reproducción.

La demostración acepta solo turnos de la transcripción incluida y está disponible desde cualquier pestaña compatible con la extensión. La captura de una llamada real queda para una fase posterior.
