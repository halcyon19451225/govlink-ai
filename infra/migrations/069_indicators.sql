-- ================================================================
-- Migration 069: 指標の一元化 — kpis を indicators に吸収し、目標と値の履歴を分ける
-- ================================================================
--
-- 設計: claude/coe-dataset-model.md §9-1・§9-4（D3）
--
-- なぜ必要か
-- ----------
--   Coe には「指標」が3か所にあった。
--     kpis                      … 計画の KPI（目標・現在値）
--     measure_indicators        … 施策の指標17カテゴリ（ラベル・目標・データソース・頻度）
--     measure_indicator_results … 指標×評価時点×実績値
--   同じ現状値を KPI にも施策指標にも手で入れる二重入力が起き、
--   「この実績はどのデータから出たのか」を追えなかった。指標管理に一元化する。
--
--     indicators        … 指標そのもの（どう測るか）。**kpis を改名して吸収する**
--     indicator_targets … 目標（計画／主要施策／取組のスコープ付き）
--     indicator_values  … 値の履歴（いつ時点の値か・誰が・どの経路で・どの版から）
--     measure_indicators … 「どの施策・取組で・どのカテゴリか」だけを持つ割当表に痩せる
--
-- なぜ改名なのか（新表を作って移さない理由）
-- ------------------------------------------
--   kpis(id) を参照する外部キーが 12 本ある（logic_models の output/outcome・evidences・
--   gap_analyses・asis_analyses・issue_hypotheses・measure_indicators・improvement_actions・
--   kpis 自身の contributes_to / cloned_from・plan_template 系・benchmark_values）。
--   PostgreSQL の外部キーは表の OID を指すので、**改名すれば FK も UUID も何もせずに生き残る**。
--   新表に移して張り替えるより安全で、実データの id が変わらない。
--
-- 互換ビュー
-- ----------
--   読み取り側は 49 ファイル・96 か所が `current` を使っている。一度に切り替えると危ないので、
--   `kpis` という名前の**読み取り専用ビュー**を置いて、旧来の SELECT はそのまま動かす。
--   書き込み側（11 か所）はこのマイグレーションと同じコミットで指標サービス層へ切り替える。
--   ビューは書き込めないので、切替漏れがあれば実行時に必ず失敗する（黙って古い経路に落ちない）。

-- ────────────────────────────────────────────────────────────────
-- 1. kpis → indicators（改名と列の追加）
-- ────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.indicators') IS NULL THEN
    ALTER TABLE kpis RENAME TO indicators;
  END IF;
END $$;

