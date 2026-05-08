-- ============================================================
-- 011_system_templates.sql — データセット定義 + システムテンプレート3種
-- ============================================================

-- ================================================================
-- データセット定義（13種）
-- ================================================================
INSERT INTO dataset_definitions VALUES
('needs_survey','介護予防・日常生活圏域ニーズ調査結果',
 '高齢者の健康状態・社会参加・主観的健康観・生きがい・閉じこもり・外出・サポートネットワーク・食事・住まいへの不安割合等',
 'csv',ARRAY['地域名','調査年','設問番号','選択肢','回答数','割合'],
 ARRAY['kaigo_hoken'],ARRAY['gap_analysis','issue_hypothesis','logic_model'],
 ARRAY['gap_analysis','hypothesis','needs_eval'],'confidential','3年毎',
 '市町村が実施する介護予防・日常生活圏域ニーズ調査（厚生労働省標準様式）の集計結果'),

('home_care_survey','在宅介護実態調査結果',
 '介護不安割合（認知症状への対応・外出付き添い・排泄等）を含む集計データ。要支援1・2別・要介護3以上別の集計が必要',
 'csv',ARRAY['要介護度区分','設問','回答割合'],
 ARRAY['kaigo_hoken'],ARRAY['gap_analysis','issue_hypothesis'],
 ARRAY['gap_analysis','hypothesis'],'confidential','3年毎',
 '市町村が実施する在宅介護実態調査（厚生労働省標準様式）の集計結果'),

('care_cert_anonymized','匿名化された要介護認定者一覧',
 '認定区分・認定日・有効期間・認知症自立度・障害自立度・性別・年齢・居住圏域を含む',
 'csv',ARRAY['匿名ID','認定区分','認定年月','認知症自立度','障害自立度','性別','年齢','圏域'],
 ARRAY['kaigo_hoken'],ARRAY['gap_analysis','issue_hypothesis','cost_efficiency'],
 ARRAY['gap_analysis','hypothesis','cost_calc'],'confidential','毎年',
 '介護保険システムから出力する認定者一覧（匿名化処理済み）'),

('care_insurance_report','介護保険事業状況報告データ',
 '要介護認定率（要介護度別）・受給率・受給者1人当たり給付費・第1号被保険者数等の時系列データ',
 'csv',ARRAY['年度','月','第1号被保険者数','認定者数','認定率','受給者数','受給率','給付費'],
 ARRAY['kaigo_hoken'],ARRAY['gap_analysis','service_volume','cost_efficiency'],
 ARRAY['gap_analysis','cost_calc','service_volume'],'internal','毎年',
 '介護保険事業状況報告（厚生労働省）の市町村別データ。地域包括ケア見える化システムの実行管理機能からエクスポート可'),

('mieruka_export','地域包括ケア見える化システム エクスポートデータ',
 '認定率・受給率・1人当たり給付費の県平均・全国平均との比較値。2040年推計値を含む',
 'excel',ARRAY['指標名','自市町村値','都道府県平均','全国平均','年度'],
 ARRAY['kaigo_hoken'],ARRAY['gap_analysis','issue_hypothesis','service_volume','cost_efficiency'],
 ARRAY['gap_analysis','benchmark','forecast'],'internal','随時',
 '地域包括ケア見える化システム（https://mieruka.mhlw.go.jp/）からのデータエクスポート'),

('residence_change_survey','居所変更実態調査結果',
 '施設での死亡率（老健除く）・自宅での死亡率（自死除く）・退院後ADL低下者割合を含む',
 'csv',ARRAY['調査年','指標名','値','単位'],
 ARRAY['kaigo_hoken'],ARRAY['gap_analysis'],ARRAY['gap_analysis'],
 'confidential','3年毎','市町村が実施する居所変更実態調査の集計結果'),

