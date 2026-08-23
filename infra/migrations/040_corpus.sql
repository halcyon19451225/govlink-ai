-- ================================================================
-- 040_corpus.sql
-- X3: コーパス — 匿名化横断スキーマ・オプトイン同意・ナレッジ抽出
--
-- 設計: claude/coe-ownai-plan.md（承認済み方針）X3
-- 承認事項: 横断学習の同意方式 = オプトイン（契約時に選択）
--
-- 【構成】
--   corpus_consents      … 自治体ごとのオプトイン同意（Ordo運営が契約に基づき設定）
--   corpus_measures      … 横断参照できる施策データセット（匿名化済み）
--   corpus_evidence      … 横断参照できるエビデンス項目（匿名化済み）
--   knowledge_extractions… ナレッジ文書からのAI抽出の提案（担当者確認前の置き場）
--
-- 【匿名化の設計】
--   コーパス行は municipality_id を持たない。代わりに
--   contributor_key = SHA-256(salt + municipality_id) を持つ:
--   - 同一自治体の供出をグループ化・オプトアウト時の一括削除ができる
--   - 平文の自治体IDには戻せない
--   contributor_key が NULL の行は Tier1（Ordo管理の公開資料）由来。
--   自由記述内の自治体名は供出時にコード側で「当自治体」へ置換する。
--
-- 【品質の設計（検収）】
--   自治体からの供出は status='pending' で入り、Ordo運営画面の検収で
--   approved になって初めて参照対象になる。ナレッジ抽出は担当者が
--   確認・修正してから取り込む（無確認の自動登録はしない —
--   コーパス汚染の防止。方針ドキュメント3章）。
--   出典（source_note / source）を必ず持つ — 妥当性の追跡が生命線。
--
-- 【学習データの制約】
--   コーパスは担当者が確認・確定した事実データのみで構成する
--   （Claudeの生成文そのものは入れない — Anthropic 商用利用規約への配慮。
--     ナレッジ抽出はAIが「元文書の記載」を構造化したもので、担当者の
--     確認を経て初めて取り込まれる）。
--
-- 方針: MIGRATION_POLICY.md 準拠。新規テーブル＋種付けのみ。冪等。
-- ================================================================

