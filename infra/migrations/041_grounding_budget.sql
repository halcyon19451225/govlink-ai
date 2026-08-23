-- ================================================================
-- 041_grounding_budget.sql
-- X4: コーパス接地（独自AI v0）＋ 予算積算の強化
--
-- 設計: claude/coe-ownai-plan.md（承認済み方針）X4
-- 承認事項: 予算編成提案 = 施策構築 cost フェーズの強化として組み込む
--
-- 【内容】
-- 1. measure_designs.budget_breakdown — 積算内訳（費目別）。
--    [{ item: "委託料", amount: 2400000, note: "週1回×48回×5万円" }] の配列。
--    cost フェーズのAI対話が類似施策のコスト実績（コーパス）を参照しながら
--    内訳を提案し、確定後は効率性評価（第5階層）の材料になる。
-- 2. ai_grounding_logs — コーパス接地の記録。
--    どの対話に・どのコーパス行を・どのモード（shadow/assist）で使ったか。
--    shadow は「裏で検索だけ行い記録する」（利用者には出さない）。
--    adopted はその対話が commit まで到達したかの粗い採択指標
--    （v0 の定義。個別提案単位の採択追跡は今後の課題として正直に運用する）。
--
-- 方針: MIGRATION_POLICY.md 準拠。列追加＋新規テーブルのみ。冪等。
-- ================================================================

-- ── 積算内訳（F区画の拡張）─────────────────────────
ALTER TABLE measure_designs
  ADD COLUMN IF NOT EXISTS budget_breakdown JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN measure_designs.budget_breakdown IS
  '積算内訳 [{item(費目), amount(円), note(積算根拠: 単価×回数等)}]。costフェーズのAI対話がコーパスのコスト実績を参照して提案する（X4）。正本は src/lib/measure/types.ts の normalizeBudgetBreakdown';

-- ── コーパス接地ログ ─────────────────────────────
CREATE TABLE IF NOT EXISTS ai_grounding_logs (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  task_type           TEXT        NOT NULL,
  -- 実効モード: shadow=検索・記録のみ / assist=プロンプトへ注入
  mode                TEXT        NOT NULL CHECK (mode IN ('shadow', 'assist', 'primary')),
  project_id          UUID,
  -- 対話ID等（measure_dialogues.id / asis_analyses.id）。採択判定の結合キー
  context_id          UUID,
  -- 検索に使った要約語（個人情報を含めない。真因・分野などの断片）
  query_summary       TEXT,
  corpus_measure_ids  UUID[]      NOT NULL DEFAULT '{}',
  corpus_evidence_ids UUID[]      NOT NULL DEFAULT '{}',
  -- プロンプトに注入したか（shadow は false）
  injected            BOOLEAN     NOT NULL DEFAULT false,
  latency_ms          INTEGER,
  -- 粗い採択指標: 接地した対話が commit（施策の書き出し）まで到達したか
  adopted             BOOLEAN,
  adopted_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ai_grounding_logs_occurred
  ON ai_grounding_logs (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_grounding_logs_task
  ON ai_grounding_logs (task_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_grounding_logs_context
  ON ai_grounding_logs (context_id) WHERE context_id IS NOT NULL;

COMMENT ON TABLE ai_grounding_logs IS
  'コーパス接地（独自AI v0）の記録。shadow運用の品質計測とウェート判断の材料（X4）。プロンプト・応答本文は保存しない';

-- ── 確認用ログ ───────────────────────────────────
DO $$
BEGIN
  RAISE NOTICE 'コーパス接地: measure_designs.budget_breakdown と ai_grounding_logs を用意しました';
END $$;
