-- ================================================================
-- Migration 066: データセット（箱・版・行）・属性辞書・個票（五つ組）・対象群・操作履歴
-- ================================================================
--
-- 設計: claude/coe-dataset-model.md（v4・2026-09-14）第Ⅰ部
--
-- 何を変えるか
-- ------------
--   これまでの「データセット管理」は集計ファイルの置き場（project_datasets）で、
--   版の概念も、個票の器も、機械的な指標算出の土台も無かった。
--   本マイグレーションで次を入れる。
--
--   datasets / dataset_versions / dataset_rows … 箱（種別 aggregate|individual）と履歴（版）、
--                                                集計データの行（列定義に沿って取り込む）
--   attribute_definitions                     … 属性辞書（「何の情報か」はこのキーに限る。自由記述型は無い）
--   subjects / sid_aliases / observations     … 個票の五つ組（誰・何・いつ・値・出所）と仮名の別名
--   cohorts / cohort_members                  … 対象群（親子。取組の対象は主要施策の対象群の部分集合）
--   experiment_assignments / release_requests … 実験割付（Coe が生成・不変）と逆引き依頼の記録
--   activity_log                              … 操作履歴（人が画面から操作しても AI が操作しても同じ形で残す）
--   municipalities.key_id 等                  … 自治体の鍵 ID（鍵そのものは Coe に無い）
--
-- 個人情報について（最重要）
-- --------------------------
--   ここで作るどの表にも、氏名・住所・生年月日・電話・個人番号・宛名番号・被保険者番号の
--   **列は存在しない**。列が無ければ、アプリのバグでも運用ミスでも入らない。
--   observations に自由記述列は無く、attr_key は辞書への外部キーなので、辞書に無い情報は
--   DB が拒否する。sid は庁内で鍵付き導出した仮名で、Coe は鍵を持たない。
--
-- 既存データの移行
-- ----------------
--   project_datasets の各行を、箱1つ（project_id × dataset_def_id）＋版1つに写す。
--   列定義が無いので行の取り込みは行わず、ファイルの参照だけ引き継ぐ（status は pending のまま）。
--   care_cert_anonymized（個票を無検証で受けていた定義）に上げられていたファイルは、
--   旧経路のものとして版を rejected にし、note にその旨を残す。
--   project_datasets 自体はこのマイグレーションでは落とさない（API を切り替える D2 で落とす）。

-- ────────────────────────────────────────────────────────────────
-- 1. 属性辞書
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attribute_definitions (
  key              TEXT PRIMARY KEY,                 -- 'demo.age_band5' / 'care.level' / 'outcome.cert_new'
  municipality_id  UUID REFERENCES municipalities(id) ON DELETE CASCADE,  -- NULL = Coe 共通辞書 / 値あり = テナント拡張
  label            TEXT NOT NULL,
  description      TEXT,
  -- ★ 'text'（自由記述）は存在しない
  value_type       TEXT NOT NULL CHECK (value_type IN ('code','band','int','numeric','bool','month','fiscal_year')),
  codes            JSONB,                            -- code/band の許容値と表示名。これ以外の値は拒否
  unit             TEXT,
  role             TEXT NOT NULL CHECK (role IN ('quasi_identifier','sensitive','exposure','outcome','neutral')),
  generalization   JSONB,                            -- 粗化のはしご（quasi_identifier では必須）
  time_granularity TEXT NOT NULL CHECK (time_granularity IN ('day','month','fiscal_year','static')),
  -- ★ 既定は持ち込み不可。共通辞書で明示的に true にしたものだけ
  cloud_allowed    BOOLEAN NOT NULL DEFAULT false,
  source_hints     JSONB,                            -- 標準EUC / KDB の項目名との対応候補
  plan_types       TEXT[],
  version          INTEGER NOT NULL DEFAULT 1,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT attribute_definitions_qi_ladder_chk
    CHECK (role <> 'quasi_identifier' OR generalization IS NOT NULL)
);
COMMENT ON TABLE attribute_definitions IS
  '属性辞書。「何の情報か」はこのキーに限る。自由記述型は無い。共通辞書の正本は app/src/lib/dataset/dictionary.ts';

