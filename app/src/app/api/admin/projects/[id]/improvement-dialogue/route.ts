export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { requireProjectAccess } from "@/lib/tenant";
import { query, queryOne } from "@/lib/db";
import { requireModulePermission } from "@/lib/permissions";
import { buildImprovementContext } from "@/lib/improvement/context";
import { improvementOpenerMessage } from "@/lib/improvement/prompt";

type Params = { params: { id: string } };

const MODULE = "self_evaluation";

const SELECT_COLS = `
  d.id, d.project_id, d.program_evaluation_id, d.title, d.status, d.current_step,
  d.messages, d.proposals, d.committed_at::text,
  d.turn_status, d.turn_error,
  d.created_at::text, d.updated_at::text`;

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  // テナント境界。URL の project id が自分の自治体のものか確認する
  // （claude/coe-tenant-isolation.md A-4）。拒否は 404 で、存在を漏らさない
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  const deny = await requireModulePermission(session, params.id, MODULE, "view");
  if (deny) return deny;

  const rows = await query(
    `SELECT ${SELECT_COLS}
     FROM improvement_dialogues d
     WHERE d.project_id = $1
     ORDER BY d.created_at DESC`,
    [params.id],
  ).catch(() => []);

  return NextResponse.json({ data: rows, error: null });
}

const createSchema = z.object({
  program_evaluation_id: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(120).optional(),
});

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  // テナント境界。URL の project id が自分の自治体のものか確認する
  // （claude/coe-tenant-isolation.md A-4）。拒否は 404 で、存在を漏らさない
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  const deny = await requireModulePermission(session, params.id, MODULE, "edit");
  if (deny) return deny;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    raw = {};
  }
  const parsed = createSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: parsed.error.issues[0]?.message ?? "入力が不正です" },
      { status: 400 },
    );
  }

  const evalId = parsed.data.program_evaluation_id ?? null;

  // 評価結果を読んだうえで冒頭メッセージを組み立てる
  const ctx = await buildImprovementContext({
    projectId: params.id,
    programEvaluationId: evalId,
    currentStep: "review",
    proposalsSummary: "（まだなし）",
    knowledgeContext: "",
  });

  const messages = [
    {
      role: "assistant",
      content: improvementOpenerMessage(ctx.hasEvaluation, ctx.kpiLine),
      step: "review",
    },
  ];

  const created = await queryOne<{ id: string }>(
    `INSERT INTO improvement_dialogues
       (project_id, program_evaluation_id, title, status, current_step, messages, proposals)
     VALUES ($1, $2, $3, 'in_progress', 'review', $4::jsonb, '[]'::jsonb)
     RETURNING id`,
    [
      params.id,
      evalId,
      parsed.data.title ?? "改善提案",
      JSON.stringify(messages),
    ],
  );

  if (!created) {
    return NextResponse.json({ data: null, error: "作成に失敗しました" }, { status: 500 });
  }

  return NextResponse.json({ data: { id: created.id }, error: null }, { status: 201 });
}
