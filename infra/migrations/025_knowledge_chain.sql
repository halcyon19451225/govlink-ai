ALTER TABLE knowledge_documents
  ADD COLUMN chain_token TEXT,
  ADD COLUMN chain_started_at TIMESTAMPTZ,
  ADD COLUMN last_chain_ping_at TIMESTAMPTZ;
