export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import type Anthropic from "@anthropic-ai/sdk";
import { authOptions } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { requireModulePermission } from "@/lib/permissions";
import { aiCreateMessage } from "@/lib/ai/gateway";
import { retrieveGrounding } from "@/lib/corpus/retrieval";
import {
  mergeGeneratedSections,
  normalizeSections,
  sanitizeGeneratedSections,
  type PlanChapterDef,
} from "@/lib/plan/document";
import { chaptersOfDocKind, docKindOf, variantOfDocKind, type DocKind } from "@/lib/plan/evalReport";
import { gatherEvalTables } from "@/lib/plan/evalData";
import { LM_ELEMENT_SECTIONS } from "@/lib/plan/clone";
import { normalizeIndicatorType, OUTCOME_TIER_META, isOutcomeTier } from "@/lib/outcome/tiers";

type Params = { params: { id: string } };

const MODULE = "logic_model";

/**
 * 「章立てを起こす」— 定型章構成に実データを流し込んで下書きを生成
 *   doc=plan … 計画書7章（PL2 P③・taskType generation.plan_doc）
 *   doc=eval … 評価報告書6章（PL3 A①・taskType generation.eval_report）
 * - locked=true の章は上書きしない（mergeGeneratedSections が保護）
 * - finalized の文書には生成しない
 * - 数値の表（KPI・施策・工程・達成状況・改善一覧）は出力時にシステムが
 *   実データから自動挿入するため、AIには表を書かせない
 */

const GEN_TOOL: Anthropic.Tool = {
  name: "record_plan_sections",
  description: "行政文書の各章の下書き本文を記録します。",
  input_schema: {
    type: "object",
    properties: {
      sections: {
        type: "array",
        description: "章ごとの下書き(与えられた章IDのみ・全章)",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "章ID（指定された定型章構成のID）" },
            body_md: {
              type: "string",
              description:
                "本文（Markdown軽量: ## 小見出し / - 箇条書き / 1. 番号付き / 段落）。行政文書の文体。実データの数値は与えた資料の記載どおりに書き、创作しない",
            },
            summary: { type: "string", description: "章の要約（2〜3文）" },
            source_refs: {
              type: "array",
              items: { type: "string" },
              description: "本文が依拠した資料名（与えた資料の名前のみ）",
            },
          },
          required: ["id", "body_md", "summary"],
        },
      },
    },
    required: ["sections"],
  },
};

interface PromptParts {
  system: string;
  userContent: string;
  defaultTitle: string;
}

function chapterGuideOf(chapters: readonly PlanChapterDef[]): string {
  return chapters.map((c) => `- id:${c.id} 「${c.heading}」… ${c.brief}`).join("\n");
}

// ── 計画書（PL2）───────────────────────────────────────────

