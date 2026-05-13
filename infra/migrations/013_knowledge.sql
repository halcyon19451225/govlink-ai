-- ================================================================
-- ナレッジドキュメント
-- ================================================================
CREATE TABLE knowledge_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tier INT NOT NULL CHECK (tier IN (1, 2)),
  municipality_id UUID REFERENCES municipalities(id),
  title TEXT NOT NULL,
  description TEXT,
  file_name TEXT NOT NULL,
  s3_key TEXT NOT NULL,
  file_size_bytes BIGINT,
  file_type TEXT NOT NULL,
  document_category TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'compiled', 'error')),
  error_message TEXT,
  extracted_text TEXT,
  compiled_at TIMESTAMPTZ,
  uploaded_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- ナレッジ辞書
-- ================================================================
CREATE TABLE knowledge_dicts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tier INT NOT NULL CHECK (tier IN (1, 2)),
  municipality_id UUID REFERENCES municipalities(id),
  dict_data JSONB NOT NULL DEFAULT '{"version": 0, "sections": []}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tier, municipality_id)
);

-- ================================================================
-- ドキュメントとナレッジ辞書セクションの対応
-- ================================================================
CREATE TABLE knowledge_document_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  dict_id UUID NOT NULL REFERENCES knowledge_dicts(id),
  section_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- プロジェクトとナレッジの紐付け
-- ================================================================
CREATE TABLE project_knowledge_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  knowledge_dict_id UUID NOT NULL REFERENCES knowledge_dicts(id),
  linked_section_ids TEXT[] DEFAULT ARRAY[]::text[],
  linked_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, knowledge_dict_id)
);

CREATE INDEX idx_knowledge_docs_tier ON knowledge_documents(tier);
CREATE INDEX idx_knowledge_docs_municipality ON knowledge_documents(municipality_id);
CREATE INDEX idx_knowledge_docs_status ON knowledge_documents(status);
CREATE INDEX idx_project_knowledge_links_project ON project_knowledge_links(project_id);

INSERT INTO knowledge_dicts (tier, municipality_id, dict_data)
VALUES (1, NULL, '{"version": 0, "sections": [], "global_terms": {}, "planning_checklist": []}');
