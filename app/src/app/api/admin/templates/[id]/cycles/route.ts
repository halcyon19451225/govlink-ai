export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";

const postSchema = z.object({
  name: z.string().min(1, "サイクル名は必須です"),
  cycle_type: z.string().min(1, "サイクル種別は必須です"),
  phase: z.string().min(1, "フェーズは必須です"),
  recurrence: z.string().min(1, "繰り返し設定は必須です"),
  description: z.string().optional().nullable(),
  sort_order: z.number().int().default(0),
});

type Params = { params: { id: string } };

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }

  // テンプレート存在確認 & システムテンプレートチェック
  const existing = await query<{ id: string; is_system_template: boolean }>(
    "SELECT id, is_system_template FROM plan_templates WHERE id = $1",
    [params.id],
  );
  const tmpl = existing[0];
  if (!tmpl) {
    return NextResponse.json({ data: null, error: "テンプレートが見つかりません" }, { status: 404 });
  }
  if (tmpl.is_system_template) {
    return NextResponse.json({ data: null, error: "システムテンプレートは変更できません" }, { status: 403 });
  }

  let raw: unknown;
  try { raw = await req.json(); } catch {
    return NextResponse.json({ data: null, error: "リクエスト本文が不正です" }, { status: 400 });
  }

  const parsed = postSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: parsed.error.issues[0]?.message ?? "入力が不正です" },
      { status: 400 },
    );
  }

  const { name, cycle_type, phase, recurrence, description, sort_order } = parsed.data;

  const result = await query<{ id: string }>(
    `INSERT INTO pdca_cycle_defs
       (template_id, name, cycle_type, phase, recurrence, description, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [params.id, name, cycle_type, phase, recurrence, description ?? null, sort_order],
  );

  return NextResponse.json({ data: { id: result[0]?.id }, error: null }, { status: 201 });
}
