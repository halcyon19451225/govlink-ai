export const dynamic = "force-dynamic";
export const maxDuration = 120;

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import type Anthropic from "@anthropic-ai/sdk";
import { authOptions } from "@/lib/auth";
import { requireProjectAccess } from "@/lib/tenant";
import { query, queryOne } from "@/lib/db";
import { requireModulePermission } from "@/lib/permissions";
import { aiCreateMessage } from "@/lib/ai/gateway";
import { sanitizeIntakeProposals } from "@/lib/plan/handoverIntake";
import { LM_ELEMENT_SECTIONS } from "@/lib/plan/clone";

type Params = { params: { id: string } };

const MODULE = "self_evaluation";

/**
 * 引き継ぎ反映の差分提案を生成（PL1 P② 経路1）— taskType: proposal.handover_intake
 *
 * 入力: plan_handovers.package（未達アウトカム・carry_over改善・判断経路・真因）＋
 *       新計画の現状（複製済みdraft施策・KPI・ロジックモデル現行版）
 * 出力: 4系統の提案（LM要素修正 / 施策B・D区画反映 / KPI目標見直し / 改善起票）。
 *       **提案はまだ何も適用しない** — 担当者が選別して /apply で一括適用する。
 */

const INTAKE_TOOL: Anthropic.Tool = {
  name: "record_intake_proposals",
  description: "前期引き継ぎパッケージを新計画へ反映するための差分提案を記録します。",
  input_schema: {
    type: "object",
    properties: {
      proposals: {
        type: "array",
        description: "反映の差分提案（最大30件。根拠の薄い提案は出さない）",
        items: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["lm_element_edit", "measure_update", "kpi_target", "improvement_action"],
            },
            // lm_element_edit
            section: {
              type: "string",
              description:
                "lm_element_edit: ロジックモデルのセクション（inputs/activities/outputs/outcomes/initial_outcomes/intermediate_outcomes/long_outcomes）。measure_update: intervention（B区画）| experiment（D区画）",
            },
            element_id: { type: "string", description: "lm_element_edit: 修正する既存要素のid。新規追加なら省略" },
            new_text: { type: "string", description: "lm_element_edit: 修正後の要素テキスト" },
            rationale: { type: "string", description: "lm_element_edit / kpi_target: 提案の根拠（引き継ぎ項目との対応を明記）" },
            // measure_update
            measure_id: { type: "string", description: "measure_update: 反映先の施策ID（新計画側の一覧から選ぶ）" },
            proposal: { type: "string", description: "measure_update: 反映内容（carry_over改善に基づく修正案）" },
            from_action_title: { type: "string", description: "measure_update: 元になった改善アクション名" },
            // kpi_target
            kpi_id: { type: "string", description: "kpi_target: 対象KPIのID（新計画側の一覧から選ぶ）" },
            proposed_target: { type: "number", description: "kpi_target: 見直し後の目標値（根拠が薄ければ省略し要見直しのままにする）" },
            proposed_deadline: { type: "string", description: "kpi_target: 見直し後の期限（YYYY-MM-DD・省略可）" },
            // improvement_action
            title: { type: "string", description: "improvement_action: 起票する改善アクション名" },
            detail: { type: "string", description: "improvement_action: 内容" },
            root_cause: { type: "string", description: "improvement_action: 対応する真因" },
          },
          required: ["type"],
        },
      },
    },
    required: ["proposals"],
  },
};

const SYSTEM = `あなたは日本の地方自治体の計画づくりを支援する政策アナリストです。
前期計画の「引き継ぎパッケージ」（未達アウトカム・次期へ送る改善アクション・
評価フローの判断経路・真因）を、複製済みの次期計画（たたき台）へ反映するための
**差分提案**を record_intake_proposals ツールで出してください。

【厳守】
- 提案は**引き継ぎパッケージに書かれている内容に基づくものだけ**。一般論の追加をしない。
- 各提案の rationale / from_action_title に「どの引き継ぎ項目から来たか」を必ず書く（リネージ）。
- measure_update の measure_id・kpi_target の kpi_id は、与えた新計画側の一覧にあるIDだけを使う。
- carry_over の改善アクションは原則 improvement_action として起票し、対応する施策が
  明確な場合のみ measure_update も併せて提案する。
- 未達アウトカムに対応する KPI は、根拠をもって数値を提案できる場合のみ proposed_target を出す。
  根拠が薄ければ数値は出さない（要見直しフラグのままにする — 勝手な目標値を作らない）。
- ロジックモデルの修正は、未達アウトカムと真因から因果の見直しが必要な要素に限る。
- 提案がない系統は出さなくてよい（無理に埋めない）。適用の可否は担当者が判断する。`;

