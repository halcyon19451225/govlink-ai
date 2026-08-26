-- ================================================================
-- 051_audience_deck.sql
-- PL4: P④ 受益者向け説明資料（pptx・ノート欄に読み原稿）
--
-- 設計: claude/coe-x7-pdca-design.md（承認済み v2.2）第2部 P④
--   - pptxgenjs（純JS）でサーバー生成。addNotes() でスライドごとの
--     ノート欄に読み原稿（話し言葉・1枚45〜60秒目安）を書き込む
--   - 画面は計画書調製画面に「🎤 説明資料」タブとして同居（新メニューなし）
--   - 出力は S3 保存＋ダウンロード。plan_documents に variant='deck' で同居
--     （設計の「同居させる案も可」を採用 — 章=スライドの対応が sections JSONB に
--      そのまま載り、ロック・確定・履歴・リライトの既存機構を共用できるため）
--   - 将来接続: Libera の pptx→ナレーション動画エンジン（ノート欄=ナレーション原稿）
--
-- 【変更内容】
--   1. plan_documents.variant / plan_document_exports.variant の CHECK を
--      superset へ張り替え（+ 'deck'。050までの値はすべて残す）
--   2. ai_task_routing に generation.audience_deck を種付け
--
-- 方針: MIGRATION_POLICY.md 準拠。CHECK拡張＋種付けのみ。冪等。
-- ================================================================

-- ── plan_documents.variant に deck を追加 ──────────────────
ALTER TABLE plan_documents
  DROP CONSTRAINT IF EXISTS plan_documents_variant_check;
ALTER TABLE plan_documents
  ADD CONSTRAINT plan_documents_variant_check
    CHECK (variant IN (
      'full',               -- 計画書（PL2）
      'simple',             -- （出力体裁用の予約）
      'digest',             -- （同上）
      'evaluation_report',  -- 評価結果報告書（PL3）
      'deck'                -- 受益者向け説明資料（PL4。sections=スライド、summary=読み原稿）
    ));

-- ── plan_document_exports.variant にも同じ値を追加 ──────────
ALTER TABLE plan_document_exports
  DROP CONSTRAINT IF EXISTS plan_document_exports_variant_check;
ALTER TABLE plan_document_exports
  ADD CONSTRAINT plan_document_exports_variant_check
    CHECK (variant IN (
      'full', 'simple', 'digest',   -- 計画書の3体裁（PL2）
      'evaluation_report',          -- 評価報告書のdocx（PL3）
      'deck'                        -- 説明資料のpptx（PL4）
    ));

COMMENT ON TABLE plan_documents IS
  '計画書・評価報告書・説明資料の調製（PL2/PL3/PL4）。variant=full が計画書、evaluation_report が評価報告書、deck が受益者向け説明資料（sections=スライド・summary=読み原稿）。章/スライドごとの locked=true はAI再生成・リライトの対象外。finalized で内容を固定';

-- ── AIタスク種別の種付け ────────────────────────────────
INSERT INTO ai_task_routing (task_type, note) VALUES
  ('generation.audience_deck', '受益者向け説明資料のスライド下書き生成・リライト（PL4）')
ON CONFLICT (task_type) DO NOTHING;

-- ── 確認用ログ ───────────────────────────────────────
DO $$
BEGIN
  RAISE NOTICE 'PL4: plan_documents の variant に deck を追加し、generation.audience_deck を用意しました';
END $$;