async function buildPlanPrompt(projectId: string): Promise<PromptParts | null> {
  const [project, kpis, hyps, measures, lm, checkpoints] = await Promise.all([
    queryOne<{
      title: string;
      description: string;
      purpose: string | null;
      municipality: string;
      plan_start: string | null;
      plan_end: string | null;
    }>(
      `SELECT p.title, p.description, p.purpose, m.name AS municipality,
              to_char(p.plan_start_date, 'YYYY-MM-DD') AS plan_start,
              to_char(p.plan_end_date, 'YYYY-MM-DD') AS plan_end
       FROM projects p JOIN municipalities m ON m.id = p.municipality_id
       WHERE p.id = $1`,
      [projectId],
    ),
    query<{ label: string; unit: string; target: number | null; baseline_value: number | null; indicator_type: string | null; target_deadline: string | null }>(
      `SELECT label, unit, target::float AS target, baseline_value::float AS baseline_value,
              indicator_type, to_char(target_deadline, 'YYYY-MM-DD') AS target_deadline
       FROM kpis WHERE project_id = $1 ORDER BY created_at LIMIT 30`,
      [projectId],
    ),
    query<{ title: string; root_cause: string | null; description: string | null }>(
      `SELECT title, root_cause, description FROM issue_hypotheses
       WHERE project_id = $1 ORDER BY priority_rank NULLS LAST, created_at LIMIT 10`,
      [projectId],
    ),
    query<{
      title: string;
      approach: string | null;
      target_population: string | null;
      intervention: string | null;
      delivery: string | null;
      evidence_status: string;
      owner_department: string | null;
      total_budget: number | null;
    }>(
      `SELECT title, approach, target_population, intervention, delivery,
              evidence_status, owner_department, total_budget::float AS total_budget
       FROM measure_designs WHERE project_id = $1 ORDER BY sort_order, created_at LIMIT 20`,
      [projectId],
    ),
    queryOne<Record<string, unknown>>(
      `SELECT ${LM_ELEMENT_SECTIONS.map((s) => `"${s}"`).join(", ")}
       FROM logic_models WHERE project_id = $1
       ORDER BY is_current DESC, version DESC, created_at DESC LIMIT 1`,
      [projectId],
    ),
    query<{ name: string; phase: string; scheduled_date: string | null }>(
      `SELECT name, phase, to_char(scheduled_date, 'YYYY-MM-DD') AS scheduled_date
       FROM project_pdca_checkpoints WHERE project_id = $1 ORDER BY scheduled_date NULLS LAST LIMIT 30`,
      [projectId],
    ),
  ]);
  if (!project) return null;

  const lmText = lm
    ? LM_ELEMENT_SECTIONS.map((s) => {
        const arr = Array.isArray(lm[s]) ? (lm[s] as unknown[]) : [];
        const texts = arr
          .map((el) => (el && typeof el === "object" ? String((el as Record<string, unknown>)["text"] ?? "") : String(el)))
          .filter(Boolean);
        return texts.length ? `${s}: ${texts.join(" / ")}` : null;
      })
        .filter(Boolean)
        .join("\n")
    : "（ロジックモデル未作成）";

  // コーパス接地（既存 assist 設定に従う — claude なら何もしない）
  let corpusBlock = "";
  try {
    const g = await retrieveGrounding({
      taskType: "generation.plan_doc",
      projectId,
      queryText: `${project.title} ${kpis.map((k) => k.label).join(" ")}`.slice(0, 600),
    });
    if (g.mode === "assist" || g.mode === "primary") {
      corpusBlock = [g.measureBlock, g.evidenceBlock].filter(Boolean).join("\n\n");
    }
  } catch {
    corpusBlock = "";
  }

  const system = `あなたは日本の地方自治体の計画策定を支援する政策アナリストです。
与えた実データから、行政計画書の各章の下書きを record_plan_sections ツールで書いてください。

【定型章構成（この7章・このIDで返す）】
${chapterGuideOf(chaptersOfDocKind("plan"))}

【厳守】
- **与えた実データに基づいて書く**。数値・指標名・施策名は資料の記載どおり。無いものを创作しない。
- データが無い箇所は「（今後整理）」等の明示的なプレースホルダにする（もっともらしく埋めない）。
- 文体は行政計画（である調・簡潔・見出しと箇条書きを活用）。
- 各章に summary（2〜3文の要約）を必ず付ける（簡易版・概要版に使う）。
- KPI表・施策一覧表・工程表は出力時にシステムが実データから自動挿入するため、
  本文では表を書かず、方針・考え方・読み方を書く。
${corpusBlock ? "- 横断コーパスを参照した場合は source_refs に「コーパス: ◯◯」と記す。" : ""}`;

  const userContent = `【計画の基本情報】
標題: ${project.title} / 自治体: ${project.municipality}
計画期間: ${project.plan_start ?? "未設定"} 〜 ${project.plan_end ?? "未設定"}
目的: ${project.purpose ?? project.description ?? "（未設定）"}

【KPI（三層アウトカム）】
${kpis.map((k) => `- ${k.label}（${normalizeIndicatorType(k.indicator_type)}）基準${k.baseline_value ?? "—"}→目標${k.target ?? "—"}${k.unit} 期限${k.target_deadline ?? "—"}`).join("\n") || "（未設定）"}

【課題仮説と真因】
${hyps.map((h) => `- ${h.title}${h.root_cause ? ` / 真因: ${h.root_cause}` : ""}`).join("\n") || "（未設定）"}

【施策（B〜G区画の要点）】
${measures.map((m2) => `- ${m2.title} / 対象:${m2.target_population ?? "—"} / 介入:${(m2.intervention ?? "—").slice(0, 200)} / 体制:${m2.delivery ?? "—"} / エビデンス:${m2.evidence_status} / 担当:${m2.owner_department ?? "—"} / 事業費:${m2.total_budget ?? "—"}`).join("\n") || "（未登録）"}

【ロジックモデル（現行版の要素）】
${lmText}

【PDCAチェックポイント】
${checkpoints.map((c) => `- ${c.scheduled_date ?? "—"} [${c.phase}] ${c.name}`).join("\n") || "（未設定）"}
${corpusBlock ? `\n${corpusBlock}` : ""}`;

  return { system, userContent, defaultTitle: `${project.title} 計画書` };
}

