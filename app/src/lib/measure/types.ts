/**
 * 施策データセット（EBPM）の型と語彙 — E1
 *
 * ── このファイルが正本 ─────────────────────────────────────
 * measure_designs テーブル（036）の各区画の形・語彙・表示名は
 * すべてここに集約する。画面・API・対話プロンプトはここだけを参照する。
 * （ロジックモデルで列定義が画面ごとに割れて事故になった反省。
 *   L2 で LOGIC_COLUMNS に集約したのと同じ方針。）
 *
 * ── 根拠にしている一般資料 ─────────────────────────────────
 * - EBPMの手順: 内閣官房 行政改革推進本部 EBPMガイドブック
 * - エビデンスレベル: Maryland Scientific Methods Scale（Sherman et al. 1998）
 *   および医療分野のエビデンスピラミッド（5段階）
 * - 指標の三層: Donabedian（1966）のストラクチャー／プロセス／アウトカム。
 *   厚労省の介護予防・総合事業の評価（図6・図7の出典）も同じ三分類
 * - 自治体での実験の作法: 環境省 日本版ナッジ・ユニット（BEST）年次報告
 */

// ─── エビデンスレベル（5段階）──────────────────────────────

export type EvidenceLevel = 1 | 2 | 3 | 4 | 5;

export interface EvidenceLevelMeta {
  level: EvidenceLevel;
  label: string;
  designs: string;
  note: string;
  color: string;
}

/** 弱い→強いの順。画面では常にこの階層を添えて表示する */
export const EVIDENCE_LEVELS: Record<EvidenceLevel, EvidenceLevelMeta> = {
  5: {
    level: 5,
    label: "系統的レビュー・メタ分析",
    designs: "複数のRCTの統合",
    note: "最も強い。ただし対象集団の違い（外的妥当性）は必ず確認する",
    color: "#10b981",
  },
  4: {
    level: 4,
    label: "RCT（ランダム化比較試験）",
    designs: "無作為割付による比較",
    note: "因果を最も強く主張できる単独研究",
    color: "#34d399",
  },
  3: {
    level: 3,
    label: "準実験",
    designs: "差の差・回帰不連続・マッチング・操作変数",
    note: "対照群はあるが無作為でない。設計の妥当性に依存する",
    color: "#fbbf24",
  },
  2: {
    level: 2,
    label: "前後比較・単純時系列",
    designs: "対照群なしの前後比較",
    note: "他要因（景気・制度変更・自然な回復）を除けない",
    color: "#fb923c",
  },
  1: {
    level: 1,
    label: "事例報告・専門家意見",
    designs: "他自治体の事例・有識者の見解",
    note: "参考情報。これのみを根拠に効果を主張しない",
    color: "#94a3b8",
  },
};

/** エビデンス項目の研究デザイン → レベルの対応 */
export const STUDY_DESIGNS = [
  { key: "sr", label: "系統的レビュー・メタ分析", level: 5 as EvidenceLevel },
  { key: "rct", label: "RCT", level: 4 as EvidenceLevel },
  { key: "qed", label: "準実験（差の差・RD・マッチング等）", level: 3 as EvidenceLevel },
  { key: "prepost", label: "前後比較・時系列", level: 2 as EvidenceLevel },
  { key: "case", label: "事例報告・専門家意見", level: 1 as EvidenceLevel },
] as const;

export type StudyDesignKey = (typeof STUDY_DESIGNS)[number]["key"];

// ─── エビデンス ───────────────────────────────────────────

export type EvidenceStatus = "sufficient" | "partial" | "none";

export const EVIDENCE_STATUS_META: Record<
  EvidenceStatus,
  { label: string; color: string; desc: string }
> = {
  sufficient: {
    label: "参照エビデンスあり",
    color: "#10b981",
    desc: "適用可能なエビデンスを参照できた。外的妥当性メモを添えて実施できる",
  },
  partial: {
    label: "部分的",
    color: "#f59e0b",
    desc: "関連するエビデンスはあるが対象・介入が異なる。実験設計を添えて確定する",
  },
  none: {
    label: "エビデンスなし",
    color: "#ef4444",
    desc: "参照できるエビデンスが無い。実験設計（エビデンスを作りながら実施）が必要",
  },
};

export interface EvidenceItem {
  title: string;
  source: string;
  url?: string;
  year?: number | null;
  design: StudyDesignKey;
  /** 1〜5。design から既定値を引くが、内容に応じて上書き可 */
  evidence_level: EvidenceLevel;
  /** その研究の対象集団 */
  population?: string;
  effect_summary: string;
  /** 外的妥当性: その研究の対象と当自治体の違い・それでも適用できると考える根拠 */
  transferability?: string;
}