ALTER TABLE indicators ADD COLUMN IF NOT EXISTS description TEXT;
-- 算出方法。既存の KPI は手入力（manual）から始まり、設定すれば計算型に変わる
ALTER TABLE indicators ADD COLUMN IF NOT EXISTS calc_type TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE indicators ADD COLUMN IF NOT EXISTS spec JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE indicators ADD COLUMN IF NOT EXISTS time_granularity TEXT NOT NULL DEFAULT 'fiscal_year';
ALTER TABLE indicators ADD COLUMN IF NOT EXISTS data_source TEXT;
ALTER TABLE indicators ADD COLUMN IF NOT EXISTS frequency TEXT;
ALTER TABLE indicators ADD COLUMN IF NOT EXISTS base_day TEXT;
-- どこで生まれた指標か（画面の絞り込みと、次期計画への複製の判断に使う）
ALTER TABLE indicators ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'plan';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'indicators_calc_type_chk') THEN
    ALTER TABLE indicators ADD CONSTRAINT indicators_calc_type_chk
      CHECK (calc_type IN ('manual','aggregate','longitudinal','cross','formula'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'indicators_origin_chk') THEN
    ALTER TABLE indicators ADD CONSTRAINT indicators_origin_chk
      CHECK (origin IN ('plan','measure','dialogue','template'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'indicators_time_granularity_chk') THEN
    ALTER TABLE indicators ADD CONSTRAINT indicators_time_granularity_chk
      CHECK (time_granularity IN ('day','month','fiscal_year'));
  END IF;
END $$;

COMMENT ON TABLE indicators IS
  '指標。旧 kpis を改名して吸収した（id と外部キーはそのまま）。目標は indicator_targets、値の履歴は indicator_values';
COMMENT ON COLUMN indicators.calc_type IS
  'manual=手入力 / aggregate=集計型 / longitudinal=経年比較型 / cross=クロス集計型 / formula=計算式型';
COMMENT ON COLUMN indicators.spec IS 'calc_type ごとの設定（箱・列・絞り込み・集計方法・式）。lib/indicator が検証する';

-- ────────────────────────────────────────────────────────────────
-- 2. 目標（スコープ付き）
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS indicator_targets (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  indicator_id      UUID NOT NULL REFERENCES indicators(id) ON DELETE CASCADE,
  -- plan=計画の目標（旧 kpis.target）/ measure=主要施策の目標 / work=取組の目標
  scope             TEXT NOT NULL CHECK (scope IN ('plan','measure','work')),
  measure_design_id UUID REFERENCES measure_designs(id) ON DELETE CASCADE,
  measure_work_id   UUID REFERENCES measure_works(id) ON DELETE CASCADE,
  baseline_value    NUMERIC,
  baseline_as_of    DATE,
  target_value      NUMERIC,
  achievement_condition TEXT NOT NULL DEFAULT 'gte',
  target_deadline   DATE,
  note              TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- スコープごとに1つ。plan は施策を持たない
  CONSTRAINT indicator_targets_scope_chk CHECK (
    (scope = 'plan'    AND measure_design_id IS NULL AND measure_work_id IS NULL) OR
    (scope = 'measure' AND measure_design_id IS NOT NULL AND measure_work_id IS NULL) OR
    (scope = 'work'    AND measure_work_id IS NOT NULL)
  ),
  CONSTRAINT indicator_targets_uq UNIQUE NULLS NOT DISTINCT
    (indicator_id, scope, measure_design_id, measure_work_id)
);
CREATE INDEX IF NOT EXISTS idx_indicator_targets_indicator ON indicator_targets(indicator_id);

-- ────────────────────────────────────────────────────────────────
-- 3. 値の履歴（旧 measure_indicator_results も吸収）
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS indicator_values (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  indicator_id   UUID NOT NULL REFERENCES indicators(id) ON DELETE CASCADE,
  -- 「いつ時点の値か」。計算した日時（computed_at）とは別
  as_of          DATE NOT NULL,
  scope          TEXT NOT NULL DEFAULT 'plan' CHECK (scope IN ('plan','measure','work')),
  measure_design_id UUID REFERENCES measure_designs(id) ON DELETE SET NULL,
  measure_work_id   UUID REFERENCES measure_works(id) ON DELETE SET NULL,
  -- 群別の値（実験の介入群・対照群ごと）
  cohort_id      UUID REFERENCES cohorts(id) ON DELETE SET NULL,
  arm            TEXT,
  value          NUMERIC,
  value_text     TEXT,
  numerator      NUMERIC,
  denominator    NUMERIC,
  n              INTEGER,
  -- 使った版: [{dataset_id, dataset_version_id, as_of}] ＋ 参照した指標値 id。手入力なら {}
  inputs         JSONB NOT NULL DEFAULT '{}'::jsonb,
  note           TEXT,
  computed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 誰が・どの経路で（人が画面から操作しても AI が操作しても同じ形で残す）
  actor          UUID,
  via            TEXT NOT NULL DEFAULT 'ui'
    CHECK (via IN ('ui','bulk','gap_analysis','dialogue','evaluation','auto_tasks','migration')),
  dialogue_ref   JSONB,
  -- 旧 measure_indicator_results からの移行の痕跡（二重取り込み防止）
  legacy_result_id UUID UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_indicator_values_latest
  ON indicator_values(indicator_id, scope, as_of DESC, computed_at DESC);
COMMENT ON TABLE indicator_values IS
  '指標の値の履歴。同じ as_of で再計算しても上書きせず積む（新しい版が上がって値が変わったことを追えるように）';

-- ────────────────────────────────────────────────────────────────
-- 4. 既存データの移行
-- ────────────────────────────────────────────────────────────────
-- 4-1/4-2. 旧 kpis の目標と現在値を、目標表と履歴へ写す。
--   **旧列は §4-5 で落とす**ので、再実行に備えて「列がある間だけ」実行する。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'indicators' AND column_name = 'target') THEN
    -- 計画の目標（旧 kpis.target / baseline / achievement_condition / target_deadline）
    EXECUTE $sql$
      INSERT INTO indicator_targets (indicator_id, scope, baseline_value, baseline_as_of, target_value, achievement_condition, target_deadline)
      SELECT i.id, 'plan', i.baseline_value,
             CASE WHEN i.baseline_year IS NOT NULL THEN make_date(i.baseline_year, 4, 1) END,
             i.target, COALESCE(i.achievement_condition, 'gte'), i.target_deadline
      FROM indicators i
      -- ⚠ 計画の KPI だけ。4-3 ② で施策の指標から起こした行（origin='measure'）に
      --    計画の目標を作ってはいけない
      WHERE i.origin = 'plan'
        AND NOT EXISTS (SELECT 1 FROM indicator_targets t WHERE t.indicator_id = i.id AND t.scope = 'plan')
    $sql$;
    -- 現在値（旧 kpis.current）を履歴の1行として写す。0 は「未入力」と区別できないので写さない
    EXECUTE $sql$
      INSERT INTO indicator_values (indicator_id, as_of, scope, value, inputs, computed_at, via, note)
      SELECT i.id, i.updated_at::date, 'plan', i.current, '{}'::jsonb, i.updated_at, 'migration',
             '069 で kpis.current から移行（基準日は最終更新日）'
      FROM indicators i
      WHERE i.origin = 'plan' AND i.current IS NOT NULL AND i.current <> 0
        AND NOT EXISTS (SELECT 1 FROM indicator_values v WHERE v.indicator_id = i.id AND v.via = 'migration')
    $sql$;
  END IF;
END $$;

-- 4-2b. 旧列を落とす（**4-3 より前に**）
--   目標と値の正本は indicator_targets / indicator_values になった。旧列を残すと
--   「どちらが正しいのか」が生まれ、二重入力の問題が形を変えて戻る。**落とす。**
--   （previous_value / previous_target は「前期計画の値」という別の概念なので残す）
--
--   ⚠ **落とす位置が 4-3 より後ろだと、このマイグレーションは実データで失敗する。**
--      indicators.target は NOT NULL・既定値なし（旧 kpis.target）。列が残ったまま
--      4-3 ② が指標を起こすと
--        null value in column "target" of relation "indicators" violates not-null constraint
--      で全体がロールバックする。kpi_id を持たない measure_indicators が1行でもあれば起きる。
--      （2026-09-14 に実データで発生。スクラッチ DB には該当行が無く、すり抜けていた）
ALTER TABLE indicators DROP COLUMN IF EXISTS target;
ALTER TABLE indicators DROP COLUMN IF EXISTS current;
ALTER TABLE indicators DROP COLUMN IF EXISTS achievement_condition;
ALTER TABLE indicators DROP COLUMN IF EXISTS target_deadline;
ALTER TABLE indicators DROP COLUMN IF EXISTS baseline_value;
ALTER TABLE indicators DROP COLUMN IF EXISTS baseline_year;

-- 4-3. measure_indicators を割当表にする
ALTER TABLE measure_indicators ADD COLUMN IF NOT EXISTS indicator_id UUID REFERENCES indicators(id) ON DELETE CASCADE;

--   ① 既に kpi_id を持つ行はそれを使う
UPDATE measure_indicators SET indicator_id = kpi_id
 WHERE indicator_id IS NULL AND kpi_id IS NOT NULL;

--   ② 持たない行は、そのラベル・単位から指標を1つ起こして紐づける（origin='measure'）
--   ⚠ ラベルで突き合わせない。同じ計画に同じラベルの行が2つあると、どちらにどの指標が
--      付くかが決まらず、指標が孤立する。measure_indicators.id を鍵にして1対1で結ぶ。
CREATE TEMP TABLE _mi_new_indicators ON COMMIT DROP AS
  SELECT mi.id AS mi_id, gen_random_uuid() AS indicator_id, mi.project_id, mi.label,
         COALESCE(mi.unit, '') AS unit, mi.definition, mi.data_source, mi.frequency, mi.base_day
    FROM measure_indicators mi
   WHERE mi.indicator_id IS NULL;

INSERT INTO indicators (id, project_id, label, unit, description, data_source, frequency, base_day,
                        origin, indicator_type)
SELECT n.indicator_id, n.project_id, n.label, n.unit, n.definition, n.data_source, n.frequency, n.base_day,
       'measure', 'process'
  FROM _mi_new_indicators n;

UPDATE measure_indicators mi
   SET indicator_id = n.indicator_id
  FROM _mi_new_indicators n
 WHERE mi.id = n.mi_id;

--   ③ 施策・取組の目標を indicator_targets へ
INSERT INTO indicator_targets (indicator_id, scope, measure_design_id, measure_work_id,
                               baseline_value, baseline_as_of, target_value, achievement_condition)
SELECT mi.indicator_id,
       CASE WHEN mi.measure_work_id IS NULL THEN 'measure' ELSE 'work' END,
       CASE WHEN mi.measure_work_id IS NULL THEN mi.measure_design_id END,
       mi.measure_work_id,
       mi.baseline_value, mi.baseline_date, mi.target_value, COALESCE(mi.achievement_condition, 'gte')
FROM measure_indicators mi
WHERE mi.indicator_id IS NOT NULL
ON CONFLICT (indicator_id, scope, measure_design_id, measure_work_id) DO NOTHING;

-- 4-4. 旧 measure_indicator_results を indicator_values へ
INSERT INTO indicator_values (indicator_id, as_of, scope, measure_design_id, measure_work_id,
                              value, value_text, inputs, note, computed_at, via, legacy_result_id)
SELECT mi.indicator_id,
       COALESCE(r.measured_on, make_date(COALESCE(r.fiscal_year, EXTRACT(YEAR FROM r.created_at)::int), 4, 1)),
       CASE WHEN mi.measure_work_id IS NULL THEN 'measure' ELSE 'work' END,
       CASE WHEN mi.measure_work_id IS NULL THEN mi.measure_design_id END,
       mi.measure_work_id,
       r.value, r.value_text, '{}'::jsonb, r.note, r.created_at,
       CASE WHEN r.auto_computed THEN 'auto_tasks' ELSE 'evaluation' END,
       r.id
FROM measure_indicator_results r
JOIN measure_indicators mi ON mi.id = r.measure_indicator_id
WHERE mi.indicator_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM indicator_values v WHERE v.legacy_result_id = r.id);

-- 4-5. 旧列の削除は 4-2b（4-3 より前）へ移した。理由はそちらに書いてある。

-- ────────────────────────────────────────────────────────────────
-- 5. 互換ビュー kpis（読み取り専用）
-- ────────────────────────────────────────────────────────────────
--   旧 SELECT をそのまま動かすため。`current` は履歴の最新値から作る。
--   **書き込みはできない**ので、切替漏れがあれば実行時に必ず失敗する。
CREATE OR REPLACE VIEW kpis AS
SELECT
  i.id,
  i.project_id,
  i.label,
  COALESCE(t.target_value, 0)::numeric   AS target,
  COALESCE(lv.value, 0)::numeric         AS current,
  i.unit,
  i.created_at,
  i.updated_at,
  i.goal_id,
  i.previous_value,
  i.previous_target,
  i.indicator_type,
  COALESCE(t.achievement_condition, 'gte') AS achievement_condition,
  t.target_deadline,
  t.baseline_value,
  EXTRACT(YEAR FROM t.baseline_as_of)::int AS baseline_year,
  i.contributes_to_kpi_id,
  i.cloned_from_kpi_id,
  i.target_needs_review
FROM indicators i
LEFT JOIN indicator_targets t ON t.indicator_id = i.id AND t.scope = 'plan'
LEFT JOIN LATERAL (
  SELECT v.value FROM indicator_values v
   WHERE v.indicator_id = i.id AND v.scope = 'plan' AND v.cohort_id IS NULL AND v.arm IS NULL
   ORDER BY v.as_of DESC, v.computed_at DESC LIMIT 1
) lv ON true
-- ⚠ 計画の KPI だけを返す。4-3 ② で施策の指標から起こした行（origin='measure'）まで
--    返すと、ダッシュボードや計画書の KPI 一覧に施策の指標が混ざる
WHERE i.origin = 'plan';

COMMENT ON VIEW kpis IS
  '互換ビュー（読み取り専用）。069 で kpis は indicators に吸収された。新しいコードは indicators / indicator_targets / indicator_values を直接使う。読み取り側の切替が終わったら落とす（D7）';

-- ────────────────────────────────────────────────────────────────
-- 6. 割当表から移った列に印を付ける（まだ落とさない）
-- ────────────────────────────────────────────────────────────────
--   measure_indicators の label / unit / definition / baseline_value / target_value /
--   achievement_condition / data_source / frequency / base_day / baseline_date は
--   indicators と indicator_targets に移った。読み取り側の切替が終わるまでは残し、
--   食い違いに気づけるようコメントで正本を示す。
COMMENT ON COLUMN measure_indicators.indicator_id IS '指標の実体。ラベル・単位・データソース・頻度・基準日はこちらが正本';
COMMENT ON COLUMN measure_indicators.label IS '⚠ 069 以降の正本は indicators.label。読み取り側の切替が終わったら落とす';
COMMENT ON COLUMN measure_indicators.target_value IS '⚠ 069 以降の正本は indicator_targets.target_value';

-- ────────────────────────────────────────────────────────────────
-- 7. 操作履歴の対象に指標を加える
-- ────────────────────────────────────────────────────────────────
COMMENT ON TABLE activity_log IS
  '操作履歴。人が画面から操作しても AI が操作しても同じ形で残る。entity: dataset / dataset_version / attribute / key_type / indicator / indicator_target / indicator_value';
