/**
 * コーパス検索（類似度スコアリング・純粋・テスト可能）— X4
 *
 * ── このファイルが正本 ─────────────────────────────────────
 * コーパス接地（独自AI v0）の検索・整形はここに集約する。
 * 形態素解析に頼らず、文字バイグラム（2-gram）の重なりで適合度を測る:
 * - 日本語で分かち書き不要・決定的・依存ゼロ
 * - 「介護予防教室」と「介護予防の教室運営」が自然に重なる
 * 精度が必要になったら（コーパスが育ったら）埋め込み検索に置き換える。
 * その際もこの純粋関数のインターフェイスを保つ。
 *
 * 設計: claude/coe-ownai-plan.md（承認済み方針）X4。
 */

// ─── バイグラム ───────────────────────────────────────────

/** 正規化: NFKC・小文字化・空白と記号の除去 */
function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s　。、．，・「」『』（）()[\]{}<>【】〈〉:：;；!！?？/／\\＼\-ー―…‥"'’‘“”`]/g, "");
}

/** 文字バイグラムの集合 */
export function bigrams(text: string | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!text) return out;
  const t = normalize(String(text));
  for (let i = 0; i < t.length - 1; i++) {
    out.add(t.slice(i, i + 2));
  }
  return out;
}

/** クエリ側バイグラムと本文の重なり数 */
export function overlap(query: Set<string>, text: string | null | undefined): number {
  if (query.size === 0 || !text) return 0;
  let n = 0;
  const tb = bigrams(text);
  tb.forEach((g) => {
    if (query.has(g)) n++;
  });
  return n;
}

// ─── スコアリング ─────────────────────────────────────────

/** corpus_measures 行のうちスコアリングに使う部分 */
export interface CorpusMeasureForMatch {
  id: string;
  title: string;
  field_category: string | null;
  population_band: string | null;
  approach: string | null;
  target_population: string | null;
  intervention: string | null;
  outcome_notes: string[];
  effect_note: string | null;
  evidence_status: string;
  total_budget: number | null;
  unit_cost: number | null;
  cost_per_outcome_note: string | null;
  funding: string | null;
}

export interface CorpusEvidenceForMatch {
  id: string;
  title: string;
  field_category: string | null;
  source: string;
  year: number | null;
  design: string;
  evidence_level: number;
  population: string | null;
  effect_summary: string;
  transferability: string | null;
  /** 財政効果率（X7e。年換算財政効果額÷事業費 — 042参照） */
  fiscal_effect_rate?: number | null;
}

/**
 * 施策行の適合度。タイトル・分野を重く、本文を軽く。
 * 自治体規模帯が一致すれば加点（同規模の実績は移転可能性が高い）。
 */
export function scoreMeasure(
  query: Set<string>,
  row: CorpusMeasureForMatch,
  band?: string | null,
): number {
  let s = 0;
  s += 3 * overlap(query, row.title);
  s += 2 * overlap(query, row.field_category);
  s += 2 * overlap(query, row.approach);
  s += 1 * overlap(query, row.target_population);
  s += 1 * overlap(query, row.intervention);
  s += 1 * overlap(query, row.outcome_notes.join(" "));
  if (band && row.population_band && band === row.population_band) s += 2;
  return s;
}

export function scoreEvidence(query: Set<string>, row: CorpusEvidenceForMatch): number {
  let s = 0;
  s += 3 * overlap(query, row.title);
  s += 2 * overlap(query, row.field_category);
  s += 2 * overlap(query, row.effect_summary);
  s += 1 * overlap(query, row.population);
  return s;
}

export interface Ranked<T> {
  row: T;
  score: number;
}

/** スコア降順・しきい値以上の上位N件（同点は元順を保持: 決定的） */
export function rank<T>(
  rows: T[],
  scoreOf: (row: T) => number,
  opts?: { limit?: number; minScore?: number },
): Ranked<T>[] {
  const limit = opts?.limit ?? 5;
  const minScore = opts?.minScore ?? 3;
  return rows
    .map((row, i) => ({ row, score: scoreOf(row), i }))
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, limit)
    .map(({ row, score }) => ({ row, score }));
}

// ─── プロンプト用の整形 ───────────────────────────────────

const yen = (n: number | null | undefined): string | null =>
  n == null ? null : `${Math.round(n).toLocaleString("ja-JP")}円`;

/**
 * 類似施策ブロック。出典（匿名供出/Tier1資料）とエビデンス状況を必ず添え、
 * 「実績のある参照候補」であって指示ではないことが読み取れる形にする。
 */
