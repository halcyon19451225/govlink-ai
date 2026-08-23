-- ================================================================
-- 038_ai_gateway.sql
-- X1: AIゲートウェイ（独自AI構想の第一段）
--
-- 設計: claude/coe-ownai-plan.md（承認済み方針）
--
-- 【背景】Claude API の呼び出しが約20箇所に散在し、
--   - どのタスクでどれだけAIを使っているかが記録されていない
--   - 将来、独自AI（コーパス検索・推定・接地生成）へ段階移行する際の
--     切り替え点が存在しない
--   という状態だった。全呼び出しを src/lib/ai/gateway.ts 経由に集約し、
--   タスク種別ごとのルーティング設定と利用ログをここに持つ。
--
-- 【テーブル】
--   ai_task_routing … タスク種別ごとの動作モードと独自AIウェート。
--     Ordo運営画面（X5）が管理APIを通じて更新する「ダイヤル」。
--     mode:
--       claude  = 従来どおり Claude のみ（既定）
--       shadow  = Claudeを正とし、裏で独自AIも実行して比較ログのみ取る
--       assist  = コーパス検索結果をClaudeのプロンプトに接地する
--       primary = 独自AIが主、Claudeは補助
--     ※ X1時点で実装済みの動作は claude のみ。shadow以降はX4で実装。
--        未実装モードが設定されてもゲートウェイは claude として動作する
--        （安全側フォールバック）。
--   ai_usage_logs … 全AI呼び出しの利用ログ。トークン数・レイテンシ・
--     成否を記録し、Ordo運営画面の品質モニタとウェート判断の材料にする。
--     adopted は「AIの提案が担当者に採択されたか」。X1では列のみ用意し、
--     shadow運用（X4）で書き込みを始める。
--
-- 方針: MIGRATION_POLICY.md 準拠。新規テーブルのみ（破壊的変更なし）。冪等。
-- ================================================================

-- ── ルーティング設定（タスク別ダイヤル）─────────────────
CREATE TABLE IF NOT EXISTS ai_task_routing (
  task_type   TEXT        PRIMARY KEY,
  mode        TEXT        NOT NULL DEFAULT 'claude'
                CHECK (mode IN ('claude', 'shadow', 'assist', 'primary')),
  -- 独自AIのウェート（0〜100）。mode と併せて段階移行の度合いを表す
  ordo_weight SMALLINT    NOT NULL DEFAULT 0
                CHECK (ordo_weight BETWEEN 0 AND 100),
  note        TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE ai_task_routing IS
  'AIゲートウェイのタスク別ルーティング設定。Ordo運営画面から共有鍵APIで更新する（独自AIへの段階移行のダイヤル）';
COMMENT ON COLUMN ai_task_routing.mode IS
  'claude=Claudeのみ / shadow=裏で独自AI並走・比較ログのみ / assist=コーパス接地 / primary=独自AI主体。X1で有効なのはclaudeのみ、他は設定可だがclaudeとして動作';

-- 既知のタスク種別を種付け（src/lib/ai/taskTypes.ts の AI_TASK_TYPES と対応）
INSERT INTO ai_task_routing (task_type, note) VALUES
  ('dialogue.asis',            '現状整理（SWOT等）の対話'),
  ('dialogue.issue',           '課題仮説設定の対話'),
  ('dialogue.measure',         '施策構築（EBPM）の対話'),
  ('dialogue.improvement',     'A改善の対話'),
  ('proposal.issue_hypothesis','課題仮説のAI提案'),
  ('proposal.goals',           '目標のAI提案'),
  ('proposal.improvements',    '改善策のAI提案'),
  ('generation.logic_model',   'ロジックモデル生成'),
  ('generation.report',        'レポート生成'),
  ('generation.schedule',      'スケジュール生成'),
  ('generation.summary',       '投稿サマリー生成'),
  ('analysis.gap',             'ギャップ分析'),
  ('analysis.gap_values',      'ギャップ分析の値提案'),
  ('analysis.stats',           '統計データの解釈'),
  ('analysis.evidence',        'エビデンス評価'),
  ('knowledge.compile',        'ナレッジのコンパイル'),
  ('knowledge.dict_edit',      'ナレッジ辞書のAI編集'),
  ('knowledge.summarize',      '資料の要約')
ON CONFLICT (task_type) DO NOTHING;

-- ── 利用ログ ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_usage_logs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  task_type       TEXT        NOT NULL,
  -- 実際に応答を生成したプロバイダ
  provider        TEXT        NOT NULL DEFAULT 'claude'
                    CHECK (provider IN ('claude', 'ordo')),
  model           TEXT,
  input_tokens    INTEGER,
  output_tokens   INTEGER,
  latency_ms      INTEGER,
  status          TEXT        NOT NULL DEFAULT 'ok'
                    CHECK (status IN ('ok', 'error')),
  error_message   TEXT,
  -- 文脈（分かる範囲で記録。個票の中身は保存しない）
  project_id      UUID,
  municipality_id UUID,
  -- 提案が担当者に採択されたか（X4のshadow運用から書き込み）
  adopted         BOOLEAN,
  adopted_at      TIMESTAMPTZ
);

COMMENT ON TABLE ai_usage_logs IS
  'AIゲートウェイの利用ログ。プロンプト・応答本文は保存しない（トークン数・成否・文脈IDのみ）。Ordo運営画面の品質モニタとウェート判断の材料';

CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_occurred
  ON ai_usage_logs (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_task
  ON ai_usage_logs (task_type, occurred_at DESC);

-- ── 確認用ログ ───────────────────────────────────
DO $$
BEGIN
  RAISE NOTICE 'AIゲートウェイ: ai_task_routing（%件）と ai_usage_logs を用意しました',
    (SELECT count(*) FROM ai_task_routing);
END $$;