// ── 評価報告書（PL3）──────────────────────────────────────

async function buildEvalPrompt(projectId: string): Promise<PromptParts | null> {
  const [project, tables, evalDetails, experiments, handover] = await Promise.all([
    queryOne<{
      title: string;
      purpose: string | null;
      description: string;
      municipality: string;
      plan_start: string | null;
      plan_end: string | null;
    }>(
      `SELECT p.title, p.purpose, p.description, m.name AS municipality,
              to_char(p.plan_start_date, 'YYYY-MM-DD') AS plan_start,
              to_char(p.plan_end_date, 'YYYY-MM-DD') AS plan_end
       FROM projects p JOIN municipalities m ON m.id = p.municipality_id
       WHERE p.id = $1`,
      [projectId],
    ),
    gatherEvalTables(projectId),
    query<{
      measure: string | null;
      evaluation_tier: string;
      fiscal_year: number | null;
      result: string | null;
      findings: string | null;
      success_factors: string | null;
      barrier_factors: string | null;
      improvement_actions: string | null;
      next_steps: string | null;
      achievement_rate: number | null;
    }>(
      `SELECT md.title AS measure, pe.evaluation_tier, pe.fiscal_year, pe.result,
              pe.findings, pe.success_factors, pe.barrier_factors,
              pe.improvement_actions, pe.next_steps, pe.achievement_rate::float AS achievement_rate
       FROM program_evaluations pe
       LEFT JOIN measure_designs md ON md.id = pe.measure_design_id
       WHERE pe.project_id = $1
       ORDER BY pe.fiscal_year DESC NULLS LAST, pe.created_at DESC LIMIT 20`,
      [projectId],
    ),
    query<{
      measure: string | null;
      design: string;
      result_summary: string;
      effect_direction: string;
      effect_size: string | null;
      evidence_level: number | null;
      sample_size: number | null;
      status: string;
      promoted: boolean;
    }>(
      `SELECT md.title AS measure, er.design, er.result_summary, er.effect_direction,
              er.effect_size, er.evidence_level, er.sample_size, er.status,
              (er.promoted_at IS NOT NULL) AS promoted
       FROM experiment_results er
       LEFT JOIN measure_designs md ON md.id = er.measure_design_id
       WHERE er.project_id = $1
       ORDER BY er.created_at DESC LIMIT 15`,
      [projectId],
    ),
    queryOne<{ title: string; status: string; package: unknown; fiscal_year: number | null }>(
      `SELECT title, status, package, fiscal_year FROM plan_handovers
       WHERE source_project_id = $1
       ORDER BY (status = 'finalized') DESC, (status = 'consumed') DESC, updated_at DESC LIMIT 1`,
      [projectId],
    ),
  ]);
  if (!project) return null;

  const tierLine = (tier: string): string => {
    const t = normalizeIndicatorType(tier);
    return isOutcomeTier(t) ? OUTCOME_TIER_META[t].label : t;
  };

  const kpiLines = tables.kpis
    .map(
      (k) =>
        `- ${k.label}（${k.tier}）基準${k.baseline ?? "—"}→現在${k.current ?? "—"}→目標${k.target ?? "—"}${k.unit} / 到達度${k.rate == null ? "算定不能" : `${Math.round(k.rate * 10) / 10}%`} / ${k.achieved ? "達成" : "未達"}`,
    )
    .join("\n");

  const evalLines = evalDetails
    .map((e) => {
      const parts = [
        `- ${e.measure ?? "（計画全体）"} [${tierLine(e.evaluation_tier)}${e.fiscal_year ? `・${e.fiscal_year}年度` : ""}] ${e.result ?? ""}`,
        e.findings ? `  所見: ${e.findings.slice(0, 200)}` : null,
        e.success_factors ? `  成功要因: ${e.success_factors.slice(0, 150)}` : null,
        e.barrier_factors ? `  阻害要因: ${e.barrier_factors.slice(0, 150)}` : null,
        e.improvement_actions ? `  改善の方向: ${e.improvement_actions.slice(0, 150)}` : null,
        e.next_steps ? `  次の一手: ${e.next_steps.slice(0, 150)}` : null,
      ].filter(Boolean);
      return parts.join("\n");
    })
    .join("\n");

  const expLines = experiments
    .map(
      (x) =>
        `- ${x.measure ?? "—"} / 設計:${x.design} / 結果:${x.result_summary.slice(0, 200)} / 方向:${x.effect_direction}${x.effect_size ? ` / 効果量:${x.effect_size}` : ""}${x.evidence_level ? ` / Lv${x.evidence_level}` : ""}${x.sample_size ? ` / n=${x.sample_size}` : ""}${x.promoted ? " / エビデンス昇格済み" : ""}`,
    )
    .join("\n");

  const impLines = tables.improvements
    .map((a) => `- ${a.title}${a.root_cause ? ` / 真因: ${a.root_cause}` : ""} / 状況: ${a.status}${a.due_date ? ` / 期限: ${a.due_date}` : ""}`)
    .join("\n");

  let handoverBlock = "（引き継ぎパッケージは未作成）";
  if (handover) {
    const pkg = (handover.package ?? {}) as {
      unmet_outcomes?: { label?: string; rate?: number | null }[];
      carry_over_actions?: { title?: string; root_cause?: string | null }[];
      root_causes?: { title?: string; root_cause?: string | null }[];
      flow_decisions?: { flow?: string; fiscal_year?: number | null }[];
    };
    handoverBlock = [
      `「${handover.title}」（状態: ${handover.status}${handover.fiscal_year ? `・${handover.fiscal_year}年度` : ""}）`,
      pkg.unmet_outcomes?.length
        ? `未達アウトカム:\n${pkg.unmet_outcomes.slice(0, 10).map((u) => `- ${u.label ?? "—"}${u.rate != null ? `（到達度${u.rate}%）` : ""}`).join("\n")}`
        : null,
      pkg.carry_over_actions?.length
        ? `持ち越す改善アクション:\n${pkg.carry_over_actions.slice(0, 10).map((c) => `- ${c.title ?? "—"}${c.root_cause ? ` / 真因: ${c.root_cause}` : ""}`).join("\n")}`
        : null,
      pkg.root_causes?.length
        ? `特定済みの真因:\n${pkg.root_causes.slice(0, 10).map((r) => `- ${r.title ?? "—"}${r.root_cause ? `: ${r.root_cause}` : ""}`).join("\n")}`
        : null,
      pkg.flow_decisions?.length ? `図6/7の判断記録: ${pkg.flow_decisions.length}件` : null,
    ]
      .filter(Boolean)
      .join("\n");
  }

  const system = `あなたは日本の地方自治体の政策評価を支援する評価アナリストです。
与えた実データから、評価結果報告書の各章の下書きを record_plan_sections ツールで書いてください。

【定型章構成（この6章・このIDで返す）】
${chapterGuideOf(chaptersOfDocKind("eval"))}

【厳守】
- **与えた実データに基づいて書く**。到達度・指標名・施策名・評価結果は資料の記載どおり。無いものを创作しない。
- 評価の記録が無い箇所は「（評価未実施）」等の明示的なプレースホルダにする（もっともらしく埋めない）。
- 文体は行政の評価報告書（である調・簡潔・事実と解釈を分ける）。
- 各章に summary（2〜3文の要約）を必ず付ける。
- KPI達成状況表・施策別評価表・改善アクション一覧表は出力時にシステムが実データから
  自動挿入するため、本文では表を書かず、読み方・特筆事項・解釈を書く。
- 達成/未達の断定は与えたデータの判定に従う（独自の再判定をしない）。`;

  const userContent = `【計画の基本情報】
標題: ${project.title} / 自治体: ${project.municipality}
計画期間: ${project.plan_start ?? "未設定"} 〜 ${project.plan_end ?? "未設定"}
目的: ${project.purpose ?? project.description ?? "（未設定）"}
評価の枠組み: 三層アウトカム（短期=年次評価・図6 / 中間=計画期間評価・図7 / 長期=常時監視）

【KPI達成状況（統一計算による到達度）】
${kpiLines || "（KPI未設定）"}

【プログラム評価の記録（図6/図7の判断経路）】
${evalLines || "（評価の記録はありません）"}

【実験結果】
${expLines || "（実験結果はありません）"}

【改善アクション】
${impLines || "（改善アクションはありません）"}

【次期計画への引き継ぎパッケージ】
${handoverBlock}`;

  return { system, userContent, defaultTitle: `${project.title} 評価結果報告書` };
}

