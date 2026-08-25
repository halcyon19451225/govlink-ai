-- ================================================================
-- 047_jages_source_fix.sql
-- X7e補修: JAGES収集面の差し替え（プレスリリースページ → 更新履歴一覧）
--
-- 経緯（2026-08-25 試運転で発覚）:
--   /library/pressrelease/ の年度フォルダは JavaScript 駆動で、
--   サーバーが返すHTMLにはPDFリンクが出ない（唯一のファイルリンクは
--   xlsx検索用ファイルで、アダプタが正しく除外 → 候補0件）。
--   → 収集面をサーバー描画の多目的DB「更新履歴」一覧に差し替える
--     （記事詳細リンクが取れることを実地確認済み。アダプタ側も
--       multidatabase_view_main_detail 対応を追加 — adapters.ts）。
--   過去年度分のバックログはこの面からは取れないため、必要なら
--   webseed（手動シード）で補う。
--
-- 方針: MIGRATION_POLICY.md 準拠。データ修正のみ・冪等
--   （旧URLのままの行だけを更新。ユーザーが画面で編集済みなら触らない）。
-- ================================================================

UPDATE corpus_sources
SET base_url = 'https://www.jages.net/?active_action=multidatabase_view_main_init&block_id=65&multidatabase_id=1',
    name = 'JAGES 研究成果・プレスリリース（更新履歴）',
    license_note = license_note || ' / 収集面は更新履歴一覧（多目的DB・サーバー描画）。プレスリリースページの年度フォルダはJS駆動のため収集不可（2026-08-25確認）',
    last_content_hash = NULL,   -- 面の変更後、必ず再収集させる
    updated_at = now()
WHERE adapter = 'jages_press'
  AND base_url = 'https://www.jages.net/library/pressrelease/';

DO $$
DECLARE
  n INT;
BEGIN
  SELECT count(*) INTO n FROM corpus_sources
  WHERE adapter = 'jages_press' AND base_url LIKE '%multidatabase_view_main_init%';
  IF n > 0 THEN
    RAISE NOTICE 'JAGES収集面を更新履歴一覧に差し替えました（再収集の準備OK）';
  ELSE
    RAISE NOTICE 'JAGESソースは旧URLではありません（画面で編集済みの可能性 — 変更していません）';
  END IF;
END $$;