('vital_statistics','人口動態統計',
 '市町村別の死亡場所（自宅・病院・施設等）別死亡者数',
 'csv',ARRAY['年','死亡場所','死亡者数'],
 ARRAY['kaigo_hoken'],ARRAY['gap_analysis'],ARRAY['gap_analysis'],
 'public','毎年','厚生労働省 人口動態調査（市区町村別データ）またはe-Stat'),

('jages_data','JAGES調査結果データ',
 '日本老年学的評価研究による地域別健康格差指標。エビデンスの根拠として活用',
 'excel',ARRAY['指標','自市町村値','比較対照値','出典'],
 ARRAY['kaigo_hoken'],ARRAY['issue_hypothesis','logic_model','cost_efficiency'],
 ARRAY['hypothesis','theory_eval'],'internal','随時',
 '公益財団法人医療科学研究所 JAGES事務局から提供される各種資料'),

('dementia_medical_data','認知症関連医療情報',
 '認知症高齢者日常生活自立度Ⅱ以上の者の割合・認知症病棟長期入院者数（1年超）',
 'csv',ARRAY['調査年','指標名','値','分母'],
 ARRAY['kaigo_hoken'],ARRAY['gap_analysis','issue_hypothesis'],
 ARRAY['gap_analysis','hypothesis'],'confidential','毎年',
 '国保データベース（KDB）または介護情報基盤からのデータ抽出'),

('elder_housing_data','高齢者向け住まいの設置状況（都道府県提供）',
 '有料老人ホーム・サービス付き高齢者向け住宅の入居定員総数・要介護者数',
 'excel',ARRAY['施設名','所在地','入居定員','要介護者数','調査時点'],
 ARRAY['kaigo_hoken'],ARRAY['service_volume','gap_analysis'],
 ARRAY['service_volume'],'internal','随時',
 '都道府県から提供。熊本県は令和8年夏頃（7月目途）提供予定'),

('care_service_providers','介護サービス事業所一覧',
 '市町村内の介護サービス事業所の種別・所在地・定員・稼働率・利用者数',
 'csv',ARRAY['事業所名','サービス種別','所在圏域','定員','稼働率'],
 ARRAY['kaigo_hoken'],ARRAY['gap_analysis','service_volume'],
 ARRAY['gap_analysis','service_volume'],'internal','毎年',
 '介護サービス情報公表システムまたは市町村独自調査'),

('care_workforce_data','介護職員数・人材推計ワークシート',
 '介護職員数の現状と2025/2040年推計値。令和8年10月頃配布予定のR6介護職員数版を使用',
 'excel',ARRAY['職種','現状職員数','2025年推計','2040年推計','不足見込み数'],
 ARRAY['kaigo_hoken'],ARRAY['issue_hypothesis','logic_model'],
 ARRAY['hypothesis'],'internal','随時',
 '厚生労働省が配布する人材推計ワークシート（R6介護職員数版）'),

('insurance_finance_data','介護保険財政データ（前期計画実績）',
 '主要施策毎の投入金額（人件費按分含む）・給付費実績・保険料',
 'excel',ARRAY['主要施策名','年度','人件費','事業費','給付費実績'],
 ARRAY['kaigo_hoken'],ARRAY['cost_efficiency','program_evaluation'],
 ARRAY['cost_calc'],'confidential','毎年',
 '市町村の決算データ・介護保険特別会計決算書');

-- ================================================================
-- システムテンプレート 1: 介護保険事業計画（全機能）
-- ================================================================
INSERT INTO plan_templates (id, name, plan_type, description, plan_period_years,
  module_config, is_system_template, is_public) VALUES
(
  'ffffffff-0001-0000-0000-000000000001',
  '介護保険事業計画（第10期）— 策定から評価まで',
  'kaigo_hoken',
  '9期評価→10期策定→計画期間中のPDCA→次期策定まで、策定方針の全工程をカバーする標準テンプレート。5階層プログラム評価・コストと効率性の評価・サービス見込量管理を含む。',
  3,
  '{
    "dataset_manager":   {"enabled": true},
    "gap_analysis":      {"enabled": true},
    "issue_hypothesis":  {"enabled": true},
    "logic_model":       {"enabled": true},
    "program_evaluation":{"enabled": true},
    "cost_efficiency":   {"enabled": true},
    "service_volume":    {"enabled": true},
    "self_evaluation":   {"enabled": true}
  }',
  true, true
);