export function formatMeasureBlock(ranked: Ranked<CorpusMeasureForMatch>[]): string | null {
  if (ranked.length === 0) return null;
  const lines = ranked.map(({ row }) => {
    const parts: string[] = [`- ${row.title}`];
    const meta: string[] = [];
    if (row.field_category) meta.push(row.field_category);
    if (row.population_band) meta.push(`規模帯${row.population_band}`);
    if (meta.length) parts[0] += `（${meta.join("・")}）`;
    if (row.approach) parts.push(`  作用機序: ${row.approach}`);
    if (row.intervention) parts.push(`  介入: ${row.intervention}`);
    if (row.outcome_notes.length > 0) parts.push(`  成果指標: ${row.outcome_notes.join(" / ")}`);
    if (row.effect_note) parts.push(`  実績効果: ${row.effect_note}`);
    const cost: string[] = [];
    if (row.total_budget != null) cost.push(`事業費${yen(row.total_budget)}`);
    if (row.unit_cost != null) cost.push(`単価${yen(row.unit_cost)}`);
    if (row.cost_per_outcome_note) cost.push(`算定式: ${row.cost_per_outcome_note}`);
    if (cost.length) parts.push(`  コスト: ${cost.join(" / ")}`);
    return parts.join("\n");
  });
  return `【横断コーパスの類似施策（他自治体の確定済みデータ・匿名）】\n${lines.join("\n")}`;
}

export function formatEvidenceBlock(ranked: Ranked<CorpusEvidenceForMatch>[]): string | null {
  if (ranked.length === 0) return null;
  const lines = ranked.map(({ row }) => {
    const parts = [
      `- [Lv${row.evidence_level}/${row.design}] ${row.title}（${row.source}${row.year ? `・${row.year}` : ""}）`,
      `  効果: ${row.effect_summary}`,
    ];
    if (row.population) parts.push(`  対象: ${row.population}`);
    if (row.transferability) parts.push(`  特性: ${row.transferability}`);
    return parts.join("\n");
  });
  return `【横断コーパスのエビデンス（検収済み・出典つき）】\n${lines.join("\n")}`;
}

/**
 * コスト実績ブロック（costフェーズの積算用）。
 * 類似施策のうちコスト情報を持つものだけを並べ、レンジも示す。
 */
export function formatCostBlock(ranked: Ranked<CorpusMeasureForMatch>[]): string | null {
  const withCost = ranked.filter(
    ({ row }) =>
      row.total_budget != null || row.unit_cost != null || row.cost_per_outcome_note,
  );
  if (withCost.length === 0) return null;
  const lines = withCost.map(({ row }) => {
    const cost: string[] = [];
    if (row.total_budget != null) cost.push(`事業費${yen(row.total_budget)}`);
    if (row.unit_cost != null) cost.push(`単価${yen(row.unit_cost)}`);
    if (row.funding) cost.push(`財源: ${row.funding}`);
    if (row.cost_per_outcome_note) cost.push(`算定式: ${row.cost_per_outcome_note}`);
    return `- ${row.title}${row.population_band ? `（規模帯${row.population_band}）` : ""}: ${cost.join(" / ")}`;
  });
  const units = withCost
    .map(({ row }) => row.unit_cost)
    .filter((n): n is number => n != null)
    .sort((a, b) => a - b);
  let rangeLine = "";
  if (units.length >= 2) {
    rangeLine = `\n単価レンジ: ${yen(units[0])}〜${yen(units[units.length - 1])}（${units.length}件）`;
  }
  return `【類似施策のコスト実績（横断コーパス）】\n${lines.join("\n")}${rangeLine}`;
}

// ─── corpus_context の適合検索（X7e）───────────────────────
//
// SWOT素材（政策パッケージ・制度・地域統計・トレンド）の適合度。
// 地域の加点は設計 §1-3 の順序を固定する:
//   region_code一致(+4) > 都道府県一致(+3) > population_band一致(+2) > 全国(+1)
// 「適合度しきい値未満は出さない」大原則は rank() の minScore で維持する。

export interface CorpusContextForMatch {
  id: string;
  kind: string;
  title: string;
  body: string;
  pestle_tag: string;
  seven_s_tag: string | null;
  swot_hint: string;
  region_scope: string;
  region_code: string | null;
  population_band: string | null;
  field_category: string | null;
  source_org: string;
  source_url: string | null;
  published_at: string | null;
  effective_until: string | null;
}

