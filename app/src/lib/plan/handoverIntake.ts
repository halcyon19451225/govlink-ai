/**
 * 前期引き継ぎの取り込み（PL1 P② 経路1）— 提案の語彙とサニタイズ（純粋・テスト可能)
 *
 * AIは plan_handovers.package（未達アウトカム・carry_over改善・判断経路・真因）と
 * 新計画の現状（複製済みdraft）から**反映の差分提案**を作る。
 * 適用は担当者がチェックボックスで選別してから（無確認の自動反映をしない —
 * コーパス検収と同じ流儀）。
 *
 * 提案の4系統（設計 第2部 P② 経路1）:
 *  - lm_element_edit      … ロジックモデル: 改訂版を起こして要素の修正・追加を適用
 *  - measure_update       … 施策: carry_over改善を対応するdraft施策のB/D区画へ反映
 *  - kpi_target           … KPI: 未達指標の目標値・期限の見直し案
 *  - improvement_action   … 改善: carry_over分を新計画に source='handover' で起票
 */

import { LM_ELEMENT_SECTIONS } from "@/lib/plan/clone";

export type LmSection = (typeof LM_ELEMENT_SECTIONS)[number];

export type IntakeProposal =
  | {
      type: "lm_element_edit";
      section: LmSection;
      /** 既存要素の修正なら要素id・新規追加なら null */
      element_id: string | null;
      new_text: string;
      rationale: string;
    }
  | {
      type: "measure_update";
      measure_id: string;
      /** intervention=B区画（介入の修正案） / experiment=D区画（実験設計の見直し案） */
      section: "intervention" | "experiment";
      proposal: string;
      from_action_title: string | null;
    }
  | {
      type: "kpi_target";
      kpi_id: string;
      proposed_target: number | null;
      proposed_deadline: string | null; // YYYY-MM-DD
      rationale: string;
    }
  | {
      type: "improvement_action";
      title: string;
      detail: string | null;
      root_cause: string | null;
    };

export interface IntakeValidIds {
  measureIds: ReadonlySet<string>;
  kpiIds: ReadonlySet<string>;
}

export interface IntakeSanitizeResult {
  proposals: IntakeProposal[];
  rejected: { reason: string }[];
}

const MAX_PROPOSALS = 30;

const clip = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};

const LM_SECTION_SET: ReadonlySet<string> = new Set(LM_ELEMENT_SECTIONS);

/**
 * AIのツール出力を安全に取り込む。
 * - 参照先ID（measure_id / kpi_id）が新計画に実在しない提案は捨てる（理由を記録）
 * - 数値・日付の不正は null に落とす（提案自体は残す — フラグだけでも意味がある）
 * - 件数上限・長さ制限
 */
export function sanitizeIntakeProposals(
  raw: unknown,
  ids: IntakeValidIds,
): IntakeSanitizeResult {
  const out: IntakeSanitizeResult = { proposals: [], rejected: [] };
  if (!raw || typeof raw !== "object") return out;
  const list = (raw as Record<string, unknown>)["proposals"];
  if (!Array.isArray(list)) return out;

  for (const item of list.slice(0, MAX_PROPOSALS)) {
    if (!item || typeof item !== "object") continue;
    const p = item as Record<string, unknown>;
    const type = p["type"];

    if (type === "lm_element_edit") {
      const section = typeof p["section"] === "string" && LM_SECTION_SET.has(p["section"]) ? (p["section"] as LmSection) : null;
      const newText = clip(p["new_text"], 500);
      const rationale = clip(p["rationale"], 500);
      if (!section || !newText || !rationale) {
        out.rejected.push({ reason: "lm_element_edit: section/new_text/rationale が不足" });
        continue;
      }
      out.proposals.push({
        type: "lm_element_edit",
        section,
        element_id: clip(p["element_id"], 60),
        new_text: newText,
        rationale,
      });
    } else if (type === "measure_update") {
      const measureId = clip(p["measure_id"], 60);
      const section = p["section"] === "experiment" ? "experiment" : p["section"] === "intervention" ? "intervention" : null;
      const proposal = clip(p["proposal"], 1000);
      if (!measureId || !ids.measureIds.has(measureId)) {
        out.rejected.push({ reason: `measure_update: 新計画に存在しない施策ID（${measureId ?? "空"}）` });
        continue;
      }
      if (!section || !proposal) {
        out.rejected.push({ reason: "measure_update: section/proposal が不足" });
        continue;
      }
      out.proposals.push({
        type: "measure_update",
        measure_id: measureId,
        section,
        proposal,
        from_action_title: clip(p["from_action_title"], 200),
      });
    } else if (type === "kpi_target") {
      const kpiId = clip(p["kpi_id"], 60);
      const rationale = clip(p["rationale"], 500);
      if (!kpiId || !ids.kpiIds.has(kpiId)) {
        out.rejected.push({ reason: `kpi_target: 新計画に存在しないKPI ID（${kpiId ?? "空"}）` });
        continue;
      }
      if (!rationale) {
        out.rejected.push({ reason: "kpi_target: rationale が不足" });
        continue;
      }
      const rawTarget = p["proposed_target"];
      const target = typeof rawTarget === "number" && Number.isFinite(rawTarget) ? rawTarget : null;
      const rawDeadline = clip(p["proposed_deadline"], 10);
      const deadline = rawDeadline && /^\d{4}-\d{2}-\d{2}$/.test(rawDeadline) ? rawDeadline : null;
      out.proposals.push({
        type: "kpi_target",
        kpi_id: kpiId,
        proposed_target: target,
        proposed_deadline: deadline,
        rationale,
      });
    } else if (type === "improvement_action") {
      const title = clip(p["title"], 200);
      if (!title) {
        out.rejected.push({ reason: "improvement_action: title が空" });
        continue;
      }
      out.proposals.push({
        type: "improvement_action",
        title,
        detail: clip(p["detail"], 1000),
        root_cause: clip(p["root_cause"], 500),
      });
    }
  }
  return out;
}