-- テンプレート1 サイクルA: 策定フェーズ（P）
INSERT INTO pdca_cycle_defs (id, template_id, name, cycle_type, phase, recurrence, description, sort_order) VALUES
('cccc0001-0001-0000-0000-000000000001',
 'ffffffff-0001-0000-0000-000000000001',
 '策定フェーズ（前期評価→次期計画策定）', 'planning_phase', 'P', 'once',
 '9期計画の評価から10期計画書完成までの策定作業。QCストーリー①〜⑤に対応。', 1);

INSERT INTO pdca_checkpoint_defs VALUES
('dddd0001-0001-0001-0000-000000000001',
 'cccc0001-0001-0000-0000-000000000001',
 '前期計画評価（Phase 1）',
 'QCストーリー①⑦の適用。9期計画の5階層プログラム評価を実施し、主要施策毎の継続・改変・廃止の根拠を整理する。計画初年度または策定年度上旬に実施。',
 0, 4, 7,
 ARRAY['process','outcome_initial','outcome_intermediate','cost_efficiency'],
 ARRAY['program_evaluation','cost_efficiency','self_evaluation','service_volume'],
 'insurer_will',
 '前期評価報告書・自己評価シート・サービス見込量乖離分析シートを完成させる。点検ツールを用いた評価結果を策定委員会に提示する。',
 1),

('dddd0001-0001-0002-0000-000000000001',
 'cccc0001-0001-0000-0000-000000000001',
 '現状把握・データ収集（Phase 2）',
 'QCストーリー②の適用。各種実態調査・見える化システム・JAGES等からデータを収集し、基本目標指標の現状値を整理する。',
 0, 4, 9,
 ARRAY[]::text[],
 ARRAY['dataset_manager','gap_analysis'],
 'status_check',
 '必要なデータセットをすべてアップロードする。現状値一覧シートと中長期推計シート（2040年度）を作成する。',
 2),

('dddd0001-0001-0003-0000-000000000001',
 'cccc0001-0001-0000-0000-000000000001',
 '地域分析・課題仮説設定（Phase 3）',
 'QCストーリー②③④の適用。SWOT分析→ギャップ可視化→ニーズ評価→真因分析の順で課題仮説シートを作成。地域ケア会議・策定委員会で検証する。',
 0, 7, 10,
 ARRAY['needs','theory'],
 ARRAY['gap_analysis','issue_hypothesis','logic_model'],
 'task_selection',
 'SWOT分析シート、課題仮説シート（課題・真因・想定施策）を完成させ、策定委員会で承認を受ける。',
 3),

('dddd0001-0001-0004-0000-000000000001',
 'cccc0001-0001-0000-0000-000000000001',
 '施策設計・見込量算定・保険料算定（Phase 4）',
 'QCストーリー⑤の適用。ロジックモデル確定→対照群・費用設定→マトリクスによる優先順位付け→施策効果反映→サービス見込量算定→保険料試算。',
 0, 9, NULL,
 ARRAY['theory'],
 ARRAY['logic_model','cost_efficiency','service_volume'],
 'measure_planning',
 '主要施策一覧（対照群・費用・根拠付）、マトリクス評価表、サービス見込量算定シート、保険料試算を完成させる。コスト比率≤100%を採択の参考目安とする。',
 4),

('dddd0001-0001-0005-0000-000000000001',
 'cccc0001-0001-0000-0000-000000000001',
 '計画書作成・審議・確定（Phase 5）',
 '計画書草案を作成し、介護保険事業審議会・パブリックコメントを経て計画を確定・公表する。',
 1, 1, 3,
 ARRAY[]::text[],
 ARRAY['logic_model','program_evaluation'],
 'insurer_will',
 '計画書草案→審議会審議→パブコメ→計画確定→公表の順に進める。',
 5);