// ─── 実験設計 ─────────────────────────────────────────────

export type ExperimentDesignKey =
  | "rct"
  | "cluster_rct"
  | "stepped_wedge"
  | "waitlist"
  | "rdd"
  | "did"
  | "synthetic_control"
  | "matching"
  | "iv"
  | "its"
  | "prepost";

export interface ExperimentDesignMeta {
  key: ExperimentDesignKey;
  label: string;
  /** どういう状況で選ぶか（AIの提案ロジックもこの条件に従う） */
  when: string;
  /** 得られるエビデンスレベル */
  level: EvidenceLevel;
}

/**
 * 自治体の規模・状況に応じた設計のはしご。上から順に検討する。
 * 対象規模で個人割付ができないなら単位を上げ、対照が作れないなら準実験へ落とす。
 * どこまで落ちたか（＝得られるレベル）を隠さないことが重要。
 */
export const EXPERIMENT_DESIGNS: ExperimentDesignMeta[] = [
  {
    key: "rct",
    label: "RCT（個人単位の無作為割付）",
    when: "対象者を個人単位で割り付けられ、対象規模が検出力を満たす（目安: 各群百人以上）",
    level: 4,
  },
  {
    key: "cluster_rct",
    label: "クラスターRCT（会場・地区単位）",
    when: "介入が会場・地区単位でしか提供できない（教室・拠点型の事業など）",
    level: 4,
  },
  {
    key: "stepped_wedge",
    label: "ステップド・ウェッジ（順次導入）",
    when: "最終的に全員へ提供する前提で、導入時期を無作為にずらせる。公平性の説明がしやすく行政向き",
    level: 4,
  },
  {
    key: "waitlist",
    label: "待機リスト方式",
    when: "定員があり順番に提供する事業。待機期間中の群を対照として使う",
    level: 4,
  },
  {
    key: "rdd",
    label: "回帰不連続（RDD）",
    when:
      "対象の可否が閾値で決まる（年齢・所得段階・要介護度・チェックリスト点数など）。" +
      "閾値の前後は他の条件が似ているため、割付をしなくても比較群が手に入る。" +
      "閾値付近に十分な人数（目安: 前後それぞれ数十人以上）が必要",
    level: 4,
  },
  {
    key: "did",
    label: "差の差（DiD）",
    when: "全域一斉で対照群が作れない。近隣自治体・未実施地区・過去トレンドと比較する",
    level: 3,
  },
  {
    key: "synthetic_control",
    label: "合成対照法（SCM）",
    when:
      "介入する単位が1つしかない（1保険者・1自治体まるごとの制度変更など）。" +
      "似た他自治体を重み付けして合成した『介入しなかった場合の自分』と比べる。" +
      "介入前の期間が複数期（目安5期以上）そろっていることが条件",
    level: 3,
  },
  {
    key: "matching",
    label: "マッチング比較（傾向スコア）",
    when:
      "参加が任意で無作為化できない。参加の決まり方を説明できる属性が手元にある場合に、" +
      "属性の近い非参加者と比較する（説明できない動機が残るぶん自己選択バイアスに注意）",
    level: 3,
  },
  {
    key: "iv",
    label: "操作変数法（IV）",
    when:
      "参加の有無に影響するが結果には直接影響しない要因がある" +
      "（会場までの距離、勧奨通知を無作為に送った、制度改正の時期差など）。" +
      "その要因を使って参加の効果を取り出す",
    level: 3,
  },
  {
    key: "its",
    label: "中断時系列（ITS）",
    when:
      "比較できる他集団がまったく無いが、介入前の時系列が十分に長い" +
      "（目安: 介入前に月次12点以上）。導入時点で水準・傾きが変わったかを見る",
    level: 3,
  },
  {
    key: "prepost",
    label: "前後比較＋モニタリング",
    when:
      "上記のいずれも困難な場合の最終手段。同時期に起きた他の出来事と区別できないため、" +
      "外部要因（制度改正・報酬改定・人口動態・他事業）を記録し続けることを設計に含める",
    level: 2,
  },
];

export const EXPERIMENT_DESIGN_META: Record<ExperimentDesignKey, ExperimentDesignMeta> =
  Object.fromEntries(EXPERIMENT_DESIGNS.map((d) => [d.key, d])) as Record<
    ExperimentDesignKey,
    ExperimentDesignMeta
  >;

