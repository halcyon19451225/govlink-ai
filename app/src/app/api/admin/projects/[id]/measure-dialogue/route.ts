export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { requireModulePermission } from "@/lib/permissions";
import { measureOpenerMessage } from "@/lib/measure/prompt";
import type { MeasureMessage } from "@/lib/measure/types";

type Params = { params: { id: string } };

// 施策構築（EBPM）対話の一覧・作成 — E2

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, "measure_design", "view");
  if (deny) return deny;

  const rows = await query(
    `SELECT d.id, d.issue_hypothesis_id, d.title, d.status, d.current_step,
            d.messages, d.approaches, d.evidence, d.experiments, d.indicators, d.costs,
            d.turn_status, d.turn_error,
            d.committed_at::text, d.created_at::text, d.updated_at::text,
            h.title AS hypothesis_title
     FROM measure_dialogues d
     LEFT JOIN issue_hypotheses h ON h.id = d.issue_hypothesis_id
     WHERE d.project_id = $1
     ORDER BY d.created_at DESC`,
    [params.id],
  );

  return NextResponse.json({ data: rows, error: null });
}

const createSchema = z.object({
  issue_hypothesis_id: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(120).optional(),
});

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, "measure_design", "edit");
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

  const hypId = parsed.data.issue_hypothesis_id ?? null;

  // 起点の課題仮説（真因・施策の方向性）を最初のメッセージに反映する
  let hyp: {
    title: string;
    root_cause: string | null;
    proposed_measures: string[] | null;
  } | null = null;
  if (hypId) {
    hyp = await queryOne(
      `SELECT title, root_cause, proposed_measures
       FROM issue_hypotheses WHERE id = $1 AND project_id = $2`,
      [hypId, params.id],
    );
    if (!hyp) {
      return NextResponse.json(
        { data: null, error: "指定された課題仮説が見つかりません" },
        { status: 404 },
      );
    }
  }

  const opener = measureOpenerMessage({
    hypothesisTitle: hyp?.title ?? null,
    rootCause: hyp?.root_cause ?? null,
    proposedMeasures: hyp?.proposed_measures ?? [],
  });

  const seedMessages: MeasureMessage[] = [
    { role: "assistant", content: opener, step: "approach" },
  ];

  const title =
    parsed.data.title ?? (hyp ? `施策構築: ${hyp.title.slice(0, 60)}` : "施策構築");

  const row = await queryOne<{ id: string }>(
    `INSERT INTO measure_dialogues (project_id, issue_hypothesis_id, title, messages)
     VALUES ($1, $2, $3, $4::jsonb)
     RETURNING id`,
    [params.id, hypId, title, JSON.stringify(seedMessages)],
  );

  if (!row) {
    return NextResponse.json({ data: null, error: "作成に失敗しました" }, { status: 500 });
  }

  return NextResponse.json({ data: { id: row.id }, error: null }, { status: 201 });
}
