-- Fact corpus for retrieval. Vector size must match EMBEDDING_DIMENSIONS (default 1536,
-- text-embedding-3-small). Changing the model or dimensions requires a new migration + re-seed.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS facts (
  id           text PRIMARY KEY,
  statement    text NOT NULL,
  source_url   text NOT NULL,
  source_title text,
  embedding    vector(1536) NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Cosine distance (<=>) with HNSW: millisecond top-k at hackathon scale and well beyond.
CREATE INDEX IF NOT EXISTS facts_embedding_hnsw
  ON facts USING hnsw (embedding vector_cosine_ops);
