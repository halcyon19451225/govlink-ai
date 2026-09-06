export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireProjectAccess } from "@/lib/tenant";
import { query, queryOne, transaction } from "@/lib/db";
import { requireModulePermission } from "@/lib/permissions";
import { recordArtifact, resolveArtifactIds } from "@/lib/modules/recordArtifact";
import { ARTIFACT_TYPES } from "@/lib/modules/artifact-types";
import {
  activeProblems,
  factorShortLabel,
  type HypothesisItem,
  type ProblemItem,
  type RootCauseItem,
  type SelectionItem,
} from "@/lib/issue/types";

type Params = { params: { id: string; dialogueId: string } };

interface DialogueRow {
  id: string;
  kpi_id: string | null;
  gap_analysis_id: string | null;
  asis_analysis_id: string | null;
  status: "in_progress" | "completed";
  problems: ProblemItem[];
  selection: SelectionItem[];
  root_causes: RootCauseItem[];
  hypotheses: HypothesisItem[];
}

interface TreeNode {
  id: string;
  label: string;
  children?: TreeNode[];
}

/**
 * 真因分析の結果を既存のロジックツリー表現（root_cause_tree）に変換する。
 * 特性要因図の大骨→小骨と、なぜなぜ分析の連鎖を1本の木にまとめる。
 */
function buildRootCauseTree(rc: RootCauseItem | undefined): TreeNode[] {
  if (!rc) return [];
  const nodes: TreeNode[] = [];

  rc.bones.forEach((bone, bi) => {
    nodes.push({
      id: `bone-${bi}`,
      label: factorShortLabel(bone.factor),
      children: bone.causes.map((c, ci) => ({ id: `bone-${bi}-${ci}`, label: c })),
    });
  });

  if (rc.whys.length > 0) {
    // なぜなぜは入れ子にして深さを表現する
    let current: TreeNode | null = null;
    const root: TreeNode = { id: "why-root", label: "なぜなぜ分析", children: [] };
    for (const w of rc.whys) {
      const node: TreeNode = { id: `why-${w.level}`, label: `なぜ${w.level}: ${w.answer}`, children: [] };
      if (current) {
        current.children = [node];
      } else {
        root.children = [node];
      }
      current = node;
    }
    if (rc.root_cause && current) {
      current.children = [{ id: "root-cause", label: `真因: ${rc.root_cause}` }];
    }
    nodes.push(root);
  } else if (rc.root_cause) {
    nodes.push({ id: "root-cause", label: `真因: ${rc.root_cause}` });
  }

  return nodes;
}

/**
 * 対話で確定した課題仮説を issue_hypotheses（成果物テーブル）へ書き出す。
 * 既に書き出し済みの場合は、同じ対話に紐づく行を作り直す（再実行可能）。
 */
