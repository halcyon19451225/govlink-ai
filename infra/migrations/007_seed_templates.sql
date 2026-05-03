-- システム標準テンプレートのシードデータ

-- 1. 地域包括ケア計画
INSERT INTO plan_templates (id, name, category, legal_basis, plan_period_years, is_composite, description, is_system)
VALUES (
  'aaaaaaaa-0001-0000-0000-000000000000',
  '地域包括ケア計画（介護保険・老人福祉・認知症）',
  'elderly_care',
  '介護保険法第117条・老人福祉法第20条の8・認知症基本法第14条',
  3,
  true,
  '介護保険事業計画・老人福祉計画・認知症施策推進計画を一体的に策定する複合計画。3年ごとに見直し。',
  true
);

INSERT INTO template_kpi_suggestions (template_id, label, unit, indicator_type, evaluation_timing, evaluation_year, sort_order)
VALUES
  ('aaaaaaaa-0001-0000-0000-000000000000', '要介護認定率',        '%',  'outcome_mid',     '毎年度末', NULL, 1),
  ('aaaaaaaa-0001-0000-0000-000000000000', '新規要介護認定率',    '%',  'outcome_initial',  '毎年度末', NULL, 2),
  ('aaaaaaaa-0001-0000-0000-000000000000', 'サービス未利用者割合','%',  'outcome_initial',  '毎年度末', NULL, 3),
  ('aaaaaaaa-0001-0000-0000-000000000000', '認知症サポーター数',  '人', 'process',          '毎年度末', NULL, 4);

INSERT INTO template_evaluation_schedules (template_id, evaluation_type, timing_year, timing_period, description)
VALUES
  ('aaaaaaaa-0001-0000-0000-000000000000', 'process', 1, 'first_half',  '1年目上期: 事業進捗の確認'),
  ('aaaaaaaa-0001-0000-0000-000000000000', 'process', 2, 'first_half',  '2年目上期: 中間評価（次期計画の基礎データ収集）'),
  ('aaaaaaaa-0001-0000-0000-000000000000', 'outcome', 2, 'first_half',  '2年目上期: アウトカム中間評価（次期計画見直し用）'),
  ('aaaaaaaa-0001-0000-0000-000000000000', 'outcome', 3, 'year_end',    '3年目年度末: 最終アウトカム評価');

-- 2. 障害福祉計画・障害児福祉計画
INSERT INTO plan_templates (id, name, category, legal_basis, plan_period_years, is_composite, description, is_system)
VALUES (
  'aaaaaaaa-0002-0000-0000-000000000000',
  '障害福祉計画・障害児福祉計画',
  'disability',
  '障害者総合支援法第88条・児童福祉法第33条の20',
  3,
  true,
  '障害福祉サービスの提供体制・必要量を見込む計画。障害児福祉計画と一体的に策定。',
  true
);

INSERT INTO template_kpi_suggestions (template_id, label, unit, indicator_type, evaluation_timing, evaluation_year, sort_order)
VALUES
  ('aaaaaaaa-0002-0000-0000-000000000000', '福祉施設から地域生活への移行者数', '人', 'outcome_initial', '毎年度末', NULL, 1),
  ('aaaaaaaa-0002-0000-0000-000000000000', '相談支援件数',                    '件', 'process',         '毎年度末', NULL, 2),
  ('aaaaaaaa-0002-0000-0000-000000000000', 'グループホーム利用者数',          '人', 'outcome_mid',     '毎年度末', NULL, 3);

INSERT INTO template_evaluation_schedules (template_id, evaluation_type, timing_year, timing_period, description)
VALUES
  ('aaaaaaaa-0002-0000-0000-000000000000', 'process', 1, 'year_end',   '1年目年度末: 進捗確認'),
  ('aaaaaaaa-0002-0000-0000-000000000000', 'outcome', 3, 'year_end',   '3年目年度末: 最終評価');

-- 3. 子ども・子育て支援事業計画
INSERT INTO plan_templates (id, name, category, legal_basis, plan_period_years, is_composite, description, is_system)
VALUES (
  'aaaaaaaa-0003-0000-0000-000000000000',
  '子ども・子育て支援事業計画',
  'child',
  '子ども・子育て支援法第61条',
  5,
  false,
  '教育・保育の量の見込みと確保策、地域子ども・子育て支援事業の実施に関する計画。5年ごとに策定。',
  true
);

