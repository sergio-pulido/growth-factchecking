# Decisiones de arquitectura

## 001 · Monorepo con npm workspaces

La extensión y la API tienen ciclos de ejecución propios y comparten los tipos de la verificación. Un solo archivo de bloqueo permite instalar los tres espacios de trabajo desde la raíz.

## 002 · Panel bajo demanda

La extensión usa Manifest V3 y activa el panel al pulsar su icono. El permiso temporal sobre la pestaña permite probar el mismo flujo inicial en X, Meet y otras webs.

## 003 · Recuperación y veredicto

La integración prevista usará Embeddings y PostgreSQL con pgvector para recuperar hechos. Decisions clasificará la afirmación a partir de esos hechos. La API será responsable de las credenciales y devolverá las referencias junto al veredicto.

[Embeddings de OpenAI](https://developers.openai.com/api/docs/guides/embeddings) · [Decisions de OpenAI](https://developers.openai.com/api/docs/guides/decisions) · [pgvector](https://github.com/pgvector/pgvector)
