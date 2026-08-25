-- ================================================================
-- 042_corpus_harvest.sql
-- X7a: 自律コーパス収集 — ソースレジストリ・収集run・項目拡張・corpus_context
--
-- 設計: claude/coe-x7-pdca-design.md（承認済み v2.2）第1部
--
-- 【構成】
--   corpus_sources       … 収集ソースのレジストリ（許諾・確認が済むまで enabled=false）
--   corpus_harvest_runs  … 収集実行の履歴（件数・トークン・明細ログ）
--   corpus_evidence      … 列追加: harvest_run_id / dup_of / dup_score ＋
--                          (a) 因果の統計的根拠（効果量・CI・p値・手法・標本…）
--                          (b) 財政効果（額・単位・根拠・財政効果率・期間・注記）
--   corpus_measures      … 列追加: harvest_run_id / dup_of / dup_score
--   corpus_context       … SWOT素材の第3種別（PESTLE/7SタグはAs-Isと同語彙）
--   pg_trgm              … 重複検知（タイトル＋出典のtrigram類似度）
--
-- 【品質原則（既存を維持）】
--   - 無確認の自動登録をしない: 自動収集は status='pending' 投入まで。
--     承認操作なしに approved には絶対ならない
--   - 全行出典必須・source_key 冪等（ON CONFLICT DO NOTHING / DO UPDATE）
--   - 重複は dup_of を付けるだけ。自動では絶対に落とさない（判断は検収者）
--
-- 【財政効果率の定義（確認結果0で確定）】
--   fiscal_effect_rate ＝ 財政効果額（年換算）÷ 事業費（年）
--   実装済みの効率性評価 cost_efficiency_records（010）の算定式
--     cost_ratio = (labor_cost + operating_cost) / (reduction_a+b+c) * 100
--     （投入額 ÷ 年間削減額 × 100。小さいほど効率的）
--   と同一の分子・分母・年次で、その逆数に相当する:
--     fiscal_effect_rate = 年間削減額 ÷ 投入額 （= 100 ÷ cost_ratio）
--   大きいほど効率的。効率性評価画面との比較表示はこの換算で行う。
--
-- 方針: MIGRATION_POLICY.md 準拠。追加のみ（列削除・CHECK縮小はしない）。冪等。
-- ================================================================

