import "server-only";
import { query, queryOne } from "@/lib/db";
import { getFlow, type FlowDecisionPath } from "@/lib/evaluation/flow";
import type { ImprovementContext } from "./prompt";

/**
 * 対話型AI改善提案が読むべき「C工程の成果物」を集める。
 *
 * 従来の suggest-improvements はここを一切読んでいなかったため、
 * 評価を踏まえない一般論の提案しか出せなかった。
 */

interface EvalRow {
  id: string;
  evaluation_tier: string;
  fiscal_year: number | null;
  status: string;
  result: string | null;
  achievement_rate: number | null;
  computed_achievement_rate: number | null;
  findings: string | null;
  barrier_factors: string | null;
  improvement_actions: string | null;
  next_steps: string | null;
  flow_decision_path: unknown;
  kpi_snapshot: unknown;
}

const TIER_LABEL: Record<string, string> = {
  process: "プロセス評価",
  outcome: "アウトカム評価",
  outcome_initial: "短期アウトカム評価",
  outcome_intermediate: "中間アウトカム評価",
  outcome_long: "長期アウトカム評価",
  efficiency: "効率性評価",
};

function formatEvaluation(e: EvalRow): string {
  const lines: string[] = [];
  const rate = e.achievement_rate ?? e.computed_achievement_rate;
  lines.push(
    `■ ${TIER_LABEL[e.evaluation_tier] ?? e.evaluation_tier}` +
      `${e.fiscal_year ? `（${e.fiscal_year}年度）` : ""}` +
      `${rate != null ? ` 到達度 ${rate}%` : ""}` +
      `${e.status === "approved" ? " ※承認済（数値は凍結）" : ""}`,
  );
  if (e.result) lines.push(`  結果: ${e.result}`);

  // 図6/図7の判定経路 — 改善提案が最も参照すべき部分
  const path = e.flow_decision_path as FlowDecisionPath | null;
  const flow = getFlow(path?.flow);
  if (flow && Array.isArray(path?.answers)) {
    lines.push(`  ${flow.label}の判断経路:`);
    for (const a of path.answers) {
      const over = a.overridden ? "（システム判定を上書き）" : "";
      lines.push(`    - ${a.question} → ${a.label || "（記述）"}${over}`);
      if (a.note) lines.push(`      補足: ${a.note}`);
    }
  }

  if (e.findings) lines.push(`  所見: ${e.findings}`);
  if (e.barrier_factors) lines.push(`  阻害要因: ${e.barrier_factors}`);
  if (e.improvement_actions) lines.push(`  記入済みの改善策: ${e.improvement_actions}`);
  if (e.next_steps) lines.push(`  次のステップ: ${e.next_steps}`);

  // 承認時に凍結したKPI実績
  const snap = e.kpi_snapshot;
  if (Array.isArray(snap) && snap.length > 0) {
    const items = snap
      .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
      .map((s) => `${String(s.label)} ${String(s.current)}${String(s.unit ?? "")} / 目標 ${String(s.target)}（到達度 ${String(s.rate)}%）`);
    if (items.length > 0) lines.push(`  対象KPI: ${items.join(" ／ ")}`);
  }

  return lines.join("\n");
}

