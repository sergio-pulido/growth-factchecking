-- Captured conversations, their utterances and the claims extracted from them.
-- Spec: docs/specs/conversation-capture.md. Idempotent: the runner re-applies every file.

CREATE TABLE IF NOT EXISTS conversations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform   text NOT NULL CHECK (platform ~ '^[a-z0-9_-]{1,32}$'),
  capture    text NOT NULL CHECK (capture IN ('captions', 'page_text', 'audio')),
  title      text,
  page_url   text,
  language   text,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at   timestamptz
);

CREATE TABLE IF NOT EXISTS utterances (
  id              bigserial PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  client_id       text NOT NULL,
  speaker         text NOT NULL,
  speaker_kind    text NOT NULL CHECK (speaker_kind IN ('named', 'self', 'others', 'unknown')),
  text            text NOT NULL,
  spoken_at       timestamptz NOT NULL,
  received_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, client_id)
);

CREATE INDEX IF NOT EXISTS utterances_conversation_spoken
  ON utterances (conversation_id, spoken_at, id);

CREATE TABLE IF NOT EXISTS claims (
  id              bigserial PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  utterance_id    bigint NOT NULL REFERENCES utterances (id) ON DELETE CASCADE,
  text            text NOT NULL,
  status          text NOT NULL CHECK (status IN ('checked', 'failed')),
  verdict         text CHECK (verdict IN ('yes', 'probably_yes', 'neutral', 'probably_no', 'no')),
  sources         jsonb NOT NULL DEFAULT '[]'::jsonb,
  reason          text,
  relevance       real,
  confidence      real,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'checked') = (verdict IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS claims_conversation ON claims (conversation_id, id);
