-- ================================================================
-- 036_measure_design.sql
-- E1: 施策構築（EBPM）モジュールの土台
--
-- 設計: claude/coe-ebpm-plan.md（承認済み方針）
--
-- 【何を作るか】
--   課題仮説設定（真因）とロジックモデルの間に「施策構築」の工程を挿入する。
--   真因を解消するアプローチから具体的な施策を構築し、
--     1. まずエビデンスを参照する（管理画面ナレッジ → Web）
--     2. 参照可能なエビデンスが無ければ、自治体の規模・状況に応じた
--        実験設計（RCT・クラスターRCT・ステップド・ウェッジ・差の差 等）をAIが提案する
--     3. 短期・中間KPI、ストラクチャー／プロセス指標、コストまでを
--        一つのデータセット（measure_designs 1行）に揃える
--   C評価・A改善はこのデータセットを前提に動く。
--
-- 【確定条件（承認済み）】
--   エビデンスが sufficient でない施策は、実験設計を添えない限り confirmed にできない。
--   「エビデンスを作りながら実施する」というEBPMの標準形をDBの制約で保証する。
--
-- 方針: MIGRATION_POLICY.md 準拠。新規テーブル＋レジストリ追加のみ。
--       既存テーブルへの破壊的変更なし。冪等。
-- ================================================================