-- ── 重複検知用の拡張 ─────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── ソースレジストリ ─────────────────────────────────
CREATE TABLE IF NOT EXISTS corpus_sources (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT        NOT NULL,
  kind              TEXT        NOT NULL
                      CHECK (kind IN ('structured_db', 'pdf_repository', 'press')),
  base_url          TEXT        NOT NULL,
  -- アダプタ実装の識別子（lib/corpus/harvest/adapters.ts の正本と check で照合）
  adapter           TEXT        NOT NULL,
  crawl_frequency   TEXT        NOT NULL DEFAULT 'manual'
                      CHECK (crawl_frequency IN ('weekly', 'monthly', 'manual')),
  -- ライセンス・許諾の注記（未記入のソースは有効化不可 — アプリ側ガード）
  license_note      TEXT        NOT NULL DEFAULT '',
  -- pdf_repository / 学術API用: 検索クエリ・分野タグ等（X7b/X7dで使用）
  query_config      JSONB,
  -- ★許諾・確認が済むまで有効化しない
  enabled           BOOLEAN     NOT NULL DEFAULT false,
  last_crawled_at   TIMESTAMPTZ,
  last_content_hash TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE corpus_sources IS
  '自律コーパス収集のソースレジストリ（X7a）。enabled=false のソースは収集しない。license_note が空のソースは有効化できない（許諾・利用規約の確認が最終防衛線）';

-- ── 収集実行の履歴 ───────────────────────────────────
CREATE TABLE IF NOT EXISTS corpus_harvest_runs (
  id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id                   UUID        NOT NULL REFERENCES corpus_sources(id) ON DELETE CASCADE,
  trigger                     TEXT        NOT NULL
                                CHECK (trigger IN ('scheduled', 'manual')),
  status                      TEXT        NOT NULL DEFAULT 'running'
                                CHECK (status IN ('running', 'succeeded', 'partial', 'failed')),
  started_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at                 TIMESTAMPTZ,
  pages_fetched               INT         NOT NULL DEFAULT 0,
  items_found                 INT         NOT NULL DEFAULT 0,
  items_new                   INT         NOT NULL DEFAULT 0,
  items_duplicate             INT         NOT NULL DEFAULT 0,
  items_rejected_by_sanitize  INT         NOT NULL DEFAULT 0,
  knowledge_docs_created      INT         NOT NULL DEFAULT 0,   -- アダプタB用（X7b）
  input_tokens                BIGINT      NOT NULL DEFAULT 0,   -- コスト可視化（ai_usage_logsと同粒度）
  output_tokens               BIGINT      NOT NULL DEFAULT 0,
  error_summary               TEXT,
  -- 件名レベルの明細（何を拾い何を捨てたか）: [{kind, title, url?, note?}]
  log                         JSONB       NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_corpus_harvest_runs_source
  ON corpus_harvest_runs (source_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_corpus_harvest_runs_started
  ON corpus_harvest_runs (started_at DESC);

COMMENT ON TABLE corpus_harvest_runs IS
  '自動収集の実行履歴（X7a）。log には拾った件名・捨てた理由を件名レベルで残す（検収者の判断材料）';

-- ── corpus_evidence / corpus_measures への列追加（互換維持・NULL許容のみ）──
ALTER TABLE corpus_evidence
  ADD COLUMN IF NOT EXISTS harvest_run_id UUID REFERENCES corpus_harvest_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS dup_of         UUID,
  ADD COLUMN IF NOT EXISTS dup_score      REAL;

ALTER TABLE corpus_measures
  ADD COLUMN IF NOT EXISTS harvest_run_id UUID REFERENCES corpus_harvest_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS dup_of         UUID,
  ADD COLUMN IF NOT EXISTS dup_score      REAL;

-- ── (a) 因果の統計的根拠（アウトプット→初期アウトカム）────
-- 「本文に数値がある場合のみ転記。無ければ NULL のまま」（推測禁止の原則）
ALTER TABLE corpus_evidence
  ADD COLUMN IF NOT EXISTS output_summary    TEXT,   -- 何をどれだけ提供したか
  ADD COLUMN IF NOT EXISTS outcome_summary   TEXT,   -- 変化したアウトカム指標と変化量
  ADD COLUMN IF NOT EXISTS outcome_tier      TEXT
    CHECK (outcome_tier IN ('outcome_initial', 'outcome_intermediate', 'outcome_long')),
    -- ★ kpis.indicator_type / lib/outcome/tiers.ts と同語彙（語彙分裂を作らない）
  ADD COLUMN IF NOT EXISTS effect_size_type  TEXT
    CHECK (effect_size_type IN ('rate_diff', 'mean_diff', 'rr', 'or', 'hr', 'irr', 'cohen_d', 'other')),
  ADD COLUMN IF NOT EXISTS effect_size_value NUMERIC,
  ADD COLUMN IF NOT EXISTS ci_low            NUMERIC,
  ADD COLUMN IF NOT EXISTS ci_high           NUMERIC,
  ADD COLUMN IF NOT EXISTS p_value           NUMERIC,
  ADD COLUMN IF NOT EXISTS stat_method       TEXT,   -- DiD・Cox比例ハザード等（自由記述）
  ADD COLUMN IF NOT EXISTS sample_size       INT,
  ADD COLUMN IF NOT EXISTS followup_months   INT;

-- ── (b) 財政効果（C工程・効率性評価＝第5階層と同語彙）─────
ALTER TABLE corpus_evidence
  ADD COLUMN IF NOT EXISTS fiscal_effect_amount NUMERIC,  -- 円換算
  ADD COLUMN IF NOT EXISTS fiscal_effect_unit   TEXT
    CHECK (fiscal_effect_unit IN ('per_person_total', 'per_person_year', 'total_year', 'other')),
  ADD COLUMN IF NOT EXISTS fiscal_effect_basis  TEXT,     -- 給付費/医療費/扶助費/税収/事業費削減…
  -- 財政効果率 ＝ 財政効果額（年換算）÷ 事業費（年）。
  -- cost_efficiency_records.cost_ratio（投入÷削減×100）の逆数に相当（= 100 ÷ cost_ratio）
  ADD COLUMN IF NOT EXISTS fiscal_effect_rate   NUMERIC,
  ADD COLUMN IF NOT EXISTS fiscal_horizon_years NUMERIC,  -- 効果の発現・計測期間
  ADD COLUMN IF NOT EXISTS fiscal_note          TEXT;     -- 算定根拠・割引率・海外通貨の換算注記

-- ── source_kind に自動収集値を追加（CHECK 張り替え・上位集合）──
ALTER TABLE corpus_evidence
  DROP CONSTRAINT IF EXISTS corpus_evidence_source_kind_check;
ALTER TABLE corpus_evidence
  ADD CONSTRAINT corpus_evidence_source_kind_check
    CHECK (source_kind IN (
      'evidence_item',      -- 施策のエビデンス欄（自治体供出）
      'experiment_result',  -- 自治体の実験結果
      'knowledge_extract',  -- ナレッジ抽出・webseed（手動シード）
      'harvest'             -- 自動収集（X7a）
    ));

ALTER TABLE corpus_measures
  DROP CONSTRAINT IF EXISTS corpus_measures_source_kind_check;
ALTER TABLE corpus_measures
  ADD CONSTRAINT corpus_measures_source_kind_check
    CHECK (source_kind IN (
      'measure_design',     -- 自治体の確定施策
      'knowledge_extract',  -- ナレッジ抽出・webseed
      'harvest'             -- 自動収集（X7a。参照行 govreview は X7e で追加予定）
    ));

-- ── corpus_context — SWOT素材の第3種別（P工程供給用）──────
CREATE TABLE IF NOT EXISTS corpus_context (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  status          TEXT        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected')),
  source_key      TEXT        NOT NULL UNIQUE,          -- 冪等（webseed:ctx:… / webseed:auto:…）
  harvest_run_id  UUID        REFERENCES corpus_harvest_runs(id) ON DELETE SET NULL,
  kind            TEXT        NOT NULL
                    CHECK (kind IN (
                      'policy_package',   -- 国の政策パッケージ・大綱・骨太方針の施策項目
                      'legal_system',     -- 制度・法改正
                      'subsidy_program',  -- 補助金・交付金・モデル事業の公募
                      'regional_stat',    -- 地域統計の事実（全国値との比較つき）
                      'trend'             -- 社会・技術トレンド（白書等の記述）
                    )),
  title           TEXT        NOT NULL,
  body            TEXT        NOT NULL,                 -- 事実の要約（推測・評価を含めない）
  -- ★ As-Is（lib/asis/types.ts）と同語彙: P/E/S/T/L/Env
  pestle_tag      TEXT        NOT NULL
                    CHECK (pestle_tag IN ('P', 'E', 'S', 'T', 'L', 'Env')),
  -- 内部環境系はこちら（マッキンゼー7S・As-Isと同語彙）
  seven_s_tag     TEXT
                    CHECK (seven_s_tag IN (
                      'strategy', 'structure', 'system', 'shared_values',
                      'skills', 'staff', 'style'
                    )),
  swot_hint       TEXT        NOT NULL DEFAULT 'neutral'
                    CHECK (swot_hint IN ('opportunity', 'threat', 'strength', 'weakness', 'neutral')),
  region_scope    TEXT        NOT NULL DEFAULT 'national'
                    CHECK (region_scope IN ('national', 'prefecture', 'municipality')),
  region_code     TEXT,                                 -- 都道府県・市区町村コード
  population_band TEXT,                                 -- 既存5段階と同語彙
  field_category  TEXT,                                 -- 既存分野語彙
  effective_from  DATE,                                 -- 制度の適用期間（改廃の鮮度管理）
  effective_until DATE,
  source_org      TEXT        NOT NULL,                 -- 出典必須（既存原則）
  source_url      TEXT,
  published_at    DATE,
  source_note     TEXT,
  dup_of          UUID,
  dup_score       REAL,
  review_note     TEXT,
  reviewed_at     TIMESTAMPTZ,
  reviewed_by     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_corpus_context_status
  ON corpus_context (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_corpus_context_kind
  ON corpus_context (kind, region_scope);

COMMENT ON TABLE corpus_context IS
  'SWOT素材（政策パッケージ・制度・地域統計・トレンド）の第3コーパス種別（X7a）。As-Is/課題仮説と同一のPESTLE/7Sタグ体系。effective_until 超過行は接地対象から自動除外（期限切れ表示でアーカイブ）';

-- ── 重複検知用 GIN インデックス（title＋出典の trigram）────
CREATE INDEX IF NOT EXISTS idx_corpus_evidence_trgm
  ON corpus_evidence USING gin ((title || ' ' || source) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_corpus_measures_trgm
  ON corpus_measures USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_corpus_context_trgm
  ON corpus_context USING gin (title gin_trgm_ops);

-- ── AIタスク種別の種付け（収集の構造化抽出）───────────────
INSERT INTO ai_task_routing (task_type, note) VALUES
  ('knowledge.harvest', '自動収集ソースからの構造化抽出（X7a）')
ON CONFLICT (task_type) DO NOTHING;

-- ── ソースの初期登録（すべて enabled=false で登録・有効化は画面から）──
-- 初弾は政府標準利用規約系（BEST）。ナッジシェアはアダプタ実装のみ・
-- 事前許諾の完了まで有効化しない（確認結果1）。
INSERT INTO corpus_sources (name, kind, base_url, adapter, crawl_frequency, license_note, enabled)
SELECT * FROM (VALUES
  (
    '環境省 日本版ナッジ・ユニット（BEST）事例集',
    'structured_db',
    'https://www.env.go.jp/earth/ondanka/nudge.html',
    'env_best',
    'monthly',
    '政府標準利用規約2.0（環境省サイト・出典明記で利用可）。PDF資料の再配布はしない（本文からの構造化抽出のみ）',
    false
  ),
  (
    '自治体ナッジシェア',
    'structured_db',
    'https://www.nudge-share.jp/',
    'nudge_share',
    'monthly',
    '要事前許諾・出典明記。★許諾完了まで有効化しないこと（確認結果1: 許諾連絡は後回し）',
    false
  )
) AS v(name, kind, base_url, adapter, crawl_frequency, license_note, enabled)
WHERE NOT EXISTS (
  SELECT 1 FROM corpus_sources s WHERE s.adapter = v.adapter
);

-- ── 確認用ログ ───────────────────────────────────────
DO $$
DECLARE
  n_sources INT;
BEGIN
  SELECT count(*) INTO n_sources FROM corpus_sources;
  RAISE NOTICE '自律コーパス収集(X7a): corpus_sources(%件) / corpus_harvest_runs / corpus_context を用意し、corpus_evidence に統計・財政効果欄を追加しました', n_sources;
  RAISE NOTICE '登録ソースはすべて enabled=false です。ライセンス確認のうえ /ordo-admin/corpus の自動収集タブから有効化してください';
END $$;
