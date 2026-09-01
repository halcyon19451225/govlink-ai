-- ================================================================
-- 057_measure_works_indicators.sql
-- 施策構築（EBPM）の二層化と、プログラム評価指標一覧（17カテゴリ）への対応
--
-- 背景:
--   評価フロー図6は「取組」ごと、図7は「主要施策」ごとに回る。
--   これまで measure_designs の一層しか無く、図6の単位が持てなかった。
--   また指標は structure/process/outcome の三層しか持たず、
--   別紙「プログラム評価指標一覧」の17カテゴリ（ニーズ・文脈・インプット・
--   カバレッジ・忠実度・公平性・インパクト・波及・単位コスト・費用対効果・
--   持続性）を表現できなかった。
--
--   評価タイミングは「2、3年目の上旬」のような介護保険事業計画固有の言い方を
--   実装に埋め込まず、指標ごとに 頻度＋評価時点（相対年次／絶対日付）で持つ。
--   年次評価を行わない計画は「計画期間ごと」だけを置けば成立する。
--
--   コストは計画期間の各年度ごとに事業費と財源を持つ。
--
-- 方針: 列追加と新テーブルのみ。既存データは壊さない。冪等。
-- ================================================================

-- ── 取組（主要施策を構成する単位。図6の評価単位）───────────────
CREATE TABLE IF NOT EXISTS measure_works (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  measure_design_id UUID        NOT NULL REFERENCES measure_designs(id) ON DELETE CASCADE,
  -- 画面表示用の短い符号（W-1 など）。施策の中で一意
  code              TEXT        NOT NULL,
  title             TEXT        NOT NULL,
  summary           TEXT,
  -- 誰に対する取組か
  target            TEXT,
  -- 実施方法（直営／委託／補助／共催 等。自由記述）
  method            TEXT,
  owner_department  TEXT,
  -- 取り下げ（行は消さない。指標が measure_work_id で参照しているため）
  retired           BOOLEAN     NOT NULL DEFAULT false,
  retired_reason    TEXT,
  sort_order        INTEGER     NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_measure_works_code
  ON measure_works (measure_design_id, code);
CREATE INDEX IF NOT EXISTS idx_measure_works_design
  ON measure_works (measure_design_id, sort_order);

COMMENT ON TABLE measure_works IS
  '取組 — 主要施策（measure_designs）を構成する単位。評価フロー図6の年毎評価はこの単位で回る';

-- ── 取組のアクティビティ（実施項目）─────────────────────────
-- スケジュール設定（schedule_tasks）へ反映する単位。
-- title / due_date / document_required / document_deadline / owner_department は
-- schedule_tasks の同名列にそのまま写せる形にしてある。
CREATE TABLE IF NOT EXISTS measure_activities (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  measure_work_id   UUID        NOT NULL REFERENCES measure_works(id) ON DELETE CASCADE,
  title             TEXT        NOT NULL,
  note              TEXT,
  start_date        DATE,
  -- 実施期限。未設定のものはスケジュールへ反映しない
  due_date          DATE,
  -- 繰り返し: none / monthly / quarterly / semiannual / annual
  recurrence        TEXT        NOT NULL DEFAULT 'none',
  -- 繰り返し回数（none のときは NULL）。計画期間の年度数を既定にする
  occurrences       INTEGER,
  owner_department  TEXT,
  -- 成果物の要否と提出期限
  document_required BOOLEAN     NOT NULL DEFAULT false,
  document_deadline DATE,
  -- 「開催後30日」のような相対指定（絶対日付が無いとき使う）
  document_offset_days INTEGER,
  sort_order        INTEGER     NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT measure_activities_recurrence_chk
    CHECK (recurrence IN ('none', 'monthly', 'quarterly', 'semiannual', 'annual'))
);

CREATE INDEX IF NOT EXISTS idx_measure_activities_work
  ON measure_activities (measure_work_id, sort_order);

COMMENT ON TABLE measure_activities IS
  'アクティビティ（実施項目）— スケジュール設定へ反映する単位。指標No.5の実績はここの完了実績から数える';

-- ── アクティビティとスケジュールタスクの対応 ─────────────────
-- 繰り返しの実施項目は年度数だけタスクへ展開されるので 1:N。
CREATE TABLE IF NOT EXISTS measure_activity_tasks (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  measure_activity_id UUID        NOT NULL REFERENCES measure_activities(id) ON DELETE CASCADE,
  schedule_task_id    UUID        NOT NULL REFERENCES schedule_tasks(id) ON DELETE CASCADE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (measure_activity_id, schedule_task_id)
);

CREATE INDEX IF NOT EXISTS idx_measure_activity_tasks_task
  ON measure_activity_tasks (schedule_task_id);

-- ── 指標（プログラム評価指標一覧の17カテゴリ）────────────────
-- measure_work_id が NULL なら主要施策レベルの指標（図7が使う）、
-- 値が入っていれば取組レベルの指標（図6が使う）。
CREATE TABLE IF NOT EXISTS measure_indicators (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  measure_design_id UUID        NOT NULL REFERENCES measure_designs(id) ON DELETE CASCADE,
  measure_work_id   UUID        REFERENCES measure_works(id) ON DELETE CASCADE,
  -- 別紙「指標一覧」の No.（1〜17）
  category_no       SMALLINT    NOT NULL,
  label             TEXT        NOT NULL,
  definition        TEXT,
  unit              TEXT,
  baseline_value    NUMERIC,
  baseline_date     DATE,
  target_value      NUMERIC,
  -- 達成条件の向き（kpis と同じ語彙）
  achievement_condition TEXT    NOT NULL DEFAULT 'gte',
  data_source       TEXT,
  -- 測定頻度: monthly / quarterly / semiannual / annual / plan_period / once / adhoc
  frequency         TEXT        NOT NULL DEFAULT 'annual',
  -- 基準日の説明（「各年度3月31日時点」など。計画によって異なるため自由記述）
  base_day          TEXT,
  -- 既存KPIに紐づける場合
  kpi_id            UUID        REFERENCES kpis(id) ON DELETE SET NULL,
  -- required / recommended / optional。既定はカテゴリから引くが個別に上書きできる
  requirement       TEXT        NOT NULL DEFAULT 'optional',
  -- 前工程から Coe が補完した値か（画面で「自動」と示す）
  auto_filled       BOOLEAN     NOT NULL DEFAULT false,
  sort_order        INTEGER     NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT measure_indicators_category_chk
    CHECK (category_no BETWEEN 1 AND 17),
  CONSTRAINT measure_indicators_frequency_chk
    CHECK (frequency IN ('monthly', 'quarterly', 'semiannual', 'annual', 'plan_period', 'once', 'adhoc')),
  CONSTRAINT measure_indicators_requirement_chk
    CHECK (requirement IN ('required', 'recommended', 'optional')),
  CONSTRAINT measure_indicators_condition_chk
    CHECK (achievement_condition IN ('lte', 'lt', 'gte', 'gt', 'eq'))
);

CREATE INDEX IF NOT EXISTS idx_measure_indicators_design
  ON measure_indicators (measure_design_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_measure_indicators_work
  ON measure_indicators (measure_work_id) WHERE measure_work_id IS NOT NULL;

COMMENT ON COLUMN measure_indicators.category_no IS
  '別紙「プログラム評価指標一覧」の No.（1 ニーズ 〜 17 持続可能性）';
COMMENT ON COLUMN measure_indicators.measure_work_id IS
  'NULL なら主要施策レベル（図7が使う）、値が入っていれば取組レベル（図6が使う）';

-- ── 指標ごとの評価時点 ───────────────────────────────────
-- 「2、3年目の上旬」を実装に埋め込まないための表。
-- 相対指定（計画開始からの第N年度・上期／下期／期末）と絶対日付の両方を持てる。
CREATE TABLE IF NOT EXISTS measure_indicator_checkpoints (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  measure_indicator_id UUID        NOT NULL REFERENCES measure_indicators(id) ON DELETE CASCADE,
  label                TEXT        NOT NULL,
  -- 計画開始からの第N年度（1 始まり）。絶対日付だけで運用する場合は NULL
  relative_year        SMALLINT,
  -- first（上期）/ second（下期）/ end（年度末）
  relative_period      TEXT,
  absolute_date        DATE,
  -- どの評価のための時点か: needs / theory / process / outcome / impact / cost
  evaluation_type      TEXT,
  owner_department     TEXT,
  sort_order           INTEGER     NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT measure_checkpoints_period_chk
    CHECK (relative_period IS NULL OR relative_period IN ('first', 'second', 'end')),
  CONSTRAINT measure_checkpoints_eval_chk
    CHECK (evaluation_type IS NULL OR
           evaluation_type IN ('needs', 'theory', 'process', 'outcome', 'impact', 'cost'))
);

CREATE INDEX IF NOT EXISTS idx_measure_checkpoints_indicator
  ON measure_indicator_checkpoints (measure_indicator_id, sort_order);

-- ── 年度別の事業費と財源 ─────────────────────────────────
CREATE TABLE IF NOT EXISTS measure_cost_years (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  measure_design_id UUID        NOT NULL REFERENCES measure_designs(id) ON DELETE CASCADE,
  -- 年度の開始する西暦年（2026 = 令和8年度）。和暦は画面側で組み立てる
  fiscal_year       SMALLINT    NOT NULL,
  total_amount      NUMERIC,
  -- 財源内訳（円）。列を増やさずに済むよう jsonb で持つ:
  --   national（国庫支出金）/ prefectural（県支出金）/ special_account（特別会計）
  --   / general（一般財源）/ other（その他）
  funding           JSONB       NOT NULL DEFAULT '{}'::jsonb,
  note              TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (measure_design_id, fiscal_year)
);

CREATE INDEX IF NOT EXISTS idx_measure_cost_years_design
  ON measure_cost_years (measure_design_id, fiscal_year);

COMMENT ON COLUMN measure_cost_years.fiscal_year IS
  '年度の開始する西暦年（2026 = 令和8年度）。計画期間を超える効果検証年度も置ける';

-- ── 積算内訳（費目 × 年度）───────────────────────────────
CREATE TABLE IF NOT EXISTS measure_cost_items (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  measure_design_id UUID        NOT NULL REFERENCES measure_designs(id) ON DELETE CASCADE,
  -- 費目（委託料・報償費・需用費・役務費 等）
  item              TEXT        NOT NULL,
  -- 積算根拠（単価×回数×人数 等。効率性評価と査定説明の生命線）
  basis             TEXT,
  -- 年度別の金額 {"2026": 300000, "2027": 0}
  amounts           JSONB       NOT NULL DEFAULT '{}'::jsonb,
  sort_order        INTEGER     NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_measure_cost_items_design
  ON measure_cost_items (measure_design_id, sort_order);

-- ── 効率性の算定式（既存の cost_per_outcome_note を補う）──────────
ALTER TABLE measure_designs
  ADD COLUMN IF NOT EXISTS execution_rate_note TEXT;

COMMENT ON COLUMN measure_designs.execution_rate_note IS
  '執行率の算定式（決算額 ÷ 予算額）。強化版 工程6 の年次コスト確認が使う';

DO $$
DECLARE
  n INTEGER;
BEGIN
  SELECT count(*) INTO n FROM information_schema.tables
   WHERE table_schema = 'public'
     AND table_name IN ('measure_works', 'measure_activities', 'measure_activity_tasks',
                        'measure_indicators', 'measure_indicator_checkpoints',
                        'measure_cost_years', 'measure_cost_items');
  RAISE NOTICE '施策構築の拡張テーブル: % / 7 が存在します', n;
END $$;
