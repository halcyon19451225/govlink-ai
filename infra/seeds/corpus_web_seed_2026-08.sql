-- ================================================================
-- corpus_web_seed_2026-08.sql
-- コーパス強化シード: インターネット公開情報（JAGES）からの取り込み
--
-- 【出所と根拠】
--   JAGES（日本老年学的評価研究）の公開プレスリリース・検討会資料・
--   プロジェクトページから、介護予防分野の代表的な研究知見と
--   実装事例（武豊プロジェクト）を構造化したもの。
--   JAGESサイトは出典明記を条件に転載を認めている。各行に出典を持つ。
--
-- 【品質ゲート（重要）】
--   すべて status='pending'（検収待ち）で投入する。
--   /ordo-admin/corpus の検収タブで内容を確認・承認して初めて
--   横断参照（コーパス接地）の対象になる。無確認の自動登録はしない
--   という X3 の方針をシードにも適用している。
--
-- 【エビデンスレベルの判定方針（正直さ優先）】
--   - 傾向スコアマッチング・操作変数を用いた準実験 → design=qed / Lv3
--   - 縦断（多変量調整のみ・マッチングなし） → design=qed / Lv2 に保守的に下げる
--   - 横断・地域相関 → design=case / Lv1（因果を主張しない）
--
-- 【冪等性】source_key の ON CONFLICT DO NOTHING。
--   再実行しても検収済みの行を上書きしない（安全側）。
--
-- 実行: psql "$DATABASE_URL" -f ../infra/seeds/corpus_web_seed_2026-08.sql
-- 前提: 040_corpus.sql 実行済み
-- ================================================================

-- ── エビデンス ───────────────────────────────────

INSERT INTO corpus_evidence
  (status, field_category, population_band, title, source, url, year,
   design, evidence_level, population, effect_summary, transferability,
   source_kind, source_key, contributor_key, source_note)
VALUES
-- 1. 武豊町サロン×認知症（Lv3）
('pending', '介護予防', '1〜5万',
 '地域サロン（通いの場）への参加と認知症発症: 年4回以上の参加で発症リスク0.7倍（7年追跡）',
 'Hikichi H, Kondo K, Takeda T, Kawachi I (2017) Alzheimer''s & Dementia: TRCI 3(1):23-32（JAGES武豊プロジェクト）',
 'https://www.jages.net/?action=common_download_main&upload_id=3411',
 2017, 'qed', 3,
 '愛知県武豊町の65歳以上高齢者2,593名（2006年調査回答者を2013年末まで追跡）',
 '年4回以上のサロン参加者は認知症発症リスクが0.7倍（約3割減）。性・教育歴・等価所得・併存症・うつ・認知機能・飲酒喫煙・歩行時間・他の社会参加を統計的に調整したコミュニティ介入研究',
 '人口約4万人の町。住民ボランティア運営・多拠点・自治体支援というサロンの運営形態が効果の前提。参加は自己選択のため残余交絡の可能性は残る',
 'knowledge_extract', 'webseed:jages:taketoyo-dementia-2017', NULL,
 'JAGESプレスリリース「『憩いのサロン』参加で認知症リスク3割減」（2017年1月）'),

-- 2. 武豊町サロン×要介護認定（Lv3）
('pending', '介護予防', '1〜5万',
 '地域サロンへの参加と要介護認定: 参加者は5年間の認定リスクが約半減',
 'Hikichi H, et al. (2015) Journal of Epidemiology and Community Health（JAGES武豊プロジェクト）',
 'https://www.jages.net/project/jititaijointresearch/taketoyo/',
 2015, 'qed', 3,
 '愛知県武豊町の65歳以上高齢者（サロン事業対象地域）',
 'サロン参加者は5年間の要介護認定リスクが約半減する可能性。自己選択バイアスを傾向スコアマッチングと操作変数法で統制した準実験',
 '運営形態（住民主体・多拠点・低頻度でも可）が similar な事業に適用しやすい。単一町での検証であり地域特性の影響は残る',
 'knowledge_extract', 'webseed:jages:taketoyo-ninteir-2015', NULL,
 'JAGES武豊プロジェクトページ（効果検証の項）'),

