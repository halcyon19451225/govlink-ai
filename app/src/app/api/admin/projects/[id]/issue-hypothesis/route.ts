export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";

type Params = { params: { id: string } };

const bodySchema = z.object({
  title: z.string().min(1, "仮説タイトルは必須です"),
  description: z.string().optional().nullable(),
  root_cause: z.string().optional().nullable(),
  root_cause_tree: z.any().optional().nullable(),
  priority_rank: z.number().int().optional().nullable(),
  smart_check: z.any().optional().nullable(),
  evidence_sources: z.array(z.string()).optional().nullable(),
  proposed_measures: z.array(z.string()).optional().nullable(),
  status: z.enum(["draft", "confirmed", "rejected"]).default("draft"),
  gap_analysis_id: z.string().uuid().optional().nullable(),
  verification_notes: z.string().optional().nullable(),
});

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }

  const rows = await query(
    `SELECT * FROM issue_hypotheses WHERE project_id = $1 ORDER BY priority_rank NULLS LAST, created_at`,
    [params.id],
  );

  return NextResponse.json({ data: rows, error: null });
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ data: null, error: "リクエスト本文が不正です" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: parsed.error.issues[0]?.message ?? "入力が不正です" },
      { status: 400 },
    );
  }

  const d = parsed.data;

  const row = await queryOne<{ id: string }>(
    `INSERT INTO issue_hypotheses
       (project_id, title, description, root_cause, root_cause_tree,
        priority_rank, smart_check, evidence_sources, proposed_measures,
        status, gap_analysis_id, verification_notes, ai_generated)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8, $9, $10, $11, $12, false)
     RETURNING id`,
    [
      params.id,
      d.title,
      d.description ?? null,
      d.root_cause ?? null,
      d.root_cause_tree != null ? JSON.stringify(d.root_cause_tree) : null,
      d.priority_rank ?? null,
      d.smart_check != null ? JSON.stringify(d.smart_check) : null,
      d.evidence_sources ?? null,
      d.proposed_measures ?? null,
      d.status,
      d.gap_analysis_id ?? null,
      d.verification_notes ?? null,
    ],
  );

  if (!row) {
    return NextResponse.json({ data: null, error: "DB登録に失敗しました" }, { status: 500 });
  }

  return NextResponse.json({ data: { id: row.id }, error: null }, { status: 201 });
}
