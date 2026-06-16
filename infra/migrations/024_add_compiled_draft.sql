ALTER TABLE knowledge_documents ADD COLUMN compiled_draft JSONB DEFAULT '[]';
ALTER TABLE knowledge_dicts ADD COLUMN version INT NOT NULL DEFAULT 0;
