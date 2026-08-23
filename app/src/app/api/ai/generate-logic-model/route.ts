export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { aiStreamMessage } from "@/lib/ai/gateway";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { checkLimit, incrementAiUsage } from "@/lib/plan-limits";
import { transaction } from "@/lib/db";
import { getKnowledgeContext } from "@/lib/knowledge-context";
import { recordArtifact, resolveArtifactIds } from "@/lib/modules/recordArtifact";
import { elementsFromTexts, serializeElements } from "@/lib/logicmodel/elements";
import {
  buildGenerationContext,
  GROUNDING_INSTRUCTION,
} from "@/lib/logicmodel/generationContext";

const kpiSchema = z.object({
  label: z.string(),
  target: z.union([z.number(), z.string()]).transform(Number),
  unit: z.string().default(""),
});

const bodySchema = z.object({
  projectId: z.string().uuid("プロジェクト ID が不正です"),
  title: z.string().min(1, "政策名は必須です"),
  description: z.string().default(""),
  kpis: z.array(kpiSchema).default([]),
  issueHypothesisId: z.string().uuid().optional().nullable(),
});

// ロジックモデル生成の指示（プロンプトキャッシュ対象）
//
// アウトカムは三層で出させる。CA工程（評価・改善）のスコアボードが
// 短期／中間／長期の三層で動いているのに、計画側が短期と長期の二層しか
// 持っていなかったため、生成結果の long_outcomes が中間の欄に流し込まれ、
// 評価の時点で層がずれていた。ここで層をそろえる。
const SYSTEM_PROMPT = `あなたは日本の地方自治体の政策アナリストです。
政策情報をもとに、ロジックモデルをJSON形式で生成してください。
以下のキーを含むJSONのみを返してください（日本語で）:
inputs（投入資源の配列）,
activities（実施活動の配列）,
outputs（産出物の配列）,
short_outcomes（短期アウトカム＝概ね1年で現れる変化の配列）,
intermediate_outcomes（中間アウトカム＝2〜5年で現れる変化の配列）,
long_outcomes（長期アウトカム＝計画期間を超えて目指す状態の配列）
各配列は3〜5項目。具体的かつ実行可能な内容にしてください。
アウトカムは「〜が増える」「〜が向上する」のように、
活動そのものではなく対象者に生じる変化として書いてください。
マークダウンのコードブロックは使わず、JSONのみを出力してください。
例:
{
  "inputs": ["職員5名の配置", "予算1000万円", "外部専門家の委託"],
  "activities": ["現状調査・ニーズ把握", "サービス設計", "試験運用・改善"],
  "outputs": ["調査報告書", "サービスガイドライン", "利用者200名への提供"],
  "short_outcomes": ["サービスの認知度が向上する", "利用者満足度が80%以上になる"],
  "intermediate_outcomes": ["対象者の外出頻度が増える", "要支援認定率の上昇が鈍化する"],
  "long_outcomes": ["高齢者が住み慣れた地域で暮らし続けられる", "持続可能な運用体制が確立する"]
}`;

interface LogicModelJson {
  inputs: string[];
  activities: string[];
  outputs: string[];
  short_outcomes: string[];
  /** 旧プロンプトの応答には無いことがあるため任意 */
  intermediate_outcomes?: string[];
  long_outcomes: string[];
}

function extractJson(text: string): string {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch?.[1]) return fenceMatch[1].trim();
  return text.trim();
}