// ── 本体 ──────────────────────────────────────────────────

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, MODULE, "edit");
  if (deny) return deny;

  let kind: DocKind = "plan";
  try {
    const raw = (await req.json().catch(() => ({}))) as { doc?: unknown };
    kind = docKindOf(raw?.doc);
  } catch {
    kind = "plan";
  }
  const variant = variantOfDocKind(kind);
  const chapters = chaptersOfDocKind(kind);
  const taskType = kind === "eval" ? ("generation.eval_report" as const) : ("generation.plan_doc" as const);

  const existing = await queryOne<{ id: string; status: string; sections: unknown; title: string }>(
    `SELECT id, status, sections, title FROM plan_documents WHERE project_id = $1 AND variant = $2`,
    [params.id, variant],
  );
  if (existing?.status === "finalized") {
    return NextResponse.json(
      { data: null, error: "確定済みの文書には生成できません（確定を解除してください）" },
      { status: 409 },
    );
  }

  const parts = kind === "eval" ? await buildEvalPrompt(params.id) : await buildPlanPrompt(params.id);
  if (!parts) {
    return NextResponse.json({ data: null, error: "プロジェクトが見つかりません" }, { status: 404 });
  }

  try {
    const message = await aiCreateMessage(
      { taskType, projectId: params.id },
      {
        max_tokens: 8000,
        system: [{ type: "text", text: parts.system, cache_control: { type: "ephemeral" } }],
        tools: [GEN_TOOL],
        tool_choice: { type: "tool", name: "record_plan_sections" },
        messages: [{ role: "user", content: parts.userContent }],
      },
    );
    const toolUse = message.content.find(
      (c): c is Anthropic.ToolUseBlock => c.type === "tool_use" && c.name === "record_plan_sections",
    );
    if (!toolUse) {
      return NextResponse.json({ data: null, error: "AI応答の解析に失敗しました" }, { status: 502 });
    }

    const generated = sanitizeGeneratedSections(toolUse.input, chapters);
    const merged = mergeGeneratedSections(normalizeSections(existing?.sections ?? []), generated, chapters);

    const row = await queryOne<{ id: string }>(
      `INSERT INTO plan_documents (project_id, variant, title, sections, generated_at)
       VALUES ($1, $2, $3, $4::jsonb, now())
       ON CONFLICT (project_id, variant) DO UPDATE SET
         sections = EXCLUDED.sections,
         generated_at = now(),
         updated_at = now()
       RETURNING id`,
      [params.id, variant, existing?.title ?? parts.defaultTitle, JSON.stringify(merged)],
    );
    return NextResponse.json({
      data: { id: row?.id ?? null, sections: merged, generated: generated.length },
      error: null,
    });
  } catch (e) {
    console.error("文書の生成に失敗:", e);
    return NextResponse.json({ data: null, error: "生成に失敗しました" }, { status: 500 });
  }
}
