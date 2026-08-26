-- ================================================================
-- 052_schedule_feed.sql
-- S1: D① スケジュール強化 ＋ D②段1 ICSカレンダーフィード
--
-- 設計: claude/coe-x7-pdca-design.md（承認済み v2.2）第2部 D①・D②
--   D①: 新テーブルは作らず既存スケジュールモジュールを強化する
--        → schedule_tasks に列を2つ追加するのみ（追加・互換維持）
--          - measure_design_id … タスクがどの施策の工程か（施策別×四半期の進捗ボードの軸。
--            確定済み施策のG区画から一括生成するとき（S1）にAIが紐付ける）
--          - owner_department  … 担当（G区画 owner_department から供給）
--   D②段1: ICSフィード（Libera側改修ゼロで確実に動く土台）
--        GET /api/public/schedule-feed/[token].ics —
--        タスク＋PDCAチェックポイントを iCalendar 形式で配信。
--        token はプロジェクト単位で複数発行・失効可能（担当者ごとに配れる）。
--        Google/Outlook/Libera いずれのカレンダーでも購読可能
--
-- 方針: MIGRATION_POLICY.md 準拠。列追加＋新テーブルのみ。冪等。
-- ================================================================

-- ── schedule_tasks の強化（D①）────────────────────────────
ALTER TABLE schedule_tasks
  ADD COLUMN IF NOT EXISTS measure_design_id UUID REFERENCES measure_designs(id) ON DELETE SET NULL;
ALTER TABLE schedule_tasks
  ADD COLUMN IF NOT EXISTS owner_department TEXT;

CREATE INDEX IF NOT EXISTS idx_schedule_tasks_measure
  ON schedule_tasks (measure_design_id) WHERE measure_design_id IS NOT NULL;

COMMENT ON COLUMN schedule_tasks.measure_design_id IS
  'このタスクがどの施策（measure_designs）の工程か。S1の一括生成でAIが紐付け、進捗ボードの施策別表示に使う。手動タスクはNULLのままでよい';
COMMENT ON COLUMN schedule_tasks.owner_department IS
  '担当課（施策G区画 owner_department 由来。手入力も可）';

-- ── ICSフィードのトークン（D②段1）─────────────────────────
CREATE TABLE IF NOT EXISTS schedule_feed_tokens (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- 誰用のフィードか（例: 健康推進課 / 佐藤さん）。表示・棚卸し用
  label       TEXT        NOT NULL DEFAULT '',
  -- URLに入る推測不能な値（発行時にサーバーで生成）
  token       TEXT        NOT NULL UNIQUE,
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 失効（NULL=有効）。失効後のアクセスは404 — 配布先ごとに止められる
  revoked_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_schedule_feed_tokens_project
  ON schedule_feed_tokens (project_id, created_at DESC);

COMMENT ON TABLE schedule_feed_tokens IS
  'ICSカレンダーフィード（D②段1）の購読トークン。プロジェクト×配布先単位で発行・失効。フィードはタスク＋PDCAチェックポイントを配信';

-- ── 確認用ログ ───────────────────────────────────────
DO $$
BEGIN
  RAISE NOTICE 'S1: schedule_tasks に measure_design_id / owner_department を追加し、schedule_feed_tokens を用意しました';
END $$;