-- ────────────────────────────────────────────────────────────────
-- 2. 箱・版・行
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS datasets (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind             TEXT NOT NULL CHECK (kind IN ('aggregate','individual')),
  name             TEXT NOT NULL,
  description      TEXT,
  template_id      TEXT REFERENCES dataset_definitions(id),   -- 既存13件をテンプレートとして参照
  -- aggregate: [{name, role:'dimension'|'time'|'measure', type, codes?, required?}]
  -- individual: {"attr_keys":[…]}
  schema           JSONB NOT NULL DEFAULT '[]',
  acquisition      JSONB,                            -- 取得方法（任意）: {system, report_name, euc_condition, owner, note}
  time_granularity TEXT NOT NULL DEFAULT 'fiscal_year' CHECK (time_granularity IN ('day','month','fiscal_year')),
  created_by       UUID,
  created_via      TEXT NOT NULL DEFAULT 'ui',       -- 'ui' | 'dialogue' | 'migration'
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_datasets_project ON datasets(project_id);

CREATE TABLE IF NOT EXISTS dataset_versions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id       UUID NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  as_of            DATE NOT NULL,                    -- この版のデータの基準日（必須）
  file_name        TEXT,
  storage_path     TEXT,
  file_digest      TEXT,
  file_size_bytes  BIGINT,
  ingest_key       TEXT UNIQUE,                      -- 冪等性
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','validated','rejected')),
  accepted         INTEGER,
  rejected         INTEGER,
  suppressed       INTEGER,
  replaced         INTEGER,
  reject_reasons   JSONB,                            -- 種別と件数だけ。値は残さない
  tool_version     TEXT,                             -- individual: 変換ツールの版
  mapping_digest   TEXT,
  dictionary_version INTEGER,
  key_id           TEXT,                             -- individual: 変換に使った鍵の ID（municipalities.key_id と一致しなければ拒否）
  k_observed       INTEGER,
  row_count        INTEGER,                          -- 版に含まれる行数（集計）/ 人数（個票）
  note             TEXT,
  uploaded_by      UUID,
  uploaded_via     TEXT NOT NULL DEFAULT 'ui',
  uploaded_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  validated_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_dataset_versions_dataset ON dataset_versions(dataset_id, as_of DESC);

CREATE TABLE IF NOT EXISTS dataset_rows (
  dataset_version_id UUID NOT NULL REFERENCES dataset_versions(id) ON DELETE CASCADE,
  row_no           INTEGER NOT NULL,
  dims             JSONB NOT NULL DEFAULT '{}',      -- dimension 列 {"地域名":"A圏域","設問番号":"Q12"}
  period           DATE NOT NULL,                    -- time 列を正規化した基準日
  measures         JSONB NOT NULL DEFAULT '{}',      -- measure 列 {"回答数":123,"割合":0.31}
  PRIMARY KEY (dataset_version_id, row_no)
);
CREATE INDEX IF NOT EXISTS idx_dataset_rows_period ON dataset_rows(dataset_version_id, period);

-- ────────────────────────────────────────────────────────────────
-- 3. 個票（五つ組）
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subjects (
  project_id       UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sid              TEXT NOT NULL,
  first_seen_version_id UUID NOT NULL REFERENCES dataset_versions(id),
  canonical_sid    TEXT NOT NULL,                    -- 別名で寄せた代表 sid（自分自身なら同じ値）
  key_type         TEXT NOT NULL,                    -- どのキー種別から導出されたか（'atena'|'hihokensha'|…|'random'）
  link_confidence  TEXT NOT NULL DEFAULT 'exact' CHECK (link_confidence IN ('exact','probabilistic','unlinked')),
  PRIMARY KEY (project_id, sid)
);
CREATE INDEX IF NOT EXISTS idx_subjects_canonical ON subjects(project_id, canonical_sid);

CREATE TABLE IF NOT EXISTS sid_aliases (
  project_id       UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sid_a            TEXT NOT NULL,
  sid_b            TEXT NOT NULL,
  source_version_id UUID NOT NULL REFERENCES dataset_versions(id),
  reason           TEXT NOT NULL CHECK (reason IN ('bridge','key_rotation','plan_inherit')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, sid_a, sid_b)
);
COMMENT ON TABLE sid_aliases IS
  '仮名同士の「同一人物」ペア。誰かは分からない情報なので Coe に置ける。observations は canonical_sid で集計する';

CREATE TABLE IF NOT EXISTS observations (
  project_id       UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sid              TEXT NOT NULL,
  attr_key         TEXT NOT NULL REFERENCES attribute_definitions(key),
  observed_at      DATE NOT NULL,                    -- month なら月初、fiscal_year なら年度開始日、static なら 1900-01-01
  value_code       TEXT,
  value_num        NUMERIC,
  value_bool       BOOLEAN,
  dataset_version_id UUID NOT NULL REFERENCES dataset_versions(id),
  PRIMARY KEY (project_id, sid, attr_key, observed_at),
  -- 値は必ず1列だけ
  CONSTRAINT observations_one_value_chk CHECK (num_nonnulls(value_code, value_num, value_bool) = 1)
);
CREATE INDEX IF NOT EXISTS idx_observations_attr ON observations(project_id, attr_key, observed_at);
COMMENT ON TABLE observations IS
  '五つ組（誰・何・いつ・値・出所）。自由記述列も、氏名・住所・生年月日・電話・被保険者番号の列も無い';

-- ────────────────────────────────────────────────────────────────
-- 4. 対象群・割付・逆引き
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cohorts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_cohort_id UUID REFERENCES cohorts(id) ON DELETE SET NULL,   -- 取組の対象は主要施策の対象群の部分集合
  measure_design_id UUID REFERENCES measure_designs(id) ON DELETE SET NULL,
  measure_work_id  UUID REFERENCES measure_works(id) ON DELETE SET NULL,
  name             TEXT NOT NULL,
  role             TEXT NOT NULL DEFAULT 'target' CHECK (role IN ('population','target','comparison')),
  definition       JSONB NOT NULL DEFAULT '{}',      -- 抽出条件を辞書キーで: {"care.level":["support1","support2"]}
  as_of            DATE NOT NULL,
  k_threshold      INTEGER NOT NULL DEFAULT 10,
  l_threshold      INTEGER NOT NULL DEFAULT 2,
  k_observed       INTEGER,
  row_count        INTEGER,
  suppressed_count INTEGER,
  keying_scope     TEXT NOT NULL DEFAULT 'project' CHECK (keying_scope IN ('project','inherited')),
  key_holder       TEXT NOT NULL DEFAULT '',         -- 鍵の保管責任者・代理者（文字列。Coe は鍵を持たない）
  retention_until  DATE,
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','shredded')),
  created_by       UUID,
  created_via      TEXT NOT NULL DEFAULT 'ui',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cohorts_project ON cohorts(project_id);

CREATE TABLE IF NOT EXISTS cohort_members (
  cohort_id        UUID NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
  sid              TEXT NOT NULL,
  added_version_id UUID REFERENCES dataset_versions(id),
  PRIMARY KEY (cohort_id, sid)
);

CREATE TABLE IF NOT EXISTS experiment_assignments (
  cohort_id        UUID NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
  sid              TEXT NOT NULL,
  arm              TEXT NOT NULL,                    -- 'treatment'|'control'|'wave1'…
  stratum          TEXT,
  cluster_key      TEXT,
  seed_digest      TEXT NOT NULL,                    -- 割付の再現性（同一シードで同一結果）
  assigned_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (cohort_id, sid)
);
COMMENT ON TABLE experiment_assignments IS
  'Coe が生成する割付。事前登録の代わりなので UPDATE/DELETE はアプリ層で禁止する';

CREATE TABLE IF NOT EXISTS release_requests (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_id        UUID NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
  sid_list_digest  TEXT NOT NULL,
  sid_count        INTEGER NOT NULL,
  purpose          TEXT NOT NULL,                    -- 逆引きには必ず目的を記録する
  requested_by     UUID,
  approved_by      UUID,
  approved_at      TIMESTAMPTZ,
  fulfilled_at     TIMESTAMPTZ,
  result_counts    JSONB,                            -- 庁内から返る件数だけ（送付 n・返戻 n）
  note             TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ────────────────────────────────────────────────────────────────
-- 5. 操作履歴（人が画面から操作しても AI が操作しても同じ形で残す — 設計 §10-5）
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS activity_log (
  id               BIGSERIAL PRIMARY KEY,
  project_id       UUID REFERENCES projects(id) ON DELETE CASCADE,
  municipality_id  UUID REFERENCES municipalities(id) ON DELETE CASCADE,
  actor            UUID,                             -- user_roles.id。AI 操作でも actor はその対話の担当者
  via              TEXT NOT NULL CHECK (via IN ('ui','bulk','gap_analysis','dialogue','evaluation','auto_tasks','migration')),
  dialogue_ref     JSONB,                            -- via='dialogue' のとき {dialogue_kind, dialogue_id, turn_no}
  entity           TEXT NOT NULL,                    -- 'dataset'|'dataset_version'|'indicator'|'indicator_target'|'indicator_value'|'cohort'|…
  entity_id        TEXT NOT NULL,
  action           TEXT NOT NULL,                    -- 'create'|'update'|'compute'|'download'|'reject'|…
  summary          JSONB NOT NULL DEFAULT '{}',
  at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_activity_log_entity ON activity_log(entity, entity_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_project ON activity_log(project_id, at DESC);

-- ────────────────────────────────────────────────────────────────
-- 6. 自治体の鍵 ID（鍵そのものは Coe に無い — 設計 §6-3・§6-5）
-- ────────────────────────────────────────────────────────────────
ALTER TABLE municipalities ADD COLUMN IF NOT EXISTS key_id TEXT;
ALTER TABLE municipalities ADD COLUMN IF NOT EXISTS key_holder JSONB;   -- {holder, deputy, location, registered_at}
ALTER TABLE municipalities ADD COLUMN IF NOT EXISTS individual_data_enabled BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN municipalities.key_id IS
  '庁内の鍵のダイジェスト先頭8桁。この鍵 ID を持たない個票の出力は取込を拒否する。鍵そのものは Coe に無い';

-- ────────────────────────────────────────────────────────────────
-- 7. テンプレート（dataset_definitions）に種別と列定義を持たせる
-- ────────────────────────────────────────────────────────────────
ALTER TABLE dataset_definitions ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'aggregate'
  CHECK (kind IN ('aggregate','individual'));
ALTER TABLE dataset_definitions ADD COLUMN IF NOT EXISTS column_schema JSONB;
ALTER TABLE dataset_definitions ADD COLUMN IF NOT EXISTS attr_keys TEXT[];
ALTER TABLE dataset_definitions ADD COLUMN IF NOT EXISTS time_granularity TEXT NOT NULL DEFAULT 'fiscal_year';

UPDATE dataset_definitions SET column_schema = '[
  {"name":"地域名","role":"dimension","type":"text"},
  {"name":"調査年","role":"time","type":"year"},
  {"name":"設問番号","role":"dimension","type":"text"},
  {"name":"選択肢","role":"dimension","type":"text"},
  {"name":"回答数","role":"measure","type":"int"},
  {"name":"割合","role":"measure","type":"numeric"}]'::jsonb WHERE id = 'needs_survey';
UPDATE dataset_definitions SET column_schema = '[
  {"name":"要介護度区分","role":"dimension","type":"text"},
  {"name":"設問","role":"dimension","type":"text"},
  {"name":"回答割合","role":"measure","type":"numeric"}]'::jsonb WHERE id = 'home_care_survey';
UPDATE dataset_definitions SET column_schema = '[
  {"name":"年度","role":"time","type":"fiscal_year"},
  {"name":"月","role":"dimension","type":"text","required":false},
  {"name":"第1号被保険者数","role":"measure","type":"int"},
  {"name":"認定者数","role":"measure","type":"int"},
  {"name":"認定率","role":"measure","type":"numeric"},
  {"name":"受給者数","role":"measure","type":"int"},
  {"name":"受給率","role":"measure","type":"numeric"},
  {"name":"給付費","role":"measure","type":"numeric"}]'::jsonb WHERE id = 'care_insurance_report';
UPDATE dataset_definitions SET column_schema = '[
  {"name":"指標名","role":"dimension","type":"text"},
  {"name":"自市町村値","role":"measure","type":"numeric"},
  {"name":"都道府県平均","role":"measure","type":"numeric"},
  {"name":"全国平均","role":"measure","type":"numeric"},
  {"name":"年度","role":"time","type":"fiscal_year"}]'::jsonb WHERE id = 'mieruka_export';
