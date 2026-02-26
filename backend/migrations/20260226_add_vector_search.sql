-- Vector search support using pgvector
-- pgvector must be installed: brew install pgvector (built from source for PG16)

-- Enable vector extension (idempotent)
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column (3072 dimensions = gemini-embedding-001)
ALTER TABLE canonical_events
  ADD COLUMN IF NOT EXISTS embedding vector(3072);

-- Index will be created after backfill (needs data to set lists parameter)
-- Run after backfill-embeddings.ts:
--   CREATE INDEX canonical_events_embedding_idx
--     ON canonical_events USING ivfflat (embedding vector_cosine_ops)
--     WITH (lists = 50);
