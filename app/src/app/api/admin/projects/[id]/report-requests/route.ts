export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { requireModulePermission } from "@/lib/permissions";
import { aiCreateMessage } from "@/lib/ai/gateway";
import {
  sanitizeQuestions,
  sanitizeTargets,
  type ReportQuestion,
  type ReportTarget,
} from "@/lib/report/types";

type Params = { params: { id: string } };

const MODULE = "program_evaluation";

/**
 * 実績報告依頼（S2 C①）
 * GET  … 依頼一覧（回答状況の集計つき）
 * POST … 依頼の作成（対象施策を選ぶと設問をAIが自動組成 — taskType generation.report_request）
 *        作成時は draft。設問・依頼文を確認・編集してから「送信」（[requestId] の PATCH）で
 *        対象ごとの回答行とトークンURLが発行される（無確認の自動送信をしない）
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, MODULE, "view");
  if (deny) return deny;

  const rows = await query(
    `SELECT r.id, r.kind, r.fiscal_year, to_char(r.due_date, 'YYYY-MM-DD') AS due_date,
            r.title, r.status, r.created_at::text AS created_at, r.sent_at::text AS sent_at,
            r.closed_at::text AS closed_at,
            jsonb_array_length(r.targets) AS target_count,
            (SELECT count(*)::int FROM report_responses x
              WHERE x.request_id = r.id AND x.status IN ('answered', 'accepted')) AS answered_count,
            (SELECT count(*)::int FROM report_responses x
              WHERE x.request_id = r.id AND x.status = 'accepted') AS accepted_count
     FROM report_requests r
     WHERE r.project_id = $1
     ORDER BY r.created_at DESC LIMIT 50`,
    [params.id],
  );
  return NextResponse.json({ data: rows, error: null });
}

const GEN_TOOL: Anthropic.Tool = {
  name: "record_report_questions",
  description: "実績報告依頼の設問と依頼文を記録します。",
  input_schema: {
    type: "object",
    properties: {
      instruction: {
        type: "string",
        description: "依頼文の下書き（宛先の担当者・事業者向け。目的・期限・記入上の注意を簡潔に）",
      },
      questions: {
        type: "array",
        description: "設問の一覧",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "設問ID（半角英数とハイフン。例: m1-sessions）" },
            label: { type: "string", description: "設問文（例: 実施回数（年間合計）)" },
            type: { type: "string", enum: ["number", "text", "textarea"] },
            unit: { type: "string", description: "numberのときの単位（回・人・% など）" },
            kpi_id: { type: "string", description: "KPI実績値の設問のみ: 与えたKPIのID" },
            measure_design_id: { type: "string", description: "その施策専用の設問のみ: 与えた施策のID（共通設問は省略）" },
            required: { type: "boolean" },
          },
          required: ["id", "label", "type"],
        },
      },
    },
    required: ["questions"],
  },
};

const postSchema = z.object({
  kind: z.enum(["annual", "period_end"]),
  fiscal_year: z.number().int().min(2000).max(2100).optional().nullable(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  title: z.string().min(1).max(200),
  measure_ids: z.array(z.string().uuid()).min(1).max(30),
});

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, MODULE, "edit");
  if (deny) return deny;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ data: null, error: "リクエスト本文が不正です" }, { status: 400 });
  }
  const parsed = postSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: parsed.error.issues[0]?.message ?? "入力が不正です" },
      { status: 400 },
    );
  }
  const d = parsed.data;

  const [project, measures] = await Promise.all([
    queryOne<{ title: string; municipality: string }>(
      `SELECT p.title, m.name AS municipality
       FROM projects p JOIN municipalities m ON m.id = p.municipality_id WHERE p.id = $1`,
      [params.id],
    ),
    query<{
      id: string;
      title: string;
      owner_department: string | null;
      structure_indicators: unknown;
      process_indicators: unknown;
      kpi_ids_initial: string[];
      kpi_ids_intermediate: string[];
    }>(
      `SELECT id, title, owner_department, structure_indicators, process_indicators,
              kpi_ids_initial, kpi_ids_intermediate
       FROM measure_designs
       WHERE project_id = $1 AND id = ANY($2::uuid[])
       ORDER BY sort_order, created_at`,
      [params.id, d.measure_ids],
    ),
  ]);
  if (!project) {
    return NextResponse.json({ data: null, error: "プロジェクトが見つかりません" }, { status: 404 });
  }
  if (measures.length === 0) {
    return NextResponse.json({ data: null, error: "選択された施策が見つかりません" }, { status: 400 });
  }

  const kpiIds = Array.from(
    new Set(measures.flatMap((m) => [...(m.kpi_ids_initial ?? []), ...(m.kpi_ids_intermediate ?? [])])),
  );
  const kpis =
    kpiIds.length > 0
      ? await query<{ id: string; label: string; unit: string }>(
          `SELECT id, label, unit FROM kpis WHERE project_id = $1 AND id = ANY($2::uuid[])`,
          [params.id, kpiIds],
        )
      : [];

  const indicatorText = (v: unknown): string => {
    if (!Array.isArray(v)) return "";
    return (v as { text?: unknown }[])
      .map((x) => (x && typeof x === "object" && typeof x.text === "string" ? x.text : null))
      .filter(Boolean)
      .join(" / ");
  };

  const kindLabel = d.kind === "annual" ? "年次報告" : "計画期間報告";
  const system = `あなたは日本の地方自治体の実績管理を支援する行政実務の専門家です。
施策の担当者・委託事業者に送る「実績報告」の設問一式と依頼文を record_report_questions ツールで作ってください。

【設問の作り方】
- 施策ごとに: 実施回数・参加者数などの**プロセス実績（number）**、E区画の指標に対応する実績値、
  **所見（textarea・うまくいった点/工夫）**、**課題（textarea・実施上の困りごと）**を作る。
  これらは measure_design_id にその施策のIDを入れる。
- **KPI実績値の設問**は、与えたKPIごとに number 型で作り、kpi_id にそのIDを入れる
  （受領後にシステムがKPI報告へ取り込むため、単位も正確に）。
  KPIがどの施策の担当かは与えた対応で判断し、その施策の measure_design_id を付ける。
- 共通設問（全対象に同じもの）は measure_design_id を省略する（例: 報告者名 text・全体所見 textarea）。
- 設問IDは半角英数ハイフンで一意に。件数は全体で40問以内。数値の创作をさせない表現にする。
- 依頼文（instruction）は${kindLabel}の目的・期限・記入時の注意（実績は台帳等の記録に基づくこと）を簡潔に。`;

  const userContent = `【プロジェクト】${project.title}（${project.municipality}）
【報告種別】${kindLabel}${d.fiscal_year ? ` / ${d.fiscal_year}年度` : ""}${d.due_date ? ` / 回答期限 ${d.due_date}` : ""}

【対象施策】
${measures
  .map((m) => {
    const kpiForMeasure = kpis.filter((k) =>
      [...(m.kpi_ids_initial ?? []), ...(m.kpi_ids_intermediate ?? [])].includes(k.id),
    );
    return `■ ${m.title}（id: ${m.id} / 担当: ${m.owner_department ?? "未定"}）
  プロセス指標: ${indicatorText(m.process_indicators) || "（未設定）"}
  体制指標: ${indicatorText(m.structure_indicators) || "（未設定）"}
  紐づくKPI: ${kpiForMeasure.map((k) => `${k.label}（id: ${k.id} / 単位: ${k.unit || "—"}）`).join("、") || "（なし）"}`;
  })
  .join("\n")}`;

  try {
    const message = await aiCreateMessage(
      { taskType: "generation.report_request", projectId: params.id },
      {
        max_tokens: 6000,
        system: [{ type: "text", text: system }],
        tools: [GEN_TOOL],
        tool_choice: { type: "tool", name: "record_report_questions" },
        messages: [{ role: "user", content: userContent }],
      },
    );
    const toolUse = message.content.find(
      (c): c is Anthropic.ToolUseBlock => c.type === "tool_use" && c.name === "record_report_questions",
    );
    const input = (toolUse?.input ?? {}) as { instruction?: unknown; questions?: unknown };
    const questions: ReportQuestion[] = sanitizeQuestions(
      input.questions,
      new Set(kpis.map((k) => k.id)),
      new Set(measures.map((m) => m.id)),
    );
    if (questions.length === 0) {
      return NextResponse.json({ data: null, error: "設問の生成に失敗しました（再実行してください）" }, { status: 502 });
    }
    const instruction =
      typeof input.instruction === "string" ? input.instruction.trim().slice(0, 4000) : "";

    const targets: ReportTarget[] = sanitizeTargets(
      measures.map((m) => ({
        target_key: m.id,
        measure_design_id: m.id,
        measure_title: m.title,
        owner_department: m.owner_department,
        owner_name: null,
        email: null,
      })),
    );

    const row = await queryOne<{ id: string }>(
      `INSERT INTO report_requests
         (project_id, kind, fiscal_year, due_date, title, instruction, form_def, targets)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
       RETURNING id`,
      [
        params.id,
        d.kind,
        d.fiscal_year ?? null,
        d.due_date ?? null,
        d.title.trim(),
        instruction,
        JSON.stringify(questions),
        JSON.stringify(targets),
      ],
    );
    return NextResponse.json({ data: { id: row?.id ?? null }, error: null });
  } catch (e) {
    console.error("実績報告依頼の作成に失敗:", e);
    return NextResponse.json({ data: null, error: "依頼の作成に失敗しました" }, { status: 500 });
  }
}