export async function POST(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  // テナント境界。URL の project id が自分の自治体のものか確認する
  // （claude/coe-tenant-isolation.md A-4）。拒否は 404 で、存在を漏らさない
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  const deny = await requireModulePermission(session, params.id, MODULE, "edit");
  if (deny) return deny;

  const handover = await queryOne<{ id: string; package: unknown; title: string }>(
    `SELECT id, package, title FROM plan_handovers
     WHERE target_project_id = $1 AND status = 'finalized'
     ORDER BY finalized_at DESC NULLS LAST LIMIT 1`,
    [params.id],
  );
  if (!handover) {
    return NextResponse.json(
      { data: null, error: "取り込み可能な引き継ぎパッケージがありません（finalized済みが必要）" },
      { status: 404 },
    );
  }

  const [measures, kpis, lm] = await Promise.all([
    query<{ id: string; title: string; intervention: string | null }>(
      `SELECT id, title, intervention FROM measure_designs
       WHERE project_id = $1 ORDER BY sort_order, created_at LIMIT 30`,
      [params.id],
    ),
    query<{ id: string; label: string; target: number; unit: string; target_needs_review: boolean }>(
      `SELECT id, label, target::float AS target, unit, target_needs_review
       FROM kpis WHERE project_id = $1 ORDER BY created_at LIMIT 50`,
      [params.id],
    ),
    queryOne<Record<string, unknown>>(
      `SELECT ${LM_ELEMENT_SECTIONS.map((s) => `"${s}"`).join(", ")}
       FROM logic_models WHERE project_id = $1
       ORDER BY is_current DESC, version DESC, created_at DESC LIMIT 1`,
      [params.id],
    ),
  ]);

  const lmSummary = lm
    ? LM_ELEMENT_SECTIONS.map((s) => {
        const arr = Array.isArray(lm[s]) ? (lm[s] as unknown[]) : [];
        const items = arr
          .map((el) =>
            el && typeof el === "object"
              ? `{id:${(el as Record<string, unknown>)["id"]}} ${(el as Record<string, unknown>)["text"]}`
              : String(el),
          )
          .join(" / ");
        return `${s}: ${items || "（なし）"}`;
      }).join("\n")
    : "（ロジックモデルなし）";

  const userContent = `【前期の引き継ぎパッケージ（${handover.title}）】
${JSON.stringify(handover.package, null, 1).slice(0, 20000)}

【新計画側の施策（draft・反映先候補）】
${measures.map((m) => `- id:${m.id} ${m.title}`).join("\n") || "（なし）"}

【新計画側のKPI（target要見直しフラグつき）】
${kpis.map((k) => `- id:${k.id} ${k.label}（現目標 ${k.target}${k.unit}・要見直し:${k.target_needs_review}）`).join("\n") || "（なし）"}

【新計画側のロジックモデル現行版の要素】
${lmSummary}`;

  try {
    const message = await aiCreateMessage(
      { taskType: "proposal.handover_intake", projectId: params.id },
      {
        max_tokens: 4000,
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
        tools: [INTAKE_TOOL],
        tool_choice: { type: "tool", name: "record_intake_proposals" },
        messages: [{ role: "user", content: userContent }],
      },
    );
    const toolUse = message.content.find(
      (c): c is Anthropic.ToolUseBlock => c.type === "tool_use" && c.name === "record_intake_proposals",
    );
    if (!toolUse) {
      return NextResponse.json({ data: null, error: "AI応答の解析に失敗しました" }, { status: 502 });
    }
    const result = sanitizeIntakeProposals(toolUse.input, {
      measureIds: new Set(measures.map((m) => m.id)),
      kpiIds: new Set(kpis.map((k) => k.id)),
    });
    return NextResponse.json({
      data: { handover_id: handover.id, proposals: result.proposals, rejected: result.rejected },
      error: null,
    });
  } catch (e) {
    console.error("引き継ぎ反映提案の生成に失敗:", e);
    return NextResponse.json({ data: null, error: "提案の生成に失敗しました" }, { status: 500 });
  }
}