-- ================================================================
-- Step 1: 対話テーブル（構築の過程を保持する）
--   As-Is・課題仮説・改善と同じ設計。工程は6段階。
-- ================================================================
CREATE TABLE IF NOT EXISTS measure_dialogues (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- 起点となった課題仮説（真因の出所）
  issue_hypothesis_id UUID        REFERENCES issue_hypotheses(id) ON DELETE SET NULL,
  title               TEXT        NOT NULL DEFAULT '施策構築',
  status              TEXT        NOT NULL DEFAULT 'in_progress'
                        CHECK (status IN ('in_progress', 'completed')),
  current_step        TEXT        NOT NULL DEFAULT 'approach'
                        CHECK (current_step IN
                          ('approach', 'evidence', 'experiment', 'indicators', 'cost', 'done')),
  -- 対話履歴: [{ role, content, step?, suggestions? }]
  messages            JSONB       NOT NULL DEFAULT '[]'::jsonb,
  -- 1. アプローチ: [{ id, root_cause, approach, measure_title, target, intervention }]
  approaches          JSONB       NOT NULL DEFAULT '[]'::jsonb,
  -- 2. エビデンス: [{ approach_id, status, items: [{ title, source, url, year,
  --                   design, evidence_level, population, effect_summary, transferability }] }]
  evidence            JSONB       NOT NULL DEFAULT '[]'::jsonb,
  -- 3. 実験設計: [{ approach_id, design, rationale, unit, arms, sample_size_note,
  --                 primary_outcome, duration, cost_estimate, ethical_note, fallback }]
  experiments         JSONB       NOT NULL DEFAULT '[]'::jsonb,
  -- 4. 指標: [{ approach_id, structure: [], process: [],
  --             outcome_initial: [{label,target,unit,baseline,deadline,condition,kpi_id?}],
  --             outcome_intermediate: [...] }]
  indicators          JSONB       NOT NULL DEFAULT '[]'::jsonb,
  -- 5. コスト: [{ approach_id, total_budget, unit_cost, cost_per_outcome_note, funding }]
  costs               JSONB       NOT NULL DEFAULT '[]'::jsonb,
  -- measure_designs へ書き出した時刻（未書き出しは NULL）
  committed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_measure_dialogues_project
  ON measure_dialogues (project_id);
CREATE INDEX IF NOT EXISTS idx_measure_dialogues_hypothesis
  ON measure_dialogues (issue_hypothesis_id)
  WHERE issue_hypothesis_id IS NOT NULL;

DROP TRIGGER IF EXISTS set_updated_at_measure_dialogues ON measure_dialogues;
CREATE TRIGGER set_updated_at_measure_dialogues
  BEFORE UPDATE ON measure_dialogues
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

COMMENT ON TABLE measure_dialogues IS
  '施策構築（EBPM）の対話。アプローチ→エビデンス→実験設計→指標→コスト→確定の過程を保持する';

-- ================================================================
-- Step 2: 施策データセット（1施策 = 1行。C・A工程との契約）
-- ================================================================
CREATE TABLE IF NOT EXISTS measure_designs (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- ── A. 出所（リネージ）────────────────────────
  issue_hypothesis_id   UUID        REFERENCES issue_hypotheses(id) ON DELETE SET NULL,
  -- 起点にした真因の当時の文言。仮説側が後で修正されても、この施策が
  -- 何を前提に設計されたのかが変わらないように写しを持つ
  root_cause_snapshot   TEXT,
  gap_analysis_ids      UUID[]      NOT NULL DEFAULT '{}',
  measure_dialogue_id   UUID        REFERENCES measure_dialogues(id) ON DELETE SET NULL,

  -- ── B. 施策の定義 ─────────────────────────────
  title                 TEXT        NOT NULL,
  -- 作用機序: 真因にどう働きかけて断つのか
  approach              TEXT,
  target_population     TEXT,
  target_size           NUMERIC,
  -- 何を・どの頻度・どの期間・どの強度で（dosage）
  intervention          TEXT,
  -- 実施体制・担い手（直営／委託／住民主体 …）
  delivery              TEXT,
  period_start          DATE,
  period_end            DATE,

  -- ── C. エビデンス ─────────────────────────────
  evidence_status       TEXT        NOT NULL DEFAULT 'none'
                          CHECK (evidence_status IN ('sufficient', 'partial', 'none')),
  -- [{ title, source, url, year, design(sr|rct|qed|prepost|case),
  --    evidence_level(1-5), population, effect_summary, transferability }]
  evidence_items        JSONB       NOT NULL DEFAULT '[]'::jsonb,

  -- ── D. 実験設計（エビデンス不足時に必須）───────
  -- { design(rct|cluster_rct|stepped_wedge|waitlist|did|matching|prepost),
  --   rationale, unit, arms, sample_size_note, primary_outcome,
  --   duration, cost_estimate, ethical_note, fallback }
  experiment            JSONB,

  -- ── E. 指標（Donabedian 三層 ＋ KPI連鎖）───────
  -- ストラクチャー・プロセスは [{ id, text, kpi_id? }]
  structure_indicators  JSONB       NOT NULL DEFAULT '[]'::jsonb,
  process_indicators    JSONB       NOT NULL DEFAULT '[]'::jsonb,
  -- アウトカムは kpis テーブルの実体を参照（基準値・目標・期限・達成条件は kpis 側）
  kpi_ids_initial       UUID[]      NOT NULL DEFAULT '{}',
  kpi_ids_intermediate  UUID[]      NOT NULL DEFAULT '{}',

  -- ── F. コスト・効率性 ─────────────────────────
  total_budget          NUMERIC,
  unit_cost             NUMERIC,
  -- 成果1単位あたり費用の算定式（第5階層=効率性評価がこの式を使う）
  cost_per_outcome_note TEXT,
  funding               TEXT,

  -- ── G. 実行への接続 ───────────────────────────
  owner_department      TEXT,
  milestones            JSONB       NOT NULL DEFAULT '[]'::jsonb,
  risks                 JSONB       NOT NULL DEFAULT '[]'::jsonb,

  -- ── H. 管理 ──────────────────────────────────
  status                TEXT        NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft', 'confirmed')),
  sort_order            INT         NOT NULL DEFAULT 0,
  committed_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- 【確定条件】エビデンスが十分でない施策は、実験設計を添えない限り確定できない。
  -- 「エビデンスを作りながら実施する」を制約として保証する（承認済み方針）。
  CONSTRAINT measure_designs_confirm_requires_evidence
    CHECK (
      status <> 'confirmed'
      OR evidence_status = 'sufficient'
      OR (experiment IS NOT NULL AND experiment <> 'null'::jsonb AND experiment <> '{}'::jsonb)
    )
);

CREATE INDEX IF NOT EXISTS idx_measure_designs_project
  ON measure_designs (project_id);
CREATE INDEX IF NOT EXISTS idx_measure_designs_hypothesis
  ON measure_designs (issue_hypothesis_id)
  WHERE issue_hypothesis_id IS NOT NULL;

DROP TRIGGER IF EXISTS set_updated_at_measure_designs ON measure_designs;
CREATE TRIGGER set_updated_at_measure_designs
  BEFORE UPDATE ON measure_designs
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

COMMENT ON TABLE measure_designs IS
  '施策データセット（EBPM）。エビデンス・実験設計・SPO指標・コストを1施策1行に揃え、C評価・A改善の前提になる';
COMMENT ON COLUMN measure_designs.evidence_status IS
  'sufficient=参照可能なエビデンスあり / partial=部分的 / none=なし（実験設計が必要）';
COMMENT ON COLUMN measure_designs.experiment IS
  'エビデンス不足時の実験設計。confirmed にするには sufficient か実験設計のどちらかが必要（CHECK制約）';

-- ================================================================
-- Step 3: モジュール登録
--   課題仮説設定(3) とロジックモデル(4) の間に挿入する。
--   既存の sort_order 4 以降を +1 ずらしてから 4 に入れる（冪等）。
-- ================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM plan_modules WHERE id = 'measure_design') THEN
    UPDATE plan_modules SET sort_order = sort_order + 1 WHERE sort_order >= 4;
    INSERT INTO plan_modules (id, display_name, description, plan_types, depends_on, sort_order)
    VALUES (
      'measure_design',
      '施策構築（EBPM）',
      '真因を断つ施策の構築。エビデンス参照・実験設計・SPO指標・コストを1つのデータセットに揃える',
      ARRAY['kaigo_hoken','shougai_fukushi','kenko_zoshin','chiiki_fukushi','custom'],
      ARRAY['issue_hypothesis'],
      4
    );
  END IF;
