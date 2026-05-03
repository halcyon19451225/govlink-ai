import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { transaction, isPgError, PgErrorCode } from "@/lib/db";

const kpiSchema = z.object({
  label: z.string().min(1, "KPI ラベルは必須です"),
  target: z
    .union([z.number(), z.string()])
    .transform((v) => Number(v))
    .pipe(z.number({ message: "目標値は数値である必要があります" })),
  unit: z.string().default(""),
});

const bodySchema = z.object({
  title: z.string().min(1, "政策名は必須です"),
  description: z.string().default(""),
  department: z.string().min(1, "担当課は必須です"),
  status: z.enum(["draft", "active", "completed"]).default("draft"),
  kpis: z.array(kpiSchema).max(5, "KPI は最大 5 件まで登録できます").default([]),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ data: null, error: "リクエストの形式が正しくありません" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => i.message).join("、");
    return NextResponse.json({ data: null, error: message }, { status: 400 });
  }

  const { title, description, department, status, kpis } = parsed.data;

  try {
    const projectId = await transaction(async (client) => {
      // 担当課名で municipality を検索し、なければ新規作成
      const existing = await client.query<{ id: string }>(
        "SELECT id FROM municipalities WHERE name = $1 LIMIT 1",
        [department],
      );

      let municipalityId: string;
      if (existing.rows[0]) {
        municipalityId = existing.rows[0].id;
      } else {
        const inserted = await client.query<{ id: string }>(
          "INSERT INTO municipalities (name, slug, prefecture) VALUES ($1, $2, '未設定') RETURNING id",
          [department, `dept-${crypto.randomUUID()}`],
        );
        if (!inserted.rows[0]) throw new Error("municipality の作成に失敗しました");
        municipalityId = inserted.rows[0].id;
      }

      const projectResult = await client.query<{ id: string }>(
        `INSERT INTO projects (municipality_id, title, description, status)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [municipalityId, title, description, status],
      );
      if (!projectResult.rows[0]) throw new Error("project の作成に失敗しました");
      const newProjectId = projectResult.rows[0].id;

      for (const kpi of kpis) {
        await client.query(
          "INSERT INTO kpis (project_id, label, target, unit) VALUES ($1, $2, $3, $4)",
          [newProjectId, kpi.label, kpi.target, kpi.unit],
        );
      }

      return newProjectId;
    });

    return NextResponse.json({ data: { projectId }, error: null }, { status: 201 });
  } catch (error) {
    if (isPgError(error) && error.code === PgErrorCode.UNIQUE_VIOLATION) {
      return NextResponse.json({ data: null, error: "すでに同じ政策が存在します" }, { status: 409 });
    }
    console.error("POST /api/admin/projects:", error);
    return NextResponse.json({ data: null, error: "登録に失敗しました" }, { status: 500 });
  }
}
