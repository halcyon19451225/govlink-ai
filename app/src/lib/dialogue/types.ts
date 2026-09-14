/**
 * 対話からの提案・要求 — 型と検証（純関数だけ）
 *
 * 設計: claude/coe-dataset-model.md §10-2（指標の要求）・§10-3（提案 → 承認 → 登録 → 待機 → 再開）
 *
 * AI の出力はここを通ってからでないと保存されない。**承認前に何も作らない**ので、
 * ここがやるのは「提案として保存してよい形か」の検証だけで、実体は作らない。
 *
 * ★ この層は分野に依存しない。特定の行政分野の語彙を書かないこと（check:generic）。
 */

/** どの対話から出た提案か。最初に載せるのは施策構築だけ（設計 §15-8） */
export type DialogueKind = "measure" | "asis" | "issue" | "improvement";

export type ProposalKind = "dataset" | "indicator";
export type ProposalStatus = "pending" | "approved" | "declined";

/**
 * 箱（データセット）の提案。
 * **集計データの箱だけ**を提案できる。個票の箱は庁内の変換ツール（D5）と鍵の運用が要るので、
 * 対話から作らせない。
 */
export interface DatasetProposal {
  kind: "dataset";
  /** 対話の中での通し名（指標の提案が dependsOn で指す） */
  ref: string;
  name: string;
  /** なぜ必要か（担当者が承認を判断するための説明） */
  why: string;
  /** いつ時点のデータが要るか（YYYY-MM-DD） */
  asOfNeeded: string | null;
  /** 列定義。役割と型が要る（無いと行を取り込めず、指標が計算できない） */
  columns: ProposalColumn[];
  templateId: string | null;
  timeGranularity: "day" | "month" | "fiscal_year";
}

export interface ProposalColumn {
  name: string;
  role: "dimension" | "time" | "measure";
  type: string;
}

/** 指標の提案。spec は lib/indicator/spec.ts の validateSpec を通ってからでないと保存しない */
export interface IndicatorProposal {
  kind: "indicator";
  ref: string;
  label: string;
  unit: string;
  why: string;
  calcType: "aggregate" | "longitudinal" | "cross" | "formula" | "manual";
  /** 算出の設定。datasetId は未登録の箱を指せないので、承認時に dependsOn から埋める */
  spec: Record<string, unknown>;
  /** どの箱の提案に依存するか（その箱の ref） */
  dependsOn: string | null;
}

export type Proposal = DatasetProposal | IndicatorProposal;

/** 保存済みの提案（画面と API が読む形） */
export interface ProposalRow {
  id: string;
  project_id: string;
  dialogue_kind: DialogueKind;
  dialogue_id: string;
  turn_no: number;
  ref: string;
  kind: ProposalKind;
  payload: Proposal;
  status: ProposalStatus;
  decided_by: string | null;
  decided_at: string | null;
  decline_reason: string | null;
  dataset_id: string | null;
  indicator_id: string | null;
  created_at: string;
  /** 承認済みの箱に、まだ有効な版が1つも無いか（＝待っている） */
  awaiting_upload?: boolean;
  /** 承認済みの箱の最新の基準日 */
  latest_as_of?: string | null;
}

/** AI が「この指標の値が要る」と書いたもの（設計 §10-2） */
export interface IndicatorRequest {
  /** 登録済みの指標 ID。無ければ label で探す */
  indicatorId: string | null;
  label: string | null;
  asOf: string | null;
}

/**
 * 次のターンの冒頭に差し込むデータ行。
 * 「AI が調べて同期で答える」形にはしない（Amplify の 30 秒制限・設計 §10-2）。
 */
