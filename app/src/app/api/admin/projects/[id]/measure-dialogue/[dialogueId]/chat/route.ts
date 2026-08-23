export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { checkLimit, incrementAiUsage } from "@/lib/plan-limits";
import { query, queryOne } from "@/lib/db";
import { getKnowledgeContext } from "@/lib/knowledge-context";
import { requireModulePermission } from "@/lib/permissions";
import { callDialogueTool, sanitizeStringArray } from "@/lib/ai/dialogueTurn";
import { buildGenerationContext } from "@/lib/logicmodel/generationContext";
import {
  isEffectDirection,
  resultToEvidenceItem,
} from "@/lib/measure/experimentResult";
import { retrieveGrounding } from "@/lib/corpus/retrieval";
import {
  buildMeasureSystemPrompt,
  RECORD_MEASURE_TURN_TOOL,
  type ExistingKpiSummary,
} from "@/lib/measure/prompt";
import {
  allApproachesAssessed,
  allCostsSet,
  allExperimentsDesigned,
  allIndicatorsSet,
  applyApproachUpdates,
  approachesNeedingExperiment,
  guardMeasurePhase,
  parseMeasurePhase,
  sanitizeApproachEvidence,
  sanitizeApproaches,
  sanitizeCosts,
  sanitizeExperiments,
  sanitizeIndicators,
  upsertByApproach,
  upsertEvidence,
  upsertExperiments,
} from "@/lib/measure/dialogue";
import type {
  ApproachCost,
  ApproachEvidence,
  ApproachExperiment,
  ApproachIndicators,
  ApproachItem,
  EvidenceItem,
  MeasureDialogueData,
  MeasureMessage,
  MeasureStep,
} from "@/lib/measure/types";

type Params = { params: { id: string; dialogueId: string } };

const bodySchema = z.object({
  message: z.string().trim().max(4000).nullish(),
});

interface DialogueRow {
  id: string;
  issue_hypothesis_id: string | null;
  status: "in_progress" | "completed";
  current_step: MeasureStep;
  messages: MeasureMessage[];
  approaches: ApproachItem[];
  evidence: ApproachEvidence[];
  experiments: ApproachExperiment[];
  indicators: ApproachIndicators[];
  costs: ApproachCost[];
  project_title: string;
}