/** 検討したが採らなかった設計と、その理由 */
export interface ConsideredDesign {
  design: ExperimentDesignKey;
  /** なぜ採れないのか（規模・割付の可否・データの有無・倫理） */
  rejected_because: string;
}

export interface ExperimentPlan {
  design: ExperimentDesignKey;
  /** なぜその設計か（規模・倫理・運用の制約から） */
  rationale: string;
  /** 割付の単位（個人／会場／地区） */
  unit?: string;
  /** 群の構成 */
  arms?: string;
  /** 検出力の目安（想定効果量から必要数を概算し、対象規模で足りるか） */
  sample_size_note?: string;
  /** 主要評価項目（どのKPIで判定するか） */
  primary_outcome?: string;
  duration?: string;
  cost_estimate?: string;
  /** 同意・不利益回避の方法 */
  ethical_note?: string;
  /** その設計が崩れたときの次善策 */
  fallback?: string;
  /**
   * 検討したが採らなかった設計と理由。
   * 「エビデンスの有無に関わらず実験は必ず設計する」方針の実質を担保するための欄で、
   * RCT 以外を選んだときは、なぜ RCT が採れないのかがここに残る。
   */
  considered?: ConsideredDesign[];
  /** 測定の設計 — 名簿・ベースライン・共変量を、いつ・どう取るか */
  data_design?: string;
  /** その設計が成り立つ前提と、その確かめ方（並行トレンド・閾値操作の有無など） */
  assumption_check?: string;
}

// ─── 指標（Donabedian 三層）───────────────────────────────

export interface SimpleIndicator {
  id: string;
  text: string;
  /** 数値で追う場合に kpis テーブルへ紐づけられる（任意） */
  kpi_id?: string | null;
}

// ─── データセット本体 ─────────────────────────────────────

export type MeasureStatus = "draft" | "confirmed";

export interface MeasureDesign {
  id: string;
  project_id: string;
  // A. 出所
  issue_hypothesis_id: string | null;
  root_cause_snapshot: string | null;
  gap_analysis_ids: string[];
  measure_dialogue_id: string | null;
  // B. 施策の定義
  title: string;
  approach: string | null;
  target_population: string | null;
  target_size: number | null;
  intervention: string | null;
  delivery: string | null;
  period_start: string | null;
  period_end: string | null;
  // C. エビデンス
  evidence_status: EvidenceStatus;
  evidence_items: EvidenceItem[];
  // D. 実験設計
  experiment: ExperimentPlan | null;
  // E. 指標
  structure_indicators: SimpleIndicator[];
  process_indicators: SimpleIndicator[];
  kpi_ids_initial: string[];
  kpi_ids_intermediate: string[];
  // F. コスト
  total_budget: number | null;
  unit_cost: number | null;
  cost_per_outcome_note: string | null;
  funding: string | null;
  /** 積算内訳（費目別）— X4。costフェーズのAIがコーパスのコスト実績を参照して提案 */
  budget_breakdown: BudgetBreakdownItem[];
  // G. 実行
  owner_department: string | null;
  milestones: { label: string; due?: string }[];
  risks: { text: string }[];
  // H. 管理
  status: MeasureStatus;
  sort_order: number;
  committed_at: string | null;
  created_at: string;
  updated_at: string;
}

// ─── 区画の定義（画面の完成度表示・対話の進行はこれを見る）──

export type SectionKey = "origin" | "definition" | "evidence" | "experiment" | "indicators" | "cost" | "execution";

export interface SectionMeta {
  key: SectionKey;
  label: string;
  desc: string;
}

export const MEASURE_SECTIONS: SectionMeta[] = [
  { key: "origin", label: "出所", desc: "どの課題仮説・真因・ギャップから出た施策か" },
  { key: "definition", label: "施策の定義", desc: "作用機序・対象・介入内容・実施体制・期間" },
  { key: "evidence", label: "エビデンス", desc: "参照した根拠とそのレベル・外的妥当性" },
  { key: "experiment", label: "実験設計", desc: "エビデンス不足時の効果検証の設計" },
  { key: "indicators", label: "指標", desc: "ストラクチャー／プロセス指標と短期・中間KPI" },
  { key: "cost", label: "コスト・効率性", desc: "総事業費・単価・成果1単位あたり費用の算定式" },
  { key: "execution", label: "実行", desc: "所管・マイルストーン・リスク" },
];

