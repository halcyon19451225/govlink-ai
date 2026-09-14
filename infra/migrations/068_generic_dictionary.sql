-- ================================================================
-- Migration 068: 属性辞書の汎用化（コア／分野パック／テナント拡張）とキー種別の登録簿
-- ================================================================
--
-- 設計: claude/coe-dataset-model.md §5-1・§6-5
--
-- なぜ必要か
-- ----------
--   066 で入れた共通辞書は介護保険の語彙（要介護度・認知症自立度・保険料段階…）を
--   plan_types 無しで持っており、**どの分野の計画でもその属性が出てしまう**状態だった。
--   Coe は特定分野の SaaS ではないので、これは誤り。辞書を3層に分ける。
--
--     ① コア        … どの分野でも意味が変わらない属性（plan_types = {}）
--     ② 分野パック  … その計画種別のときだけ出る属性（plan_types にその分野）
--     ③ テナント拡張 … その自治体だけの属性、または ①② の値の語彙の上書き
--
--   同じくキー種別（宛名番号・各業務システムの番号）も、分野と自治体で違うので
--   コードに列挙せず `key_type_definitions` に登録する。コアが持つのは正規化の「型」だけ。
--
-- 個人情報について
-- ----------------
--   3層になっても、値の型に自由記述は無く、observations に入る属性は
--   `attribute_keys` に登録されたキーに限られる（DB が拒否する）という保証は変わらない。

-- ────────────────────────────────────────────────────────────────
-- 1. 属性キーの登録簿（observations の外部キー先）
-- ────────────────────────────────────────────────────────────────
--   辞書の定義は自治体ごとに違いうる（同じ「地区」でも値の語彙が違う）ため、
--   attribute_definitions は (key, municipality_id) で一意になる。
--   一方 observations.attr_key は「そのキーが辞書に存在すること」だけを担保すればよい。
--   そこでキーの集合だけを別に持ち、外部キーはここを指す。
CREATE TABLE IF NOT EXISTS attribute_keys (
  key        TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE attribute_keys IS
  '属性キーの登録簿。observations.attr_key の参照先。辞書に無い情報は DB が拒否する、という保証の要';

INSERT INTO attribute_keys (key)
SELECT DISTINCT key FROM attribute_definitions
ON CONFLICT (key) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'observations_attr_key_fkey') THEN
    ALTER TABLE observations DROP CONSTRAINT observations_attr_key_fkey;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'observations_attr_key_registry_fkey') THEN
    ALTER TABLE observations
      ADD CONSTRAINT observations_attr_key_registry_fkey
      FOREIGN KEY (attr_key) REFERENCES attribute_keys(key);
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────
-- 2. attribute_definitions を (key, municipality_id) 一意にする
-- ────────────────────────────────────────────────────────────────
--   ⚠ PostgreSQL 15 以上の UNIQUE NULLS NOT DISTINCT を使う（共通行は municipality_id が NULL で、
--     NULL 同士も「同じ」と扱ってほしいため）。Aurora Serverless v2 は PostgreSQL 15 互換。
ALTER TABLE attribute_definitions ADD COLUMN IF NOT EXISTS local_codes BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE attribute_definitions ADD COLUMN IF NOT EXISTS id UUID NOT NULL DEFAULT gen_random_uuid();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attribute_definitions_pkey'
               AND conrelid = 'attribute_definitions'::regclass
               AND pg_get_constraintdef(oid) = 'PRIMARY KEY (key)') THEN
    ALTER TABLE attribute_definitions DROP CONSTRAINT attribute_definitions_pkey;
    ALTER TABLE attribute_definitions ADD CONSTRAINT attribute_definitions_pkey PRIMARY KEY (id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attribute_definitions_key_muni_uq') THEN
    ALTER TABLE attribute_definitions
      ADD CONSTRAINT attribute_definitions_key_muni_uq UNIQUE NULLS NOT DISTINCT (key, municipality_id);
  END IF;
END $$;

COMMENT ON COLUMN attribute_definitions.plan_types IS
  '空＝どの分野でも使える（コア辞書）。値あり＝その計画種別のときだけ出る（分野パック）。分野を固定しないための鍵';
COMMENT ON COLUMN attribute_definitions.local_codes IS
  'true のとき、値の語彙（codes）は自治体ごとに違うので、テナントが登録して初めて使える（例: 地区の区分）';

-- ────────────────────────────────────────────────────────────────
-- 3. キー種別の登録簿
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS key_type_definitions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            TEXT NOT NULL,                    -- sid の導出に入る。登録後は変えられない
  municipality_id UUID REFERENCES municipalities(id) ON DELETE CASCADE,  -- NULL = 共通
  label           TEXT NOT NULL,
  description     TEXT,
  -- {style:'digits'|'alnum'|'alnum_sep', zeroPad?, minLength?, maxLength?}
  normalization   JSONB NOT NULL,
  -- 箱をまたぐ突合の軸にする主キーか（自治体につき1つを推奨）
  is_primary      BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT key_type_definitions_code_muni_uq UNIQUE NULLS NOT DISTINCT (code, municipality_id),
  CONSTRAINT key_type_definitions_code_chk CHECK (code ~ '^[a-z][a-z0-9_]{0,29}$')
);
COMMENT ON TABLE key_type_definitions IS
  '庁内キーの語彙。どの業務システムのどの番号を仮名化の入力にするかは分野・自治体で違うので、コードに列挙せずここに登録する。個人番号は登録できない（guard が値を拒否する）';

