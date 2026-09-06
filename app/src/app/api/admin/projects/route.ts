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
  achievement_condition: z.enum(["lte","lt","gte","gt","eq"]).nullable().optional(),
  target_deadline: z.string().nullable().optional(),
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

  // ⚠ 政策の所属自治体は **セッションからしか決めない**。
  //
  //   かつてここは「セッションに自治体IDが無ければ、リクエストの担当課名
  //   （department）で municipalities を名前検索し、あれば合流・無ければ新規作成」
  //   していた。これは §3-5 で /api/auth/register から取り除いたのと同じ
  //   「名前による合流」で、ログイン済みでテナント未確定の利用者が
  //   `department: "御船町"` を送るだけで、**他自治体に政策を書き込めた**。
  //   （実データの `slug = dept-…` の自治体は、この経路で作られたものと見られる。
  //     他は `org-…` で作られている）
  //   claude/coe-tenant-isolation.md / claude/ordo-id-design.md §3-5
  //
  //   097a0dc 以降、user_identities に紐づかない利用者には municipalityId が付かない
  //   （fail closed）。ここで弾けば、その状態のまま書き込むことはできない。
  const sessionMunId = session.user?.municipalityId;
  if (!sessionMunId) {
    return NextResponse.json(
      { data: null, error: "所属自治体が特定できないため、政策を登録できません" },
      { status: 403 },
    );
  }

  // プラン制限チェック
  const limitCheck = await checkLimit(sessionMunId, "projects");
  if (!limitCheck.allowed) {
    return NextResponse.json(
      { data: null, error: `プランの上限（${limitCheck.limit}件）に達しました`, upgrade_url: "/pricing" },
      { status: 403 },
    );
  }

  try {
    const projectId = await transaction(async (client) => {
      // 所属自治体はセッションのものに固定する（上でチェック済み）。
      // ⚠ ここに「名前で探して無ければ作る」を戻さないこと。テナント境界が壊れる
      const municipalityId = sessionMunId;

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
              indicator_type, previous_value, previous_target,
              achievement_condition, target_deadline)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            newProjectId, kpi.label, kpi.target, kpi.unit,
            goalId, kpi.indicator_type,
            kpi.previous_value ?? null, kpi.previous_target ?? null,
            kpi.achievement_condition ?? null,
            kpi.target_deadline ?? null,
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