UPDATE dataset_definitions SET column_schema = '[
  {"name":"調査年","role":"time","type":"year"},
  {"name":"指標名","role":"dimension","type":"text"},
  {"name":"値","role":"measure","type":"numeric"},
  {"name":"単位","role":"dimension","type":"text","required":false}]'::jsonb WHERE id = 'residence_change_survey';
UPDATE dataset_definitions SET column_schema = '[
  {"name":"年","role":"time","type":"year"},
  {"name":"死亡場所","role":"dimension","type":"text"},
  {"name":"死亡者数","role":"measure","type":"int"}]'::jsonb WHERE id = 'vital_statistics';
UPDATE dataset_definitions SET column_schema = '[
  {"name":"指標","role":"dimension","type":"text"},
  {"name":"自市町村値","role":"measure","type":"numeric"},
  {"name":"比較対照値","role":"measure","type":"numeric"},
  {"name":"出典","role":"dimension","type":"text","required":false}]'::jsonb WHERE id = 'jages_data';
UPDATE dataset_definitions SET column_schema = '[
  {"name":"調査年","role":"time","type":"year"},
  {"name":"指標名","role":"dimension","type":"text"},
  {"name":"値","role":"measure","type":"numeric"},
  {"name":"分母","role":"measure","type":"numeric"}]'::jsonb WHERE id = 'dementia_medical_data';
