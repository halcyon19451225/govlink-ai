export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query, queryOne, transaction } from "@/lib/db";
import { requireModulePermission } from "@/lib/permissions";
import { REFLECT_META, type ImprovementProposal } from "@/lib/improvement/types";

type Params = { params: { id: string; dialogueId: string } };

const MODULE = "self_evaluation";

/**
 * 対話で組み立てた改善案を improvement_actions（成果物）へ書き出す。
 *
 * 対話（過程）は improvement_dialogues に、追跡対象（成果物）は
 * improvement_actions に置く。課題仮説設定と同じ二層構成。
 * 再実行可能（同じ対話から作った行を作り直す）。
 */
export async function POST(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, MODULE, "edit");
  if (deny) return deny;

  const d = await queryOne<{
    id: string;
    program_evaluation_id: string | null;
    proposals: ImprovementProposal[];
  }>(
    `SELECT id, program_evaluation_id, proposals
     FROM improvement_dialogues
     WHERE id = $1 AND project_id = $2`,
    [params.dialogueId, params.id],
  );

  if (!d) {
    return NextResponse.json({ data: null, error: "改善提案が見つかりません" }, { status: 404 });
  }

  const usable = (d.proposals ?? []).filter((p) => p.title?.trim());
  if (usable.length === 0) {
    return NextResponse.json(
      { data: null, error: "書き出せる改善案がありません。対話を最後まで進めてください" },
      { status: 400 },
    );
  }

  const ranked = [...usable].sort(
    (a, b) => (a.priority ?? 99) - (b.priority ?? 99),
  );

  const created = await transaction(async (client) => {
    // 同じ対話から以前に書き出した行を作り直す（重複を防ぐ）
    await client.query(
      `DELETE FROM improvement_actions
       WHERE project_id = $1 AND improvement_dialogue_id = $2`,
      [params.id, params.dialogueId],
    );

    const ids: string[] = [];
    for (let i = 0; i < ranked.length; i++) {
      const p = ranked[i]!;
      const detailParts = [
        p.detail,
        p.expected_effect ? `見込む効果: ${p.expected_effect}` : null,
        p.due_hint ? `時期の目安: ${p.due_hint}` : null,
        p.reflect_target ? `反映先の想定: ${REFLECT_META[p.reflect_target].label}` : null,
        p.evidence.length > 0 ? `根拠:\n${p.evidence.map((e) => `・${e}`).join("\n")}` : null,
      ].filter(Boolean);

      const res = await client.query<{ id: string }>(
        `INSERT INTO improvement_actions
           (project_id, source, improvement_dialogue_id, program_evaluation_id,
            title, detail, root_cause, owner_department,
            status, priority, carry_over)
         VALUES ($1, 'improvement_dialogue', $2, $3, $4, $5, $6, $7, 'proposed', $8, $9)
         RETURNING id`,
        [
          params.id,
          d.id,
          d.program_evaluation_id,
          p.title,
          detailParts.join("\n"),
          p.root_cause || null,
          p.owner_department || null,
          p.priority ?? i + 1,
          p.carry_over === true,
        ],
      );
      const id = res.rows[0]?.id;
      if (id) ids.push(id);
    }

    await client.query(
      `UPDATE improvement_dialogues SET committed_at = now()
       WHERE id = $1 AND project_id = $2`,
      [params.dialogueId, params.id],
    );

    return ids;
  });

  const rows = await query(
    `SELECT id, title, status, priority, carry_over, owner_department
     FROM improvement_actions
     WHERE project_id = $1 AND improvement_dialogue_id = $2
     ORDER BY priority NULLS LAST`,
    [params.id, params.dialogueId],
  );

  return NextResponse.json({
    data: { created: created.length, actions: rows },
    error: null,
  });
}
