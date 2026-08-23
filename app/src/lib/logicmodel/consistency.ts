/**
 * ロジックモデルとKPIの整合検査（L3）
 *
 * ── なぜ必要か ─────────────────────────────────────────────
 * 計画（ロジックモデル）と測定（KPI）は別々の画面で作られる。
 * そのため、両者が食い違ったまま評価に進む事故が起きていた。
 *
 *   - 「中間アウトカム」に置いた成果に、短期(概ね1年)のKPIが紐付いている
 *   - KPI側は「この指標はあのKPIに効く」と申告しているのに、
 *     ロジックモデル上ではその因果が描かれていない（逆向きに描かれている）
 *   - 成果は書いてあるが測る指標が無く、評価の段になって測れないと判る
 *
 * 評価の妥当性を問われたときに答えられるのは、
 * 「計画と測定が同じことを言っている」と示せる場合だけである。
 * ここで機械的に突き合わせ、食い違いを出す。
 *
 * ── 方針 ──────────────────────────────────────────────────
 * 検出しても保存はブロックしない。担当者の判断が正しいことは十分にある
 * （例: 中間アウトカムを短期指標の積み上げで見る、という設計）。
 * 出すのは「説明が必要な箇所」であって「誤り」ではない。
 */

import {
  LOGIC_COLUMNS,
  LOGIC_COLUMN_KEYS,
  COLUMN_TO_INDICATOR_TYPE,
  type LogicColumnKey,
  type LogicColumns,
  type LogicEdge,
} from "./elements";
import { normalizeIndicatorType, isOutcomeTier, OUTCOME_TIER_META } from "@/lib/outcome/tiers";

export interface KpiForCheck {
  id: string;
  label: string;
  indicator_type: string | null;
  contributes_to_kpi_id: string | null;
}

export type FindingSeverity = "error" | "warning" | "info";

export interface ConsistencyFinding {
  /** 画面の key に使う安定した識別子 */
  key: string;
  severity: FindingSeverity;
  /** 何が食い違っているか（1行） */
  title: string;
  /** どう直すか */
  hint: string;
  /** 該当する要素id（画面で強調するため） */
  elementIds: string[];
  kpiIds: string[];
}

const COLUMN_LABEL: Record<LogicColumnKey, string> = Object.fromEntries(
  LOGIC_COLUMNS.map((c) => [c.key, c.label]),
) as Record<LogicColumnKey, string>;

const COLUMN_INDEX: Record<LogicColumnKey, number> = Object.fromEntries(
  LOGIC_COLUMN_KEYS.map((k, i) => [k, i]),
) as Record<LogicColumnKey, number>;

/** 三層の並び。短期 → 中間 → 長期 の向きにのみ寄与しうる */
const TIER_RANK: Record<string, number> = {
  outcome_initial: 1,
  outcome_intermediate: 2,
  outcome_long: 3,
};

function tierLabel(t: string): string {
  const n = normalizeIndicatorType(t);
  if (isOutcomeTier(n)) {
    const m = OUTCOME_TIER_META[n];
    return `${m.label}（${m.span}）`;
  }
  return n === "efficiency" ? "効率性指標" : "プロセス指標";
}

/**
 * edges から到達可能性を判定する。
 * edges が空のときは「隣接列の総当たり」が初期提案として表示されているので、
 * 列の順序で代用する（前の列 → 後の列 なら到達可能とみなす）。
 */