END $$;

-- 既存プロジェクトへの配布:
-- ロジックモデルか課題仮説設定が有効なプロジェクトには、この工程も有効にする
-- （両者の間に挟まる工程のため）。
INSERT INTO project_module_configs (project_id, module_id, is_enabled)
SELECT DISTINCT pmc.project_id, 'measure_design', true
FROM project_module_configs pmc
WHERE pmc.module_id IN ('issue_hypothesis', 'logic_model')
  AND pmc.is_enabled = true
ON CONFLICT (project_id, module_id) DO NOTHING;

-- テンプレートへの配布: logic_model を有効にしているテンプレートに追加
UPDATE plan_templates
SET module_config = module_config
      || jsonb_build_object('measure_design', jsonb_build_object('enabled', true))
WHERE module_config ? 'logic_model'
  AND COALESCE(module_config->'logic_model'->>'enabled', 'false') = 'true'
  AND NOT (module_config ? 'measure_design');

-- ================================================================
-- Step 4: 確認用ログ
-- ================================================================
DO $$
DECLARE
  n_projects INT;
  n_templates INT;
  v_sort INT;
BEGIN
  SELECT COUNT(*) INTO n_projects
  FROM project_module_configs WHERE module_id = 'measure_design';
  SELECT COUNT(*) INTO n_templates
  FROM plan_templates WHERE module_config ? 'measure_design';
  SELECT sort_order INTO v_sort FROM plan_modules WHERE id = 'measure_design';
  RAISE NOTICE '施策構築（EBPM）: sort_order=% / 配布プロジェクト% 件 / 配布テンプレート% 件',
    v_sort, n_projects, n_templates;
END $$;