UPDATE dataset_definitions SET column_schema = '[
  {"name":"施設名","role":"dimension","type":"text"},
  {"name":"所在地","role":"dimension","type":"text"},
  {"name":"入居定員","role":"measure","type":"int"},
  {"name":"要介護者数","role":"measure","type":"int"},
  {"name":"調査時点","role":"time","type":"date"}]'::jsonb, time_granularity = 'day' WHERE id = 'elder_housing_data';
UPDATE dataset_definitions SET column_schema = '[
  {"name":"事業所名","role":"dimension","type":"text"},
  {"name":"サービス種別","role":"dimension","type":"text"},
  {"name":"所在圏域","role":"dimension","type":"text"},
  {"name":"定員","role":"measure","type":"int"},
  {"name":"稼働率","role":"measure","type":"numeric"}]'::jsonb WHERE id = 'care_service_providers';
UPDATE dataset_definitions SET column_schema = '[
  {"name":"職種","role":"dimension","type":"text"},
  {"name":"現状職員数","role":"measure","type":"int"},
  {"name":"2025年推計","role":"measure","type":"int"},
  {"name":"2040年推計","role":"measure","type":"int"},
  {"name":"不足見込み数","role":"measure","type":"int"}]'::jsonb WHERE id = 'care_workforce_data';