export async function buildImprovementContext(opts: {
  projectId: string;
  programEvaluationId: string | null;
  currentStep: string;
  proposalsSummary: string;
  knowledgeContext: string;
}): Promise<ImprovementContext & { hasEvaluation: boolean; kpiLine: string }> {
  const { projectId, programEvaluationId } = opts;

  const project = await queryOne<{ title: string }>(
    "SELECT title FROM projects WHERE id = $1",
    [projectId],
  );

  // ── 評価結果 ────────────────────────────────
  const evals = await query<EvalRow>(
    programEvaluationId
      ? `SELECT id, evaluation_tier, fiscal_year, status, result,
                achievement_rate::float, computed_achievement_rate::float,
                findings, barrier_factors, improvement_actions, next_steps,
                flow_decision_path, kpi_snapshot
         FROM program_evaluations
         WHERE project_id = $1 AND id = $2`
      : `SELECT id, evaluation_tier, fiscal_year, status, result,
                achievement_rate::float, computed_achievement_rate::float,
                findings, barrier_factors, improvement_actions, next_steps,
                flow_decision_path, kpi_snapshot
         FROM program_evaluations
         WHERE project_id = $1
         ORDER BY created_at DESC
         LIMIT 5`,
    programEvaluationId ? [projectId, programEvaluationId] : [projectId],
  ).catch(() => [] as EvalRow[]);

  const evaluationSummary = evals.map(formatEvaluation).join("\n\n");

  // ── 課題仮説で到達した真因 ────────────────────
  const hyps = await query<{ title: string; root_cause: string | null; priority_rank: number | null }>(
    `SELECT title, root_cause, priority_rank
     FROM issue_hypotheses
     WHERE project_id = $1 AND root_cause IS NOT NULL
     ORDER BY priority_rank NULLS LAST, created_at
     LIMIT 8`,
    [projectId],
  ).catch(() => []);

  const rootCauses = hyps
    .map((h) => `- ${h.title}: ${h.root_cause}`)
    .join("\n");

  // ── 自己評価の記録 ───────────────────────────
  const selfEvals = await query<{
    title: string;
    fiscal_year: number;
    period_type: string;
    rating: string | null;
    challenges: string | null;
    countermeasures: string | null;
    next_year_changes: string | null;
  }>(
    `SELECT s.title, e.fiscal_year, e.period_type, e.rating,
            e.challenges, e.countermeasures, e.next_year_changes
     FROM self_evaluation_entries e
     JOIN self_evaluation_sheets s ON s.id = e.sheet_id
     WHERE s.project_id = $1
     ORDER BY e.fiscal_year DESC, e.period_type
     LIMIT 10`,
    [projectId],
  ).catch(() => []);

  const selfEvaluationSummary = selfEvals
    .map((s) => {
      const parts = [
        `- ${s.title}（${s.fiscal_year}年度 ${s.period_type === "interim" ? "中間" : "最終"}）`,
        s.rating ? `評価: ${s.rating}` : null,
        s.challenges ? `課題: ${s.challenges}` : null,
        s.countermeasures ? `対策: ${s.countermeasures}` : null,
        s.next_year_changes ? `次年度の変更点: ${s.next_year_changes}` : null,
      ].filter(Boolean);
      return parts.join(" ／ ");
    })
    .join("\n");

  // ── 既に起票済みの改善（重複回避）──────────────
  const actions = await query<{ title: string; status: string; owner_department: string | null }>(
    `SELECT title, status, owner_department
     FROM improvement_actions
     WHERE project_id = $1 AND status <> 'dropped'
     ORDER BY created_at DESC
     LIMIT 20`,
    [projectId],
  ).catch(() => []);

  const existingActions = actions
    .map((a) => `- ${a.title}（${a.status}${a.owner_department ? ` / ${a.owner_department}` : ""}）`)
    .join("\n");

  // 冒頭メッセージ用の1行
  const first = evals[0];
  const firstRate = first ? (first.achievement_rate ?? first.computed_achievement_rate) : null;
  const kpiLine = first
    ? `対象の評価: ${TIER_LABEL[first.evaluation_tier] ?? first.evaluation_tier}` +
      `${first.fiscal_year ? `（${first.fiscal_year}年度）` : ""}` +
      `${firstRate != null ? ` 到達度 ${firstRate}%` : ""}`
    : "";

  return {
    projectTitle: project?.title ?? "（プロジェクト）",
    evaluationSummary,
    rootCauses,
    selfEvaluationSummary,
    existingActions,
    knowledgeContext: opts.knowledgeContext,
    currentStep: opts.currentStep,
    proposalsSummary: opts.proposalsSummary,
    hasEvaluation: evals.length > 0,
    kpiLine,
  };
}