function str(v: unknown, max = 400): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, "measure_design", "edit");
  if (deny) return deny;

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { data: null, error: "ANTHROPIC_API_KEY が設定されていません" },
      { status: 500 },
    );
  }

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

  const row = await queryOne<DialogueRow>(
    `SELECT d.id, d.issue_hypothesis_id, d.status, d.current_step,
            d.messages, d.approaches, d.evidence, d.experiments,
            d.indicators, d.costs,
            p.title AS project_title
     FROM measure_dialogues d
     JOIN projects p ON p.id = d.project_id
     WHERE d.id = $1 AND d.project_id = $2`,
    [params.dialogueId, params.id],
  );

  if (!row) {
    return NextResponse.json({ data: null, error: "対話が見つかりません" }, { status: 404 });
  }

  // 初回ブートストラップ: message 未指定ならシード済みの最初の質問を返す
  const trimmedMessage = parsed.data.message?.trim() ?? "";
  if (trimmedMessage === "") {
    const lastAssistant = [...row.messages].reverse().find((m) => m.role === "assistant");
    return NextResponse.json({
      data: {
        reply: lastAssistant?.content ?? "",
        current_step: row.current_step,
        status: row.status,
        approaches: row.approaches,
        evidence: row.evidence,
        experiments: row.experiments,
        indicators: row.indicators,
        costs: row.costs,
        messages: row.messages,
      },
      error: null,
    });
  }

  // プラン上限チェック
  const munIdForLimit = session!.user?.municipalityId;
  if (munIdForLimit) {
    const limitCheck = await checkLimit(munIdForLimit, "ai_calls");
    if (!limitCheck.allowed) {
      return NextResponse.json(
        { data: null, error: "AI生成回数の上限に達しました", upgrade_url: "/pricing" },
        { status: 403 },
      );
    }
    await incrementAiUsage(munIdForLimit);
  }

  const userMessage: MeasureMessage = {
    role: "user",
    content: trimmedMessage,
    step: row.current_step,
  };
  const history = [...row.messages, userMessage];
  const aiMessages: Anthropic.MessageParam[] = history.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // ナレッジ（管理画面で作成した辞書）を一次情報源として注入
  let knowledgeContext = "";
  try {
    knowledgeContext = await getKnowledgeContext(params.id);
  } catch {
    knowledgeContext = "";
  }

  // 上流の分析（ギャップ・課題仮説・真因）。
  // L4 でロジックモデルAI生成向けに作った集約をそのまま再利用する。
  let upstreamContext = "";
  try {
    const upstream = await buildGenerationContext(params.id, row.issue_hypothesis_id);
    upstreamContext = upstream.text;
  } catch {
    upstreamContext = "";
  }

  // 既存KPI（indicators フェーズで existing_kpi_id 参照に使う。二重作成を防ぐ）
  let existingKpis: ExistingKpiSummary[] = [];
  try {
    existingKpis = await query<ExistingKpiSummary>(
      `SELECT id, label, unit, target::float AS target, indicator_type
       FROM kpis WHERE project_id = $1 ORDER BY created_at`,
      [params.id],
    );
  } catch {
    existingKpis = [];
  }

  // 自プロジェクトで獲得したエビデンス（昇格済みの実験結果・X2）。
  // 確定→昇格された結果を EvidenceItem に再構成し、evidence フェーズで最優先参照させる
  let ownEvidence: EvidenceItem[] = [];
  try {
    const promoted = await query<Record<string, unknown>>(
      `SELECT er.design, er.implemented_as_planned, er.deviation_note,
              to_char(er.period_start, 'YYYY-MM-DD') AS period_start,
              to_char(er.period_end, 'YYYY-MM-DD') AS period_end,
              er.sample_size, er.primary_outcome, er.result_summary,
              er.effect_direction, er.effect_size,
              md.title AS measure_title, md.target_population
       FROM experiment_results er
       JOIN measure_designs md ON md.id = er.measure_design_id
       WHERE er.project_id = $1 AND er.promoted_at IS NOT NULL
       ORDER BY er.promoted_at DESC
       LIMIT 10`,
      [params.id],
    );
    ownEvidence = promoted.map((r) =>
      resultToEvidenceItem(
        {
          design: r["design"] as never,
          implemented_as_planned: Boolean(r["implemented_as_planned"]),
          deviation_note: (r["deviation_note"] as string | null) ?? null,
          period_start: (r["period_start"] as string | null) ?? null,
          period_end: (r["period_end"] as string | null) ?? null,
          sample_size: (r["sample_size"] as number | null) ?? null,
          primary_outcome: (r["primary_outcome"] as string | null) ?? null,
          result_summary: String(r["result_summary"] ?? ""),
          effect_direction: isEffectDirection(r["effect_direction"])
            ? r["effect_direction"]
            : "unclear",
          effect_size: (r["effect_size"] as string | null) ?? null,
        },
        {
          measureTitle: String(r["measure_title"] ?? "施策"),
          targetPopulation: (r["target_population"] as string | null) ?? null,
        },
      ),
    );
  } catch {
    ownEvidence = [];
  }

  // 横断コーパスの接地（X4）。ルーティングが claude なら何もしない。
  // クエリは真因・アプローチ・プロジェクト名の断片（個人情報を含めない）
  let corpusBlocks: { measures?: string | null; evidence?: string | null; cost?: string | null } = {};
  try {
    let hypText = "";
    if (row.issue_hypothesis_id) {
      const hyp = await queryOne<{ title: string; root_cause: string | null }>(
        `SELECT title, root_cause FROM issue_hypotheses WHERE id = $1`,
        [row.issue_hypothesis_id],
      );
      hypText = [hyp?.title, hyp?.root_cause].filter(Boolean).join(" ");
    }
    const approachText = row.approaches
      .map((a) => `${a.measure_title} ${a.approach} ${a.target}`)
      .join(" ");
    const grounding = await retrieveGrounding({
      taskType: "dialogue.measure",
      projectId: params.id,
      contextId: params.dialogueId,
      queryText: `${row.project_title} ${hypText} ${approachText}`.slice(0, 600),
    });
    if (grounding.mode === "assist" || grounding.mode === "primary") {
      corpusBlocks = {
        measures: grounding.measureBlock,
        evidence: grounding.evidenceBlock,
        cost: grounding.costBlock,
      };
    }
  } catch {
    corpusBlocks = {};
  }

  const data: MeasureDialogueData = {
    approaches: row.approaches,
    evidence: row.evidence,
    experiments: row.experiments,
    indicators: row.indicators,
    costs: row.costs,
  };

  const systemText = buildMeasureSystemPrompt({
    projectTitle: row.project_title,
    upstreamContext,
    currentStep: row.current_step,
    data,
    knowledgeContext,
    existingKpis,
    ownEvidence,
    corpusBlocks,
  });

  const aiCtx = { taskType: "dialogue.measure", projectId: params.id } as const;

  let toolUse: Anthropic.ToolUseBlock | null;
  try {
    toolUse = await callDialogueTool(aiCtx, systemText, aiMessages, {
      tool: RECORD_MEASURE_TURN_TOOL,
      allowWebSearch: true,
    });
  } catch {
    return NextResponse.json({ data: null, error: "AIとの通信に失敗しました" }, { status: 502 });
  }
  if (!toolUse) {
    return NextResponse.json({ data: null, error: "AI応答の解析に失敗しました" }, { status: 500 });
  }

  // ── ツール出力を取り込む ────────────────────────
  const applyTurn = (
    input: Record<string, unknown>,
    current: MeasureDialogueData,
  ): MeasureDialogueData => {
    const approaches = applyApproachUpdates(
      [
        ...current.approaches,
        ...sanitizeApproaches(input.new_approaches, current.approaches.length),
      ],
      input.approach_updates,
    );
    const validIds = new Set(approaches.map((a) => a.id));
    return {
      approaches,
      evidence: upsertEvidence(
        // アプローチが増減した場合に備え、既存分も有効IDで濾しておく
        current.evidence.filter((e) => validIds.has(e.approach_id)),
        sanitizeApproachEvidence(input.evidence, validIds),
      ),
      experiments: upsertExperiments(
        current.experiments.filter((e) => validIds.has(e.approach_id)),
        sanitizeExperiments(input.experiments, validIds),
      ),
      indicators: upsertByApproach(
        current.indicators.filter((e) => validIds.has(e.approach_id)),
        sanitizeIndicators(input.indicators, validIds),
      ),
      costs: upsertByApproach(
        current.costs.filter((e) => validIds.has(e.approach_id)),
        sanitizeCosts(input.costs, validIds),
      ),
    };
  };

  const input = toolUse.input as Record<string, unknown>;
  let reply = str(input.reply, 4000) || "（応答を取得できませんでした）";
  let nextData = applyTurn(input, data);
  let phase = guardMeasurePhase(
    parseMeasurePhase(input.phase, row.current_step),
    row.current_step,
    nextData,
  );
  let suggestions = sanitizeStringArray(input.suggestions, { maxItems: 4, maxLength: 200 });

  // ── 進行ガードの追いターン ────────────────────────
  // 先のフェーズへ進もうとしたのに前提が欠けている場合、
  // 不足分の作成を促す追いターンを1回だけ自動実行する（既存対話と同じ方式）。
  const wantedPhase = parseMeasurePhase(input.phase, row.current_step);
  let retryInstruction: string | null = null;
  if (wantedPhase === "experiment" && phase !== "experiment" && nextData.approaches.length > 0) {
    const unassessed = nextData.approaches
      .filter((a) => !nextData.evidence.some((e) => e.approach_id === a.id))
      .map((a) => a.id);
    retryInstruction =
      `まだエビデンス評価が済んでいないアプローチがあります: ${unassessed.join(", ")}。` +
      `evidence フィールドで全アプローチの評価（status と items。見つからなければ status="none", items=[]）を出してから進めてください。`;
  } else if (wantedPhase === "indicators" && phase !== "indicators") {
    const missing = approachesNeedingExperiment(nextData)
      .filter((a) => !nextData.experiments.some((e) => e.approach_id === a.id))
      .map((a) => a.id);
    if (missing.length > 0) {
      retryInstruction =
        `エビデンスが不足しているのに実験設計が付いていないアプローチがあります: ${missing.join(", ")}。` +
        `experiments フィールドで設計（design と rationale は必須）を出してから進めてください。`;
    }
  } else if (wantedPhase === "cost" && phase !== "cost") {
    const missing = nextData.approaches
      .filter(
        (a) =>
          !nextData.indicators.some(
            (i) => i.approach_id === a.id && i.outcome_initial.length > 0,
          ),
      )
      .map((a) => a.id);
    if (missing.length > 0) {
      retryInstruction =
        `短期アウトカムKPIが付いていないアプローチがあります: ${missing.join(", ")}。` +
        `indicators フィールドで各アプローチに outcome_initial を1件以上出してから進めてください。`;
    }
  } else if (wantedPhase === "done" && phase !== "done") {
    const missing = nextData.approaches
      .filter((a) => !nextData.costs.some((c) => c.approach_id === a.id))
      .map((a) => a.id);
    if (missing.length > 0) {
      retryInstruction =
        `コストが整理されていないアプローチがあります: ${missing.join(", ")}。` +
        `costs フィールドで各アプローチのコスト（cost_per_outcome_note は必須）を出してから進めてください。`;
    }
  }
  if (retryInstruction) {
    try {
      const retryUse = await callDialogueTool(
        aiCtx,
        systemText,
        [
          ...aiMessages,
          { role: "assistant", content: reply },
          {
            role: "user",
            content: `（システムからの自動指示）${retryInstruction}`,
          },
        ],
        { tool: RECORD_MEASURE_TURN_TOOL, allowWebSearch: false },
      );
      if (retryUse) {
        const rInput = retryUse.input as Record<string, unknown>;
        const retried = applyTurn(rInput, nextData);
        nextData = retried;
        reply = str(rInput.reply, 4000) || reply;
        suggestions = sanitizeStringArray(rInput.suggestions, { maxItems: 4, maxLength: 200 });
        phase = guardMeasurePhase(
          parseMeasurePhase(rInput.phase, row.current_step),
          row.current_step,
          retried,
        );
      }
    } catch {
      // 回復に失敗しても、ガード済みの phase のまま対話を継続する
    }
  }

  const assistantMessage: MeasureMessage = {
    role: "assistant",
    content: reply,
    step: phase,
    ...(suggestions.length > 0 ? { suggestions } : {}),
  };
  const messages = [...history, assistantMessage];
  const nextStatus: "in_progress" | "completed" = phase === "done" ? "completed" : row.status;

  await queryOne(
    `UPDATE measure_dialogues
     SET messages = $1::jsonb, approaches = $2::jsonb, evidence = $3::jsonb,
         experiments = $4::jsonb, indicators = $5::jsonb, costs = $6::jsonb,
         current_step = $7, status = $8
     WHERE id = $9 AND project_id = $10
     RETURNING id`,
    [
      JSON.stringify(messages),
      JSON.stringify(nextData.approaches),
      JSON.stringify(nextData.evidence),
      JSON.stringify(nextData.experiments),
      JSON.stringify(nextData.indicators),
      JSON.stringify(nextData.costs),
      phase,
      nextStatus,
      params.dialogueId,
      params.id,
    ],
  );

  return NextResponse.json({
    data: {
      reply,
      current_step: phase,
      status: nextStatus,
      approaches: nextData.approaches,
      evidence: nextData.evidence,
      experiments: nextData.experiments,
      indicators: nextData.indicators,
      costs: nextData.costs,
      messages,
      evidence_complete: allApproachesAssessed(nextData),
      experiments_complete: allApproachesAssessed(nextData) && allExperimentsDesigned(nextData),
      indicators_complete: allIndicatorsSet(nextData),
      costs_complete: allCostsSet(nextData),
    },
    error: null,
  });
}
