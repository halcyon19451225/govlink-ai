-- ================================================================
-- 054_libera_bridge.sql
-- S3: Coe→Libera ブリッジ（D②段2 ＋ C① Liberaタスク通知）
--
-- 設計: claude/coe-x7-pdca-design.md（承認済み v2.2）第2部 D②段2・C①
-- 確定した前提（Liberaリポジトリ確認・2026-08-26）:
--   Libera は Coe と**同じ Cognito User Pool** を OIDC 参照している
--   → 設計時に想定した MemberCode↔userId 対応表は不要。
--     メールアドレスから Cognito の sub を解決すれば、それがそのまま
--     Libera のユーザーID（CalendarEvent.participantIds / Task.owner）になる。
--
-- 【構成】
--   libera_bridge_targets … 送信先（プロジェクト×人）。メール→sub は登録時に解決して保持
--   libera_bridge_logs    … 送信の記録（何を・誰に・成否 — 連携ログ）
--   ※ report_requests.libera_survey_id（053）は本格的なアンケート同期用の予約のまま
--
-- 方針: MIGRATION_POLICY.md 準拠。新規テーブルのみ。冪等。
-- ================================================================

CREATE TABLE IF NOT EXISTS libera_bridge_targets (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  email        TEXT        NOT NULL,
  -- Cognito の sub（登録時に AdminGetUser で解決。Libera 側の宛先IDそのもの）
  libera_sub   TEXT        NOT NULL,
  display_name TEXT,
  created_by   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, email)
);

CREATE INDEX IF NOT EXISTS idx_libera_bridge_targets_project
  ON libera_bridge_targets (project_id, created_at);

COMMENT ON TABLE libera_bridge_targets IS
  'Libera連携の送信先（S3）。スケジュールのカレンダー/タスク送信・実績報告のタスク通知の宛先';

CREATE TABLE IF NOT EXISTS libera_bridge_logs (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- push_events / push_tasks / notify_report など
  operation   TEXT        NOT NULL,
  ok          BOOLEAN     NOT NULL,
  -- 件数・宛先数・エラー概要など（人が読む1行）
  detail      TEXT,
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_libera_bridge_logs_project
  ON libera_bridge_logs (project_id, created_at DESC);

COMMENT ON TABLE libera_bridge_logs IS
  'Libera連携の送信記録（S3）。失敗時の再送判断・監査用';

-- ── 確認用ログ ───────────────────────────────────────
DO $$
BEGIN
  RAISE NOTICE 'S3: libera_bridge_targets / libera_bridge_logs を用意しました（env: LIBERA_BRIDGE_URL / LIBERA_BRIDGE_KEY）';
END $$;
