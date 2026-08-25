-- ================================================================
-- 044_harvest_pdf_sources.sql
-- X7b: アダプタB（PDF→S3原本保全→Tier1ナレッジ）＋ソース追加
--      （JAGESプレスリリース・厚労科研DB・WSIPP・Community Guide）
--
-- 設計: claude/coe-x7-pdca-design.md（承認済み v2.2）第1部 §2 アダプタB / X7b
-- 追加要望: JAGESプレスリリース（webseed第1弾の継続供給源 — ユーザー指示 2026-08-25）
--
-- 【構成】
--   knowledge_documents … harvest_source_key（冪等・UNIQUE）/ harvest_run_id 追加
--     アダプタBが自動登録した文書の重複防止と収集runへの逆リンク。
--     以降は既存のX3フロー（ナレッジ抽出タブ→AI抽出proposed→担当者選別→intake）に
--     合流する — 既存フローは一切変更しない。無確認でコーパスには入らない。
--   corpus_sources … 4ソースをseed（すべて enabled=false。
--     ライセンス・利用規約の確認後に画面から有効化する）
--
-- 方針: MIGRATION_POLICY.md 準拠。追加のみ。冪等。
-- ================================================================

-- ── アダプタBの冪等キーと逆リンク ──────────────────────
ALTER TABLE knowledge_documents
  ADD COLUMN IF NOT EXISTS harvest_source_key TEXT,
  ADD COLUMN IF NOT EXISTS harvest_run_id UUID REFERENCES corpus_harvest_runs(id) ON DELETE SET NULL;

-- ON CONFLICT (harvest_source_key) 用の一意インデックス（NULLは重複可 — 手動登録文書に影響しない）
CREATE UNIQUE INDEX IF NOT EXISTS uq_knowledge_documents_harvest_key
  ON knowledge_documents (harvest_source_key);

COMMENT ON COLUMN knowledge_documents.harvest_source_key IS
  '自動収集（アダプタB）の冪等キー: webseed:auto:<adapter>:<安定ID>。NULL=手動登録（X7b）';

-- ── ソースの追加登録（すべて enabled=false・有効化は画面から）──
INSERT INTO corpus_sources (name, kind, base_url, adapter, crawl_frequency, license_note, enabled, review_mode)
SELECT * FROM (VALUES
  (
    'JAGES プレスリリース',
    'press',
    'https://www.jages.net/library/pressrelease/',
    'jages_press',
    'monthly',
    'JAGES（日本老年学的評価研究）の公開プレスリリース。出典明記・本文からの構造化抽出のみ（PDFの再配布はしない）。webseed第1弾（JAGES介護予防）と同じ出典明記ルールを維持',
    false,
    'full'
  ),
  (
    '厚生労働科学研究成果データベース（介護予防）',
    'pdf_repository',
    'https://mhlw-grants.niph.go.jp/search?keyword=%E4%BB%8B%E8%AD%B7%E4%BA%88%E9%98%B2',
    'mhlw_grants',
    'monthly',
    '政府標準利用規約準拠の公開データベース。報告書PDFはS3へ原本保全のうえTier1ナレッジとして内部利用（出所URL・取得日をメタデータに記録。再配布はしない）',
    false,
    'full'
  ),
  (
    'WSIPP Benefit-Cost Results（米・ワシントン州）',
    'structured_db',
    'https://www.wsipp.wa.gov/BenefitCost',
    'wsipp',
    'monthly',
    '米国州機関の公開Benefit-Cost分析。出典明記で参照。海外ソースのため外的妥当性メモ必須・金額は参考値扱い（sanitizeが強制）',
    false,
    'full'
  ),
  (
    'The Community Guide（米CDC）',
    'structured_db',
    'https://www.thecommunityguide.org/pages/task-force-findings.html',
    'community_guide',
    'monthly',
    '米国の予防サービス介入ガイド（公開）。出典明記で参照。海外ソースのため外的妥当性メモ必須（sanitizeが強制）',
    false,
    'full'
  )
) AS v(name, kind, base_url, adapter, crawl_frequency, license_note, enabled, review_mode)
WHERE NOT EXISTS (
  SELECT 1 FROM corpus_sources s WHERE s.adapter = v.adapter
);

-- ── 確認用ログ ───────────────────────────────────────
DO $$
DECLARE
  n_sources INT;
BEGIN
  SELECT count(*) INTO n_sources FROM corpus_sources;
  RAISE NOTICE 'X7b: knowledge_documents に harvest_source_key/harvest_run_id を追加し、収集ソースを登録しました（現在%件・追加分はすべて enabled=false）', n_sources;
  RAISE NOTICE '有効化の前にライセンス注記を確認してください（JAGES/厚労科研/WSIPP/Community Guide）';
END $$;