INSERT INTO template_kpi_suggestions (template_id, label, unit, indicator_type, evaluation_timing, evaluation_year, sort_order)
VALUES
  ('aaaaaaaa-0003-0000-0000-000000000000', '保育所等利用率',     '%',  'outcome_initial', '毎年度末', NULL, 1),
  ('aaaaaaaa-0003-0000-0000-000000000000', '待機児童数',         '人', 'outcome_initial', '毎年4月1日', NULL, 2),
  ('aaaaaaaa-0003-0000-0000-000000000000', '放課後児童クラブ定員充足率', '%', 'process', '毎年度末', NULL, 3);

INSERT INTO template_evaluation_schedules (template_id, evaluation_type, timing_year, timing_period, description)
VALUES
  ('aaaaaaaa-0003-0000-0000-000000000000', 'process', 1, 'year_end', '1年目年度末: 進捗確認'),
  ('aaaaaaaa-0003-0000-0000-000000000000', 'outcome', 3, 'first_half', '3年目上期: 中間見直し'),
  ('aaaaaaaa-0003-0000-0000-000000000000', 'outcome', 5, 'year_end', '5年目年度末: 最終評価');

-- 4. 健康増進計画
INSERT INTO plan_templates (id, name, category, legal_basis, plan_period_years, is_composite, description, is_system)
VALUES (
  'aaaaaaaa-0004-0000-0000-000000000000',
  '健康増進計画',
  'health',
  '健康増進法第8条',
  6,
  false,
  '住民の健康増進推進のための目標設定・施策を定める計画。国の健康日本21との整合を図る。',
  true
);

INSERT INTO template_kpi_suggestions (template_id, label, unit, indicator_type, evaluation_timing, evaluation_year, sort_order)
VALUES
  ('aaaaaaaa-0004-0000-0000-000000000000', '特定健診受診率',     '%',  'process',     '毎年度末', NULL, 1),
  ('aaaaaaaa-0004-0000-0000-000000000000', '糖尿病有病者数',     '人', 'outcome_mid', '毎年度末', NULL, 2),
  ('aaaaaaaa-0004-0000-0000-000000000000', '喫煙率',             '%',  'outcome_mid', '3年ごと', NULL, 3),
  ('aaaaaaaa-0004-0000-0000-000000000000', '運動習慣者割合',     '%',  'outcome_mid', '3年ごと', NULL, 4);

INSERT INTO template_evaluation_schedules (template_id, evaluation_type, timing_year, timing_period, description)
VALUES
  ('aaaaaaaa-0004-0000-0000-000000000000', 'process', 1, 'year_end',  '毎年度末: 事業進捗確認'),
  ('aaaaaaaa-0004-0000-0000-000000000000', 'outcome', 3, 'year_end',  '3年目年度末: 中間評価'),
  ('aaaaaaaa-0004-0000-0000-000000000000', 'outcome', 6, 'year_end',  '6年目年度末: 最終評価');

-- 5. 地域防災計画
INSERT INTO plan_templates (id, name, category, legal_basis, plan_period_years, is_composite, description, is_system)
VALUES (
  'aaaaaaaa-0005-0000-0000-000000000000',
  '地域防災計画',
  'disaster',
  '災害対策基本法第42条',
  0,
  false,
  '地域の防災・減災に関する目標・施策・体制を定める計画。概ね5年ごとに見直し（期間設定は任意）。',
  true
);

INSERT INTO template_kpi_suggestions (template_id, label, unit, indicator_type, evaluation_timing, evaluation_year, sort_order)
VALUES
  ('aaaaaaaa-0005-0000-0000-000000000000', '防災訓練参加率',     '%',  'process',      '毎年度末', NULL, 1),
  ('aaaaaaaa-0005-0000-0000-000000000000', '避難所整備率',       '%',  'process',      '毎年度末', NULL, 2),
  ('aaaaaaaa-0005-0000-0000-000000000000', '自主防災組織率',     '%',  'outcome_mid',  '毎年度末', NULL, 3);

INSERT INTO template_evaluation_schedules (template_id, evaluation_type, timing_year, timing_period, description)
VALUES
  ('aaaaaaaa-0005-0000-0000-000000000000', 'process', 1, 'year_end',  '毎年度末: 防災訓練・整備状況確認');

-- 6. 自由設定計画（テンプレートなし）
INSERT INTO plan_templates (id, name, category, legal_basis, plan_period_years, description, is_system)
VALUES (
  'aaaaaaaa-0006-0000-0000-000000000000',
  '自由設定計画（テンプレートなし）',
  'other',
  NULL,
  NULL,
  'テンプレートを使わず1から計画を作成する。基本目標・KPI・評価スケジュールを全て自由に設定できる。',
  true
);