export async function POST(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  // テナント境界。URL の project id が自分の自治体のものか確認する
  // （claude/coe-tenant-isolation.md A-4）。拒否は 404 で、存在を漏らさない
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  const deny = await requireModulePermission(session, params.id, "issue_hypothesis", "edit");
  if (deny) return deny;

  const d = await queryOne<DialogueRow>(
    `SELECT id, kpi_id, gap_analysis_id, asis_analysis_id, status,
            problems, selection, root_causes, hypotheses
     FROM issue_dialogues
     WHERE id = $1 AND project_id = $2`,
    [params.dialogueId, params.id],
  );

  if (!d) {
    return NextResponse.json(
      { data: null, error: "課題仮説設定が見つかりません" },
      { status: 404 },
    );
  }

  // 統合で退役した問題に紐づく仮説は書き出さない（統合前の古い仮説が残っている場合の保険）
  const aliveIds = new Set(activeProblems(d.problems).map((p) => p.id));
  const usable = d.hypotheses.filter(
    (h) =>
      h.title.trim().length > 0 &&
      h.statement.trim().length > 0 &&
      (aliveIds.size === 0 || aliveIds.has(h.problem_id)),
  );
  if (usable.length === 0) {
    return NextResponse.json(
      { data: null, error: "書き出せる課題仮説がありません。対話を最後まで進めてください" },
      { status: 400 },
    );
  }

  const selectionByProblem = new Map(d.selection.map((s) => [s.problem_id, s]));
  const rootCauseByProblem = new Map(d.root_causes.map((r) => [r.problem_id, r]));
  const problemById = new Map(d.problems.map((p) => [p.id, p]));

  // 優先度ランクは選別スコアの降順で採番する
  const ranked = [...usable].sort(
    (a, b) =>
      (selectionByProblem.get(b.problem_id)?.score ?? 0) -
      (selectionByProblem.get(a.problem_id)?.score ?? 0),
  );

  const createdIds = await transaction(async (client) => {
    // 同じ対話から以前に書き出した行を削除して作り直す（重複を防ぐ）
    await client.query(
      `DELETE FROM issue_hypotheses WHERE project_id = $1 AND issue_dialogue_id = $2`,
      [params.id, params.dialogueId],
    );

    const ids: string[] = [];
    for (let i = 0; i < ranked.length; i++) {
      const h = ranked[i]!;
      const rc = rootCauseByProblem.get(h.problem_id);
      const problem = problemById.get(h.problem_id);
      const sel = selectionByProblem.get(h.problem_id);

      const descriptionParts = [
        h.statement,
        problem ? `対象の問題: ${problem.text}` : null,
        sel ? `選別スコア: ${sel.score}点（影響度${sel.impact}/関与可能性${sel.controllability}/緊急性${sel.urgency}）` : null,
        h.verification ? `検証方法: ${h.verification}` : null,
      ].filter(Boolean);

      const res = await client.query<{ id: string }>(
        `INSERT INTO issue_hypotheses
           (project_id, gap_analysis_id, issue_dialogue_id, title, description,
            root_cause, root_cause_tree, priority_rank, evidence_sources,
            proposed_measures, status, ai_generated, verification_notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, 'draft', true, $11)
         RETURNING id`,
        [
          params.id,
          d.gap_analysis_id,
          d.id,
          h.title,
          descriptionParts.join("\n"),
          h.root_cause || rc?.root_cause || null,
          JSON.stringify(buildRootCauseTree(rc)),
          i + 1,
          h.evidence.length > 0 ? h.evidence : null,
          h.measures.length > 0 ? h.measures : null,
          h.verification || null,
        ],
      );
      const id = res.rows[0]?.id;
      if (id) ids.push(id);
    }

    await client.query(
      `UPDATE issue_dialogues SET committed_at = now() WHERE id = $1 AND project_id = $2`,
      [params.dialogueId, params.id],
    );

    return ids;
  });

  // 成果物レジストリに登録（リネージ: ギャップ分析・現状整理 → 課題仮説）
  const sourceIds = await resolveArtifactIds(params.id, "gap_analysis", [d.gap_analysis_id]);
  const derivationNote = [
    d.gap_analysis_id ? `ギャップ分析(${d.gap_analysis_id})` : null,
    d.asis_analysis_id ? `現状整理(${d.asis_analysis_id})` : null,
  ]
    .filter(Boolean)
    .join(" / ");

  await Promise.all(
    createdIds.map((id) =>
      recordArtifact({
        projectId: params.id,
        moduleId: "issue_hypothesis",
        artifactType: ARTIFACT_TYPES.issue_hypothesis.hypothesis_sheet,
        artifactRecordId: id,
        sourceArtifactIds: sourceIds,
        derivationNote: derivationNote
          ? `${derivationNote} から対話型で課題仮説を導出`
          : "対話型で課題仮説を導出",
      }).catch((e) => console.error("recordArtifact(issue_hypothesis) 失敗:", e)),
    ),
  );

  const rows = await query(
    `SELECT id, title, description, root_cause, priority_rank, status,
            evidence_sources, proposed_measures
     FROM issue_hypotheses
     WHERE project_id = $1 AND issue_dialogue_id = $2
     ORDER BY priority_rank NULLS LAST`,
    [params.id, params.dialogueId],
  );

  return NextResponse.json({ data: { created: createdIds.length, hypotheses: rows }, error: null });
}