-- テンプレート1 サイクルB: 年次PDCAサイクル①（6月）
INSERT INTO pdca_cycle_defs VALUES
('cccc0001-0002-0000-0000-000000000001',
 'ffffffff-0001-0000-0000-000000000001',
 '年次PDCAサイクル①（前年度実績評価・6月）', 'annual_june', 'C-A', 'yearly',
 '手引き第1部に示す年度ごとのPDCAサイクル①。前年度の実績が6月頃確定するため、プロセス評価と初期アウトカム評価を実施し、当該年度の取組改善に活かす。', 2);

INSERT INTO pdca_checkpoint_defs VALUES
('dddd0001-0002-0001-0000-000000000001',
 'cccc0001-0002-0000-0000-000000000001',
 '前年度実績評価（2年目・6月）',
 '前年度実績を確定させ、プロセス評価（図6フロー）と初期アウトカム評価を実施。自己評価シートを更新し、当該年度の取組・事業の改善等に活かす。',
 2, 6, 7,
 ARRAY['process','outcome_initial'],
 ARRAY['program_evaluation','self_evaluation','service_volume'],
 'effect_check',
 '図6フローに従い「取組は予定通り実施できたか」「取組結果は目標値以上か」を確認。担当者レベルで改善策・解消方策を決定する。',
 1),

('dddd0001-0002-0002-0000-000000000001',
 'cccc0001-0002-0000-0000-000000000001',
 '前年度実績評価（3年目・6月）',
 '前年度実績を確定させ、プロセス評価と初期アウトカム評価を実施。3年目の上旬には中間アウトカム評価も実施する。',
 3, 6, 7,
 ARRAY['process','outcome_initial'],
 ARRAY['program_evaluation','self_evaluation','service_volume'],
 'effect_check',
 '図6フローに従い実施。3年目のため、次期計画策定への引き継ぎ事項も合わせて整理する。',
 2);

-- テンプレート1 サイクルC: 年次PDCAサイクル②（10月）
INSERT INTO pdca_cycle_defs VALUES
('cccc0001-0003-0000-0000-000000000001',
 'ffffffff-0001-0000-0000-000000000001',
 '年次PDCAサイクル②（中間実績評価・10月）', 'annual_october', 'C-A', 'yearly',
 '手引き第1部に示す年度ごとのPDCAサイクル②。9月末中間実績を参考に10月評価を実施し、次年度取組の改善の必要性を考察。当初予算計上も可能。', 3);

INSERT INTO pdca_checkpoint_defs VALUES
('dddd0001-0003-0001-0000-000000000001',
 'cccc0001-0003-0000-0000-000000000001',
 '中間実績評価（2年目・10月）',
 '9月末時点の中間実績をもとにプロセス評価と初期アウトカム評価を実施。次年度取組・事業の改善の必要性を考察し当初予算に反映する。',
 2, 10, 12,
 ARRAY['process','outcome_initial'],
 ARRAY['program_evaluation','self_evaluation'],
 'dc_continue',
 '事業や取組を開始して6か月のため成果が不十分なこともある。次年度の抜本的な立て直しが必要か判断し、当初予算に計上する。',
 1),

('dddd0001-0003-0002-0000-000000000001',
 'cccc0001-0003-0000-0000-000000000001',
 '中間実績評価（3年目・10月）',
 '3年目10月時点の評価。次期計画策定のための前期評価準備も並行して開始する。',
 3, 10, 12,
 ARRAY['process','outcome_initial'],
 ARRAY['program_evaluation','self_evaluation'],
 'dc_continue',
 '3年目のため、次期計画策定に向けたPhase 1前期評価の準備を同時に開始する。',
 2);