-- 共通は1件だけ。団体内統合宛名番号は、どの分野でも業務横断の軸になりうる唯一のキー
INSERT INTO key_type_definitions (code, municipality_id, label, description, normalization, is_primary)
VALUES (
  'atena', NULL, '宛名番号',
  '団体内統合宛名番号。業務システムをまたいで同じ人を指すため、箱をまたぐ突合の軸に使う。出力できない帳票は、別のキー種別を登録して橋渡しする',
  '{"style":"digits","maxLength":15}'::jsonb, true
)
ON CONFLICT (code, municipality_id) DO NOTHING;

-- ────────────────────────────────────────────────────────────────
-- 4. 計画種別の既定値を分野中立にする
-- ────────────────────────────────────────────────────────────────
--   010/011 で projects.plan_type の既定が 'kaigo_hoken' になっていた。
--   新しく作る計画が既定で介護保険になるのは、分野を固定する要素そのもの。
--   **既存の行は触らない**（実際にその分野の計画なので）。
ALTER TABLE projects ALTER COLUMN plan_type SET DEFAULT 'custom';
COMMENT ON COLUMN projects.plan_type IS
  '計画種別。分野パック（属性辞書・テンプレート）の選択に使う。既定は custom（分野指定なし）';

-- ────────────────────────────────────────────────────────────────
-- 5. 共通辞書の入れ替え（コア＋分野パック）
-- ────────────────────────────────────────────────────────────────
--   066 が入れた共通行のうち、コアにもどの分野パックにも無いキーは落とす。
--   ただし **observations から参照されている行は落とさない**（データが先にあれば残す）。
--   §6 の投入（下）を先に行い、そのあとで掃除する。

-- ── 6. コア辞書＋分野パックの投入（共通行 = municipality_id IS NULL）─────────
--    正本は app/src/lib/dataset/dictionary.ts（コア）と app/src/lib/dataset/domains/（分野パック）。
--    DICTIONARY_VERSION = 2。check:dataset が正本とこの投入の一致を検査する。
--    分野パック: kaigo_hoken（介護保険事業計画） / kosodate（子ども・子育て支援事業計画・初期セット）

