export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { requireProjectAccess } from "@/lib/tenant";
import { transaction } from "@/lib/db";
import { actorFromSession } from "@/lib/activity";
import { recordValueTx } from "@/lib/indicator/service";

const kpiUpdateSchema = z.object({
  id: z.string().uuid("KPI ID が不正です"),
  current: z
    .union([z.number(), z.string()])
    .transform((v) => Number(v))
    .pipe(z.number({ message: "KPI 現在値は数値である必要があります" })),
});

const bodySchema = z.object({
  projectId: z.string().uuid("プロジェクト ID が不正です"),
  type: z.enum(["plan", "progress", "result"], { message: "投稿タイプが不正です" }),
  body: z.string().min(1, "本文は必須です"),
  aiSummary: z.string().optional(),
  kpiUpdates: z.array(kpiUpdateSchema).default([]),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json(
      { data: null, error: "リクエストの形式が正しくありません" },
      { status: 400 },
    );
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => i.message).join("、");
    return NextResponse.json({ data: null, error: message }, { status: 400 });
  }

  const { projectId, type, body, aiSummary, kpiUpdates } = parsed.data;
  // テナント境界（claude/coe-tenant-isolation.md A-6）。
  // この API は project を URL/本文の ID で直接指すため、所属自治体を必ず確認する
  const outOfTenant = await requireProjectAccess(session, projectId);
  if (outOfTenant) return outOfTenant;


  try {
    const actor = actorFromSession(session, "ui");
    const postId = await transaction(async (client) => {
      // プロジェクトの存在確認
      const projectCheck = await client.query<{ id: string }>(
        "SELECT id FROM projects WHERE id = $1",
        [projectId],
      );
      if (!projectCheck.rows[0]) throw Object.assign(new Error("政策が見つかりません"), { status: 404 });

      // 投稿を INSERT（即時公開）
      const postResult = await client.query<{ id: string }>(
        `INSERT INTO posts (project_id, type, body, ai_summary, published_at)
         VALUES ($1, $2, $3, $4, now())
         RETURNING id`,
        [projectId, type, body, aiSummary ?? null],
      );
      if (!postResult.rows[0]) throw new Error("投稿の作成に失敗しました");
      const newPostId = postResult.rows[0].id;

      // 指標の実績値を記録する。
      // 069 以降、`current` という上書きされる1列は無い。**いつ時点の値か**を持つ履歴に積む
      // （投稿に添えた実績なので、基準日は投稿日＝今日。設計 §9-4）
      const asOf = new Date().toISOString().slice(0, 10);
      for (const update of kpiUpdates) {
        await recordValueTx(client, actor, projectId, update.id, {
          asOf,
          scope: "plan",
          value: update.current,
          note: "進捗投稿に添えて入力",
          inputs: { post_id: newPostId },
        });
      }

      return newPostId;
    });

    return NextResponse.json({ data: { postId }, error: null }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && "status" in error && (error as Error & { status: number }).status === 404) {
      return NextResponse.json({ data: null, error: "政策が見つかりません" }, { status: 404 });
    }
    console.error("POST /api/admin/posts:", error);
    return NextResponse.json({ data: null, error: "投稿に失敗しました" }, { status: 500 });
  }
}