export interface ContextMatchOpts {
  /** 自治体の地方公共団体コード（分かる場合のみ。e-Stat由来行と照合） */
  regionCode?: string | null;
  /** 自治体名（例: 御船町。行の題名・本文への言及で照合） */
  municipalityName?: string | null;
  /** 都道府県名（例: 熊本県） */
  prefecture?: string | null;
  band?: string | null;
}

export function scoreContext(
  query: Set<string>,
  row: CorpusContextForMatch,
  opts?: ContextMatchOpts,
): number {
  let s = 0;
  s += 3 * overlap(query, row.title);
  s += 2 * overlap(query, row.field_category);
  s += 1 * overlap(query, row.body);

  // 地域の加点（排他・設計の優先順位どおり）
  const text = `${row.title} ${row.body}`;
  if (opts?.regionCode && row.region_code && opts.regionCode === row.region_code) {
    s += 4;
  } else if (opts?.municipalityName && text.includes(opts.municipalityName)) {
    s += 4;
  } else if (opts?.prefecture && (text.includes(opts.prefecture) || row.region_scope === "prefecture")) {
    s += 3;
  } else if (opts?.band && row.population_band && opts.band === row.population_band) {
    s += 2;
  } else if (row.region_scope === "national") {
    s += 1;
  }
  return s;
}

const CONTEXT_KIND_LABEL: Record<string, string> = {
  policy_package: "政策パッケージ",
  legal_system: "制度・法改正",
  subsidy_program: "補助金・公募",
  regional_stat: "地域統計",
  trend: "トレンド",
};

/**
 * 環境情報ブロック。出典（機関・URL・適用期間）を必ず添える —
 * As-Is/課題仮説の source_text（出典つき原文）にそのまま使える形にする。
 */
export function formatContextBlock(ranked: Ranked<CorpusContextForMatch>[]): string | null {
  if (ranked.length === 0) return null;
  const lines = ranked.map(({ row }) => {
    const parts = [
      `- [${CONTEXT_KIND_LABEL[row.kind] ?? row.kind}/${row.pestle_tag}] ${row.title}`,
      `  ${row.body}`,
    ];
    const src: string[] = [`出典: ${row.source_org}`];
    if (row.published_at) src.push(row.published_at);
    if (row.source_url) src.push(row.source_url);
    if (row.effective_until) src.push(`適用期限 ${row.effective_until}`);
    parts.push(`  ${src.join(" / ")}`);
    return parts.join("\n");
  });
  return `【環境情報（横断コーパス・検収済み・出典つき）】\n${lines.join("\n")}`;
}

// ─── 財政効果率の分布（X7e・効率性評価＝第5階層と同語彙）────
//
// fiscal_effect_rate ＝ 年換算財政効果額 ÷ 事業費（042参照。
// cost_efficiency_records.cost_ratio の逆数に相当）。
// 2件未満は「分布」と呼べないため出さない（X6の単価分布と同じ大原則）。

export interface FiscalRateStats {
  n: number;
  median: number;
  min: number;
  max: number;
}

