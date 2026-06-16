-- ① カテゴリー（Ordoスタッフが自由に設定）
CREATE TABLE knowledge_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  description TEXT,
  plan_type TEXT,
  color TEXT DEFAULT '#0C447C',
  sort_order INT DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ② PDCA工程タグ（予め設計に組み込む。グローバル共通）
CREATE TABLE knowledge_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  pdca_phase TEXT NOT NULL CHECK (pdca_phase IN ('P','D','C','A','common')),
  module_key TEXT,
  description TEXT,
  sort_order INT DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- knowledge_documents にカテゴリ列を追加
ALTER TABLE knowledge_documents ADD COLUMN category_id UUID REFERENCES knowledge_categories(id);

-- ドキュメント↔タグ（多対多。アップロード時にスイッチで選択）
CREATE TABLE knowledge_document_tags (
  document_id UUID NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES knowledge_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (document_id, tag_id)
);

-- ③ 処理進捗・タイムライン用の列を追加
ALTER TABLE knowledge_documents
  ADD COLUMN processing_step TEXT,
  ADD COLUMN processing_progress INT DEFAULT 0,
  ADD COLUMN total_chunks INT,
  ADD COLUMN processed_chunks INT DEFAULT 0,
  ADD COLUMN processing_started_at TIMESTAMPTZ,
  ADD COLUMN processing_log JSONB DEFAULT '[]';

-- 辞書をカテゴリ単位に
ALTER TABLE knowledge_dicts ADD COLUMN category_id UUID REFERENCES knowledge_categories(id);

CREATE INDEX idx_knowledge_categories_active ON knowledge_categories(is_active);
CREATE INDEX idx_knowledge_tags_phase ON knowledge_tags(pdca_phase);
CREATE INDEX idx_knowledge_doc_tags_doc ON knowledge_document_tags(document_id);
CREATE INDEX idx_knowledge_dicts_category ON knowledge_dicts(category_id);

-- PDCA工程タグの初期シード
INSERT INTO knowledge_tags (name, slug, pdca_phase, module_key, sort_order) VALUES
('現状整理（As-Is分析）','as_is','P','as_is',10),
('課題抽出・ニーズ評価','needs','P','gap_analysis',20),
('ロジックモデル（セオリー評価）','logic_model','P','logic_model',30),
('サービス見込量','service_volume','P','service_volume',40),
('スケジュール設定','schedule','P',NULL,50),
('計画書策定','plan_doc','P',NULL,60),
('進捗報告・KPI更新','progress','D',NULL,70),
('ドキュメント管理','doc_mgmt','D',NULL,80),
('プロセス評価','process_eval','C','program_evaluation',90),
('アウトカム評価','outcome_eval','C','program_evaluation',100),
('コスト・効率性評価','cost_eval','C','cost_efficiency',110),
('EBPMスコア','ebpm','C',NULL,120),
('改善提案','improvement','A',NULL,130),
('次期計画フィードバック','feedback','A',NULL,140),
('レポート生成','report','A',NULL,150),
('法令・基本指針','law','common',NULL,160),
('用語・定義','terms','common',NULL,170);

-- カテゴリ初期データ（介護保険を1件だけ作成）
INSERT INTO knowledge_categories (name, slug, description, plan_type, color, sort_order)
VALUES ('介護保険事業計画','kaigo_hoken','介護保険事業計画・地域包括ケア計画に関するナレッジ','kaigo_hoken','#0C447C',10);
