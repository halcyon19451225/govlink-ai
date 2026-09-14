/**
 * 計画スコープの指標を読むための共通の副問い合わせ — 設計: claude/coe-dataset-model.md §9-1 Step 4
 *
 * 069 で `kpis` は `indicators` に吸収され、いまは**読み取り専用の互換ビュー**が
 * 旧コードを動かしている。ビューを落とすには、読み取り側が `indicators` /
 * `indicator_targets` / `indicator_values` を直接読むようにする必要がある（D7 の前提）。
 *
 * 読み取り側は 47 ファイル・60 か所あり、その多くは「計画の KPI を、旧 `kpis` と
 * 同じ形（label / target / current / unit …）で読む」ものだった。
 * **同じ JOIN を 60 か所に書き写すのは、正本を 60 個作るのと同じ**なので、
 * ここに1つ置いて全員がこれを使う。
 *
 *   FROM kpis WHERE project_id = $1
 *     ↓
 *   FROM ${PLAN_INDICATORS} WHERE project_id = $1      -- 列の参照はそのまま
 *
 *   LEFT JOIN kpis k ON k.id = d.kpi_id
 *     ↓
 *   LEFT JOIN ${PLAN_INDICATORS} k ON k.id = d.kpi_id
 *
 * 別名を付けても、付けなくても、**列の書き方は変えなくてよい**（1つの関係しか無い
 * 場所では修飾なしの列がそのまま解決する）。だから置き換えは機械的に済む。
 *
 * ★ 「本当に必要な列だけを読む」への作り替えは、この置き換えとは別の作業にする。
 *   一度に両方やると、どちらの変更で壊れたのか分からなくなる。
 *   ラベルと単位しか要らない場所は、`indicators` を直接読むように順次痩せさせる。
 *
 * ★ この層は分野に依存しない。特定の行政分野の語彙を書かないこと（check:generic）。
 */

/**
 * 旧 `kpis` ビューと**同じ列・同じ意味**を返す副問い合わせ。
 *
 * - `target` … 計画スコープ（scope='plan'）の目標値。無ければ 0（旧ビューと同じ）
 * - `current` … 計画スコープの最新値。無ければ 0（旧ビューと同じ）
 * - `origin='plan'` の指標だけを返す。施策構築から起こした指標（origin='measure'）まで
 *   返すと、ダッシュボードや計画書の KPI 一覧に施策の指標が混ざる
 *
 * 0 を返すのは「未入力」と区別できないが、**旧ビューがそうだった**ので、
 * 読み替えではそこを変えない（変えるなら画面ごとに意味を決める別の作業）。
 */
export const PLAN_INDICATORS = `(
  SELECT
    i.id,
    i.project_id,
    i.label,
    COALESCE(t.target_value, 0)::numeric        AS target,
    COALESCE(lv.value, 0)::numeric              AS current,
    i.unit,
    i.created_at,
    i.updated_at,
    i.goal_id,
    i.previous_value,
    i.previous_target,
    i.indicator_type,
    COALESCE(t.achievement_condition, 'gte')    AS achievement_condition,
    t.target_deadline,
    t.baseline_value,
    EXTRACT(YEAR FROM t.baseline_as_of)::int    AS baseline_year,
    i.contributes_to_kpi_id,
    i.cloned_from_kpi_id,
    i.target_needs_review,
    i.calc_type,
    i.description
  FROM indicators i
  LEFT JOIN indicator_targets t
         ON t.indicator_id = i.id AND t.scope = 'plan'
  LEFT JOIN LATERAL (
    SELECT v.value FROM indicator_values v
     WHERE v.indicator_id = i.id AND v.scope = 'plan'
       AND v.cohort_id IS NULL AND v.arm IS NULL
     ORDER BY v.as_of DESC, v.computed_at DESC LIMIT 1
  ) lv ON true
  WHERE i.origin = 'plan'
)`;
