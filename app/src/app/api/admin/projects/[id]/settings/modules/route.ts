export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { queryOne } from "@/lib/db";

type Params = { params: { id: string } };

const bodySchema = z.object({
  module_id: z.string().min(1),
  is_enabled: z.boolean(),
});

/** モジュールの有効/無効を切り替える */
export async function PATCH(req: NextRequest, { params }: Params) {
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

  const { module_id, is_enabled } = parsed.data;

  // プロジェクトの存在確認
  const project = await queryOne(
    "SELECT id FROM projects WHERE id = $1",
    [params.id],
  );
  if (!project) {
    return NextResponse.json({ data: null, error: "プロジェクトが見つかりません" }, { status: 404 });
  }

  // upsert: project_module_configs
  const row = await queryOne<{ id: string; is_enabled: boolean }>(
    `INSERT INTO project_module_configs (project_id, module_id, is_enabled)
     VALUES ($1, $2, $3)
     ON CONFLICT (project_id, module_id)
     DO UPDATE SET is_enabled = EXCLUDED.is_enabled
     RETURNING id, is_enabled`,
    [params.id, module_id, is_enabled],
  );

  return NextResponse.json({ data: row, error: null });
}