INSERT INTO attribute_keys (key)
VALUES ('demo.age_band5'), ('demo.sex'), ('demo.area'), ('house.size_band'), ('econ.income_band'), ('prog.participated'), ('prog.notified'), ('outcome.service_used'), ('outcome.cost_amount'), ('demo.status'), ('id.address_code'), ('care.level'), ('health.dementia_level'), ('health.adl_level'), ('econ.premium_band'), ('outcome.cert_new'), ('outcome.checkup_attended'), ('outcome.hospitalized'), ('child.age_class'), ('child.certification'), ('house.work_status'), ('outcome.waitlisted'), ('outcome.enrolled')
ON CONFLICT (key) DO NOTHING;

INSERT INTO attribute_definitions
  (key, municipality_id, label, description, value_type, codes, unit, role, generalization,
   time_granularity, cloud_allowed, source_hints, plan_types, local_codes, version)
SELECT v.key, NULL, v.label, v.description, v.value_type, v.codes, v.unit, v.role, v.generalization,
       v.time_granularity, v.cloud_allowed, v.source_hints, v.plan_types, v.local_codes, v.version
FROM (VALUES
  ('demo.age_band5', '年齢（5歳階級）', '基準日時点の年齢を5歳階級にしたもの。生年月日そのものは持ち込めない', 'band', '{"u20":"20歳未満","20-24":"20-24歳","25-29":"25-29歳","30-34":"30-34歳","35-39":"35-39歳","40-44":"40-44歳","45-49":"45-49歳","50-54":"50-54歳","55-59":"55-59歳","60-64":"60-64歳","65-69":"65-69歳","70-74":"70-74歳","75-79":"75-79歳","80-84":"80-84歳","85-89":"85-89歳","90-94":"90-94歳","95-99":"95-99歳","100+":"100歳以上"}'::jsonb, NULL, 'quasi_identifier', '{"priority":2,"levels":[{"label":"10歳階級","map":{"u20":"u20","20-24":"20-29","25-29":"20-29","30-34":"30-39","35-39":"30-39","40-44":"40-49","45-49":"40-49","50-54":"50-59","55-59":"50-59","60-64":"60-69","65-69":"60-69","70-74":"70-79","75-79":"70-79","80-84":"80-89","85-89":"80-89","90-94":"90+","95-99":"90+","100+":"90+"}},{"label":"20歳階級","map":{"u20":"u20","20-29":"20-39","30-39":"20-39","40-49":"40-59","50-59":"40-59","60-69":"60-79","70-79":"60-79","80-89":"80+","90+":"80+"}}]}'::jsonb, 'fiscal_year', true, '["生年月日","年齢"]'::jsonb, ARRAY[]::text[], false, 2),
  ('demo.sex', '性別', 'M / F / X（その他・不明）', 'code', '{"M":"男性","F":"女性","X":"その他・不明"}'::jsonb, NULL, 'quasi_identifier', '{"priority":3,"levels":[{"label":"削除","collapseTo":"*"}]}'::jsonb, 'static', true, '["性別"]'::jsonb, ARRAY[]::text[], false, 2),
  ('demo.area', '地区', '居住地の区分。どんな区分を使うか（日常生活圏域・小学校区・支所管内など）は自治体ごとに違うため、値の語彙は自治体が登録する。町丁目より細かい区分は登録できない', 'code', '{}'::jsonb, NULL, 'quasi_identifier', '{"priority":1,"levels":[{"label":"全域","collapseTo":"*"}]}'::jsonb, 'fiscal_year', true, '["地区","圏域","区分"]'::jsonb, ARRAY[]::text[], true, 2),
  ('house.size_band', '世帯人数（帯）', '基準日時点の同一世帯の人数', 'band', '{"s1":"1人","s2":"2人","s3_4":"3〜4人","s5":"5人以上"}'::jsonb, NULL, 'quasi_identifier', '{"priority":2,"levels":[{"label":"単身か否か","map":{"s1":"s1","s2":"s2+","s3_4":"s2+","s5":"s2+"}}]}'::jsonb, 'fiscal_year', true, '["世帯人数","世帯員数"]'::jsonb, ARRAY[]::text[], false, 2),
  ('econ.income_band', '所得の段階（帯）', '所得・課税の区分を3段階に粗化したもの。どの区分を低・中・高に当てるかは自治体が決める（制度上の段階をそのまま持ち込まない）', 'band', '{"low":"低","mid":"中","high":"高"}'::jsonb, NULL, 'sensitive', '{"priority":1,"levels":[{"label":"削除","collapseTo":"*"}]}'::jsonb, 'fiscal_year', true, '["所得段階","課税区分"]'::jsonb, ARRAY[]::text[], false, 2),
  ('prog.participated', '事業への参加', '対象の事業・サービスに参加した（有無）', 'bool', NULL, NULL, 'exposure', NULL, 'fiscal_year', true, '["参加","参加歴","受講"]'::jsonb, ARRAY[]::text[], false, 2),
  ('prog.notified', '案内・勧奨の到達', '案内や勧奨が届いた（有無）。実験の割付と実際の到達を分けて見るために使う', 'bool', NULL, NULL, 'exposure', NULL, 'fiscal_year', true, '["通知","勧奨","案内"]'::jsonb, ARRAY[]::text[], false, 2),
  ('outcome.service_used', 'サービス・制度の利用', '当該期間にサービス・制度を利用した（有無）', 'bool', NULL, NULL, 'outcome', NULL, 'fiscal_year', true, '["利用","受給"]'::jsonb, ARRAY[]::text[], false, 2),
  ('outcome.cost_amount', '費用額（年額）', '当該年度に公費・保険等から支出された額の合計（円）', 'int', NULL, '円', 'outcome', NULL, 'fiscal_year', true, '["費用","支給額","支出額"]'::jsonb, ARRAY[]::text[], false, 2),
  ('demo.status', '対象としての状態', '基準日時点で追跡の対象に含まれるか。転出・死亡・対象外は打ち切り（センサリング）として扱う', 'code', '{"active":"対象として在籍","moved_out":"転出","deceased":"死亡","out_of_scope":"対象外になった"}'::jsonb, NULL, 'neutral', NULL, 'month', true, '["異動事由","資格喪失事由","状態"]'::jsonb, ARRAY[]::text[], false, 2),
  ('id.address_code', '住所コード（庁内限定）', '地区（demo.area）を導くための入力。**Coe には出ない**', 'code', '{}'::jsonb, NULL, 'quasi_identifier', '{"priority":0,"levels":[{"label":"地区へ丸める","collapseTo":"*"}]}'::jsonb, 'fiscal_year', false, '["住所コード","町丁目コード"]'::jsonb, ARRAY[]::text[], true, 2),
  ('care.level', '要介護度', '基準日時点の要介護認定の区分。経年比較（維持改善率）はこの属性の2時点で計算する', 'code', '{"none":"非該当","target":"事業対象者","support1":"要支援1","support2":"要支援2","care1":"要介護1","care2":"要介護2","care3":"要介護3","care4":"要介護4","care5":"要介護5"}'::jsonb, NULL, 'quasi_identifier', '{"priority":4,"levels":[{"label":"5区分（非該当／事業対象者／要支援／要介護1-2／要介護3-5）","map":{"none":"none","target":"target","support1":"support","support2":"support","care1":"care12","care2":"care12","care3":"care345","care4":"care345","care5":"care345"}},{"label":"認定の有無","map":{"none":"no_cert","target":"no_cert","support":"cert","care12":"cert","care345":"cert"}}]}'::jsonb, 'month', true, '["要介護度","認定区分","要介護状態区分"]'::jsonb, ARRAY['kaigo_hoken']::text[], false, 2),
  ('health.dementia_level', '認知症高齢者の日常生活自立度', '認定調査・主治医意見書の区分', 'code', '{"none":"自立","I":"Ⅰ","IIa":"Ⅱa","IIb":"Ⅱb","IIIa":"Ⅲa","IIIb":"Ⅲb","IV":"Ⅳ","M":"M"}'::jsonb, NULL, 'sensitive', '{"priority":1,"levels":[{"label":"3区分","map":{"none":"none","I":"I_II","IIa":"I_II","IIb":"I_II","IIIa":"III+","IIIb":"III+","IV":"III+","M":"III+"}}]}'::jsonb, 'month', true, '["認知症自立度","認知症高齢者の日常生活自立度"]'::jsonb, ARRAY['kaigo_hoken']::text[], false, 2),
  ('health.adl_level', '障害高齢者の日常生活自立度', '認定調査・主治医意見書の区分', 'code', '{"none":"自立","J1":"J1","J2":"J2","A1":"A1","A2":"A2","B1":"B1","B2":"B2","C1":"C1","C2":"C2"}'::jsonb, NULL, 'sensitive', '{"priority":1,"levels":[{"label":"3区分","map":{"none":"none","J1":"J","J2":"J","A1":"A","A2":"A","B1":"B_C","B2":"B_C","C1":"B_C","C2":"B_C"}}]}'::jsonb, 'month', true, '["障害自立度","障害高齢者の日常生活自立度"]'::jsonb, ARRAY['kaigo_hoken']::text[], false, 2),
  ('econ.premium_band', '保険料段階（帯）', '第1号被保険者の保険料段階を3帯にしたもの。段階をそのままの数字では持ち込まない', 'band', '{"b1_3":"第1〜3段階","b4_6":"第4〜6段階","b7_":"第7段階以上"}'::jsonb, NULL, 'sensitive', '{"priority":1,"levels":[{"label":"削除","collapseTo":"*"}]}'::jsonb, 'fiscal_year', true, '["保険料段階"]'::jsonb, ARRAY['kaigo_hoken']::text[], false, 2),
  ('outcome.cert_new', '新規認定の発生', '当該年度に要支援・要介護の新規認定を受けた（有無）', 'bool', NULL, NULL, 'outcome', NULL, 'fiscal_year', true, '["新規認定","認定申請区分"]'::jsonb, ARRAY['kaigo_hoken']::text[], false, 2),
  ('outcome.checkup_attended', '健診受診', '当該年度に健診を受診した（有無）', 'bool', NULL, NULL, 'outcome', NULL, 'fiscal_year', true, '["健診受診","受診有無"]'::jsonb, ARRAY['kaigo_hoken']::text[], false, 2),
  ('outcome.hospitalized', '入院の発生', '当該年度に入院した（有無）', 'bool', NULL, NULL, 'outcome', NULL, 'fiscal_year', true, '["入院"]'::jsonb, ARRAY['kaigo_hoken']::text[], false, 2),
  ('child.age_class', '児童の年齢区分', '基準日時点の児童の年齢区分。年齢そのもの（demo.age_band5）とは別に、制度上の区分で持つ', 'code', '{"age0":"0歳","age1_2":"1〜2歳","age3_5":"3〜5歳","school":"就学児"}'::jsonb, NULL, 'quasi_identifier', '{"priority":2,"levels":[{"label":"就学前／就学","map":{"age0":"pre_school","age1_2":"pre_school","age3_5":"pre_school","school":"school"}}]}'::jsonb, 'fiscal_year', true, '["年齢区分","クラス"]'::jsonb, ARRAY['kosodate']::text[], false, 2),
  ('child.certification', '支給認定の区分', '子ども・子育て支援法に基づく認定区分', 'code', '{"type1":"1号（教育標準時間）","type2":"2号（満3歳以上・保育）","type3":"3号（満3歳未満・保育）","none":"認定なし"}'::jsonb, NULL, 'quasi_identifier', '{"priority":3,"levels":[{"label":"保育の必要性の有無","map":{"type1":"no_need","none":"no_need","type2":"need","type3":"need"}}]}'::jsonb, 'fiscal_year', true, '["認定区分","支給認定"]'::jsonb, ARRAY['kosodate']::text[], false, 2),
  ('house.work_status', '保護者の就労状況', '世帯の就労の形。個人の勤務先や職種は持ち込まない', 'code', '{"dual":"両方就労","single":"一方が就労","none":"就労なし","other":"その他"}'::jsonb, NULL, 'quasi_identifier', '{"priority":1,"levels":[{"label":"削除","collapseTo":"*"}]}'::jsonb, 'fiscal_year', true, '["就労状況","保護者就労"]'::jsonb, ARRAY['kosodate']::text[], false, 2),
  ('outcome.waitlisted', '利用保留（待機）となった', '申込みに対して当該年度に利用できなかった（有無）', 'bool', NULL, NULL, 'outcome', NULL, 'fiscal_year', true, '["待機","利用保留"]'::jsonb, ARRAY['kosodate']::text[], false, 2),
  ('outcome.enrolled', '利用開始', '当該年度に施設・事業の利用を開始した（有無）', 'bool', NULL, NULL, 'outcome', NULL, 'fiscal_year', true, '["入所","利用開始"]'::jsonb, ARRAY['kosodate']::text[], false, 2)
) AS v(key, label, description, value_type, codes, unit, role, generalization,
       time_granularity, cloud_allowed, source_hints, plan_types, local_codes, version)