UPDATE dataset_definitions SET column_schema = '[
  {"name":"主要施策名","role":"dimension","type":"text"},
  {"name":"年度","role":"time","type":"fiscal_year"},
  {"name":"人件費","role":"measure","type":"numeric"},
  {"name":"事業費","role":"measure","type":"numeric"},
  {"name":"給付費実績","role":"measure","type":"numeric"}]'::jsonb WHERE id = 'insurance_finance_data';

-- 匿名化された要介護認定者一覧 → 個票種別へ。列定義ではなく属性辞書のキー集合で定義し直す。
-- （旧定義は「匿名ID・年齢の生値・認定年月」を無検証で受けていた。以後は変換ツールを通したものだけ）
UPDATE dataset_definitions SET
  kind = 'individual',
  display_name = '要介護認定者（個票）',
  description = '要介護認定者の個票。庁内の変換ツールで仮名化・帯域化したものだけを取り込む（要介護度・認知症自立度・障害自立度・性別・年齢階級・圏域）',
  required_columns = ARRAY['sid','attr_key','observed_at','value'],
  attr_keys = ARRAY['care.level','health.dementia_level','health.adl_level','demo.sex','demo.age_band5','demo.area','demo.status'],
  time_granularity = 'month',
  data_sensitivity = 'individual'