export function fiscalRateStats(rates: Array<number | null | undefined>): FiscalRateStats | null {
  const xs = rates
    .filter((n): n is number => n != null && Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
  if (xs.length < 2) return null;
  const mid = Math.floor(xs.length / 2);
  const median = xs.length % 2 === 1 ? xs[mid]! : (xs[mid - 1]! + xs[mid]!) / 2;
  return { n: xs.length, median, min: xs[0]!, max: xs[xs.length - 1]! };
}

const rate = (n: number): string => (Math.round(n * 100) / 100).toString();

export function formatFiscalRateBlock(stats: FiscalRateStats | null): string | null {
  if (!stats) return null;
  return [
    `【類似施策の財政効果率（横断コーパス・${stats.n}件）】`,
    `- 財政効果率（年換算財政効果額÷事業費）: 中央値 ${rate(stats.median)}（${rate(stats.min)}〜${rate(stats.max)}）`,
    "※ 効率性評価（第5階層）のコスト比率の逆数に相当。海外由来の値は参考値（各行の注記を参照）",
  ].join("\n");
}

// ─── 推薦ランキングv1（品質・採択実績を加味）— X6 ─────────
//
// 「関係がある」だけでなく「根拠が強く・実績があり・使われてきた」行を
// 上に出す。学習モデルではなく**透明な規則**で始める（説明可能・決定的）。
// コーパスと採択ログが育ったら、この係数を実績データで較正する。

/**
 * 情報の質の係数（1.0〜約1.9）。
 * - エビデンス状況: sufficient +0.3 / partial +0.1
 * - 実績効果あり: +0.3（【変化なし】【悪化】も +0.15 — 「効かない」実績にも価値がある）
 * - コスト情報あり: +0.2（積算の参照可能性）
 * - 成果指標あり: +0.1
 */
export function qualityWeight(row: CorpusMeasureForMatch): number {
  let w = 1.0;
  if (row.evidence_status === "sufficient") w += 0.3;
  else if (row.evidence_status === "partial") w += 0.1;
  if (row.effect_note) {
    w += row.effect_note.includes("【改善") ? 0.3 : 0.15;
  }
  if (row.unit_cost != null || row.cost_per_outcome_note) w += 0.2;
  if (row.outcome_notes.length > 0) w += 0.1;
  return w;
}

/**
 * 採択実績ボーナス。接地された対話が書き出しまで到達した回数（粗い採択・X4定義）。
 * 逓減（log2）かつ上限つき — 実績の偏りで新しい良い行が埋もれないように。
 */
export function adoptionBonus(adoptions: number): number {
  if (!Number.isFinite(adoptions) || adoptions <= 0) return 0;
  return Math.min(0.6, Math.log2(1 + adoptions) * 0.15);
}

/**
 * 推薦ランキング: 適合度がしきい値以上の行だけを対象に、
 *   最終スコア = 適合度 × 品質係数 × (1 + 採択ボーナス)
 * で並べ替える。適合しない行は品質が高くても出さない（接地の大原則）。
 */
export function rankMeasuresSmart(
  query: Set<string>,
  rows: CorpusMeasureForMatch[],
  opts?: {
    limit?: number;
    minScore?: number;
    band?: string | null;
    adoptionByRowId?: Map<string, number>;
  },
): Ranked<CorpusMeasureForMatch>[] {
  const limit = opts?.limit ?? 5;
  const minScore = opts?.minScore ?? 3;
  return rows
    .map((row, i) => {
      const relevance = scoreMeasure(query, row, opts?.band ?? null);
      const adoptions = opts?.adoptionByRowId?.get(row.id) ?? 0;
      const score =
        relevance >= minScore
          ? relevance * qualityWeight(row) * (1 + adoptionBonus(adoptions))
          : 0;
      return { row, score, relevance, i };
    })
    .filter((r) => r.relevance >= minScore)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, limit)
    .map(({ row, score }) => ({ row, score }));
}

// ─── 積算推定v1（単価分布からの概算）— X6 ─────────────────

export interface BudgetEstimate {
  /** 単価情報を持つ類似施策の件数 */
  n: number;
  unit_median: number;
  unit_min: number;
  unit_max: number;
  /** 対象規模が分かる場合の概算総額（中央値×規模、min×規模〜max×規模） */
  total_mid?: number;
  total_low?: number;
  total_high?: number;
}

/**
 * 適合した類似施策の単価分布から概算を出す。
 * 2件未満なら「分布」と呼べないため null（1件の値を相場のように見せない）。
 */
export function estimateBudget(
  ranked: Ranked<CorpusMeasureForMatch>[],
  targetSize?: number | null,
): BudgetEstimate | null {
  const units = ranked
    .map(({ row }) => row.unit_cost)
    .filter((n): n is number => n != null && Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
  if (units.length < 2) return null;
  const mid = Math.floor(units.length / 2);
  const median =
    units.length % 2 === 1 ? units[mid]! : (units[mid - 1]! + units[mid]!) / 2;
  const est: BudgetEstimate = {
    n: units.length,
    unit_median: median,
    unit_min: units[0]!,
    unit_max: units[units.length - 1]!,
  };
  if (targetSize != null && Number.isFinite(targetSize) && targetSize > 0) {
    est.total_mid = Math.round(median * targetSize);
    est.total_low = Math.round(units[0]! * targetSize);
    est.total_high = Math.round(units[units.length - 1]! * targetSize);
  }
  return est;
}

export function formatBudgetEstimateBlock(est: BudgetEstimate | null): string | null {
  if (!est) return null;
  const lines = [
    `【積算の目安（類似施策${est.n}件の単価分布・独自AI v0）】`,
    `- 対象1人あたり単価: 中央値 ${yen(est.unit_median)}（${yen(est.unit_min)}〜${yen(est.unit_max)}）`,
  ];
  if (est.total_mid != null) {
    lines.push(
      `- 概算総額（単価×対象規模）: ${yen(est.total_mid)}（${yen(est.total_low)}〜${yen(est.total_high)}）`,
    );
  }
  lines.push(
    "※ 機械的な概算。介入の頻度・強度・実施体制が違えば単価は大きく変わる。費目内訳（breakdown）を立てて当自治体の実情で必ず補正すること",
  );
  return lines.join("\n");
}
