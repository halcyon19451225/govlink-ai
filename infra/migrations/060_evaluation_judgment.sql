-- 060_evaluation_judgment.sql
-- CA2-3改: 図E1判定の保存先と、共通ヘッダF7-0 ③⑥⑦の材料 — G/H系列（収束工程の様式）の土台
--
-- 設計: claude/coe-eval-judgment-e1.md §3 / claude/coe-eval-reflect-forms.md（転記ゼロ原則）
--   置き場の原則（2026-09-02 決定）:
--     ・設計時に定まる値（自然体推計・寄与経路・事前推計・適用除外・前提条件）→ 施策側
--       （measure_indicators / measure_designs）。施策構築(EBPM)の器に「計画時の前提」として持つ
--     ・評価時に決まる値（判定q1〜q4b・報告書No.・ルート・処遇・実際に行った比較の段・
--       期末の財政効果の実績）→ 評価側（program_evaluations）。承認時に凍結される
--     A改善は施策構築のデータを書き換えない、の不可侵事項と整合させるための分離。
--
-- 冪等: ADD COLUMN IF NOT EXISTS のみ。既存行は触らない（既定値は NULL / '[]' / false）。
--
-- ※ このファイルに BEGIN/COMMIT は書かない。ランナー（scripts/run-migration.mjs）が
--    全体をトランザクションで囲むため（058 と同じ）。

-- ─── 1. 指標: ベースライン（自然体推計）────────────────────────
-- 共通ヘッダ③「ベースライン（自然体推計値）／X（実績−ベースライン）」の材料。
-- X は目標値との差ではない（目標差＝達成評価、ベースライン差＝効果推計）。
-- 所管部署が計画時に一元管理する値なので施策側に置く。

ALTER TABLE measure_indicators
  ADD COLUMN IF NOT EXISTS natural_baseline NUMERIC;
ALTER TABLE measure_indicators
  ADD COLUMN IF NOT EXISTS baseline_source  TEXT;

COMMENT ON COLUMN measure_indicators.natural_baseline IS
  '自然体推計値（施策がなかった場合の推移・趨勢延長）。X＝期末実績−この値。目標値との差ではない';
COMMENT ON COLUMN measure_indicators.baseline_source IS
  '自然体推計の根拠（推計方法・出典・合成対照法等の検証の有無）';

-- ─── 2. 施策: 寄与経路・財政効果の事前推計・適用除外・前提条件 ──────
-- contribution_pathways … [{ key, label, formula, note }]
--   分野ごとに定義する寄与経路（例: 発生率の抑制×対象者数×単価）。経路別推計式を明記する
-- fiscal_effect_estimates … [{ pathway_key, annual, cumulative, basis }]（円）
--   計画時の事前推計。期末の実績は評価側（program_evaluations.fiscal_effect）に別に持つ
-- judgment_exemption … { kind: 'statutory'|'safety_net'|'small_n', reason, decided_on }
--   適用除外リスト（法定必須事業・セーフティネット機能・分母下限未満のスモールN）。
--   除外は廃止対象にしない、または比較の段Dの方法（単一事例・GAS）で評価する
-- preconditions … [{ id, condition, check_method, fallback, status, checked_fiscal_year, note }]
--   様式H2 前提条件表（崩れると施策全体が止まる急所 3〜5項目）。年次評価で status を更新

ALTER TABLE measure_designs
  ADD COLUMN IF NOT EXISTS contribution_pathways   JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE measure_designs
  ADD COLUMN IF NOT EXISTS fiscal_effect_estimates JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE measure_designs
  ADD COLUMN IF NOT EXISTS judgment_exemption      JSONB;
ALTER TABLE measure_designs
  ADD COLUMN IF NOT EXISTS preconditions           JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN measure_designs.contribution_pathways IS
  '寄与経路（どの変数を通じて財政効果が生じるか）の定義 [{key,label,formula,note}]';
COMMENT ON COLUMN measure_designs.fiscal_effect_estimates IS
  '財政効果の事前推計（計画時）[{pathway_key,annual,cumulative,basis}]。期末実績は program_evaluations.fiscal_effect';
COMMENT ON COLUMN measure_designs.judgment_exemption IS
  '適用除外 {kind: statutory|safety_net|small_n, reason, decided_on}。評価前に決裁で固定する';