-- ── 同意（オプトイン）──────────────────────────────
CREATE TABLE IF NOT EXISTS corpus_consents (
  municipality_id UUID        PRIMARY KEY REFERENCES municipalities(id) ON DELETE CASCADE,
  opted_in        BOOLEAN     NOT NULL DEFAULT false,
  -- 契約上の根拠（契約番号・覚書の日付など）
  note            TEXT,
  decided_by      TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE corpus_consents IS
  '匿名化データの横断利用へのオプトイン同意（契約に基づきOrdo運営が設定）。opted_in=true の自治体のみ供出できる。オプトアウト時は当該自治体の供出済みコーパス行を削除する';

-- ── コーパス: 施策 ─────────────────────────────────
CREATE TABLE IF NOT EXISTS corpus_measures (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  status                TEXT        NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'approved', 'rejected')),

  -- 検索軸（検収時にOrdo運営が補完・修正できる）
  field_category        TEXT,      -- 分野（介護予防・子育て・防災 …）
  population_band       TEXT,      -- 自治体規模帯（〜1万 / 1〜5万 / 5〜20万 / 20〜50万 / 50万〜）

  -- 施策データセットの写し（measure_designs のB〜F区画相当・匿名化済み）
  title                 TEXT        NOT NULL,
  approach              TEXT,
  target_population     TEXT,
  target_size           NUMERIC,
  intervention          TEXT,
  delivery              TEXT,
  evidence_status       TEXT        NOT NULL DEFAULT 'none'
                          CHECK (evidence_status IN ('sufficient', 'partial', 'none')),
  evidence_items        JSONB       NOT NULL DEFAULT '[]'::jsonb,
  experiment            JSONB,
  structure_indicators  JSONB       NOT NULL DEFAULT '[]'::jsonb,  -- 文字列の配列
  process_indicators    JSONB       NOT NULL DEFAULT '[]'::jsonb,  -- 文字列の配列
  outcome_notes         JSONB       NOT NULL DEFAULT '[]'::jsonb,  -- KPI要約の文字列配列
  total_budget          NUMERIC,
  unit_cost             NUMERIC,
  cost_per_outcome_note TEXT,
  funding               TEXT,
  -- 実績効果の要約（昇格済み実験結果から。「効かなかった」も正直に持つ）
  effect_note           TEXT,

  -- 出所（妥当性の追跡）
  source_kind           TEXT        NOT NULL
                          CHECK (source_kind IN ('measure_design', 'knowledge_extract')),
  source_key            TEXT        NOT NULL UNIQUE,  -- 冪等供出のためのキー
  contributor_key       TEXT,       -- SHA-256(salt + municipality_id)。NULL = Tier1由来
  source_note           TEXT,       -- 出典（文書名・発行元など）

  review_note           TEXT,
  reviewed_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_corpus_measures_status
  ON corpus_measures (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_corpus_measures_contributor
  ON corpus_measures (contributor_key) WHERE contributor_key IS NOT NULL;

COMMENT ON TABLE corpus_measures IS
  '横断参照用の施策データセット（匿名化済み）。pending はOrdo検収待ちで参照対象外。X4でSWOT/施策提案/積算のコーパス接地に使う';

-- ── コーパス: エビデンス ───────────────────────────
CREATE TABLE IF NOT EXISTS corpus_evidence (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  status          TEXT        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected')),
  field_category  TEXT,
  population_band TEXT,

  -- EvidenceItem 相当（measure/types.ts の形式と互換）
  title           TEXT        NOT NULL,
  source          TEXT        NOT NULL,   -- 出典（必須 — 妥当性の追跡）
  url             TEXT,
  year            INTEGER,
  design          TEXT        NOT NULL
                    CHECK (design IN ('sr', 'rct', 'qed', 'prepost', 'case')),
  evidence_level  SMALLINT    NOT NULL CHECK (evidence_level BETWEEN 1 AND 5),
  population      TEXT,
  effect_summary  TEXT        NOT NULL,
  transferability TEXT,

  source_kind     TEXT        NOT NULL
                    CHECK (source_kind IN ('evidence_item', 'experiment_result', 'knowledge_extract')),
  source_key      TEXT        NOT NULL UNIQUE,
  contributor_key TEXT,
  source_note     TEXT,

  review_note     TEXT,
  reviewed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_corpus_evidence_status
  ON corpus_evidence (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_corpus_evidence_contributor
  ON corpus_evidence (contributor_key) WHERE contributor_key IS NOT NULL;

COMMENT ON TABLE corpus_evidence IS
  '横断参照用のエビデンス項目（匿名化済み）。出典必須。pending はOrdo検収待ちで参照対象外';

-- ── ナレッジ抽出の提案（担当者確認前の置き場）─────────
CREATE TABLE IF NOT EXISTS knowledge_extractions (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   UUID        NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  status        TEXT        NOT NULL DEFAULT 'proposed'
                  CHECK (status IN ('proposed', 'intaken', 'dismissed')),
  -- { measures: [...], evidence: [...] } — corpus_* 行の形の提案
  proposals     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  -- 取り込み結果 { measures: n, evidence: n }（担当者確認後に記録）
  intake_result JSONB,
  decided_by    TEXT,
  decided_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_extractions_document
  ON knowledge_extractions (document_id, created_at DESC);

COMMENT ON TABLE knowledge_extractions IS
  'ナレッジ文書からAIが拾い上げた施策・エビデンス情報の提案。担当者が確認・修正して取り込むまでコーパスには入らない（無確認の自動登録はしない）';

-- ── AIタスク種別の追加種付け（抽出タスク）────────────
INSERT INTO ai_task_routing (task_type, note) VALUES
  ('knowledge.extract', 'ナレッジ文書からの施策・エビデンス抽出')
ON CONFLICT (task_type) DO NOTHING;

-- ── 確認用ログ ───────────────────────────────────
DO $$
BEGIN
  RAISE NOTICE 'コーパス: corpus_consents / corpus_measures / corpus_evidence / knowledge_extractions を用意しました（オプトイン＋検収制）';
END $$;
