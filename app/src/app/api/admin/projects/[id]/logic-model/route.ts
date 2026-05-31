export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { recordArtifact, resolveArtifactIds } from "@/lib/modules/recordArtifact";
import { requireModulePermission } from "@/lib/permissions";

type Params = { params: { id: string } };

const bodySchema = z.object({
  name: z.string().optional().nullable(),
  purpose: z.string().optional().nullable(),
  basic_goal: z.string().optional().nullable(),
  basic_ideology: z.string().optional().nullable(),
  problem: z.string().optional().nullable(),
  challenge: z.string().optional().nullable(),
  root_cause: z.string().optional().nullable(),
  major_policy: z.string().optional().nullable(),
  inputs: z.array(z.string()).optional().default([]),
  activities: z.array(z.string()).optional().default([]),
  outputs: z.array(z.string()).optional().default([]),
  outcomes: z.any().optional().nullable(),
  initial_outcomes: z.array(z.string()).optional().nullable(),
  intermediate_outcomes: z.array(z.string()).optional().nullable(),
  issue_hypothesis_id: z.string().uuid().optional().nullable(),
  status: z.enum(["draft", "confirmed"]).default("draft"),
});

const patchSchema = z.object({
  id: z.string().uuid(),
  name: z.string().optional().nullable(),
  purpose: z.string().optional().nullable(),
  basic_goal: z.string().optional().nullable(),
  basic_ideology: z.string().optional().nullable(),
  problem: z.string().optional().nullable(),
  challenge: z.string().optional().nullable(),
  root_cause: z.string().optional().nullable(),
  major_policy: z.string().optional().nullable(),
  inputs: z.array(z.string()).optional(),
  activities: z.array(z.string()).optional(),
  outputs: z.array(z.string()).optional(),
  outcomes: z.any().optional().nullable(),
  initial_outcomes: z.array(z.string()).optional().nullable(),
  intermediate_outcomes: z.array(z.string()).optional().nullable(),
  issue_hypothesis_id: z.string().uuid().optional().nullable(),
  status: z.enum(["draft", "confirmed"]).optional(),
});

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, "logic_model", "view");
  if (deny) return deny;

  const rows = await query(
    `SELECT lm.*,
            json_build_object(
              'id', ih.id,
              'title', ih.title,
              'description', ih.description,
              'root_cause', ih.root_cause,
              'proposed_measures', ih.proposed_measures
            ) FILTER (WHERE ih.id IS NOT NULL) AS upstream_hypothesis
     FROM logic_models lm
     LEFT JOIN issue_hypotheses ih ON ih.id = lm.issue_hypothesis_id
     WHERE lm.project_id = $1
     ORDER BY lm.version DESC LIMIT 1`,
    [params.id],
  );

  return NextResponse.json({ data: rows[0] ?? null, error: null });
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, "logic_model", "edit");
  if (deny) return deny;

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
    `INSERT INTO logic_models
       (project_id, name, purpose, basic_goal, basic_ideology,
        problem, challenge, root_cause, major_policy,
        inputs, activities, outputs, outcomes,
        initial_outcomes, intermediate_outcomes,
        issue_hypothesis_id, status, version, ai_generated)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
             $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb,
             $14::jsonb, $15::jsonb,
             $16, $17, 1, false)
     RETURNING id`,
    [
      params.id,
      d.name ?? null,
      d.purpose ?? null,
      d.basic_goal ?? null,
      d.basic_ideology ?? null,
      d.problem ?? null,
      d.challenge ?? null,
      d.root_cause ?? null,
      d.major_policy ?? null,
      JSON.stringify(d.inputs ?? []),
      JSON.stringify(d.activities ?? []),
      JSON.stringify(d.outputs ?? []),
      d.outcomes != null ? JSON.stringify(d.outcomes) : null,
      d.initial_outcomes != null ? JSON.stringify(d.initial_outcomes) : null,
      d.intermediate_outcomes != null ? JSON.stringify(d.intermediate_outcomes) : null,
      d.issue_hypothesis_id ?? null,
      d.status,
    ],
  );

  if (!row) {
    return NextResponse.json({ data: null, error: "DB登録に失敗しました" }, { status: 500 });
  }

  // 成果物レジストリに登録（R2-3）
  const version = 1;
  const sourceIds = await resolveArtifactIds(
    params.id,
    "issue_hypothesis",
    [d.issue_hypothesis_id],
  );
  await recordArtifact({
    projectId: params.id,
    moduleId: "logic_model",
    artifactType: `logic_model_v${version}`,
    artifactRecordId: row.id,
    sourceArtifactIds: sourceIds,
    derivationNote: d.issue_hypothesis_id
      ? `課題仮説(${d.issue_hypothesis_id})からロジックモデルを作成`
      : undefined,
  }).catch((e) => console.error("recordArtifact(logic_model) 失敗:", e));

  return NextResponse.json({ data: { id: row.id }, error: null }, { status: 201 });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, "logic_model", "edit");
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

  const { id: modelId, ...d } = parsed.data;

  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  const addField = (col: string, val: unknown, jsonb = false) => {
    setClauses.push(`${col} = $${paramIndex++}${jsonb ? "::jsonb" : ""}`);
    values.push(jsonb && val != null ? JSON.stringify(val) : val);
  };

  if ("name" in d) addField("name", d.name ?? null);
  if ("purpose" in d) addField("purpose", d.purpose ?? null);
  if ("basic_goal" in d) addField("basic_goal", d.basic_goal ?? null);
  if ("basic_ideology" in d) addField("basic_ideology", d.basic_ideology ?? null);
  if ("problem" in d) addField("problem", d.problem ?? null);
  if ("challenge" in d) addField("challenge", d.challenge ?? null);
  if ("root_cause" in d) addField("root_cause", d.root_cause ?? null);
  if ("major_policy" in d) addField("major_policy", d.major_policy ?? null);
  if ("inputs" in d) addField("inputs", d.inputs, true);
  if ("activities" in d) addField("activities", d.activities, true);
  if ("outputs" in d) addField("outputs", d.outputs, true);
  if ("outcomes" in d) addField("outcomes", d.outcomes, true);
  if ("initial_outcomes" in d) addField("initial_outcomes", d.initial_outcomes, true);
  if ("intermediate_outcomes" in d) addField("intermediate_outcomes", d.intermediate_outcomes, true);
  if ("issue_hypothesis_id" in d) addField("issue_hypothesis_id", d.issue_hypothesis_id ?? null);
  if (d.status !== undefined) addField("status", d.status);

  if (setClauses.length === 0) {
    return NextResponse.json({ data: null, error: "更新フィールドがありません" }, { status: 400 });
  }

  setClauses.push(`updated_at = now()`);

  values.push(modelId, params.id);
  const idParam = paramIndex++;
  const projectParam = paramIndex;

  const row = await queryOne<{ id: string }>(
    `UPDATE logic_models SET ${setClauses.join(", ")}
     WHERE id = $${idParam} AND project_id = $${projectParam}
     RETURNING id`,
    values,
  );

  if (!row) {
    return NextResponse.json({ data: null, error: "ロジックモデルが見つかりません" }, { status: 404 });
  }

  return NextResponse.json({ data: { id: row.id }, error: null });
}