ON CONFLICT (key, municipality_id) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description, value_type = EXCLUDED.value_type,
  codes = EXCLUDED.codes, unit = EXCLUDED.unit, role = EXCLUDED.role, generalization = EXCLUDED.generalization,
  time_granularity = EXCLUDED.time_granularity, cloud_allowed = EXCLUDED.cloud_allowed,
  source_hints = EXCLUDED.source_hints, plan_types = EXCLUDED.plan_types,
  local_codes = EXCLUDED.local_codes, version = EXCLUDED.version, updated_at = now();

-- ── 7. 066 が入れた、コアにも分野パックにも無い共通行の掃除 ─────────────────
--    参照されている行は残す（データが先にあれば消さない）。
DELETE FROM attribute_definitions a
 WHERE a.municipality_id IS NULL
   AND a.key NOT IN ('demo.age_band5', 'demo.sex', 'demo.area', 'house.size_band', 'econ.income_band', 'prog.participated', 'prog.notified', 'outcome.service_used', 'outcome.cost_amount', 'demo.status', 'id.address_code', 'care.level', 'health.dementia_level', 'health.adl_level', 'econ.premium_band', 'outcome.cert_new', 'outcome.checkup_attended', 'outcome.hospitalized', 'child.age_class', 'child.certification', 'house.work_status', 'outcome.waitlisted', 'outcome.enrolled')
   AND NOT EXISTS (SELECT 1 FROM observations o WHERE o.attr_key = a.key);

DELETE FROM attribute_keys k
 WHERE k.key NOT IN ('demo.age_band5', 'demo.sex', 'demo.area', 'house.size_band', 'econ.income_band', 'prog.participated', 'prog.notified', 'outcome.service_used', 'outcome.cost_amount', 'demo.status', 'id.address_code', 'care.level', 'health.dementia_level', 'health.adl_level', 'econ.premium_band', 'outcome.cert_new', 'outcome.checkup_attended', 'outcome.hospitalized', 'child.age_class', 'child.certification', 'house.work_status', 'outcome.waitlisted', 'outcome.enrolled')
   AND NOT EXISTS (SELECT 1 FROM attribute_definitions a WHERE a.key = k.key)
   AND NOT EXISTS (SELECT 1 FROM observations o WHERE o.attr_key = k.key);

-- ── 8. 個票テンプレートの属性キーを新しい語彙に合わせる ─────────────────────
--    care_cert_anonymized は介護保険の分野パックを使う（旧: house/econ の分野名混じりのキー）
UPDATE dataset_definitions SET attr_keys = ARRAY[
  'care.level','health.dementia_level','health.adl_level','demo.sex','demo.age_band5','demo.area','demo.status'
]::text[]
WHERE id = 'care_cert_anonymized';
