-- ================================================================
-- 046_machine_transcribe.sql
-- X7e: アダプタD（機械転記: e-Stat・行政事業レビュー）＋接地配線の器
--
-- 設計: claude/coe-x7-pdca-design.md（承認済み v2.2）第1部 §2 アダプタD / X7e
--
-- 【構成】
--   corpus_measures.source_kind … 'govreview' を追加（CHECK張り替え・上位集合）
--     行政事業レビュー由来の**参照行**（国事業の予算・単価。接地時に
--     「国事業の参考単価」と明示する — X6積算推定への単価分布供給）
--   ai_grounding_logs … corpus_context_ids を追加（context接地の記録・使用回数集計）
--   corpus_sources … アダプタD 2ソースをseed（enabled=false・review_mode='light'）
--     アダプタDはAIの生成を挟まない機械転記（数値・事業名・出典URLをそのまま構造化。
--     要約文はテンプレート生成）— 推測混入リスクが構造的にゼロのため light 検収に適合（§3-4）
--
-- 方針: MIGRATION_POLICY.md 準拠。追加のみ。冪等。
-- ================================================================

-- ── corpus_measures.source_kind に govreview を追加 ─────────
ALTER TABLE corpus_measures
  DROP CONSTRAINT IF EXISTS corpus_measures_source_kind_check;
ALTER TABLE corpus_measures
  ADD CONSTRAINT corpus_measures_source_kind_check
    CHECK (source_kind IN (
      'measure_design',     -- 自治体の確定施策
      'knowledge_extract',  -- ナレッジ抽出・webseed
      'harvest',            -- 自動収集（X7a）
      'govreview'           -- 行政事業レビュー参照行（X7e。国事業の参考単価）
    ));

-- ── 接地ログに context 配列を追加 ────────────────────────
ALTER TABLE ai_grounding_logs
  ADD COLUMN IF NOT EXISTS corpus_context_ids UUID[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN ai_grounding_logs.corpus_context_ids IS
  '接地に使った corpus_context 行（X7e: As-Is対話への環境情報注入）';

-- ── アダプタDのソース登録（enabled=false・light検収）────────
INSERT INTO corpus_sources (name, kind, base_url, adapter, crawl_frequency, license_note, query_config, enabled, review_mode)
SELECT * FROM (VALUES
  (
    'e-Stat 統計API（社会・人口統計体系など）',
    'structured_db',
    'https://api.e-stat.go.jp/rest/3.0/app/json/getStatsData?statsDataId=0000020201&cdArea=00000&limit=100',
    'e_stat',
    'monthly',
    '政府統計の総合窓口 e-Stat API（利用登録済みappIdが必要 — env ESTAT_APP_ID をエンジンが自動付与。未設定のままでは実行できない）。出典明記（e-Stat・statsDataId）。★有効化前に statsDataId と対象地域（cdArea）を実際の関心統計に合わせて base_url を編集すること',
    '{"pestle_tag": "S", "field_category": "地域統計"}'::jsonb,
    false,
    'light'
  ),
  (
    '行政事業レビュー 見える化サイト（RSシステム）',
    'structured_db',
    'https://rssystem.go.jp/download-csv',
    'gyosei_review',
    'monthly',
    '政府標準利用規約準拠の公開データ（rssystem.go.jp）。事業名・予算/執行額・成果指標を参照行として転記し「国事業の参考単価」と明示して接地に使う。★有効化前に base_url を実CSVのダウンロードURL（年度・範囲を絞ったもの）に差し替えること（一覧ページのままでは0件になる）',
    '{"budget_unit_yen": 1000000}'::jsonb,
    false,
    'light'
  )
) AS v(name, kind, base_url, adapter, crawl_frequency, license_note, query_config, enabled, review_mode)
WHERE NOT EXISTS (
  SELECT 1 FROM corpus_sources s WHERE s.adapter = v.adapter
);

-- ── 確認用ログ ───────────────────────────────────────
DO $$
DECLARE
  n_sources INT;
BEGIN
  SELECT count(*) INTO n_sources FROM corpus_sources;
  RAISE NOTICE 'X7e: govreview種別・context接地ログ・アダプタD 2ソースを用意しました（現在%件・追加分は enabled=false / light検収）', n_sources;
END $$;
