-- ================================================================
-- 035_logic_model_elements.sql
-- L2: ロジックモデルの要素を構造化する
--
-- 設計: claude/coe-lm-l1.md の「次（L2以降）」
--
-- 【背景】各欄が「文字列の配列」だった
--   ["介護予防教室の参加者が増える", "外出頻度が上がる"]
--
--   このため
--     - どの成果をどのKPIで見るのかを書く場所が無く、
--       評価のたびに人が見比べて対応付けていた
--     - 並べ替えると別物になり、因果の線（edges）の宛先を指せなかった
--     - 文言を1文字直すと「別の要素」になり、履歴が追えなかった
--
--   要素に id を与える:
--     [{"id": "...", "text": "介護予防教室の参加者が増える", "kpi_ids": []}]
--
--   id が定まることで L3（KPI割当）と L4（因果エッジ）の宛先が決まる。
--
-- 【安全性】
--   アプリ側は src/lib/logicmodel/elements.ts の normalizeElements を通して読む。
--   文字列配列・{term,text}・{id,text,kpi_ids} のいずれが入っていても読めるため、
--   このマイグレーションの前後どちらの状態でも画面は壊れない。
--   （＝デプロイ順序に依存しない）
--
-- 方針: MIGRATION_POLICY.md 準拠。DROP COLUMN / DROP TABLE は行わない。
--       旧 outcomes 列は消さず、写しとして残す。
--       冪等（既に要素形式の行は素通しする）。
-- ================================================================

-- ================================================================
-- Step 1: 変換関数
--   jsonb 配列の各要素を {id, text, kpi_ids} に揃える。
--     - 文字列          → text に入れ、id を新規採番
--     - {text: "..."}   → text を引き継ぎ、id が無ければ採番
--     - {id, text, ...} → そのまま（kpi_ids が無ければ [] を補う）
--   空文字・null の要素は落とす。
-- ================================================================
CREATE OR REPLACE FUNCTION lm_to_elements(src jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    jsonb_agg(elem ORDER BY ord),
    '[]'::jsonb
  )
  FROM (
    SELECT
      ord,
      jsonb_build_object(
        'id',
        CASE
          WHEN jsonb_typeof(item) = 'object'
           AND COALESCE(item->>'id', '') <> ''
          THEN item->>'id'
          ELSE 'el_' || md5(random()::text || clock_timestamp()::text || ord::text)
        END,
        'text', txt,
        'kpi_ids',
        CASE
          WHEN jsonb_typeof(item) = 'object'
           AND jsonb_typeof(item->'kpi_ids') = 'array'
          THEN item->'kpi_ids'
          ELSE '[]'::jsonb
        END
      ) AS elem
    FROM (
      SELECT
        item,
        ord,
        BTRIM(
          CASE jsonb_typeof(item)
            WHEN 'string' THEN item #>> '{}'
            WHEN 'object' THEN COALESCE(
              item->>'text', item->>'label', item->>'title', item->>'name'
            )
            WHEN 'number' THEN item #>> '{}'
            ELSE NULL
          END
        ) AS txt
      FROM jsonb_array_elements(
             CASE WHEN jsonb_typeof(src) = 'array' THEN src ELSE '[]'::jsonb END
           ) WITH ORDINALITY AS t(item, ord)
    ) s
    WHERE txt IS NOT NULL AND txt <> ''
  ) x;
$$;

COMMENT ON FUNCTION lm_to_elements(jsonb) IS
  'ロジックモデルの列を {id,text,kpi_ids} の配列に正規化する（035）';

-- ================================================================
-- Step 2: 旧 outcomes 列から三層アウトカムを救済する
--
--   AI生成は outcomes に [{"term":"short","text":"..."}] を入れていた。
--   三層の専用列が空の行だけ、term を見て振り分ける。
--   既に専用列に値がある行は触らない（利用者が手で直した内容を上書きしない）。
-- ================================================================
UPDATE logic_models
SET initial_outcomes = lm_to_elements(
      (SELECT COALESCE(jsonb_agg(e), '[]'::jsonb)
       FROM jsonb_array_elements(outcomes) e
       WHERE e->>'term' IN ('short', 'initial', 'outcome_initial'))
    )
WHERE jsonb_typeof(outcomes) = 'array'
  AND COALESCE(jsonb_array_length(initial_outcomes), 0) = 0
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(outcomes) e
    WHERE e->>'term' IN ('short', 'initial', 'outcome_initial')
  );

UPDATE logic_models
SET intermediate_outcomes = lm_to_elements(
      (SELECT COALESCE(jsonb_agg(e), '[]'::jsonb)
       FROM jsonb_array_elements(outcomes) e
       WHERE e->>'term' IN ('intermediate', 'mid', 'outcome_intermediate'))
    )
WHERE jsonb_typeof(outcomes) = 'array'
  AND COALESCE(jsonb_array_length(intermediate_outcomes), 0) = 0
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(outcomes) e
    WHERE e->>'term' IN ('intermediate', 'mid', 'outcome_intermediate')
  );

UPDATE logic_models
SET long_outcomes = lm_to_elements(
      (SELECT COALESCE(jsonb_agg(e), '[]'::jsonb)
       FROM jsonb_array_elements(outcomes) e
       WHERE e->>'term' IN ('long', 'outcome_long'))
    )
WHERE jsonb_typeof(outcomes) = 'array'
  AND COALESCE(jsonb_array_length(long_outcomes), 0) = 0
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(outcomes) e
    WHERE e->>'term' IN ('long', 'outcome_long')
  );

