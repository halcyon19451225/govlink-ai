export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { transaction, isPgError, PgErrorCode } from "@/lib/db";
import { checkLimit } from "@/lib/plan-limits";
import { instantiateTemplate } from "@/lib/templates";

const kpiSchema = z.object({
  label: z.string().min(1, "KPI ラベルは必須です"),
  target: z
    .union([z.number(), z.string()])
    .transform((v) => Number(v))
    .pipe(z.number({ message: "目標値は数値である必要があります" })),
  unit: z.string().default(""),
  goal_index: z.number().int().optional().nullable(),
  indicator_type: z
    .enum(["process", "outcome_initial", "outcome_mid", "outcome_long", "efficiency"])
    .default("process"),
  previous_value: z.number().optional().nullable(),
  previous_target: z.number().optional().nullable(),
  sort_order: z.number().int().default(0),
});

const goalSchema = z.object({
  title: z.string().min(1, "基本目標タイトルは必須です"),
  description: z.string().default(""),
  sort_order: z.number().int().default(0),
});

const bodySchema = z.object({
  title: z.string().min(1, "政策名は必須です"),
  description: z.string().default(""),
  department: z.string().default(""),
  status: z.enum(["draft", "active", "completed"]).default("draft"),
  template_id: z.string().nullable().optional(),
  plan_start_date: z.string().optional().nullable(),
  plan_end_date: z.string().optional().nullable(),
  is_composite: z.boolean().default(false),
  purpose: z.string().optional().nullable(),
  major_policy: z.string().optional().nullable(),
  department_name: z.string().optional().nullable(),
  vision: z.string().optional().nullable(),
  module_overrides: z.record(z.string(), z.object({ enabled: z.boolean() })).optional(),
  goals: z.array(goalSchema).default([]),
  kpis: z.array(kpiSchema).max(20, "KPI は最大 20 件まで登録できます").default([]),
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
    const details = parsed.error.issues.map((i) => ({
      field: i.path.join(".") || "(root)",
      message: i.message,
      code: i.code,
    }));
    console.error("POST /api/admin/projects バリデーションエラー:", JSON.stringify(details, null, 2));
    const message = details.map((d) => `${d.field}: ${d.message}`).join("、");
    return NextResponse.json({ data: null, error: message, details }, { status: 400 });
  }

  const {
    title, description, department, status,
    template_id, plan_start_date, plan_end_date, is_composite,
    purpose, major_policy, department_name, vision,
    goals, kpis,
  } = parsed.data;

  // プラン制限チェック（セッションに自治体IDがある場合のみ）
  const sessionMunId = session.user?.municipalityId;
  if (sessionMunId) {
    const limitCheck = await checkLimit(sessionMunId, "projects");
    if (!limitCheck.allowed) {
      return NextResponse.json(
        { data: null, error: `プランの上限（${limitCheck.limit}件）に達しました`, upgrade_url: "/pricing" },
        { status: 403 },
      );
    }
  }

  try {
    const projectId = await transaction(async (client) => {
      // セッションから自治体ID取得、なければ担当課名でフォールバック
      let municipalityId = session.user?.municipalityId ?? null;

      if (!municipalityId) {
        if (!department) throw new Error("自治体情報が取得できません");
        const existing = await client.query<{ id: string }>(
          "SELECT id FROM municipalities WHERE name = $1 LIMIT 1",
          [department],
        );
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
      }

      const projectResult = await client.query<{ id: string }>(
        `INSERT INTO projects
           (municipality_id, title, description, status,
            template_id, plan_start_date, plan_end_date, is_composite,
            department_name, purpose, major_policy, vision)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING id`,
        [
          municipalityId, title, description, status,
          template_id ?? null,
          plan_start_date ? plan_start_date : null,
          plan_end_date ? plan_end_date : null,
          is_composite,
          department_name ?? department ?? null,
          purpose ?? null,
          major_policy ?? null,
          vision ?? null,
        ],
      );
      if (!projectResult.rows[0]) throw new Error("project の作成に失敗しました");
      const newProjectId = projectResult.rows[0].id;

      // 基本目標を挿入し、goal_number → goal_id マップを作成
      const goalIdMap: Record<number, string> = {};
      let goalIdx = 0;
      for (const g of goals) {
        const gr = await client.query<{ id: string }>(
          `INSERT INTO project_goals (project_id, goal_number, title, description, sort_order)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [newProjectId, goalIdx + 1, g.title, g.description, g.sort_order ?? goalIdx],
        );
        if (gr.rows[0]) goalIdMap[goalIdx] = gr.rows[0].id;
        goalIdx++;
      }

      // KPIを挿入
      for (const kpi of kpis) {
        const goalId =
          kpi.goal_index != null && goalIdMap[kpi.goal_index] != null
            ? goalIdMap[kpi.goal_index]
            : null;
        await client.query(
          `INSERT INTO kpis
             (project_id, label, target, unit, goal_id,
              indicator_type, previous_value, previous_target)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            newProjectId, kpi.label, kpi.target, kpi.unit,
            goalId, kpi.indicator_type,
            kpi.previous_value ?? null, kpi.previous_target ?? null,
          ],
        );
      }

      return newProjectId;
    });

    // テンプレートからPDCAチェックポイント・モジュール設定を生成
    if (template_id && plan_start_date) {
      try {
        await instantiateTemplate(template_id, projectId, new Date(plan_start_date));
      } catch (instantiateError) {
        // instantiateTemplate の失敗はプロジェクト作成自体は成功扱い（ログのみ）
        console.error("instantiateTemplate 失敗:", instantiateError);
      }
    }

    return NextResponse.json({ data: { projectId }, error: null }, { status: 201 });
  } catch (error) {
    if (isPgError(error) && error.code === PgErrorCode.UNIQUE_VIOLATION) {
      return NextResponse.json({ data: null, error: "すでに同じ政策が存在します" }, { status: 409 });
    }
    console.error("POST /api/admin/projects:", error);
    return NextResponse.json({ data: null, error: "登録に失敗しました" }, { status: 500 });
  }
}
