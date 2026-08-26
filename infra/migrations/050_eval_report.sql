-- ================================================================
-- 050_eval_report.sql
-- PL3: A① 評価結果報告書の調製・出力（plan_documents 基盤を再利用）
--
-- 設計: claude/coe-x7-pdca-design.md（承認済み v2.2）第2部 A①
--   - C工程の成果物（プログラム評価・自己評価・スコアボード）と
--     A工程の成果物（改善アクション・引き継ぎパッケージ）を1冊に調製する
--   - P②（次期での取り込み）の入力になるため、確定（finalized）で
--     内容をスナップショット固定する（plan_documents の既存機構を共用）
--
-- 【変更内容】
--   1. plan_documents.variant / plan_document_exports.variant の CHECK を
--      superset へ張り替え（+ 'evaluation_report'。049の値はすべて残す —
--      MIGRATION_POLICY.md の「CHECKの縮小はしない」原則どおり）
--      ※ PL4 で 'deck' を追加する際も同じ張り替え方で拡張する
--   2. ai_task_routing に generation.eval_report を種付け
--
-- 方針: MIGRATION_POLICY.md 準拠。CHECK拡張＋種付けのみ。冪等。
-- ================================================================

-- ── plan_documents.variant に evaluation_report を追加 ──────
ALTER TABLE plan_documents
  DROP CONSTRAINT IF EXISTS plan_documents_variant_check;
ALTER TABLE plan_documents
  ADD CONSTRAINT plan_documents_variant_check
    CHECK (variant IN (
      'full',               -- 計画書（PL2。sections の正本）
      'simple',             -- （出力体裁用の予約 — plan_documents 行としては未使用）
      'digest',             -- （同上）
      'evaluation_report'   -- 評価結果報告書（PL3。full とは独立した sections を持つ）
    ));

-- ── plan_document_exports.variant にも同じ値を追加 ──────────
ALTER TABLE plan_document_exports
  DROP CONSTRAINT IF EXISTS plan_document_exports_variant_check;
ALTER TABLE plan_document_exports
  ADD CONSTRAINT plan_document_exports_variant_check
    CHECK (variant IN (
      'full', 'simple', 'digest',   -- 計画書の3体裁（PL2）
      'evaluation_report'           -- 評価報告書のdocx（PL3）
    ));

COMMENT ON TABLE plan_documents IS
  '計画書・評価報告書の調製（PL2/PL3）。variant=full が計画書、evaluation_report が評価報告書。章ごとの locked=true はAI再生成・リライトの対象外。finalized で内容を固定（確定済み評価報告書は P② 経路1の入力）';

-- ── AIタスク種別の種付け ────────────────────────────────
INSERT INTO ai_task_routing (task_type, note) VALUES
  ('generation.eval_report', '評価結果報告書の章立て下書き生成・章別リライト（PL3）')
ON CONFLICT (task_type) DO NOTHING;

-- ── 確認用ログ ───────────────────────────────────────
DO $$
BEGIN
  RAISE NOTICE 'PL3: plan_documents の variant に evaluation_report を追加し、generation.eval_report を用意しました';
END $$;
