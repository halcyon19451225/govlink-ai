-- ================================================================
-- 043_corpus_review.sql
-- X7c: 検収スループット — reviewed_by・review_mode（3段階検収）
--
-- 設計: claude/coe-x7-pdca-design.md（承認済み v2.2）第1部 §3-2・§3-4
--
-- 【構成】
--   corpus_evidence / corpus_measures … reviewed_by 追加
--     （一括承認でも1件ずつ誰が承認したかを記録 — 監査可能性は個別承認と同等。
--       corpus_context は 042 で当初から保持済み）
--   corpus_sources … review_mode 追加（確認の粒度をリスクに比例させる）
--     full  … 1件ずつ精査（AI抽出を経る全行の既定）
--     light … 機械転記・AI不介在のソース（X7eのアダプタD）。収集回単位のまとめ承認
--     spot  … 低リスク種別。ランダム10%目視 → 問題なければ残りをまとめ承認
--
-- 【原則（変わらないこと）】
--   3モードとも「無確認の自動登録をしない」を維持 —
--   承認操作なしに approved には絶対ならない。モードが変えるのは
--   確認の粒度（1件ずつ / 収集回まとめ / 抽出検査）だけ。
--
-- 方針: MIGRATION_POLICY.md 準拠。追加のみ。冪等。
-- ================================================================

ALTER TABLE corpus_evidence
  ADD COLUMN IF NOT EXISTS reviewed_by TEXT;
ALTER TABLE corpus_measures
  ADD COLUMN IF NOT EXISTS reviewed_by TEXT;

COMMENT ON COLUMN corpus_evidence.reviewed_by IS
  '検収操作者（メール）。一括承認でも1件ずつ記録する（X7c）';
COMMENT ON COLUMN corpus_measures.reviewed_by IS
  '検収操作者（メール）。一括承認でも1件ずつ記録する（X7c）';

ALTER TABLE corpus_sources
  ADD COLUMN IF NOT EXISTS review_mode TEXT NOT NULL DEFAULT 'full'
    CHECK (review_mode IN ('full', 'light', 'spot'));

COMMENT ON COLUMN corpus_sources.review_mode IS
  '検収の粒度（X7c §3-4）: full=1件ずつ / light=収集回単位のまとめ承認（機械転記ソース向け）/ spot=ランダム10%目視→まとめ承認。どのモードでも承認操作なしに approved にはならない';

-- ── 確認用ログ ───────────────────────────────────────
DO $$
BEGIN
  RAISE NOTICE '検収スループット(X7c): reviewed_by（evidence/measures）と corpus_sources.review_mode（full/light/spot・既定full）を追加しました';
END $$;
