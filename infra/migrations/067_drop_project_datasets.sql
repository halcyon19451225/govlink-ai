-- ================================================================
-- Migration 067: project_datasets の廃止（D2）
-- ================================================================
--
-- 066 で project_datasets の各行は datasets（箱）＋ dataset_versions（版）に写した
-- （ingest_key = 'legacy:<旧id>'）。D2 で API・画面・ギャップ分析・リネージ・成果物記録の
-- 参照先をすべて版に切り替えたので、旧表を落とす。
--
-- 安全側の作り: 066 の移行が済んでいない行（版に写っていない旧行）が1件でもあれば、
-- 落とさずに例外で止める。「データが残っているのに表が消えた」を起こさないため。

DO $$
DECLARE
  unmigrated INTEGER;
BEGIN
  IF to_regclass('public.project_datasets') IS NULL THEN
    RETURN;
  END IF;
  SELECT COUNT(*) INTO unmigrated
    FROM project_datasets pd
   WHERE NOT EXISTS (SELECT 1 FROM dataset_versions v WHERE v.ingest_key = 'legacy:' || pd.id::text);
  IF unmigrated > 0 THEN
    RAISE EXCEPTION '066 で移行されていない project_datasets の行が % 件あります。先に 066 を適用してください', unmigrated;
  END IF;
  DROP TABLE project_datasets;
END $$;