/** 各区画がどの程度埋まっているか（0=未着手 / 1=一部 / 2=完了） */
export function sectionCompleteness(m: MeasureDesign): Record<SectionKey, 0 | 1 | 2> {
  const some = (...vals: unknown[]) => vals.some((v) => v != null && v !== "" && !(Array.isArray(v) && v.length === 0));
  const all = (...vals: unknown[]) => vals.every((v) => v != null && v !== "" && !(Array.isArray(v) && v.length === 0));
  const grade = (someV: boolean, allV: boolean): 0 | 1 | 2 => (allV ? 2 : someV ? 1 : 0);

  const evidenceDone =
    m.evidence_status === "sufficient"
      ? m.evidence_items.length > 0
      : m.evidence_items.length > 0 || m.evidence_status === "none";

  // 実験設計は「エビデンスが十分なら不要」なので、その場合は完了扱い
  const experimentGrade: 0 | 1 | 2 =
    m.evidence_status === "sufficient"
      ? 2
      : m.experiment
        ? m.experiment.rationale && m.experiment.design
          ? 2
          : 1
        : 0;

  return {
    origin: grade(
      some(m.issue_hypothesis_id, m.root_cause_snapshot, m.gap_analysis_ids),
      all(m.root_cause_snapshot) && some(m.issue_hypothesis_id, m.gap_analysis_ids),
    ),
    definition: grade(
      some(m.approach, m.target_population, m.intervention),
      all(m.approach, m.target_population, m.intervention) && some(m.delivery, m.period_start),
    ),
    evidence: grade(m.evidence_items.length > 0 || m.evidence_status !== "none", evidenceDone),
    experiment: experimentGrade,
    indicators: grade(
      some(m.structure_indicators, m.process_indicators, m.kpi_ids_initial, m.kpi_ids_intermediate),
      m.kpi_ids_initial.length > 0 &&
        (m.process_indicators.length > 0 || m.structure_indicators.length > 0),
    ),
    cost: grade(some(m.total_budget, m.unit_cost, m.funding), all(m.total_budget) && some(m.cost_per_outcome_note)),
    execution: grade(some(m.owner_department, m.milestones, m.risks), all(m.owner_department)),
  };
}

/**
 * 確定できるか（承認済み方針: エビデンス十分 or 実験設計あり）。
 * DB の CHECK 制約と同じ規則。画面ではこちらで先に判定して理由を出す。
 */
export function canConfirm(m: MeasureDesign): { ok: boolean; reason: string | null } {
  if (m.title.trim() === "") return { ok: false, reason: "施策名が未入力です" };
  if (m.evidence_status === "sufficient") {
    if (m.evidence_items.length === 0) {
      return {
        ok: false,
        reason: "「参照エビデンスあり」なのにエビデンスが1件も記録されていません",
      };
    }
    return { ok: true, reason: null };
  }
  const hasExperiment =
    m.experiment != null && typeof m.experiment === "object" && !!m.experiment.design;
  if (!hasExperiment) {
    return {
      ok: false,
      reason:
        "参照可能なエビデンスが無い施策は、実験設計（効果検証の方法）を添えないと確定できません。" +
        "エビデンスを作りながら実施するのがEBPMの標準的な形です。",
    };
  }
  return { ok: true, reason: null };
}

// ─── 正規化（JSONB はどの形が来ても壊れないように）─────────

function asArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    const t = v.trim();
    if (t.startsWith("[")) {
      try {
        const p: unknown = JSON.parse(t);
        if (Array.isArray(p)) return p;
      } catch {
        /* fallthrough */
      }
    }
  }
  return [];
}

