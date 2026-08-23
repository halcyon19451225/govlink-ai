-- ================================================================
-- 039_experiment_results.sql
-- X2: エビデンス循環 — 実験結果の記録と「参照可能なエビデンス」への昇格
--
-- 設計: claude/coe-ownai-plan.md（承認済み方針）X2
--
-- 【背景】施策構築（E1〜E5）で「エビデンスが無ければ実験設計を添えて
--   実施する」が制度化された（036 の確定条件）。しかし実験を実施した後の
--   結果を記録する場所が無く、「エビデンスを作りながら実施する」の
--   後半（作ったエビデンスを次の計画で参照する）が閉じていなかった。
--
-- 【循環】
--   施策の実験設計（D区画）→ 実施 → ここに結果を記録（draft）
--   → 担当者が確定（confirmed）→ 昇格（promote）:
--       設計の種別から得られるエビデンスレベルを自動判定し
--       （計画どおり実施できなかった場合は1段階下げる）、
--       施策の evidence_items に追加・evidence_status を更新する。
--   → 次の施策構築の対話で「参照可能なエビデンス」として提示される。
--   効果が出なかった実験も昇格対象（「効かない」も次の計画には根拠。
--   方向は effect_direction と effect_summary が正直に持つ）。
--
-- 【将来（X3）】昇格済みの実験結果は、同意自治体の匿名化コーパスへの
--   供出候補になる（本マイグレーションではCoe内で完結）。
--
-- 方針: MIGRATION_POLICY.md 準拠。新規テーブルのみ（破壊的変更なし）。冪等。
-- ================================================================

CREATE TABLE IF NOT EXISTS experiment_results (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  measure_design_id     UUID        NOT NULL REFERENCES measure_designs(id) ON DELETE CASCADE,

  -- ── 実施の記録 ─────────────────────────────
  -- 実施した設計（記録時に施策のD区画から写す。後から施策側が変わっても
  -- 「何の設計で得た結果か」が変わらないようにする）
  design                TEXT        NOT NULL
                          CHECK (design IN ('rct', 'cluster_rct', 'stepped_wedge',
                                            'waitlist', 'did', 'matching', 'prepost')),
  -- 計画どおり実施できたか。false の場合は得られるレベルを1段階下げる
  implemented_as_planned BOOLEAN    NOT NULL DEFAULT true,
  -- 計画から外れた点（無作為化が崩れた・脱落が多かった 等）
  deviation_note        TEXT,
  period_start          DATE,
  period_end            DATE,
  sample_size           INTEGER     CHECK (sample_size IS NULL OR sample_size >= 0),

  -- ── 結果 ──────────────────────────────────
  -- 主要評価項目（設計時の primary_outcome に対応）
  primary_outcome       TEXT,
  result_summary        TEXT        NOT NULL,
  effect_direction      TEXT        NOT NULL DEFAULT 'unclear'
                          CHECK (effect_direction IN ('improved', 'no_change',
                                                      'worsened', 'unclear')),
  -- 効果量（自由記述: 「+2.3ポイント（95%CI 0.4〜4.2）」等）
  effect_size           TEXT,

  -- ── 状態・昇格 ─────────────────────────────
  status                TEXT        NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft', 'confirmed')),
  -- 昇格時に自動判定したエビデンスレベル（1〜5）。未昇格は NULL
  evidence_level        SMALLINT    CHECK (evidence_level BETWEEN 1 AND 5),
  promoted_at           TIMESTAMPTZ,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- 昇格は確定済みの結果に限る（draft のまま昇格させない）
  CONSTRAINT experiment_results_promote_requires_confirm
    CHECK (promoted_at IS NULL OR status = 'confirmed')
);

CREATE INDEX IF NOT EXISTS idx_experiment_results_project
  ON experiment_results (project_id);
CREATE INDEX IF NOT EXISTS idx_experiment_results_measure
  ON experiment_results (measure_design_id);

COMMENT ON TABLE experiment_results IS
  '施策の実験設計（measure_designs.experiment）を実施した結果。確定→昇格でエビデンス（evidence_items）になり、次の計画から参照できる（エビデンス循環・X2）';
COMMENT ON COLUMN experiment_results.implemented_as_planned IS
  '計画どおり実施できたか。false は内的妥当性が下がるため、昇格時のエビデンスレベルを設計の既定から1段階下げる';
COMMENT ON COLUMN experiment_results.evidence_level IS
  '昇格時に設計種別＋実施状況から自動判定したレベル（1〜5）。判定ロジックは src/lib/measure/experimentResult.ts が正本';

-- ── 確認用ログ ───────────────────────────────────
DO $$
BEGIN
  RAISE NOTICE 'エビデンス循環: experiment_results を用意しました（記録→確定→昇格→次の計画で参照）';
END $$;
