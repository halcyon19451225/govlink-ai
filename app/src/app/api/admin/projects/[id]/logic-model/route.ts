export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { query, queryOne, transaction } from "@/lib/db";
import { recordArtifact, resolveArtifactIds } from "@/lib/modules/recordArtifact";
import { requireModulePermission } from "@/lib/permissions";
import { normalizeEdges, normalizeElements, serializeElements } from "@/lib/logicmodel/elements";

type Params = { params: { id: string } };

/**
 * ロジックモデルの1列。
 * 旧クライアント（文字列配列を送る）と新クライアント（要素オブジェクトを送る）の
 * 両方を受ける。デプロイの前後でどちらが来ても壊れないようにするため。
 */
const elementListSchema = z.union([
  z.array(z.string()),
  z.array(
    z.object({
      id: z.string().optional(),
      text: z.string(),
      kpi_ids: z.array(z.string()).optional(),
    }),
  ),
]);

/** 受け取った列を {id,text,kpi_ids} に揃えて JSONB 文字列にする */
function columnJson(value: unknown, prefix: string): string {
  return JSON.stringify(serializeElements(normalizeElements(value, prefix)));
}

const bodySchema = z.object({
  name: z.string().optional().nullable(),
  purpose: z.string().optional().nullable(),
  basic_goal: z.string().optional().nullable(),
  basic_ideology: z.string().optional().nullable(),
  problem: z.string().optional().nullable(),
  challenge: z.string().optional().nullable(),
  root_cause: z.string().optional().nullable(),
  major_policy: z.string().optional().nullable(),
  inputs: elementListSchema.optional().default([]),
  activities: elementListSchema.optional().default([]),
  outputs: elementListSchema.optional().default([]),
  outcomes: z.any().optional().nullable(),
  initial_outcomes: elementListSchema.optional().nullable(),
  intermediate_outcomes: elementListSchema.optional().nullable(),
  long_outcomes: elementListSchema.optional().nullable(),
  edges: z.array(z.object({ from: z.string(), to: z.string(), note: z.string().optional() })).optional().nullable(),
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
  inputs: elementListSchema.optional(),
  activities: elementListSchema.optional(),
  outputs: elementListSchema.optional(),
  outcomes: z.any().optional().nullable(),
  initial_outcomes: elementListSchema.optional().nullable(),
  intermediate_outcomes: elementListSchema.optional().nullable(),
  long_outcomes: elementListSchema.optional().nullable(),
  edges: z.array(z.object({ from: z.string(), to: z.string(), note: z.string().optional() })).optional().nullable(),
  issue_hypothesis_id: z.string().uuid().optional().nullable(),
  status: z.enum(["draft", "confirmed"]).optional(),
});

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, "logic_model", "view");
  if (deny) return deny;

  const rows = await query(
    // FILTER は集約関数にしか付けられない。json_build_object に付けていたため
    // このGETは常に 500 になり、編集後の再読み込みが動いていなかった。
    // 課題仮説が無いときに NULL を返すのは CASE で表す。
    `SELECT lm.*,
            CASE WHEN ih.id IS NULL THEN NULL ELSE
              json_build_object(
                'id', ih.id,
                'title', ih.title,
                'description', ih.description,
                'root_cause', ih.root_cause,
                'proposed_measures', ih.proposed_measures
              )
            END AS upstream_hypothesis
     FROM logic_models lm
     LEFT JOIN issue_hypotheses ih ON ih.id = lm.issue_hypothesis_id
     WHERE lm.project_id = $1
     ORDER BY lm.is_current DESC, lm.version DESC, lm.created_at DESC LIMIT 1`,
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

  // 版を積む。既存の現行版があれば降ろし、新しい行を現行版にする。
  // version を常に 1 で入れていたため「最新版」が version では決まらず、
  // 画面ごとに ORDER BY version / generated_at が割れて別の行を見ていた（034 で is_current を導入）。
  const created = await transaction(async (client) => {
    const prev = await client.query<{ id: string }>(
      `SELECT id FROM logic_models
       WHERE project_id = $1
       ORDER BY is_current DESC, version DESC, created_at DESC
       LIMIT 1`,
      [params.id],
    );
    const prevId = prev.rows[0]?.id ?? null;

    await client.query(
      "UPDATE logic_models SET is_current = false WHERE project_id = $1 AND is_current",
      [params.id],
    );

    const res = await client.query<{ id: string; version: number }>(
      `INSERT INTO logic_models
         (project_id, name, purpose, basic_goal, basic_ideology,
          problem, challenge, root_cause, major_policy,
          inputs, activities, outputs, outcomes,
          initial_outcomes, intermediate_outcomes, long_outcomes,
          edges, issue_hypothesis_id, status, version, is_current,
          revised_from_id, ai_generated)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
               $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb,
               $14::jsonb, $15::jsonb, $16::jsonb,
               $17::jsonb, $18, $19,
               (SELECT COALESCE(MAX(version), 0) + 1 FROM logic_models WHERE project_id = $1),
               true, $20, false)
       RETURNING id, version`,
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
        columnJson(d.inputs, "inputs"),
        columnJson(d.activities, "activities"),
        columnJson(d.outputs, "outputs"),
        // outcomes は旧形式の写し。正本は三層の専用列（035）。
        d.outcomes != null ? JSON.stringify(d.outcomes) : null,
        columnJson(d.initial_outcomes, "initial_outcomes"),
        columnJson(d.intermediate_outcomes, "intermediate_outcomes"),
        columnJson(d.long_outcomes, "long_outcomes"),
        JSON.stringify(normalizeEdges(d.edges)),
        d.issue_hypothesis_id ?? null,
        d.status,
        prevId,
      ],
    );
    return res.rows[0] ?? null;
  });

  const row = created;

  if (!row) {
    return NextResponse.json({ data: null, error: "DB登録に失敗しました" }, { status: 500 });
  }

  // 成果物レジストリに登録（R2-3）
  const version = row.version;
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
  // 要素列は必ず {id,text,kpi_ids} に揃えてから書く。
  // 旧クライアントが文字列配列を送ってきても、DBの形は一定に保たれる。
  const addColumn = (col: string, val: unknown) => {
    setClauses.push(`${col} = $${paramIndex++}::jsonb`);
    values.push(columnJson(val, col));
  };

  if ("inputs" in d) addColumn("inputs", d.inputs);
  if ("activities" in d) addColumn("activities", d.activities);
  if ("outputs" in d) addColumn("outputs", d.outputs);
  if ("outcomes" in d) addField("outcomes", d.outcomes, true);
  if ("initial_outcomes" in d) addColumn("initial_outcomes", d.initial_outcomes);
  if ("intermediate_outcomes" in d) addColumn("intermediate_outcomes", d.intermediate_outcomes);
  if ("long_outcomes" in d) addColumn("long_outcomes", d.long_outcomes);
  if ("edges" in d) {
    setClauses.push(`edges = $${paramIndex++}::jsonb`);
    values.push(JSON.stringify(normalizeEdges(d.edges)));
  }
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