WHERE id = 'care_cert_anonymized';

-- ────────────────────────────────────────────────────────────────
-- 8. 既存 project_datasets の移行（箱1つ＋版1つ。ファイルの参照だけ引き継ぐ）
-- ────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.project_datasets') IS NOT NULL THEN
    -- 箱: project × 定義 ごとに1つ（既に同名の箱があれば作らない）
    INSERT INTO datasets (project_id, kind, name, description, template_id, schema, time_granularity, created_via, created_at)
    SELECT DISTINCT ON (pd.project_id, pd.dataset_def_id)
           pd.project_id,
           dd.kind,
           dd.display_name,
           dd.description,
           dd.id,
           CASE WHEN dd.kind = 'individual'
                THEN jsonb_build_object('attr_keys', to_jsonb(COALESCE(dd.attr_keys, ARRAY[]::text[])))
                ELSE COALESCE(dd.column_schema, '[]'::jsonb) END,
           dd.time_granularity,
           'migration',
           MIN(pd.uploaded_at) OVER (PARTITION BY pd.project_id, pd.dataset_def_id)
    FROM project_datasets pd
    JOIN dataset_definitions dd ON dd.id = pd.dataset_def_id
    WHERE NOT EXISTS (
      SELECT 1 FROM datasets d WHERE d.project_id = pd.project_id AND d.template_id = pd.dataset_def_id
    )
    ORDER BY pd.project_id, pd.dataset_def_id, pd.uploaded_at;

    -- 版: 元の1行 = 1版。ingest_key に旧 id を入れて再実行しても増えないようにする
    INSERT INTO dataset_versions
      (dataset_id, as_of, file_name, storage_path, file_size_bytes, ingest_key, status, row_count,
       note, uploaded_by, uploaded_via, uploaded_at)
    SELECT d.id,
           COALESCE(make_date(pd.survey_year, 3, 31), pd.uploaded_at::date),
           pd.file_name, pd.s3_key, pd.file_size_bytes,
           'legacy:' || pd.id::text,
           CASE WHEN dd.kind = 'individual' THEN 'rejected' ELSE COALESCE(pd.status, 'pending') END,
           pd.row_count,
           CASE WHEN dd.kind = 'individual'
                THEN '旧経路（無検証の個票アップロード）のファイル。個票は庁内の変換ツールを通して上げ直してください'
                ELSE '066 で project_datasets から移行。列定義が無いため行は取り込んでいない' END,
           pd.uploaded_by, 'migration', pd.uploaded_at
    FROM project_datasets pd
    JOIN dataset_definitions dd ON dd.id = pd.dataset_def_id
    JOIN datasets d ON d.project_id = pd.project_id AND d.template_id = pd.dataset_def_id
    WHERE NOT EXISTS (SELECT 1 FROM dataset_versions v WHERE v.ingest_key = 'legacy:' || pd.id::text);
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────
-- 9. 共通辞書の初期投入（介護保険）。正本は app/src/lib/dataset/dictionary.ts（DICTIONARY_VERSION=1）。
--    check:dataset が「正本のキーがすべてここにあること」を検査する。改訂時は両方を更新する
-- ────────────────────────────────────────────────────────────────
INSERT INTO attribute_definitions
  (key, label, description, value_type, codes, unit, role, generalization, time_granularity, cloud_allowed, source_hints, version)
