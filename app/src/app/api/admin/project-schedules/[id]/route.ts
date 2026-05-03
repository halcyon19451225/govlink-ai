import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";

const bodySchema = z.object({
  status: z.enum(["pending", "in_progress", "done"]),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ data: null, error: "リクエストの形式が正しくありません" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: "status は pending / in_progress / done のみ有効です" },
      { status: 400 },
    );
  }

  await query(
    "UPDATE project_schedules SET status = $1 WHERE id = $2",
    [parsed.data.status, params.id],
  );

  return NextResponse.json({ data: { id: params.id, status: parsed.data.status }, error: null });
}