COMMENT ON COLUMN measure_designs.preconditions IS
  '様式H2 前提条件表 [{id,condition,check_method,fallback,status,checked_fiscal_year,note}]';

-- ─── 3. 評価: 図E1の判定と処遇（共通ヘッダ②③⑥⑦の転記元）────────────
-- judgment … { q1, q2, q3, q4a, q4b, rationale: {q2,q3,q4a}, evidence: { trend: {...}, fiscal: {...} } }
--   4問の回答とその根拠。report_no / route / judgment_path は judgment から
--   サーバー側で機械的に導いた値（画面の値を信用しない）。判定保留は report_no IS NULL
-- standard_treatment … 報告書No.から定まる初期値（写し。REPORT_PATTERNS が正）
-- decided_treatment  … 処遇決定会議→答申を経た確定値（様式G1-6）。保存時は事務局案
-- rationale_required … 標準処遇≠決定処遇（様式G1-7 ○）。true なら rationale 未入力で承認不可
-- rationale          … 様式H4-2 理由（①数字の再解釈 ②現場・関係機関の意見 ③制度整合 → よって）
-- comparison_grade   … 実際に行った比較の段 A〜D（初期値は実験設計から提示）
-- fiscal_effect      … { pathways: [{pathway_key,label,annual,cumulative,basis}], effect_total,
--                        cost_total, rate, mark: 'J'|'K'|null, note }（期末の実績・円）

ALTER TABLE program_evaluations
  ADD COLUMN IF NOT EXISTS judgment            JSONB;
ALTER TABLE program_evaluations
  ADD COLUMN IF NOT EXISTS judgment_path       TEXT;
ALTER TABLE program_evaluations
  ADD COLUMN IF NOT EXISTS report_no           SMALLINT;
ALTER TABLE program_evaluations
  ADD COLUMN IF NOT EXISTS route               TEXT;
ALTER TABLE program_evaluations
  ADD COLUMN IF NOT EXISTS standard_treatment  TEXT;
ALTER TABLE program_evaluations
  ADD COLUMN IF NOT EXISTS decided_treatment   TEXT;
ALTER TABLE program_evaluations
  ADD COLUMN IF NOT EXISTS rationale_required  BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE program_evaluations
  ADD COLUMN IF NOT EXISTS rationale           TEXT;
ALTER TABLE program_evaluations
  ADD COLUMN IF NOT EXISTS comparison_grade    TEXT;
ALTER TABLE program_evaluations
  ADD COLUMN IF NOT EXISTS fiscal_effect       JSONB;

-- 語彙の固定（既存行は NULL なので制約は通る）
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'program_evaluations_report_no_chk') THEN
    ALTER TABLE program_evaluations
      ADD CONSTRAINT program_evaluations_report_no_chk
      CHECK (report_no IS NULL OR report_no BETWEEN 1 AND 9);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'program_evaluations_route_chk') THEN
    ALTER TABLE program_evaluations
      ADD CONSTRAINT program_evaluations_route_chk
      CHECK (route IS NULL OR route IN ('A', 'B', 'C', 'D'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'program_evaluations_comparison_grade_chk') THEN
    ALTER TABLE program_evaluations
      ADD CONSTRAINT program_evaluations_comparison_grade_chk
      CHECK (comparison_grade IS NULL OR comparison_grade IN ('A', 'B', 'C', 'D'));
  END IF;
END $$;

COMMENT ON COLUMN program_evaluations.judgment IS
  '図E1の4問の回答と根拠 {q1,q2,q3,q4a,q4b,rationale,evidence}。report_no/route はここから機械的に導く';
COMMENT ON COLUMN program_evaluations.report_no IS
  '着地した報告書No.（1〜9）。NULL＝判定保留（どのルートにも進まず処遇を行わない）';
COMMENT ON COLUMN program_evaluations.decided_treatment IS
  '決定処遇（様式G1-6）。標準処遇と異なる場合は rationale_required=true・rationale 必須（comply or explain）';

-- G1台帳の取り出し（施策×判定）を軽くする
CREATE INDEX IF NOT EXISTS idx_program_evaluations_report_no
  ON program_evaluations (project_id, report_no) WHERE report_no IS NOT NULL;

DO $$ BEGIN
  RAISE NOTICE 'CA2-3改: 図E1判定（judgment/report_no/route/処遇/比較の段/財政効果）と自然体推計・寄与経路・適用除外・前提条件の列を用意しました';
END $$;
