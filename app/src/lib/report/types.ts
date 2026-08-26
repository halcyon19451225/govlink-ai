/**
 * 実績報告の依頼と回答管理（S2 C①）— 語彙・サニタイズ（純粋・テスト可能）
 *
 * ── このファイルが正本 ─────────────────────────────────────
 * 設問（form_def）・割当先（targets）・回答（answers）の形と防御はここに集約する。
 * API・管理画面・公開フォーム・検査（check:report）はここだけを参照する。
 */

// ─── 語彙（053 の CHECK と同一） ──────────────────────────

export const REPORT_KINDS = [
  { key: "annual", label: "年次報告", detail: "年度の実施実績・KPI実績値の報告（図6の年次評価の入力）" },
  { key: "period_end", label: "計画期間報告", detail: "計画期間全体の実績報告（図7の計画期間評価の入力）" },
] as const;
export type ReportKind = (typeof REPORT_KINDS)[number]["key"];

export const REQUEST_STATUS = ["draft", "sent", "closed"] as const;
export type RequestStatus = (typeof REQUEST_STATUS)[number];

export const RESPONSE_STATUS = [
  { key: "pending", label: "未回答", color: "#94a3b8" },
  { key: "answered", label: "回答済", color: "#22d3ee" },
  { key: "returned", label: "差し戻し", color: "#f59e0b" },
  { key: "accepted", label: "受領", color: "#34d399" },
] as const;
export type ResponseStatus = (typeof RESPONSE_STATUS)[number]["key"];

// ─── 設問（form_def） ─────────────────────────────────────

export const QUESTION_TYPES = ["number", "text", "textarea"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export interface ReportQuestion {
  id: string;
  label: string;
  type: QuestionType;
  /** number のとき表示する単位（例: 回・人・%） */
  unit?: string;
  /** KPI実績値の設問。受領後に kpi_reports へ取り込む対象になる */
  kpi_id?: string;
  /** この施策の回答フォームにだけ出す（無印は共通設問） */
  measure_design_id?: string;
  required?: boolean;
}

const clip = (v: unknown, max: number): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

/**
 * AI出力・画面編集の設問を防御的に取り込む。
 * - id が無い/重複する設問は落とす（回答の対応が壊れるため）
 * - kpi_id / measure_design_id は実在IDのみ（渡された集合で検証）
 * - 件数上限 60（1施策あたり数問×施策数の実務上限）
 */
export function sanitizeQuestions(
  raw: unknown,
  validKpiIds: ReadonlySet<string>,
  validMeasureIds: ReadonlySet<string>,
): ReportQuestion[] {
  if (!Array.isArray(raw)) return [];
  const out: ReportQuestion[] = [];
  const seen = new Set<string>();
  for (const item of raw.slice(0, 100)) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = clip(o["id"], 60);
    const label = clip(o["label"], 200);
    const type = QUESTION_TYPES.includes(o["type"] as QuestionType) ? (o["type"] as QuestionType) : null;
    if (!id || !label || !type || seen.has(id)) continue;
    seen.add(id);
    const kpiId = clip(o["kpi_id"], 60);
    const measureId = clip(o["measure_design_id"], 60);
    const q: ReportQuestion = { id, label, type };
    const unit = clip(o["unit"], 20);
    if (unit) q.unit = unit;
    if (kpiId && validKpiIds.has(kpiId)) q.kpi_id = kpiId;
    if (measureId && validMeasureIds.has(measureId)) q.measure_design_id = measureId;
    if (o["required"] === true) q.required = true;
    out.push(q);
    if (out.length >= 60) break;
  }
  return out;
}

// ─── 割当先（targets） ────────────────────────────────────

export interface ReportTarget {
  /** 施策UUID（report_responses.target_key に対応） */
  target_key: string;
  measure_design_id: string;
  measure_title: string;
  owner_department: string | null;
  owner_name: string | null;
  email: string | null;
}

export function sanitizeTargets(raw: unknown): ReportTarget[] {
  if (!Array.isArray(raw)) return [];
  const out: ReportTarget[] = [];
  const seen = new Set<string>();
  for (const item of raw.slice(0, 50)) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const key = clip(o["target_key"], 60);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      target_key: key,
      measure_design_id: clip(o["measure_design_id"], 60) || key,
      measure_title: clip(o["measure_title"], 200),
      owner_department: clip(o["owner_department"], 120) || null,
      owner_name: clip(o["owner_name"], 120) || null,
      email: clip(o["email"], 200) || null,
    });
  }
  return out;
}

// ─── 回答（answers） ──────────────────────────────────────

/** 対象（施策）の回答フォームに出す設問 = 共通設問 ＋ その施策の設問 */
export function questionsForTarget(questions: ReportQuestion[], measureDesignId: string): ReportQuestion[] {
  return questions.filter((q) => !q.measure_design_id || q.measure_design_id === measureDesignId);
}

/**
 * 公開フォームからの回答を防御的に取り込む。
 * - 設問にあるIDだけ受け付ける（余計なキーは捨てる）
 * - number は数値化できなければ捨てる（文字混入をKPIへ流さない）
 * - required 未回答は missing に列挙（保存は許すが画面で警告）
 */
export function sanitizeAnswers(
  raw: unknown,
  questions: ReportQuestion[],
): { answers: Record<string, string | number>; missing: string[] } {
  const answers: Record<string, string | number> = {};
  const byId = new Map(questions.map((q) => [q.id, q]));
  if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const q = byId.get(k);
      if (!q) continue;
      if (q.type === "number") {
        const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, "").trim());
        if (Number.isFinite(n)) answers[k] = n;
      } else {
        const s = clip(v, q.type === "textarea" ? 4000 : 500);
        if (s) answers[k] = s;
      }
    }
  }
  const missing = questions.filter((q) => q.required && answers[q.id] === undefined).map((q) => q.id);
  return { answers, missing };
}

/** 受領済み回答から kpi_reports へ取り込む対象（kpi_idつき数値設問×数値回答）を抜き出す */
export function kpiImportRows(
  questions: ReportQuestion[],
  answers: Record<string, unknown>,
): { kpi_id: string; value: number; label: string }[] {
  const out: { kpi_id: string; value: number; label: string }[] = [];
  for (const q of questions) {
    if (!q.kpi_id || q.type !== "number") continue;
    const v = answers[q.id];
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isFinite(n)) out.push({ kpi_id: q.kpi_id, value: n, label: q.label });
  }
  return out;
}
