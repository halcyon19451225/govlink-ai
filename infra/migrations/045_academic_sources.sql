-- ================================================================
-- 045_academic_sources.sql
-- X7d: アダプタC（学術API: J-STAGE・PubMed・CiNii）のソース登録
--
-- 設計: claude/coe-x7-pdca-design.md（承認済み v2.2）第1部 §2 アダプタC / X7d
--
-- スキーマ変更なし（seedのみ）。エビデンス行量産の主力。
-- base_url に検索クエリ込みのAPI URLを設定する — 分野を増やすときは
-- 同じアダプタで base_url（検索語）を変えたソース行を画面から追加すればよい。
--
-- 判定規律（アダプタ実装側で強制）:
--  - 抄録スクリーニングで足切り（介入研究か／デザイン明記があるか）
--  - 抄録だけで rct を名乗る行は本文確認まで Lv を1段保守的に
--  - 効果量が無ければ OA本文（PMC/J-STAGE全文）を1回だけ追撃取得
--
-- 方針: MIGRATION_POLICY.md 準拠。追加のみ。冪等。
-- ================================================================

INSERT INTO corpus_sources (name, kind, base_url, adapter, crawl_frequency, license_note, enabled, review_mode)
SELECT * FROM (VALUES
  (
    'J-STAGE 論文検索（介護予防）',
    'structured_db',
    'https://api.jstage.jst.go.jp/searchapi/do?service=3&article=%E4%BB%8B%E8%AD%B7%E4%BA%88%E9%98%B2&count=20',
    'j_stage',
    'weekly',
    'J-STAGE WebAPI（無償・機械アクセス前提の公式API）。出典・DOI明記で書誌情報と公開抄録を参照。本文はOA公開分のみ',
    false,
    'full'
  ),
  (
    'PubMed 論文検索（地域介入×高齢者）',
    'structured_db',
    'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=20&sort=pub_date&term=community-based+intervention+AND+older+adults+AND+(randomized+OR+quasi-experimental)',
    'pubmed',
    'weekly',
    'PubMed E-utilities（NCBI公式API・無償）。出典・PMID明記で書誌情報と公開抄録を参照。本文はPMC OA分のみ。海外扱い＝外的妥当性メモ必須',
    false,
    'full'
  ),
  (
    'CiNii Research 論文検索（介護予防 効果検証）',
    'structured_db',
    'https://cir.nii.ac.jp/opensearch/articles?format=rss&count=20&q=%E4%BB%8B%E8%AD%B7%E4%BA%88%E9%98%B2%20%E5%8A%B9%E6%9E%9C%E6%A4%9C%E8%A8%BC',
    'cinii',
    'weekly',
    'CiNii Research OpenSearch API（国立情報学研究所・公式API）。出典・CRID明記で書誌情報を参照',
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
  RAISE NOTICE 'X7d: 学術APIソース（J-STAGE・PubMed・CiNii）を登録しました（現在%件・追加分はすべて enabled=false）', n_sources;
END $$;