-- 3. 武豊町サロン×主観的健康感（Lv3）
('pending', '介護予防', '1〜5万',
 'サロン事業開始8ヶ月後、参加者の主観的健康感が非参加者比で改善',
 'Ichida Y, et al. (2013) Social Science & Medicine 94:83-90（JAGES武豊プロジェクト）',
 'https://www.jages.net/project/jititaijointresearch/taketoyo/',
 2013, 'qed', 3,
 '愛知県武豊町の65歳以上高齢者（介入地区と対照の比較）',
 'サロン開始8ヶ月後の時点で、参加者の主観的健康感が改善。介入・比較デザインによる短期アウトカムの検証',
 '短期（1年未満）で測定可能なアウトカムとして主観的健康感を使える示唆。効果量の一般化には複数地域での再現が必要',
 'knowledge_extract', 'webseed:jages:taketoyo-srh-2013', NULL,
 'JAGES武豊プロジェクトページ（効果検証の項）'),

-- 4. 通いの場×フレイル（縦断・調整のみ → 保守的にLv2）
('pending', '介護予防', NULL,
 '通いの場・サロンへの3年以上の参加でフレイル発症が半減以下（IRR 0.47）',
 'JAGES 2013→2016縦断パネル（近藤克則「『通いの場』の介護予防効果 検証はどこまで進んだか」一般介護予防事業等の推進方策に関する検討会資料）',
 'https://www.jages.net/mujp4dgbm-2248/?action=common_download_main&upload_id=7312',
 2019, 'qed', 2,
 '24自治体の高齢者7,223名（前期高齢者4,651名・後期高齢者2,572名、平均73.0歳）を3年追跡',
 'サロン参加3年以上の群はフレイル発症率比 IRR 0.47（95%CI 0.28-0.79, p<0.01）。年齢・性・所得・教育・婚姻・就業・うつ・疾患・食生活・運動・交友関係等を調整',
 '多自治体の縦断データだが無作為化・マッチングは無く多変量調整のみのため、レベルは保守的に2とした。参加継続年数と効果の関係（量反応）を示す点が施策設計に有用',
 'knowledge_extract', 'webseed:jages:kayoinoba-frailty-irr047', NULL,
 '検討会資料スライド（JAGES 2013-2016パネル分析）'),

-- 5. 社会参加×介護給付費（Lv3）
('pending', '介護予防', NULL,
 '趣味・スポーツの会へ週1回以上参加する高齢者は、11年間の介護給付費が1人あたり約30〜50万円低い',
 'Saito M, et al. (2019) BMJ Open（JAGES縦断研究）',
 'https://www.jages.net/mujp4dgbm-2248/?action=common_download_main&upload_id=7312',
 2019, 'qed', 3,
 'JAGES参加自治体の高齢者（11年間の介護給付実績を追跡）',
 '週1回以上の趣味の会・スポーツの会参加者は、11年間の累積介護給付費が非参加者より1人あたり約30〜50万円低い。傾向スコアによる逆確率重み付け（IPW）・多重代入で自己選択を統制',
 '費用対効果（第5階層・効率性評価）の根拠に使える希少な長期給付費データ。金額は当時の給付水準に依存するため、規模の目安として扱う',
 'knowledge_extract', 'webseed:jages:saito2019-ltc-cost', NULL,
 '検討会資料スライド（Saito M, et al. 2019 BMJ Open の紹介）'),

-- 6. 地域相関（横断 → Lv1・因果を主張しない）
('pending', '介護予防', NULL,
 '社会参加の割合が高い地域ほど、転倒・認知症・うつのリスク指標が低い（31自治体の地域相関）',
 'JAGES 2010-11横断調査（第47回社会保障審議会介護保険部会 配付資料, 2013）',
 'https://www.jages.net/mujp4dgbm-2248/?action=common_download_main&upload_id=7312',
 2013, 'case', 1,
 '31自治体・約11.2万人の高齢者回答（2010年8月〜2012年1月調査）',
 'スポーツ組織参加率が高い地域で転倒が少なく、ボランティア参加率が高い地域で認知症リスク指標が低く、趣味グループ参加率が高い地域でうつ得点が低い相関。横断・地域相関であり因果は主張できない',
 '「地域の参加率」を上げる面的施策（ポピュレーションアプローチ）の着眼点として有用。個人への効果を保証するものではない',
 'knowledge_extract', 'webseed:jages:crosssec-31city-2013', NULL,
 '検討会資料スライド（社会保障審議会介護保険部会2013配付資料の再掲）')