function validateLogicModel(obj: unknown): obj is LogicModelJson {
  if (typeof obj !== "object" || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return (
    Array.isArray(o.inputs) &&
    Array.isArray(o.activities) &&
    Array.isArray(o.outputs) &&
    Array.isArray(o.short_outcomes) &&
    Array.isArray(o.long_outcomes)
  );
}

async function saveLogicModel(
  projectId: string,
  title: string,
  model: LogicModelJson,
  issueHypothesisId: string | null | undefined,
  /** 生成の根拠にした上流成果物。リネージに残す */
  upstreamIds: {
    gapAnalysisIds: string[];
    issueHypothesisIds: string[];
    measureDesignIds?: string[];
  } = {
    gapAnalysisIds: [],
    issueHypothesisIds: [],
    measureDesignIds: [],
  },
): Promise<void> {
  const asList = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => String(x)).filter((s) => s.trim() !== "") : [];

  const initial = asList(model.short_outcomes);
  const intermediate = asList(model.intermediate_outcomes);
  const long = asList(model.long_outcomes);

  // 生成結果は要素形式 {id, text, kpi_ids} で保存する（035）。
  // ここで id を採番しておくことで、KPI紐付け（L3）と因果エッジ（L4）が
  // この要素を宛先として指せるようになる。
  const col = (texts: string[], prefix: string) =>
    JSON.stringify(serializeElements(elementsFromTexts(texts, prefix)));

  // 旧 outcomes 列は { term, text } 形式のまま維持する（旧画面の後方互換）。
  // 正となるのは三層の専用列で、こちらは読み取り互換のための写し。
  const outcomes = [
    ...initial.map((text) => ({ term: "initial", text })),
    ...intermediate.map((text) => ({ term: "intermediate", text })),
    ...long.map((text) => ({ term: "long", text })),
  ];

  await transaction(async (client) => {
    // ── 改訂は「その場更新」ではなく「新しい版の追加」にする ──────────
    //
    // 以前はここで DELETE FROM logic_models WHERE project_id していた。
    // その結果、AI生成を押すたびに
    //   - 評価が参照していた軸（program_evaluations.logic_model_id）
    //   - 改善の反映先（improvement_actions.reflect_logic_model_id）
    //   - 成果物リネージ（module_artifacts.artifact_record_id）
    // が指す行ごと消え、過去の評価の前提が失われていた。
    // 版を積み、現行版は is_current で一意に決める（034）。
    const prev = await client.query<{ id: string; version: number }>(
      `SELECT id, version FROM logic_models
       WHERE project_id = $1
       ORDER BY is_current DESC, version DESC, created_at DESC
       LIMIT 1`,
      [projectId],
    );
    const prevId = prev.rows[0]?.id ?? null;

    await client.query(
      "UPDATE logic_models SET is_current = false WHERE project_id = $1 AND is_current",
      [projectId],
    );

    const result = await client.query<{ id: string }>(
      `INSERT INTO logic_models
         (project_id, inputs, activities, outputs, outcomes,
          initial_outcomes, intermediate_outcomes, long_outcomes,
          name, status, ai_generated, version, is_current,
          issue_hypothesis_id, revised_from_id, revision_reason)
       VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb,
               $6::jsonb, $7::jsonb, $8::jsonb,
               $9, 'draft', true,
               (SELECT COALESCE(MAX(version), 0) + 1 FROM logic_models WHERE project_id = $1),
               true,
               $10, $11, $12)
       RETURNING id`,
      [
        projectId,
        col(asList(model.inputs), "inputs"),
        col(asList(model.activities), "activities"),
        col(asList(model.outputs), "outputs"),
        JSON.stringify(outcomes),
        col(initial, "initial_outcomes"),
        col(intermediate, "intermediate_outcomes"),
        col(long, "long_outcomes"),
        title,
        issueHypothesisId ?? null,
        prevId,
        prevId ? "AI生成による再作成" : null,
      ],
    );
    const modelId = result.rows[0]?.id;
    if (modelId) {
      // 成果物レジストリに登録（R2-3）。
      // 何を根拠に生成したのかを残す。「なぜその活動なのか」を後から辿れるようにするため。
      const hypIds = upstreamIds.issueHypothesisIds.length > 0
        ? upstreamIds.issueHypothesisIds
        : [issueHypothesisId];
      const measureIds = upstreamIds.measureDesignIds ?? [];
      const [hypSources, gapSources, measureSources] = await Promise.all([
        resolveArtifactIds(projectId, "issue_hypothesis", hypIds),
        resolveArtifactIds(projectId, "gap_analysis", upstreamIds.gapAnalysisIds),
        resolveArtifactIds(projectId, "measure_design", measureIds),
      ]);
      const noteParts: string[] = [];
      if (upstreamIds.gapAnalysisIds.length > 0)
        noteParts.push(`ギャップ分析${upstreamIds.gapAnalysisIds.length}件`);
      if (measureIds.length > 0)
        noteParts.push(`確定済み施策${measureIds.length}件`);
      if (hypIds.filter(Boolean).length > 0)
        noteParts.push(`課題仮説${hypIds.filter(Boolean).length}件`);
      await recordArtifact(
        {
          projectId,
          moduleId: "logic_model",
          artifactType: "logic_model_v1",
          artifactRecordId: modelId,
          sourceArtifactIds: [...hypSources, ...gapSources, ...measureSources],
          derivationNote:
            noteParts.length > 0
              ? `${noteParts.join("・")}をもとにAIでロジックモデルを生成`
              : "AIによるロジックモデル自動生成（上流の分析結果なし）",
        },
        client,
      );
    }
  });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }

  const munIdForLimit = session.user?.municipalityId;
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

  const { projectId, title, description, kpis, issueHypothesisId } = parsed.data;

  // ── 上流工程の成果物を集める（L4）────────────────────
  //
  // 以前は課題仮説のタイトルと真因だけを渡していた（それも明示指定時のみ）。
  // そのため生成物が「どの自治体でも通用する一般論」になり、
  // ギャップ分析・現状整理で積み上げた事実が反映されていなかった。
  //
  // QCストーリーでは 現状把握 → 目標設定 → 要因解析（真因）→ 対策立案 の順で、
  // ロジックモデルは「対策立案」にあたる。真因を渡さずに対策を書かせると
  // この筋を飛ばすことになり、「なぜその活動なのか」に答えられなくなる。
  const upstream = await buildGenerationContext(projectId, issueHypothesisId);
  const hypothesisContext = upstream.text ? `\n\n${upstream.text}\n\n${GROUNDING_INSTRUCTION}` : "";

  const kpiText =
    kpis.length > 0
      ? "\nKPI:\n" + kpis.map((k) => `- ${k.label}: 目標 ${k.target}${k.unit}`).join("\n")
      : "";

  const knowledgeContext = await getKnowledgeContext(projectId);
  const knowledgePart = knowledgeContext ? `${knowledgeContext}\n\n` : "";

  const userPrompt = `${knowledgePart}政策名: ${title}
概要: ${description || "（未記入）"}${hypothesisContext}${kpiText}

上記の政策についてロジックモデルをJSON形式で生成してください。`;

  const encoder = new TextEncoder();
  let fullText = "";

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const claudeStream = aiStreamMessage({ taskType: "generation.logic_model" }, {
          model: "claude-sonnet-4-6",
          max_tokens: 2048,
          system: [
            {
              type: "text" as const,
              text: SYSTEM_PROMPT,
              cache_control: { type: "ephemeral" },
            },
          ],
          messages: [{ role: "user", content: userPrompt }],
        });

        for await (const event of claudeStream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            const chunk = event.delta.text;
            fullText += chunk;
            controller.enqueue(encoder.encode(chunk));
          }
        }

        // ストリーミング完了後にDBへ保存
        try {
          const jsonText = extractJson(fullText);
          const parsed = JSON.parse(jsonText) as unknown;
          if (validateLogicModel(parsed)) {
            await saveLogicModel(projectId, title, parsed, issueHypothesisId, upstream.sourceIds);
          } else {
            console.error("Logic model JSON の構造が不正です:", jsonText);
          }
        } catch (dbError) {
          console.error("Logic model の保存に失敗しました:", dbError);
        }
      } catch (error) {
        console.error("Claude streaming error:", error);
        controller.enqueue(
          encoder.encode(`\n__ERROR__: 生成中にエラーが発生しました`),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}
