-- 058_evaluation_results.sql
-- CA2-1: 指標の実績値・ベンチマーク・課題の委任 — C評価を施策データセット（057）に接続する土台
--
-- 設計: claude/coe-ca2-design.md §3
--   - 実績は measure_indicator_results に一元化。測定のたびに1行、履歴で持つ（上書きしない）。
--     auto_computed は自動集計値の印（手で直すと外す — measure_indicators.auto_filled と同じ規約）
--   - ベンチマーク（図7 工程3-2）は出典必須の手入力から始める。1指標に複数の比較先
--   - 課題の委任: 取組毎評価（図6）→ 主要施策毎評価（図7）→ 次期計画、の二段
--   - program_evaluations に取組の単位（measure_work_id）と指標凍結（indicator_snapshot）を追加
--
-- 冪等: ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS のみ。既存行は触らない。
--
-- ※ このファイルに BEGIN/COMMIT は書かない。ランナー（scripts/run-migration.mjs）が
--    全体をトランザクションで囲むため、自前で囲むと二重になり、ファイル側の COMMIT で
--    先に確定してしまってランナーのロールバック保証が効かなくなる。他の 001〜057 も同様。

-- ─── 1. 指標の実績値 ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS measure_indicator_results (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  measure_indicator_id     UUID        NOT NULL REFERENCES measure_indicators(id) ON DELETE CASCADE,
  -- どの評価時点の測定か。随時測定は NULL
  checkpoint_id            UUID        REFERENCES measure_indicator_checkpoints(id) ON DELETE SET NULL,
  -- 開始西暦年（2026 = 令和8年度。057 と同じ規約 — 和暦は画面で組み立てる）
  fiscal_year              INT,
  measured_on              DATE,
  value                    NUMERIC,
  -- Yes/No・定性指標の受け皿（value と併用可）
  value_text               TEXT,
  note                     TEXT,
  source                   TEXT        NOT NULL DEFAULT 'manual'
    CONSTRAINT indicator_results_source_chk
    CHECK (source IN ('manual', 'auto_tasks', 'report_request', 'import')),
  -- 自動集計値の印。手で直すと外す
  auto_computed            BOOLEAN     NOT NULL DEFAULT false,
  -- 実績報告依頼（053）から入った場合の出所
  report_request_answer_id UUID,
  created_by               TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_indicator_results_indicator
  ON measure_indicator_results (measure_indicator_id, fiscal_year);
CREATE INDEX IF NOT EXISTS idx_indicator_results_checkpoint
  ON measure_indicator_results (checkpoint_id) WHERE checkpoint_id IS NOT NULL;

-- ─── 2. ベンチマーク（図7 工程3-2 の比較先） ─────────────────────

CREATE TABLE IF NOT EXISTS measure_indicator_benchmarks (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  measure_indicator_id UUID        NOT NULL REFERENCES measure_indicators(id) ON DELETE CASCADE,
  -- 「全国平均」「県平均」「人口同規模平均」＋自由記述
  comparator           TEXT        NOT NULL,
  value                NUMERIC     NOT NULL,
  fiscal_year          INT,
  -- 出典必須（「介護保険事業状況報告」「地域包括ケア見える化システム」等）
  source_name          TEXT        NOT NULL,
  source_url           TEXT,
  note                 TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_indicator_benchmarks_indicator
  ON measure_indicator_benchmarks (measure_indicator_id);

-- ─── 3. 課題の委任（図6 → 図7 → 次期計画） ──────────────────────

CREATE TABLE IF NOT EXISTS evaluation_delegations (
  id                         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id                 UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  from_evaluation_id         UUID        REFERENCES program_evaluations(id) ON DELETE SET NULL,
  measure_design_id          UUID        REFERENCES measure_designs(id) ON DELETE SET NULL,
  measure_work_id            UUID        REFERENCES measure_works(id) ON DELETE SET NULL,
  -- to_measure: 取組評価から主要施策評価へ / to_next_plan: 主要施策評価から次期計画へ
  level                      TEXT        NOT NULL
    CONSTRAINT eval_delegations_level_chk
    CHECK (level IN ('to_measure', 'to_next_plan')),
  title                      TEXT        NOT NULL,
  detail                     TEXT,
  root_cause                 TEXT,
  status                     TEXT        NOT NULL DEFAULT 'open'
    CONSTRAINT eval_delegations_status_chk
    CHECK (status IN ('open', 'addressed', 'carried_over')),
  addressed_in_evaluation_id UUID        REFERENCES program_evaluations(id) ON DELETE SET NULL,
  -- 次期計画へ渡ったときの結線（plan_handovers）
  plan_handover_id           UUID,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_eval_delegations_project
  ON evaluation_delegations (project_id, status);
CREATE INDEX IF NOT EXISTS idx_eval_delegations_measure
  ON evaluation_delegations (measure_design_id) WHERE measure_design_id IS NOT NULL;

-- ─── 4. 既存テーブルの拡張 ───────────────────────────────────────

-- 評価の単位を取組（図6）まで下ろす
ALTER TABLE program_evaluations
  ADD COLUMN IF NOT EXISTS measure_work_id UUID REFERENCES measure_works(id) ON DELETE SET NULL;

-- 承認時に使った指標の実績・目標・判定・算定式を凍結（kpi_snapshot の指標版）
ALTER TABLE program_evaluations
  ADD COLUMN IF NOT EXISTS indicator_snapshot JSONB DEFAULT '[]';

-- 改善アクションの反映先5系統目: 施策データセット
-- （037_measure_evaluation_link.sql で追加済み。同一定義の再掲 — 適用時は skipping になる。
--   CA2 が前提にする列なので、依存を明示する意味でここにも残す）
ALTER TABLE improvement_actions
  ADD COLUMN IF NOT EXISTS reflect_measure_design_id UUID REFERENCES measure_designs(id) ON DELETE SET NULL;

-- 評価系PDCAチェックポイントが評価の承認で自動完了したときの痕跡
ALTER TABLE project_pdca_checkpoints
  ADD COLUMN IF NOT EXISTS completed_by_evaluation_id UUID REFERENCES program_evaluations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_program_evaluations_work
  ON program_evaluations (measure_work_id) WHERE measure_work_id IS NOT NULL;

