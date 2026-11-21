-- Optional extra (docs/specs/argument-relevance.md). Nullable and additive: the core never reads or writes it
-- unless ARGUMENT_RELEVANCE_ENABLED is on.
ALTER TABLE claims ADD COLUMN IF NOT EXISTS argument_relevance jsonb;
