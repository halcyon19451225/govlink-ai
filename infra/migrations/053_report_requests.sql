-- ================================================================
-- 053_report_requests.sql
-- S2: C① 実績報告の依頼と回答管理（Coe内フォーム経路＝主経路）
--
-- 設計: claude/coe-x7-pdca-design.md（承認済み v2.2）第2部 C①
--   - 回答者に委託事業者・外部関係者を含む（確認結果5）ため、
--     Liberaアカウントを前提にしない**トークンURLのCoe内フォーム**を主経路とする
--   - 依頼: kind（annual=年次 / period_end=計画期間毎）→ 対象施策を選ぶと
--     設問をAIが自動組成（E区画SPO指標・KPIから。taskType generation.report_request）
--   - 回答: /report/<token> の公開フォーム（認証不要・1トークン1対象・失効管理）
--   - 管理: 未回答/回答済/差し戻し/受領のボード → 受領した回答のKPI実績値を
--     既存 kpi_reports へワンクリック取り込み（二重入力排除・imported_at 記録）
--   - libera_survey_id は S3（Libera連携）用の予約列
--
-- 方針: MIGRATION_POLICY.md 準拠。新規テーブル＋種付けのみ。冪等。
-- ================================================================

CREATE TABLE IF NOT EXISTS report_requests (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind             TEXT        NOT NULL CHECK (kind IN ('annual', 'period_end')),
  fiscal_year      INT,
  due_date         DATE,
  title            TEXT        NOT NULL,
  -- 依頼文（AI下書き→編集可）
  instruction      TEXT,
  -- 設問定義: [{id, label, type: number|text|textarea, unit?, kpi_id?, measure_design_id?, required?}]
  -- measure_design_id つきの設問はその施策の回答フォームにだけ出る（共通設問は無印）
  form_def         JSONB       NOT NULL DEFAULT '[]'::jsonb,
  -- 割当先: [{target_key(=施策UUID), measure_design_id, measure_title, owner_department, owner_name, email?}]
  targets          JSONB       NOT NULL DEFAULT '[]'::jsonb,
  status           TEXT        NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'sent', 'closed')),
  -- S3（Liberaアンケート連携・補助経路）用の予約列
  libera_survey_id TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at          TIMESTAMPTZ,
  closed_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_report_requests_project
  ON report_requests (project_id, created_at DESC);

COMMENT ON TABLE report_requests IS
  '実績報告の依頼（C①）。sent で対象ごとの回答行（report_responses）とトークンURLが発行される。closed で回答受付を終了';

CREATE TABLE IF NOT EXISTS report_responses (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id    UUID        NOT NULL REFERENCES report_requests(id) ON DELETE CASCADE,
  -- targets の要素に対応（施策UUID）
  target_key    TEXT        NOT NULL,
  -- 回答用トークン（URLに入る推測不能な値。1トークン1対象）
  token         TEXT        NOT NULL UNIQUE,
  status        TEXT        NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'answered', 'returned', 'accepted')),
  -- {question_id: 回答値}
  answers       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  answered_at   TIMESTAMPTZ,
  -- 差し戻し理由（returned のとき必須 — 回答フォームに表示される）
  reviewed_note TEXT,
  reviewed_by   TEXT,
  -- KPI実績を kpi_reports へ取り込んだ日時（二重取り込み防止の表示に使う）
  imported_at   TIMESTAMPTZ,
  -- 最後に再依頼（督促）した日時
  reminded_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (request_id, target_key)
);

CREATE INDEX IF NOT EXISTS idx_report_responses_request
  ON report_responses (request_id);

COMMENT ON TABLE report_responses IS
  '実績報告の回答（C①）。pending=未回答 / answered=回答済 / returned=差し戻し（再回答可）/ accepted=受領（フォーム固定・KPI取り込み可）';

-- ── AIタスク種別の種付け ────────────────────────────────
INSERT INTO ai_task_routing (task_type, note) VALUES
  ('generation.report_request', '実績報告依頼の設問自動組成（S2 C①）')
ON CONFLICT (task_type) DO NOTHING;

-- ── 確認用ログ ───────────────────────────────────────
DO $$
BEGIN
  RAISE NOTICE 'S2: report_requests / report_responses / generation.report_request を用意しました';
END $$;