function makeReachability(
  edges: LogicEdge[],
  columnOf: Map<string, LogicColumnKey>,
): (from: string, to: string) => boolean {
  if (edges.length === 0) {
    return (from, to) => {
      const a = columnOf.get(from);
      const b = columnOf.get(to);
      if (!a || !b) return false;
      return COLUMN_INDEX[a] < COLUMN_INDEX[b];
    };
  }

  const adj = new Map<string, string[]>();
  for (const e of edges) {
    const list = adj.get(e.from);
    if (list) list.push(e.to);
    else adj.set(e.from, [e.to]);
  }

  return (from, to) => {
    const seen = new Set<string>([from]);
    const queue = [from];
    while (queue.length > 0) {
      const cur = queue.shift() as string;
      if (cur === to) return true;
      for (const next of adj.get(cur) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    return false;
  };
}

export function checkConsistency(
  cols: LogicColumns,
  edges: LogicEdge[],
  kpis: KpiForCheck[],
): ConsistencyFinding[] {
  const findings: ConsistencyFinding[] = [];
  const kpiById = new Map(kpis.map((k) => [k.id, k]));

  // 要素id → 列、KPI id → それが付いている要素id[]
  const columnOf = new Map<string, LogicColumnKey>();
  const elementText = new Map<string, string>();
  const elementsOfKpi = new Map<string, string[]>();

  for (const key of LOGIC_COLUMN_KEYS) {
    for (const el of cols[key] ?? []) {
      columnOf.set(el.id, key);
      elementText.set(el.id, el.text);
      for (const kid of el.kpi_ids) {
        const list = elementsOfKpi.get(kid);
        if (list) list.push(el.id);
        else elementsOfKpi.set(kid, [el.id]);
      }
    }
  }

  const reachable = makeReachability(edges, columnOf);
  const short = (id: string) => {
    const t = elementText.get(id) ?? id;
    return t.length > 22 ? `${t.slice(0, 22)}…` : t;
  };

  // ── C1: 要素の層とKPIの層がずれている ───────────────────
  for (const key of LOGIC_COLUMN_KEYS) {
    const expected = COLUMN_TO_INDICATOR_TYPE[key];
    if (!expected) continue; // 投入・活動は層を問わない
    for (const el of cols[key] ?? []) {
      for (const kid of el.kpi_ids) {
        const kpi = kpiById.get(kid);
        if (!kpi) continue;
        const actual = normalizeIndicatorType(kpi.indicator_type);
        if (actual === expected) continue;
        // 産出物にプロセス指標を置くのは自然なので黙る
        if (key === "outputs" && actual === "process") continue;
        findings.push({
          key: `tier:${el.id}:${kid}`,
          severity: "warning",
          title: `「${short(el.id)}」は${COLUMN_LABEL[key]}だが、指標「${kpi.label}」は${tierLabel(kpi.indicator_type ?? "")}として登録されている`,
          hint:
            "評価のスパンが食い違います。KPIの指標タイプを直すか、要素を対応する列へ移してください。" +
            "意図してこの組み合わせにしている場合（中間の成果を短期指標の積み上げで見るなど）は、その理由を評価コメントに残してください。",
          elementIds: [el.id],
          kpiIds: [kid],
        });
      }
    }
  }

  // ── C2: 同じKPIが異なるアウトカム層に付いている ──────────
  for (const [kid, elIds] of Array.from(elementsOfKpi.entries())) {
    const tierList = elIds
      .map((id: string) => columnOf.get(id))
      .filter((k): k is LogicColumnKey => !!k && !!COLUMN_TO_INDICATOR_TYPE[k]);
    const tiers = Array.from(new Set<LogicColumnKey>(tierList));
    if (tiers.length <= 1) continue;
    const kpi = kpiById.get(kid);
    findings.push({
      key: `multi:${kid}`,
      severity: "warning",
      title: `指標「${kpi?.label ?? kid}」が${tiers.map((t) => COLUMN_LABEL[t]).join("と")}の両方に紐付いている`,
      hint:
        "1つの指標が複数の層を同時に測っていることになり、達成の意味が定まりません。" +
        "どちらか一方に絞るか、層ごとに別の指標を立ててください。",
      elementIds: elIds,
      kpiIds: [kid],
    });
  }

  // ── C3: KPIの寄与関係が、ロジックモデル上に描かれていない ──
  for (const kpi of kpis) {
    const parentId = kpi.contributes_to_kpi_id;
    if (!parentId) continue;
    const parent = kpiById.get(parentId);

    const childEls = elementsOfKpi.get(kpi.id) ?? [];
    const parentEls = elementsOfKpi.get(parentId) ?? [];

    // 寄与の向きそのものが逆（中間 → 短期 など）
    const cr = TIER_RANK[normalizeIndicatorType(kpi.indicator_type)];
    const pr = parent ? TIER_RANK[normalizeIndicatorType(parent.indicator_type)] : undefined;
    if (cr && pr && cr >= pr) {
      findings.push({
        key: `contrib-dir:${kpi.id}`,
        severity: "error",
        title: `指標「${kpi.label}」（${tierLabel(kpi.indicator_type ?? "")}）が「${parent?.label ?? parentId}」（${tierLabel(parent?.indicator_type ?? "")}）に寄与するとされている`,
        hint:
          "寄与は短期 → 中間 → 長期の向きにしか成り立ちません。KPI設定の「寄与先」を見直してください。",
        elementIds: [...childEls, ...parentEls],
        kpiIds: [kpi.id, parentId],
      });
      continue;
    }

    if (childEls.length === 0 || parentEls.length === 0) {
      // どちらかがモデル上に無い場合は C5/C6 で拾う
      continue;
    }

    const anyPath = childEls.some((c) => parentEls.some((p) => reachable(c, p)));
    if (anyPath) continue;

    findings.push({
      key: `contrib-path:${kpi.id}`,
      severity: "warning",
      title: `指標「${kpi.label}」は「${parent?.label ?? parentId}」に寄与するとされているが、ロジックモデル上にその筋道が無い`,
      hint:
        `「${short(childEls[0] ?? "")}」から「${short(parentEls[0] ?? "")}」へ至る因果を描くか、` +
        "KPI設定の「寄与先」を外してください。指標の連鎖と計画の因果が一致していないと、" +
        "中間アウトカムの未達を短期アウトカムまで遡って説明できません。",
      elementIds: [...childEls, ...parentEls],
      kpiIds: [kpi.id, parentId],
    });
  }

  // ── C4: 成果が書かれているのに測る指標が無い ───────────
  for (const key of LOGIC_COLUMN_KEYS) {
    if (!COLUMN_TO_INDICATOR_TYPE[key] || key === "outputs") continue;
    for (const el of cols[key] ?? []) {
      if (el.kpi_ids.length > 0) continue;
      findings.push({
        key: `nokpi:${el.id}`,
        severity: key === "long_outcomes" ? "info" : "warning",
        title: `${COLUMN_LABEL[key]}「${short(el.id)}」に指標が紐付いていない`,
        hint:
          key === "long_outcomes"
            ? "長期アウトカムは判定ではなく軌道の監視が目的ですが、監視する指標が無いと軌道も見えません。"
            : "この成果は評価の段で測れません。KPIを割り当てるか、成果の書き方を測れる表現に改めてください。",
        elementIds: [el.id],
        kpiIds: [],
      });
    }
  }

  // ── C5: アウトカム指標がどの成果にも紐付いていない ────────
  for (const kpi of kpis) {
    const t = normalizeIndicatorType(kpi.indicator_type);
    if (!isOutcomeTier(t)) continue;
    if ((elementsOfKpi.get(kpi.id) ?? []).length > 0) continue;
    findings.push({
      key: `orphan:${kpi.id}`,
      severity: "info",
      title: `指標「${kpi.label}」（${tierLabel(kpi.indicator_type ?? "")}）がロジックモデルのどの成果にも紐付いていない`,
      hint:
        "この指標が何の成果を測っているのかが計画上たどれません。" +
        "対応する成果に割り当てるか、指標の必要性を見直してください。",
      elementIds: [],
      kpiIds: [kpi.id],
    });
  }

  // 重い順・安定順に並べる
  const rank: Record<FindingSeverity, number> = { error: 0, warning: 1, info: 2 };
  return findings.sort((a, b) => rank[a.severity] - rank[b.severity] || a.key.localeCompare(b.key));
}

/** 画面のバッジ用の集計 */
export function summarizeFindings(findings: ConsistencyFinding[]): {
  error: number;
  warning: number;
  info: number;
  label: string;
} {
  const error = findings.filter((f) => f.severity === "error").length;
  const warning = findings.filter((f) => f.severity === "warning").length;
  const info = findings.filter((f) => f.severity === "info").length;
  const parts: string[] = [];
  if (error > 0) parts.push(`要修正 ${error}`);
  if (warning > 0) parts.push(`要確認 ${warning}`);
  if (info > 0) parts.push(`参考 ${info}`);
  return { error, warning, info, label: parts.length > 0 ? parts.join(" / ") : "食い違いなし" };
}
