ALTER TABLE facts ADD COLUMN IF NOT EXISTS additional_source_urls text[] NOT NULL DEFAULT '{}';