-- テンプレート1 サイクルD: 計画期間評価（3年目）
INSERT INTO pdca_cycle_defs VALUES
('cccc0001-0004-0000-0000-000000000001',
 'ffffffff-0001-0000-0000-000000000001',
 '計画期間評価（3年目・中間アウトカム＋コストと効率性）', 'triennial', 'C-A', 'once',
 '策定方針p.12図7の「3年目の上旬に行う主要施策毎のプログラム評価」。中間アウトカム指標の達成状況とコストと効率性の評価を実施し、次期計画策定のPhase 1（前期評価）に引き継ぐ。', 4);

INSERT INTO pdca_checkpoint_defs VALUES
('dddd0001-0004-0001-0000-000000000001',
 'cccc0001-0004-0000-0000-000000000001',
 '計画期間評価・中間アウトカム＋コストと効率性（3年目・上旬）',
 '図7フローに従い主要施策毎のプログラム評価を実施。中間アウトカム指標の達成状況を確認し、コストと効率性の評価（コスト比率の再計算）を行う。結果を次期計画策定のPhase 1として引き継ぐ。',
 3, 4, 7,
 ARRAY['outcome_intermediate','cost_efficiency'],
 ARRAY['program_evaluation','cost_efficiency','service_volume'],
 'effect_check',
 '図7フロー：中間アウトカムの目標値達成確認→初期アウトカムに起因するものか→コストと効率性の評価（投入した人員と予算は適切か）の順で実施。結果を前期評価報告書にまとめ次期計画策定委員会に提示する。',
 1);

-- ================================================================
-- システムテンプレート 2: 介護保険事業計画（進捗管理特化）
-- ================================================================
INSERT INTO plan_templates VALUES
(
  'ffffffff-0002-0000-0000-000000000001',
  '介護保険事業計画（進捗管理特化）',
  'kaigo_hoken',
  'すでに計画が策定済みで、計画期間中の進捗管理のみを行うテンプレート。策定フェーズのモジュールを省略し、年次PDCAと3年目評価に特化する。',
  3,
  '{
    "dataset_manager":   {"enabled": true},
    "gap_analysis":      {"enabled": false},
    "issue_hypothesis":  {"enabled": false},
    "logic_model":       {"enabled": false},
    "program_evaluation":{"enabled": true},
    "cost_efficiency":   {"enabled": true},
    "service_volume":    {"enabled": true},
    "self_evaluation":   {"enabled": true}
  }',
  true, true,
  NULL, NOW(), NOW()
);

-- テンプレート2 サイクルB: 年次①6月
INSERT INTO pdca_cycle_defs VALUES
('cccc0002-0002-0000-0000-000000000001',
 'ffffffff-0002-0000-0000-000000000001',
 '年次PDCAサイクル①（前年度実績評価・6月）','annual_june','C-A','yearly',
 '前年度実績評価（6月頃）', 2);

INSERT INTO pdca_checkpoint_defs VALUES
('dddd0002-0002-0001-0000-000000000001',
 'cccc0002-0002-0000-0000-000000000001',
 '前年度実績評価（2年目・6月）',
 '前年度実績を確定させ、プロセス評価と初期アウトカム評価を実施。',
 2, 6, 7,
 ARRAY['process','outcome_initial'],
 ARRAY['program_evaluation','self_evaluation','service_volume'],
 'effect_check',
 '図6フローに従い実施。改善策を当該年度の取組に反映する。',
 1),
('dddd0002-0002-0002-0000-000000000001',
 'cccc0002-0002-0000-0000-000000000001',
 '前年度実績評価（3年目・6月）',
 '前年度実績を確定させ、プロセス評価と初期アウトカム評価を実施。次期計画への引き継ぎ事項も整理する。',
 3, 6, 7,
 ARRAY['process','outcome_initial'],
 ARRAY['program_evaluation','self_evaluation','service_volume'],
 'effect_check',
 '図6フローに従い実施。次期計画策定への引き継ぎ事項も合わせて整理する。',
 2);