ON CONFLICT (source_key) DO NOTHING;

-- ── 施策（実装事例）─────────────────────────────

INSERT INTO corpus_measures
  (status, field_category, population_band, title, approach,
   target_population, target_size, intervention, delivery,
   evidence_status, evidence_items, experiment,
   structure_indicators, process_indicators, outcome_notes,
   total_budget, unit_cost, cost_per_outcome_note, funding, effect_note,
   source_kind, source_key, contributor_key, source_note)
VALUES
('pending', '介護予防', '1〜5万',
 '住民運営の多拠点サロン事業（武豊プロジェクト型・通いの場）',
 '徒歩圏に多拠点のサロン（通いの場）を整備し、住民ボランティア運営＋行政支援で高齢者の社会参加機会を増やす。閉じこもり・不活発による心身機能低下（フレイル・認知機能低下）の経路を断つ',
 '65歳以上の地域在住高齢者（要支援・要介護でない層を含む全高齢者）',
 NULL,
 '体操に限らない多彩なプログラムのサロンを町内多拠点で定期開催。武豊町では2007年開始で会場3→13ヶ所、参加者401→1,063人、65歳以上参加率5.4%→10.2%（2016年時点）',
 '住民ボランティアが運営し、自治体（保健部門）が立ち上げ・運営を支援',
 'sufficient',
 '[
   {"title":"サロン参加者は5年間の要介護認定リスクが約半減","source":"Hikichi H, et al. (2015) J Epidemiol Community Health（JAGES武豊）","url":"https://www.jages.net/project/jititaijointresearch/taketoyo/","year":2015,"design":"qed","evidence_level":3,"population":"武豊町の65歳以上高齢者","effect_summary":"傾向スコアマッチング・操作変数法による準実験で要介護認定リスク約半減","transferability":"住民主体・多拠点・行政支援の運営形態が前提"},
   {"title":"年4回以上のサロン参加で認知症発症リスク0.7倍（7年追跡）","source":"Hikichi H, et al. (2017) Alzheimer''s & Dementia: TRCI 3(1):23-32","url":"https://www.jages.net/?action=common_download_main&upload_id=3411","year":2017,"design":"qed","evidence_level":3,"population":"武豊町の高齢者2,593名","effect_summary":"多変量調整で認知症発症リスク0.7倍（約3割減）","transferability":"人口約4万人の町での検証"}
 ]'::jsonb,
 NULL,
 '["住民ボランティア運営者の確保・養成（武豊町は会場数3→13に拡大）","徒歩圏でアクセスできる会場の多拠点整備"]'::jsonb,
 '["サロン開催回数","延べ参加者数（武豊町実績: 401→1,063人）"]'::jsonb,
 '["短期: 65歳以上人口に占める参加率（武豊町実績 5.4%→10.2%）","中間: 要介護認定リスク（5年で約半減の報告）","中間: 認知症発症リスク（7年で0.7倍の報告）"]'::jsonb,
 NULL, NULL,
 '介護給付費の抑制効果は Saito et al. (2019) の社会参加研究（11年で1人30〜50万円低い）が参考値。事業費÷新規参加者数＝参加者1人獲得あたり費用 を基本形とする',
 NULL,
 '【改善・Lv3】サロン参加者の要介護認定リスク約半減（5年・傾向スコア/操作変数）、認知症発症0.7倍（7年）。フレイル発症IRR0.47（JAGES多自治体縦断・参加3年以上）',
 'knowledge_extract', 'webseed:jages:taketoyo-salon-model', NULL,
 'JAGES武豊プロジェクト（https://www.jages.net/project/jititaijointresearch/taketoyo/）・検討会資料（upload_id=7312）・プレスリリース（upload_id=3411）から構造化')

ON CONFLICT (source_key) DO NOTHING;

-- ── 確認用ログ ───────────────────────────────────
DO $$
BEGIN
  RAISE NOTICE 'Webシード投入: corpus_evidence %件 / corpus_measures %件（いずれも検収待ち。/ordo-admin/corpus で承認してください）',
    (SELECT count(*) FROM corpus_evidence WHERE source_key LIKE 'webseed:%'),
    (SELECT count(*) FROM corpus_measures WHERE source_key LIKE 'webseed:%');
END $$;