-- term を一切持たない旧 outcomes（層が判らないもの）。
-- 三層すべてが空の行に限り、従来の画面表示と同じく中間として置く。
UPDATE logic_models
SET intermediate_outcomes = lm_to_elements(outcomes)
WHERE jsonb_typeof(outcomes) = 'array'
  AND jsonb_array_length(outcomes) > 0
  AND COALESCE(jsonb_array_length(initial_outcomes), 0) = 0
  AND COALESCE(jsonb_array_length(intermediate_outcomes), 0) = 0
  AND COALESCE(jsonb_array_length(long_outcomes), 0) = 0
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(outcomes) e WHERE e ? 'term'
  );

-- ================================================================
-- Step 3: 6列を要素形式へ変換する
--   既に全要素が id を持つ行は素通しする（再実行しても id が振り直されない）。
-- ================================================================
UPDATE logic_models
SET inputs = lm_to_elements(inputs)
WHERE jsonb_typeof(inputs) = 'array'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(inputs) e
    WHERE jsonb_typeof(e) <> 'object' OR COALESCE(e->>'id', '') = ''
  );

UPDATE logic_models
SET activities = lm_to_elements(activities)
WHERE jsonb_typeof(activities) = 'array'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(activities) e
    WHERE jsonb_typeof(e) <> 'object' OR COALESCE(e->>'id', '') = ''
  );

UPDATE logic_models
SET outputs = lm_to_elements(outputs)
WHERE jsonb_typeof(outputs) = 'array'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(outputs) e
    WHERE jsonb_typeof(e) <> 'object' OR COALESCE(e->>'id', '') = ''
  );

UPDATE logic_models
SET initial_outcomes = lm_to_elements(initial_outcomes)
WHERE jsonb_typeof(initial_outcomes) = 'array'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(initial_outcomes) e
    WHERE jsonb_typeof(e) <> 'object' OR COALESCE(e->>'id', '') = ''
  );

UPDATE logic_models
SET intermediate_outcomes = lm_to_elements(intermediate_outcomes)
WHERE jsonb_typeof(intermediate_outcomes) = 'array'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(intermediate_outcomes) e
    WHERE jsonb_typeof(e) <> 'object' OR COALESCE(e->>'id', '') = ''
  );

UPDATE logic_models
SET long_outcomes = lm_to_elements(long_outcomes)
WHERE jsonb_typeof(long_outcomes) = 'array'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(long_outcomes) e
    WHERE jsonb_typeof(e) <> 'object' OR COALESCE(e->>'id', '') = ''
  );

-- NULL を空配列に寄せる（読む側の分岐を減らす）
UPDATE logic_models SET initial_outcomes      = '[]'::jsonb WHERE initial_outcomes      IS NULL;
UPDATE logic_models SET intermediate_outcomes = '[]'::jsonb WHERE intermediate_outcomes IS NULL;
UPDATE logic_models SET long_outcomes         = '[]'::jsonb WHERE long_outcomes         IS NULL;

COMMENT ON COLUMN logic_models.inputs IS
  '投入資源。要素は {id, text, kpi_ids[]}（035以降）';
COMMENT ON COLUMN logic_models.activities IS
  '実施活動。要素は {id, text, kpi_ids[]}（035以降）';
COMMENT ON COLUMN logic_models.outputs IS
  '産出物。要素は {id, text, kpi_ids[]}（035以降）';
COMMENT ON COLUMN logic_models.initial_outcomes IS
  '短期アウトカム（概ね1年）。要素は {id, text, kpi_ids[]}';
COMMENT ON COLUMN logic_models.intermediate_outcomes IS
  '中間アウトカム（2〜5年）。要素は {id, text, kpi_ids[]}';
COMMENT ON COLUMN logic_models.outcomes IS
  '旧形式の写し。正本は三層の専用列。新規の書き込みはしない（後方互換の読み取りのみ）';

-- ================================================================
-- Step 4: 確認用ログ
-- ================================================================
DO $$
DECLARE
  n_rows    INT;
  n_legacy  INT;
  n_elem    INT;
BEGIN
  SELECT COUNT(*) INTO n_rows FROM logic_models;

  -- 6列のいずれかに、id を持たない要素が残っている行
  SELECT COUNT(*) INTO n_legacy
  FROM logic_models lm
  WHERE EXISTS (
    SELECT 1
    FROM unnest(ARRAY[lm.inputs, lm.activities, lm.outputs,
                      lm.initial_outcomes, lm.intermediate_outcomes, lm.long_outcomes]) col
    WHERE jsonb_typeof(col) = 'array'
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(col) e
        WHERE jsonb_typeof(e) <> 'object' OR COALESCE(e->>'id', '') = ''
      )
  );

  SELECT COALESCE(SUM(
    COALESCE(jsonb_array_length(inputs), 0) +
    COALESCE(jsonb_array_length(activities), 0) +
    COALESCE(jsonb_array_length(outputs), 0) +
    COALESCE(jsonb_array_length(initial_outcomes), 0) +
    COALESCE(jsonb_array_length(intermediate_outcomes), 0) +
    COALESCE(jsonb_array_length(long_outcomes), 0)
  ), 0) INTO n_elem FROM logic_models;

  RAISE NOTICE 'ロジックモデル % 件 / 要素 % 個 / 未変換の行 % 件（未変換=0なら正常）',
    n_rows, n_elem, n_legacy;
END $$;
