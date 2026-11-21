-- English display text for a fact. Retrieval and Decisions keep using `statement` (and its
-- embedding); clients that render English cards show `statement_en` when present.
ALTER TABLE facts ADD COLUMN IF NOT EXISTS statement_en text;