export interface PendingInput {
  kind: "indicator_value" | "missing" | "approved" | "declined" | "data_ready";
  text: string;
  at: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const COLUMN_ROLES = new Set(["dimension", "time", "measure"]);
// lib/dataset/types.ts の ColumnType と同じ語彙。ここが広いと、承認したのに
// 列定義の検証で落ちる提案が作れてしまう
const COLUMN_TYPES = new Set(["text", "int", "numeric", "fiscal_year", "year", "month", "date"]);
const GRANULARITIES = new Set(["day", "month", "fiscal_year"]);
const CALC_TYPES = new Set(["manual", "aggregate", "longitudinal", "cross", "formula"]);

function text(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function slug(v: unknown): string {
  // ref は対話の中の通し名。画面にも出るので、扱いやすい文字に限る
  const s = text(v, 60);
  return /^[A-Za-z0-9_-]{1,60}$/.test(s) ? s : "";
}

/**
 * AI の出力から提案を取り出す。**捨てるものは黙って捨てない**（呼び出し側が件数を記録する）。
 * ここで通った提案も、担当者が承認するまでは何も作らない。
 */
export function sanitizeProposals(raw: unknown, opts: { max?: number } = {}): Proposal[] {
  if (!Array.isArray(raw)) return [];
  const max = opts.max ?? 6;
  const out: Proposal[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    if (out.length >= max) break;
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const ref = slug(o["ref"]);
    if (!ref || seen.has(ref)) continue;
    const why = text(o["why"], 400);

    if (o["kind"] === "dataset") {
      const name = text(o["name"], 120);
      if (!name) continue;
      const cols = Array.isArray(o["columns"]) ? o["columns"] : [];
      const columns: ProposalColumn[] = [];
      for (const c of cols.slice(0, 40)) {
        if (!c || typeof c !== "object") continue;
        const cc = c as Record<string, unknown>;
        const cname = text(cc["name"], 80);
        const role = String(cc["role"] ?? "");
        const type = String(cc["type"] ?? "text");
        if (!cname || !COLUMN_ROLES.has(role) || !COLUMN_TYPES.has(type)) continue;
        columns.push({ name: cname, role: role as ProposalColumn["role"], type });
      }
      // 列定義が無い箱は作れない（行を取り込めず、指標が計算できない。設計 §4-2）
      if (columns.length === 0) continue;
      const asOf = text(o["as_of_needed"], 10);
      const gran = String(o["time_granularity"] ?? "fiscal_year");
      out.push({
        kind: "dataset",
        ref,
        name,
        why,
        asOfNeeded: DATE_RE.test(asOf) ? asOf : null,
        columns,
        templateId: text(o["template_id"], 80) || null,
        timeGranularity: (GRANULARITIES.has(gran) ? gran : "fiscal_year") as DatasetProposal["timeGranularity"],
      });
      seen.add(ref);
      continue;
    }

    if (o["kind"] === "indicator") {
      const label = text(o["label"], 200);
      if (!label) continue;
      const calcType = String(o["calc_type"] ?? "aggregate");
      if (!CALC_TYPES.has(calcType)) continue;
      const spec = o["spec"];
      out.push({
        kind: "indicator",
        ref,
        label,
        unit: text(o["unit"], 40),
        why,
        calcType: calcType as IndicatorProposal["calcType"],
        spec: spec && typeof spec === "object" ? (spec as Record<string, unknown>) : {},
        dependsOn: slug(o["depends_on"]) || null,
      });
      seen.add(ref);
    }
  }
  return out;
}

/** AI の「この値が要る」を取り出す（設計 §10-2） */
export function sanitizeIndicatorRequests(raw: unknown, max = 6): IndicatorRequest[] {
  if (!Array.isArray(raw)) return [];
  const out: IndicatorRequest[] = [];
  for (const item of raw.slice(0, max)) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = text(o["indicator_id"], 40);
    const label = text(o["label"], 200);
    const asOf = text(o["as_of"], 10);
    if (!id && !label) continue;
    out.push({
      indicatorId: id || null,
      label: label || null,
      asOf: DATE_RE.test(asOf) ? asOf : null,
    });
  }
  return out;
}

/**
 * 提案が「登録できる形か」を、承認する前に確かめる。
 * 戻り値が空なら登録できる。**画面はこれを承認ボタンの手前で見せる**
 * （承認したのに登録に失敗する、という見せ方をしない）。
 */
export function proposalBlockers(p: Proposal): string[] {
  const out: string[] = [];
  if (p.kind === "dataset") {
    if (!p.columns.some((c) => c.role === "time")) out.push("時点の列（time）がありません");
    if (!p.columns.some((c) => c.role === "measure")) out.push("集計する列（measure）がありません");
    if (p.columns.filter((c) => c.role === "time").length > 1) out.push("時点の列（time）が2つ以上あります");
    for (const c of p.columns) {
      if (c.role === "measure" && !["int", "numeric"].includes(c.type)) out.push(`${c.name}: 集計する列は数値型にしてください`);
      if (c.role === "time" && !["fiscal_year", "year", "month", "date"].includes(c.type)) out.push(`${c.name}: 時点の列は日付型にしてください`);
    }
    const names = p.columns.map((c) => c.name);
    if (new Set(names).size !== names.length) out.push("列名が重複しています");
  } else {
    if (p.calcType !== "manual" && p.calcType !== "formula" && !p.dependsOn && !specHasDataset(p.spec)) {
      out.push("どのデータセットを見るかが決まっていません");
    }
  }
  return out;
}

function specHasDataset(spec: Record<string, unknown>): boolean {
  return typeof spec["datasetId"] === "string" && spec["datasetId"].length > 0;
}

/** 待機中のデータ行を、対話に差し込む1つの文にまとめる */
export function renderPendingInputs(inputs: PendingInput[]): string {
  if (inputs.length === 0) return "";
  return [
    "（システムからのデータ行 — 担当者の発言ではありません）",
    ...inputs.map((i) => `・${i.text}`),
  ].join("\n");
}
