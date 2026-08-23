/**
 * ロジックモデルの版の差分（L4）
 *
 * ── なぜ必要か ─────────────────────────────────────────────
 * 034 で改訂を「新しい版の追加」に変えた。版が積まれるようになった以上、
 * 「前の版から何が変わったのか」を示せなければ、版を残す意味が薄い。
 *
 * 特に、過去の評価は自分が使った版（program_evaluations.logic_model_id）を
 * 指したままになる。評価の前提が現行版とどう違うのかを見られないと、
 * 「あの評価は今の計画とは別のものを見ていた」という説明ができない。
 *
 * ── 突き合わせ方 ───────────────────────────────────────────
 * 要素IDで突き合わせる（L2 で id を持たせたのはこのため）。
 * IDが一致すれば「同じ要素」であり、文言が変わっていれば「変更」になる。
 * IDで一致しないものは、文言が完全一致する相手を探して救済する
 * （035 より前に書かれた版は id を持たないため）。
 * それでも相手がいなければ、追加または削除とする。
 */

import {
  LOGIC_COLUMNS,
  LOGIC_COLUMN_KEYS,
  type LogicColumnKey,
  type LogicColumns,
  type LogicEdge,
  type LogicElement,
} from "./elements";

export type DiffStatus = "added" | "removed" | "changed" | "moved" | "unchanged";

export interface ElementDiff {
  status: DiffStatus;
  /** 表示に使う代表テキスト（changed のときは変更後） */
  text: string;
  before?: LogicElement;
  after?: LogicElement;
  /** changed の内訳 */
  textChanged: boolean;
  kpiChanged: boolean;
  /** moved のときの位置 */
  fromIndex?: number;
  toIndex?: number;
}

export interface ColumnDiff {
  key: LogicColumnKey;
  label: string;
  color: string;
  elements: ElementDiff[];
  added: number;
  removed: number;
  changed: number;
  moved: number;
}

export interface EdgeDiff {
  added: LogicEdge[];
  removed: LogicEdge[];
}

export interface ModelDiff {
  columns: ColumnDiff[];
  edges: EdgeDiff;
  /** 何か違いがあるか */
  hasChanges: boolean;
  /** 一行の要約 */
  summary: string;
}

function sameKpis(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

function diffColumn(
  key: LogicColumnKey,
  before: LogicElement[],
  after: LogicElement[],
): ColumnDiff {
  const meta = LOGIC_COLUMNS.find((c) => c.key === key);
  const beforeById = new Map(before.map((e) => [e.id, e]));
  const beforeIndex = new Map(before.map((e, i) => [e.id, i]));

  // 035 より前の版は id を持たない。文言で救済するための索引
  const beforeByText = new Map<string, LogicElement>();
  for (const e of before) if (!beforeByText.has(e.text)) beforeByText.set(e.text, e);

  const matched = new Set<string>();
  const out: ElementDiff[] = [];

  after.forEach((a, toIndex) => {
    let b = beforeById.get(a.id);
    if (!b) {
      const byText = beforeByText.get(a.text);
      if (byText && !matched.has(byText.id)) b = byText;
    }

    if (!b) {
      out.push({ status: "added", text: a.text, after: a, textChanged: false, kpiChanged: false });
      return;
    }

    matched.add(b.id);
    const textChanged = b.text !== a.text;
    const kpiChanged = !sameKpis(b.kpi_ids, a.kpi_ids);
    const fromIndex = beforeIndex.get(b.id) ?? -1;

    if (textChanged || kpiChanged) {
      out.push({
        status: "changed",
        text: a.text,
        before: b,
        after: a,
        textChanged,
        kpiChanged,
        fromIndex,
        toIndex,
      });
      return;
    }
    if (fromIndex !== toIndex) {
      out.push({
        status: "moved",
        text: a.text,
        before: b,
        after: a,
        textChanged: false,
        kpiChanged: false,
        fromIndex,
        toIndex,
      });
      return;
    }
    out.push({
      status: "unchanged",
      text: a.text,
      before: b,
      after: a,
      textChanged: false,
      kpiChanged: false,
    });
  });

  for (const b of before) {
    if (matched.has(b.id)) continue;
    out.push({ status: "removed", text: b.text, before: b, textChanged: false, kpiChanged: false });
  }

  const count = (s: DiffStatus) => out.filter((e) => e.status === s).length;

  return {
    key,
    label: meta?.label ?? key,
    color: meta?.color ?? "#94a3b8",
    elements: out,
    added: count("added"),
    removed: count("removed"),
    changed: count("changed"),
    moved: count("moved"),
  };
}

function edgeKey(e: LogicEdge): string {
  return `${e.from}→${e.to}`;
}

export function diffModel(
  before: LogicColumns,
  after: LogicColumns,
  beforeEdges: LogicEdge[] = [],
  afterEdges: LogicEdge[] = [],
): ModelDiff {
  const columns = LOGIC_COLUMN_KEYS.map((key) =>
    diffColumn(key, before[key] ?? [], after[key] ?? []),
  );

  const beforeSet = new Set(beforeEdges.map(edgeKey));
  const afterSet = new Set(afterEdges.map(edgeKey));
  const edges: EdgeDiff = {
    added: afterEdges.filter((e) => !beforeSet.has(edgeKey(e))),
    removed: beforeEdges.filter((e) => !afterSet.has(edgeKey(e))),
  };

  const totals = columns.reduce(
    (acc, c) => ({
      added: acc.added + c.added,
      removed: acc.removed + c.removed,
      changed: acc.changed + c.changed,
      moved: acc.moved + c.moved,
    }),
    { added: 0, removed: 0, changed: 0, moved: 0 },
  );

  const parts: string[] = [];
  if (totals.added > 0) parts.push(`追加 ${totals.added}`);
  if (totals.removed > 0) parts.push(`削除 ${totals.removed}`);
  if (totals.changed > 0) parts.push(`変更 ${totals.changed}`);
  if (totals.moved > 0) parts.push(`並び替え ${totals.moved}`);
  if (edges.added.length > 0) parts.push(`因果追加 ${edges.added.length}`);
  if (edges.removed.length > 0) parts.push(`因果削除 ${edges.removed.length}`);

  const hasChanges = parts.length > 0;

  return {
    columns,
    edges,
    hasChanges,
    summary: hasChanges ? parts.join(" / ") : "この2版に違いはありません",
  };
}

/** 差分表示に使う色（追加=緑・削除=赤・変更=黄・並び替え=水） */
export const DIFF_STYLE: Record<DiffStatus, { label: string; color: string; mark: string }> = {
  added: { label: "追加", color: "#10b981", mark: "+" },
  removed: { label: "削除", color: "#ef4444", mark: "−" },
  changed: { label: "変更", color: "#f59e0b", mark: "~" },
  moved: { label: "並び替え", color: "#38bdf8", mark: "↕" },
  unchanged: { label: "変更なし", color: "#64748b", mark: " " },
};
