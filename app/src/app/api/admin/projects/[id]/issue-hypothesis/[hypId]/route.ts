export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import { requireModulePermission } from "@/lib/permissions";

type Params = { params: { id: string; hypId: string } };

const patchSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  root_cause: z.string().optional().nullable(),
  root_cause_tree: z.any().optional().nullable(),
  priority_rank: z.number().int().optional().nullable(),
  smart_check: z.any().optional().nullable(),
  evidence_sources: z.array(z.string()).optional().nullable(),
  proposed_measures: z.array(z.string()).optional().nullable(),
  status: z.enum(["draft", "confirmed", "rejected"]).optional(),
  gap_analysis_id: z.string().uuid().optional().nullable(),
  verification_notes: z.string().optional().nullable(),
});

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, "issue_hypothesis", "edit");
  if (deny) return deny;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ data: null, error: "リクエスト本文が不正です" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: parsed.error.issues[0]?.message ?? "入力が不正です" },
      { status: 400 },
    );
  }

  const d = parsed.data;

  // 動的UPDATEクエリを構築
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  const addField = (col: string, val: unknown, jsonb = false) => {
    setClauses.push(`${col} = $${paramIndex++}${jsonb ? "::jsonb" : ""}`);
    values.push(jsonb && val != null ? JSON.stringify(val) : val);
  };

  if (d.title !== undefined) addField("title", d.title);
  if ("description" in d) addField("description", d.description ?? null);
  if ("root_cause" in d) addField("root_cause", d.root_cause ?? null);
  if ("root_cause_tree" in d) addField("root_cause_tree", d.root_cause_tree, true);
  if ("priority_rank" in d) addField("priority_rank", d.priority_rank ?? null);
  if ("smart_check" in d) addField("smart_check", d.smart_check, true);
  if ("evidence_sources" in d) addField("evidence_sources", d.evidence_sources ?? null);
  if ("proposed_measures" in d) addField("proposed_measures", d.proposed_measures ?? null);
  if (d.status !== undefined) addField("status", d.status);
  if ("gap_analysis_id" in d) addField("gap_analysis_id", d.gap_analysis_id ?? null);
  if ("verification_notes" in d) addField("verification_notes", d.verification_notes ?? null);

  if (setClauses.length === 0) {
    return NextResponse.json({ data: null, error: "更新フィールドがありません" }, { status: 400 });
  }

  setClauses.push(`updated_at = now()`);

  values.push(params.hypId, params.id);
  const idParam = paramIndex++;
  const projectParam = paramIndex;

  const row = await queryOne<{ id: string }>(
    `UPDATE issue_hypotheses SET ${setClauses.join(", ")}
     WHERE id = $${idParam} AND project_id = $${projectParam}
     RETURNING id`,
    values,
  );

  if (!row) {
    return NextResponse.json({ data: null, error: "仮説が見つかりません" }, { status: 404 });
  }

  return NextResponse.json({ data: { id: row.id }, error: null });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, "issue_hypothesis", "edit");
  if (deny) return deny;

  const row = await queryOne<{ id: string }>(
    `DELETE FROM issue_hypotheses WHERE id = $1 AND project_id = $2 RETURNING id`,
    [params.hypId, params.id],
  );

  if (!row) {
    return NextResponse.json({ data: null, error: "仮説が見つかりません" }, { status: 404 });
  }

  return NextResponse.json({ data: { id: row.id }, error: null });
}