VALUES
  ('demo.age_band5', '年齢（5歳階級）', '基準日時点の年齢を5歳階級にしたもの。生年月日そのものは持ち込めない', 'band', '{"u40":"40歳未満","40-44":"40-44歳","45-49":"45-49歳","50-54":"50-54歳","55-59":"55-59歳","60-64":"60-64歳","65-69":"65-69歳","70-74":"70-74歳","75-79":"75-79歳","80-84":"80-84歳","85-89":"85-89歳","90-94":"90-94歳","95-99":"95-99歳","100+":"100歳以上"}'::jsonb, NULL, 'quasi_identifier', '{"priority":2,"levels":[{"label":"10歳階級","map":{"u40":"u40","40-44":"40-49","45-49":"40-49","50-54":"50-59","55-59":"50-59","60-64":"60-69","65-69":"60-69","70-74":"70-79","75-79":"70-79","80-84":"80-89","85-89":"80-89","90-94":"90+","95-99":"90+","100+":"90+"}},{"label":"前期／後期","map":{"u40":"u65","40-49":"u65","50-59":"u65","60-69":"u65_or_65-74","70-79":"65-74_or_75+","80-89":"75+","90+":"75+"}}]}'::jsonb, 'fiscal_year', true, '["生年月日","年齢"]'::jsonb, 1),
  ('demo.sex', '性別', 'M / F / X', 'code', '{"M":"男性","F":"女性","X":"その他・不明"}'::jsonb, NULL, 'quasi_identifier', '{"priority":3,"levels":[{"label":"削除","map":{"M":"*","F":"*","X":"*"}}]}'::jsonb, 'static', true, '["性別"]'::jsonb, 1),
  ('demo.area', '日常生活圏域', '居住地の日常生活圏域。町丁目より細かい区分は持ち込めない（テナント拡張で圏域名を定義する）', 'code', '{"area01":"圏域1","area02":"圏域2","area03":"圏域3","area04":"圏域4","area05":"圏域5","area06":"圏域6","area07":"圏域7","area08":"圏域8","area09":"圏域9","area10":"圏域10"}'::jsonb, NULL, 'quasi_identifier', '{"priority":1,"levels":[{"label":"全域","map":{"area01":"*","area02":"*","area03":"*","area04":"*","area05":"*","area06":"*","area07":"*","area08":"*","area09":"*","area10":"*"}}]}'::jsonb, 'fiscal_year', true, '["圏域","日常生活圏域","地区"]'::jsonb, 1),
  ('care.level', '要介護度', '基準日時点の要介護認定の区分。経年比較（維持改善率）はこの属性の2時点で計算する', 'code', '{"none":"非該当","target":"事業対象者","support1":"要支援1","support2":"要支援2","care1":"要介護1","care2":"要介護2","care3":"要介護3","care4":"要介護4","care5":"要介護5"}'::jsonb, NULL, 'quasi_identifier', '{"priority":4,"levels":[{"label":"5区分（非該当／事業対象者／要支援／要介護1-2／要介護3-5）","map":{"none":"none","target":"target","support1":"support","support2":"support","care1":"care12","care2":"care12","care3":"care345","care4":"care345","care5":"care345"}},{"label":"認定有無","map":{"none":"no_cert","target":"no_cert","support":"cert","care12":"cert","care345":"cert"}}]}'::jsonb, 'month', true, '["要介護度","認定区分","要介護状態区分"]'::jsonb, 1),
  ('house.type', '世帯類型', '独居／高齢者のみ世帯／同居あり', 'code', '{"alone":"独居","elderly_only":"高齢者のみ","with_others":"同居あり"}'::jsonb, NULL, 'quasi_identifier', '{"priority":2,"levels":[{"label":"独居か否か","map":{"alone":"alone","elderly_only":"not_alone","with_others":"not_alone"}}]}'::jsonb, 'fiscal_year', true, '["世帯類型","世帯構成"]'::jsonb, 1),
  ('econ.premium_band', '保険料段階（帯）', '第1号保険料の所得段階を3帯にしたもの', 'band', '{"b1_3":"第1〜3段階","b4_6":"第4〜6段階","b7_":"第7段階以上"}'::jsonb, NULL, 'sensitive', '{"priority":1,"levels":[{"label":"削除","map":{"b1_3":"*","b4_6":"*","b7_":"*"}}]}'::jsonb, 'fiscal_year', true, '["保険料段階","所得段階"]'::jsonb, 1),
  ('health.dementia_level', '認知症高齢者の日常生活自立度', '認定調査・主治医意見書の区分', 'code', '{"none":"自立","I":"Ⅰ","IIa":"Ⅱa","IIb":"Ⅱb","IIIa":"Ⅲa","IIIb":"Ⅲb","IV":"Ⅳ","M":"M"}'::jsonb, NULL, 'sensitive', '{"priority":1,"levels":[{"label":"3区分","map":{"none":"none","I":"I_II","IIa":"I_II","IIb":"I_II","IIIa":"III+","IIIb":"III+","IV":"III+","M":"III+"}}]}'::jsonb, 'month', true, '["認知症自立度","認知症高齢者の日常生活自立度"]'::jsonb, 1),
  ('health.adl_level', '障害高齢者の日常生活自立度', '認定調査・主治医意見書の区分', 'code', '{"none":"自立","J1":"J1","J2":"J2","A1":"A1","A2":"A2","B1":"B1","B2":"B2","C1":"C1","C2":"C2"}'::jsonb, NULL, 'sensitive', '{"priority":1,"levels":[{"label":"3区分","map":{"none":"none","J1":"J","J2":"J","A1":"A","A2":"A","B1":"B_C","B2":"B_C","C1":"B_C","C2":"B_C"}}]}'::jsonb, 'month', true, '["障害自立度","障害高齢者の日常生活自立度"]'::jsonb, 1),
  ('prog.participated', '事業への参加歴', '対象事業に参加した（有無）', 'bool', NULL, NULL, 'exposure', NULL, 'fiscal_year', true, '["参加","参加歴","利用歴"]'::jsonb, 1),
  ('outcome.cert_new', '新規認定の発生', '当該年度に要支援・要介護の新規認定を受けた（有無）', 'bool', NULL, NULL, 'outcome', NULL, 'fiscal_year', true, '["新規認定","認定申請区分"]'::jsonb, 1),
  ('outcome.checkup_attended', '健診受診', '当該年度に特定健診等を受診した（有無）', 'bool', NULL, NULL, 'outcome', NULL, 'fiscal_year', true, '["健診受診","受診有無"]'::jsonb, 1),
  ('outcome.benefit_amount', '介護給付費（年額）', '当該年度の介護給付費の合計（円）', 'int', NULL, '円', 'outcome', NULL, 'fiscal_year', true, '["給付費","給付額"]'::jsonb, 1),
  ('outcome.hospitalized', '入院の発生', '当該年度に入院した（有無）', 'bool', NULL, NULL, 'outcome', NULL, 'fiscal_year', true, '["入院"]'::jsonb, 1),
  ('demo.status', '資格の状態', '基準日時点で、在住／転出／死亡のどれか。追跡の打ち切り（センサリング）に使う', 'code', '{"active":"在住","moved_out":"転出","deceased":"死亡"}'::jsonb, NULL, 'neutral', NULL, 'month', true, '["資格喪失事由","異動事由"]'::jsonb, 1),
  ('id.address_code', '町丁目コード（庁内限定）', '日常生活圏域（demo.area）を導くための入力。**Coe には出ない**', 'code', '{}'::jsonb, NULL, 'quasi_identifier', '{"priority":0,"levels":[]}'::jsonb, 'fiscal_year', false, '["町丁目コード","住所コード"]'::jsonb, 1)
ON CONFLICT (key) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description, value_type = EXCLUDED.value_type,
  codes = EXCLUDED.codes, unit = EXCLUDED.unit, role = EXCLUDED.role, generalization = EXCLUDED.generalization,
  time_granularity = EXCLUDED.time_granularity, cloud_allowed = EXCLUDED.cloud_allowed,
  source_hints = EXCLUDED.source_hints, version = EXCLUDED.version, updated_at = now()
WHERE attribute_definitions.municipality_id IS NULL;
