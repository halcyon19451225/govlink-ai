import "server-only";
import { query } from "@/lib/db";
import { getFlow, type FlowDecisionPath } from "@/lib/evaluation/flow";
import { calcAchievement, type AchievementCondition } from "@/lib/stats/achievement";
import { normalizeIndicatorType } from "@/lib/outcome/tiers";

/**
 * 次期計画への引き継ぎパッケージ。
 *
 * PDCA が実際に一周するのはこの一点。計画期間評価（図7）の判定経路と、
 * 未完了で次期に送る改善アクション、未達の中間・長期アウトカム、
 * 課題仮説で到達した真因をひとまとまりにして固定する。
 */
export interface HandoverPackage {
  generated_at: string;
  carry_over_actions: {
    id: string;
    title: string;
    detail: string | null;
    root_cause: string | null;
    status: string;
    owner_department: string | null;
    due_date: string | null;
  }[];
  unmet_outcomes: {
    kpi_id: string;
    label: string;
    tier: string;
    unit: string;
    baseline: number | null;
    current: number | null;
    target: number | null;
    rate: number | null;
    deadline: string | null;
  }[];
  flow_decisions: {
    evaluation_id: string;
    flow: string;
    fiscal_year: number | null;
    decisions: { question: string; answer: string; note?: string }[];
  }[];
  root_causes: { title: string; root_cause: string | null }[];
  notes: string;
}

/** 現時点のデータから引き継ぎ内容を組み立てる（確定前のプレビューにも使う） */
export async function assemblePackage(projectId: string): Promise<HandoverPackage> {
  const [actions, kpis, evals, hyps] = await Promise.all([
    query<{
      id: string;
      title: string;
      detail: string | null;
      root_cause: string | null;
      status: string;
      owner_department: string | null;
      due_date: string | null;
    }>(
      `SELECT id, title, detail, root_cause, status, owner_department,
              to_char(due_date, 'YYYY-MM-DD') AS due_date
       FROM improvement_actions
       WHERE project_id = $1
         AND (carry_over = true OR status IN ('proposed', 'adopted', 'in_progress'))
       ORDER BY carry_over DESC, priority NULLS LAST, created_at`,
      [projectId],
    ).catch(() => []),

    query<{
      id: string;
      label: string;
      unit: string;
      indicator_type: string | null;
      baseline_value: number | null;
      current: number | null;
      target: number | null;
      achievement_condition: AchievementCondition | null;
      target_deadline: string | null;
    }>(
      `SELECT id, label, unit, indicator_type,
              baseline_value::float AS baseline_value,
              current::float AS current, target::float AS target,
              achievement_condition,
              to_char(target_deadline, 'YYYY-MM-DD') AS target_deadline
       FROM kpis
       WHERE project_id = $1
         AND indicator_type IN ('outcome_intermediate', 'outcome_mid', 'outcome_long')
       ORDER BY created_at`,
      [projectId],
    ).catch(() => []),

    query<{
      id: string;
      fiscal_year: number | null;
      flow_decision_path: unknown;
    }>(
      `SELECT id, fiscal_year, flow_decision_path
       FROM program_evaluations
       WHERE project_id = $1 AND flow_decision_path IS NOT NULL
       ORDER BY fiscal_year NULLS LAST, created_at`,
      [projectId],
    ).catch(() => []),

    query<{ title: string; root_cause: string | null }>(
      `SELECT title, root_cause FROM issue_hypotheses
       WHERE project_id = $1 AND root_cause IS NOT NULL
       ORDER BY priority_rank NULLS LAST, created_at`,
      [projectId],
    ).catch(() => []),
  ]);

  // 未達のアウトカムだけを拾う（達成済みは次期に送らない）
  const unmet: HandoverPackage["unmet_outcomes"] = [];
  for (const k of kpis) {
    const ach = calcAchievement({
      current: k.current,
      target: k.target,
      baseline: k.baseline_value,
      condition: k.achievement_condition,
    });
    if (ach.achieved) continue;
    unmet.push({
      kpi_id: k.id,
      label: k.label,
      tier: normalizeIndicatorType(k.indicator_type),
      unit: k.unit ?? "",
      baseline: k.baseline_value,
      current: k.current,
      target: k.target,
      rate: ach.rate,
      deadline: k.target_deadline,
    });
  }

  const flowDecisions: HandoverPackage["flow_decisions"] = [];
  for (const e of evals) {
    const path = e.flow_decision_path as FlowDecisionPath | null;
    const flow = getFlow(path?.flow);
    if (!flow || !Array.isArray(path?.answers)) continue;
    flowDecisions.push({
      evaluation_id: e.id,
      flow: flow.label,
      fiscal_year: e.fiscal_year,
      decisions: path.answers.map((a) => ({
        question: a.question,
        answer: a.label || "（記述）",
        ...(a.note ? { note: a.note } : {}),
      })),
    });
  }

  return {
    generated_at: new Date().toISOString(),
    carry_over_actions: actions,
    unmet_outcomes: unmet,
    flow_decisions: flowDecisions,
    root_causes: hyps,
    notes: "",
  };
}