-- テンプレート2 サイクルC: 年次②10月
INSERT INTO pdca_cycle_defs VALUES
('cccc0002-0003-0000-0000-000000000001',
 'ffffffff-0002-0000-0000-000000000001',
 '年次PDCAサイクル②（中間実績評価・10月）','annual_october','C-A','yearly',
 '中間実績評価と次年度予算要求（10月頃）', 3);

INSERT INTO pdca_checkpoint_defs VALUES
('dddd0002-0003-0001-0000-000000000001',
 'cccc0002-0003-0000-0000-000000000001',
 '中間実績評価（2年目・10月）',
 '9月末時点の中間実績をもとに評価を実施。次年度取組の改善の必要性を考察し当初予算に反映する。',
 2, 10, 12,
 ARRAY['process','outcome_initial'],
 ARRAY['program_evaluation','self_evaluation'],
 'dc_continue',
 '次年度の抜本的な立て直しが必要か判断し、当初予算に計上する。',
 1),
('dddd0002-0003-0002-0000-000000000001',
 'cccc0002-0003-0000-0000-000000000001',
 '中間実績評価（3年目・10月）',
 '3年目10月時点の評価。次期計画策定のための前期評価準備も並行して開始する。',
 3, 10, 12,
 ARRAY['process','outcome_initial'],
 ARRAY['program_evaluation','self_evaluation'],
 'dc_continue',
 '3年目のため、次期計画策定に向けたPhase 1前期評価の準備を同時に開始する。',
 2);

-- テンプレート2 サイクルD: 計画期間評価（3年目）
INSERT INTO pdca_cycle_defs VALUES
('cccc0002-0004-0000-0000-000000000001',
 'ffffffff-0002-0000-0000-000000000001',
 '計画期間評価（3年目）','triennial','C-A','once',
 '中間アウトカム＋コストと効率性の評価（3年目上旬）', 4);

INSERT INTO pdca_checkpoint_defs VALUES
('dddd0002-0004-0001-0000-000000000001',
 'cccc0002-0004-0000-0000-000000000001',
 '計画期間評価・中間アウトカム＋コストと効率性（3年目・上旬）',
 '中間アウトカム指標の達成状況を確認し、コストと効率性の評価（コスト比率の再計算）を行う。',
 3, 4, 7,
 ARRAY['outcome_intermediate','cost_efficiency'],
 ARRAY['program_evaluation','cost_efficiency','service_volume'],
 'effect_check',
 '結果を前期評価報告書にまとめ次期計画策定委員会に提示する。',
 1);

-- ================================================================
-- システムテンプレート 3: 汎用行政計画（カスタム）
-- ================================================================
INSERT INTO plan_templates VALUES
(
  'ffffffff-0003-0000-0000-000000000001',
  '汎用行政計画テンプレート（カスタマイズ可）',
  'custom',
  '介護保険以外の計画（障害福祉計画・健康増進計画等）や独自の計画に使用するテンプレート。モジュールとPDCAサイクルをゼロから設計できる。',
  3,
  '{
    "dataset_manager":   {"enabled": true},
    "gap_analysis":      {"enabled": true},
    "issue_hypothesis":  {"enabled": true},
    "logic_model":       {"enabled": true},
    "program_evaluation":{"enabled": true},
    "cost_efficiency":   {"enabled": false},
    "service_volume":    {"enabled": false},
    "self_evaluation":   {"enabled": true}
  }',
  true, true,
  NULL, NOW(), NOW()
);
-- テンプレート3はPDCAサイクルなし（ユーザーがデザイナーで設計する）

-- ================================================================
-- projects テーブルへのカラム追加（010で追加済みのため IF NOT EXISTS）
-- ================================================================
ALTER TABLE projects ADD COLUMN IF NOT EXISTS plan_type TEXT DEFAULT 'kaigo_hoken';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS plan_start_date DATE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS plan_end_date DATE;