function asObject(v: unknown): Record<string, unknown> | null {
  if (v == null) return null;
  if (typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  if (typeof v === "string") {
    const t = v.trim();
    if (t.startsWith("{")) {
      try {
        const p: unknown = JSON.parse(t);
        if (typeof p === "object" && p !== null && !Array.isArray(p)) {
          return p as Record<string, unknown>;
        }
      } catch {
        /* fallthrough */
      }
    }
  }
  return null;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v : null;
const numOrNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

export function normalizeEvidenceItems(v: unknown): EvidenceItem[] {
  return asArray(v)
    .map((raw) => asObject(raw))
    .filter((o): o is Record<string, unknown> => o !== null)
    .map((o) => {
      const design = STUDY_DESIGNS.some((d) => d.key === o["design"])
        ? (o["design"] as StudyDesignKey)
        : "case";
      const fallbackLevel = STUDY_DESIGNS.find((d) => d.key === design)?.level ?? 1;
      const rawLevel = numOrNull(o["evidence_level"]);
      const level: EvidenceLevel =
        rawLevel != null && rawLevel >= 1 && rawLevel <= 5
          ? (Math.round(rawLevel) as EvidenceLevel)
          : fallbackLevel;
      const out: EvidenceItem = {
        title: str(o["title"]),
        source: str(o["source"]),
        design,
        evidence_level: level,
        effect_summary: str(o["effect_summary"]),
      };
      const url = strOrNull(o["url"]);
      if (url) out.url = url;
      const year = numOrNull(o["year"]);
      if (year != null) out.year = year;
      const population = strOrNull(o["population"]);
      if (population) out.population = population;
      const transferability = strOrNull(o["transferability"]);
      if (transferability) out.transferability = transferability;
      return out;
    })
    .filter((e) => e.title !== "" || e.effect_summary !== "");
}

export function normalizeExperiment(v: unknown): ExperimentPlan | null {
  const o = asObject(v);
  if (!o) return null;
  const design = EXPERIMENT_DESIGNS.some((d) => d.key === o["design"])
    ? (o["design"] as ExperimentDesignKey)
    : null;
  if (!design) return null;
  const out: ExperimentPlan = { design, rationale: str(o["rationale"]) };
  for (const key of [
    "unit",
    "arms",
    "sample_size_note",
    "primary_outcome",
    "duration",
    "cost_estimate",
    "ethical_note",
    "fallback",
    "data_design",
    "assumption_check",
  ] as const) {
    const val = strOrNull(o[key]);
    if (val) out[key] = val;
  }
  const considered = normalizeConsideredDesigns(o["considered"]);
  if (considered.length > 0) out.considered = considered;
  return out;
}

/** 検討したが採らなかった設計（最大6件・既知のキーのみ） */
export function normalizeConsideredDesigns(v: unknown): ConsideredDesign[] {
  if (!Array.isArray(v)) return [];
  const out: ConsideredDesign[] = [];
  const seen = new Set<string>();
  for (const it of v.slice(0, 8)) {
    const o = asObject(it);
    if (!o) continue;
    const design = EXPERIMENT_DESIGNS.some((d) => d.key === o["design"])
      ? (o["design"] as ExperimentDesignKey)
      : null;
    if (!design || seen.has(design)) continue;
    const because = str(o["rejected_because"]).trim().slice(0, 300);
    if (!because) continue;
    seen.add(design);
    out.push({ design, rejected_because: because });
    if (out.length >= 6) break;
  }
  return out;
}

export function normalizeSimpleIndicators(v: unknown, prefix: string): SimpleIndicator[] {
  const seen = new Set<string>();
  return asArray(v)
    .map((raw, i): SimpleIndicator | null => {
      if (typeof raw === "string") {
        const text = raw.trim();
        return text === "" ? null : { id: `${prefix}_${i}`, text, kpi_id: null };
      }
      const o = asObject(raw);
      if (!o) return null;
      const text = str(o["text"] ?? o["label"]).trim();
      if (text === "") return null;
      let id = str(o["id"]).trim();
      if (id === "") id = `${prefix}_${i}`;
      if (seen.has(id)) id = `${id}_${i}`;
      seen.add(id);
      return { id, text, kpi_id: strOrNull(o["kpi_id"]) };
    })
    .filter((x): x is SimpleIndicator => x !== null);
}

function normalizeUuidArray(v: unknown): string[] {
  return asArray(v).filter((x): x is string => typeof x === "string" && x.trim() !== "");
}

/** DBの行（JSONB混在）を MeasureDesign に正規化する。読む側は必ずこれを通す */
export function normalizeMeasure(row: Record<string, unknown>): MeasureDesign {
  const status: MeasureStatus = row["status"] === "confirmed" ? "confirmed" : "draft";
  const evidenceStatus: EvidenceStatus =
    row["evidence_status"] === "sufficient" || row["evidence_status"] === "partial"
      ? row["evidence_status"]
      : "none";
  return {
    id: str(row["id"]),
    project_id: str(row["project_id"]),
    issue_hypothesis_id: strOrNull(row["issue_hypothesis_id"]),
    root_cause_snapshot: strOrNull(row["root_cause_snapshot"]),
    gap_analysis_ids: normalizeUuidArray(row["gap_analysis_ids"]),
    measure_dialogue_id: strOrNull(row["measure_dialogue_id"]),
    title: str(row["title"]),
    approach: strOrNull(row["approach"]),
    target_population: strOrNull(row["target_population"]),
    target_size: numOrNull(row["target_size"]),
    intervention: strOrNull(row["intervention"]),
    delivery: strOrNull(row["delivery"]),
    period_start: strOrNull(row["period_start"]),
    period_end: strOrNull(row["period_end"]),
    evidence_status: evidenceStatus,
    evidence_items: normalizeEvidenceItems(row["evidence_items"]),
    experiment: normalizeExperiment(row["experiment"]),
    structure_indicators: normalizeSimpleIndicators(row["structure_indicators"], "st"),
    process_indicators: normalizeSimpleIndicators(row["process_indicators"], "pr"),
    kpi_ids_initial: normalizeUuidArray(row["kpi_ids_initial"]),
    kpi_ids_intermediate: normalizeUuidArray(row["kpi_ids_intermediate"]),
    total_budget: numOrNull(row["total_budget"]),
    unit_cost: numOrNull(row["unit_cost"]),
    cost_per_outcome_note: strOrNull(row["cost_per_outcome_note"]),
    funding: strOrNull(row["funding"]),
    budget_breakdown: normalizeBudgetBreakdown(row["budget_breakdown"]),
    owner_department: strOrNull(row["owner_department"]),
    milestones: asArray(row["milestones"])
      .map((raw) => asObject(raw))
      .filter((o): o is Record<string, unknown> => o !== null)
      .map((o) => {
        const m: { label: string; due?: string } = { label: str(o["label"] ?? o["text"]) };
        const due = strOrNull(o["due"]);
        if (due) m.due = due;
        return m;
      })
      .filter((m) => m.label !== ""),
    risks: asArray(row["risks"])
      .map((raw) => (typeof raw === "string" ? { text: raw } : { text: str(asObject(raw)?.["text"]) }))
      .filter((r) => r.text !== ""),
    status,
    sort_order: numOrNull(row["sort_order"]) ?? 0,
    committed_at: strOrNull(row["committed_at"]),
    created_at: str(row["created_at"]),
    updated_at: str(row["updated_at"]),
  };
}

// ═══════════════════════════════════════════════════════════
// 対話（measure_dialogues）の型 — E2
// ═══════════════════════════════════════════════════════════

export type MeasureStep =
  | "approach" // 真因を断つアプローチの導出
  | "evidence" // エビデンス探索（ナレッジ → Web）
  | "experiment" // 実験設計（エビデンス不足時）
  | "indicators" // SPO三層の指標とKPI
  | "cost" // コストと効率性の算定式
  | "done";

export const MEASURE_STEP_ORDER: MeasureStep[] = [
  "approach",
  "evidence",
  "experiment",
  "indicators",
  "cost",
  "done",
];

export const MEASURE_STEP_LABEL: Record<MeasureStep, string> = {
  approach: "アプローチの導出",
  evidence: "エビデンス探索",
  experiment: "実験設計",
  indicators: "指標の設定",
  cost: "コストの整理",
  done: "完了",
};

export const MEASURE_STEP_HINT: Record<MeasureStep, string> = {
  approach: "真因のどこを・どう断つのかを決め、施策の輪郭（対象・介入）を作ります",
  evidence: "施策ごとに、まず管理画面のナレッジから、無ければWebからエビデンスを探します",
  experiment: "参照できるエビデンスが無い施策に、規模・状況に応じた効果検証の設計を添えます",
  indicators: "ストラクチャー／プロセス指標と、短期・中間のアウトカムKPIを決めます",
  cost: "総事業費・単価と、効率性評価が使う算定式を整えます",
  done: "施策データセットが確定しました",
};

/** 対話で導出したアプローチ（＝施策の種）。commit で measure_designs になる */
export interface ApproachItem {
  id: string;
  /** どの真因に対するアプローチか（文言で保持。仮説側が直っても動かない） */
  root_cause: string;
  /** 作用機序: 真因をどう断つか */
  approach: string;
  measure_title: string;
  target: string;
  intervention: string;
  /** commit 済みの場合、書き出し先の measure_designs.id */
  measure_design_id?: string | null;
  /**
   * 取り下げたアプローチ。行は消さずにこの印を立てる。
   * エビデンス・実験・指標・コストが approach_id で参照しているため、
   * 行を消すと下流が黙って壊れる（課題仮説設定の merge_problems と同じ方式）。
   */
  retired?: boolean;
  /** 取り下げの理由（別施策として扱う・統合した 等） */
  retired_reason?: string;
}

/** 取り下げていないアプローチ */
export function activeApproaches(items: ApproachItem[]): ApproachItem[] {
  return items.filter((a) => !a.retired);
}

/**
 * 同じ名前のアプローチが並んでいないか。
 * 2026-08-31、担当者の「1本にまとめて」という依頼に対しAIが a1 と同名の a2 を
 * 追加してしまい、画面上は見分けが付かなくなった。名前で気づけるようにする。
 */
export function duplicateApproachTitles(items: ApproachItem[]): string[] {
  const seen = new Map<string, number>();
  for (const a of activeApproaches(items)) {
    const key = a.measure_title.trim();
    if (!key) continue;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return Array.from(seen.entries())
    .filter(([, n]) => n > 1)
    .map(([t]) => t);
}

/** アプローチごとのエビデンス評価 */
export interface ApproachEvidence {
  approach_id: string;
  status: EvidenceStatus;
  items: EvidenceItem[];
  /** 総括（どの程度確からしいか・外的妥当性の全体所見） */
  note?: string;
}

/** アプローチごとの実験設計（E3）。ExperimentPlan に宛先を付けたもの */
export interface ApproachExperiment extends ExperimentPlan {
  approach_id: string;
}

/** 対話で提案するアウトカムKPI（既存参照 or 新規案）— E4 */
export interface KpiDraft {
  /** 既存KPIを使う場合はそのid（新規案なら null） */
  existing_kpi_id?: string | null;
  label: string;
  unit: string;
  /** 現在の値（分かる場合。新規作成時は基準値と現在値の初期値になる） */
  baseline?: number | null;
  target?: number | null;
  /** YYYY-MM-DD */
  deadline?: string | null;
  /** 達成条件の向き（既定 gte） */
  condition?: "lte" | "lt" | "gte" | "gt" | "eq";
}

/** アプローチごとの指標（Donabedian三層 + KPI）— E4 */
export interface ApproachIndicators {
  approach_id: string;
  /** ストラクチャー指標（体制・投入）。文字列で保持し commit で {id,text} 化 */
  structure: string[];
  /** プロセス指標（実施量・実施率） */
  process: string[];
  /** 短期アウトカムKPI（概ね1年）。1件以上必須 */
  outcome_initial: KpiDraft[];
  /** 中間アウトカムKPI（2〜5年） */
  outcome_intermediate: KpiDraft[];
}

/** アプローチごとのコスト — E4（X4で積算内訳を追加） */
export interface ApproachCost {
  approach_id: string;
  total_budget?: number | null;
  unit_cost?: number | null;
  /** 成果1単位あたり費用の算定式（効率性評価が使う） */
  cost_per_outcome_note: string;
  funding?: string | null;
  /** 積算内訳（費目別）— X4 */
  breakdown?: BudgetBreakdownItem[];
}

// ─── 積算内訳 — X4 ───────────────────────────────────────

/** 積算内訳の1費目。「委託料 240万円（週1回×48回×5万円）」を構造で持つ */
export interface BudgetBreakdownItem {
  /** 費目（報償費・委託料・需用費・使用料 等） */
  item: string;
  /** 金額（円）。概算段階では省略可 */
  amount?: number | null;
  /** 積算根拠（単価×回数×人数 等）。効率性評価と査定説明の生命線 */
  note?: string;
}

/** 積算内訳を安全に取り込む（最大12費目・費目名必須） */
export function normalizeBudgetBreakdown(v: unknown): BudgetBreakdownItem[] {
  if (!Array.isArray(v)) return [];
  const out: BudgetBreakdownItem[] = [];
  for (const it of v.slice(0, 12)) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const item = typeof o["item"] === "string" ? o["item"].trim().slice(0, 60) : "";
    if (!item) continue;
    const entry: BudgetBreakdownItem = { item };
    const amount = numOrNull(o["amount"]);
    if (amount != null && amount >= 0) entry.amount = amount;
    const note = typeof o["note"] === "string" ? o["note"].trim().slice(0, 300) : "";
    if (note) entry.note = note;
    out.push(entry);
  }
  return out;
}

export interface MeasureMessage {
  role: "user" | "assistant";
  content: string;
  step?: MeasureStep;
  suggestions?: string[];
}

export interface MeasureDialogueData {
  approaches: ApproachItem[];
  evidence: ApproachEvidence[];
  experiments: ApproachExperiment[];
  indicators: ApproachIndicators[];
  costs: ApproachCost[];
}

export interface MeasureDialogue {
  id: string;
  issue_hypothesis_id: string | null;
  title: string;
  status: "in_progress" | "completed";
  current_step: MeasureStep;
  messages: MeasureMessage[];
  approaches: ApproachItem[];
  evidence: ApproachEvidence[];
  experiments: ApproachExperiment[];
  indicators: ApproachIndicators[];
  costs: ApproachCost[];
  committed_at: string | null;
  created_at: string;
  updated_at: string;
}

// ─── 書き出しの完成度 ─────────────────────────────────────

/** 1アプローチについて、施策データセットに欠けている区画 */
export interface MeasureGap {
  approach_id: string;
  measure_title: string;
  missing: string[];
}

/**
 * 施策データセットとして書き出せる状態か検査する（純粋関数・画面とAPIの共用）。
 *
 * 2026-08-31 まで、commit の検査は「アプローチが1件以上あるか」だけだった。
 * エビデンスも実験設計も指標もコストも空のまま書き出せてしまい、しかも
 * 「施策データセットとして書き出す」ボタンはエビデンス探索の段階から出ていた。
 * 下流（ロジックモデルの活動・産出・アウトカム、C評価の効率性、A改善）は
 * データセットが揃っている前提で動くため、空のまま流れると
 * 「KPIの付いていない活動」がロジックモデルに並ぶことになる。
 * 課題仮説設定の真因ガードと同じ型の穴。
 *
 * 実験設計は、参照できるエビデンスの有無に関わらず必須とする（2026-09-01 方針）。
 * 既存研究が他所で効いたことと、この町のこの対象で効くことは別で、
 * 後の評価で因果を論じるには比較の作り方を事業の設計段階で決めておく必要がある。
 * 名簿・ベースライン・比較群は、事業が始まってからでは取り直せない。
 */
export function measureCommitGaps(d: {
  approaches: ApproachItem[];
  evidence: ApproachEvidence[];
  experiments: ApproachExperiment[];
  indicators: ApproachIndicators[];
  costs: ApproachCost[];
}): MeasureGap[] {
  const ev = new Map(d.evidence.map((x) => [x.approach_id, x]));
  const ex = new Map(d.experiments.map((x) => [x.approach_id, x]));
  const ind = new Map(d.indicators.map((x) => [x.approach_id, x]));
  const cost = new Map(d.costs.map((x) => [x.approach_id, x]));

  const gaps: MeasureGap[] = [];
  for (const a of activeApproaches(d.approaches)) {
    const missing: string[] = [];

    const e = ev.get(a.id);
    if (!e || !e.status) missing.push("エビデンス評価");

    // 実験設計は「エビデンスがあるかどうか」に関わらず必須。
    // 後の評価で因果を論じるには、比較の作り方を事業の設計段階で決めておく必要がある
    // （名簿・ベースライン・比較群は、始まってからでは取り直せない）。
    const x = ex.get(a.id);
    if (!x?.design) missing.push("実験設計");
    else {
      if (!x.rationale?.trim()) missing.push("実験設計の選定理由");
      // RCT 以外を選ぶなら、なぜ採れないのかを残す
      if (x.design !== "rct" && (x.considered ?? []).length === 0) {
        missing.push("採らなかった設計とその理由");
      }
    }

    const i = ind.get(a.id);
    if (!i) missing.push("指標");
    else {
      if (i.structure.length + i.process.length === 0) missing.push("ストラクチャー／プロセス指標");
      if (i.outcome_initial.filter((k) => k.label.trim().length > 0).length === 0) {
        missing.push("短期アウトカムKPI");
      }
    }

    const c = cost.get(a.id);
    if (!c || c.cost_per_outcome_note.trim().length === 0) missing.push("コスト（算定式）");

    if (missing.length > 0) {
      gaps.push({ approach_id: a.id, measure_title: a.measure_title || a.id, missing });
    }
  }
  return gaps;
}

/** 422 や画面表示に使う一文にまとめる */
export function describeMeasureGaps(gaps: MeasureGap[]): string {
  // IDを先に置く。同名のアプローチが並ぶと、名前だけではどちらの不足か分からない
  // （2026-09-01、実機で a1 と a2 が同名のまま並び、警告文が読めなかった）
  return gaps.map((g) => `${g.approach_id}「${g.measure_title}」: ${g.missing.join("・")}`).join(" / ");
}
