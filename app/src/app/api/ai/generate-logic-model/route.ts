export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { checkLimit, incrementAiUsage } from "@/lib/plan-limits";
import { transaction, queryOne } from "@/lib/db";
import { getKnowledgeContext } from "@/lib/knowledge-context";
import { recordArtifact, resolveArtifactIds } from "@/lib/modules/recordArtifact";

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
const SYSTEM_PROMPT = `あなたは日本の地方自治体の政策アナリストです。
政策情報をもとに、ロジックモデルをJSON形式で生成してください。
以下のキーを含むJSONのみを返してください（日本語で）:
inputs（投入資源の配列）,
activities（実施活動の配列）,
outputs（産出物の配列）,
short_outcomes（短期成果の配列）,
long_outcomes（長期成果の配列）
各配列は3〜5項目。具体的かつ実行可能な内容にしてください。
マークダウンのコードブロックは使わず、JSONのみを出力してください。
例:
{
  "inputs": ["職員5名の配置", "予算1000万円", "外部専門家の委託"],
  "activities": ["現状調査・ニーズ把握", "サービス設計", "試験運用・改善"],
  "outputs": ["調査報告書", "サービスガイドライン", "利用者200名への提供"],
  "short_outcomes": ["サービス認知度の向上", "利用者満足度80%以上"],
  "long_outcomes": ["地域課題の解決", "持続可能な運用体制の確立"]
}`;

interface LogicModelJson {
  inputs: string[];
  activities: string[];
  outputs: string[];
  short_outcomes: string[];
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
  issueHypothesisId?: string | null,
): Promise<void> {
  const outcomes = [
    ...model.short_outcomes.map((text) => ({ term: "short", text })),
    ...model.long_outcomes.map((text) => ({ term: "long", text })),
  ];

  await transaction(async (client) => {
    // 既存のロジックモデルを削除して再作成（最新版を1件保持）
    await client.query("DELETE FROM logic_models WHERE project_id = $1", [projectId]);
    const result = await client.query<{ id: string }>(
      `INSERT INTO logic_models
         (project_id, inputs, activities, outputs, outcomes,
          name, status, ai_generated, version, issue_hypothesis_id)
       VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb,
               $6, 'draft', true, 1, $7)
       RETURNING id`,
      [
        projectId,
        JSON.stringify(model.inputs),
        JSON.stringify(model.activities),
        JSON.stringify(model.outputs),
        JSON.stringify(outcomes),
        title,
        issueHypothesisId ?? null,
      ],
    );
    const modelId = result.rows[0]?.id;
    if (modelId) {
      // 成果物レジストリに登録（R2-3）
      const sourceIds = await resolveArtifactIds(projectId, "issue_hypothesis", [issueHypothesisId]);
      await recordArtifact(
        {
          projectId,
          moduleId: "logic_model",
          artifactType: "logic_model_v1",
          artifactRecordId: modelId,
          sourceArtifactIds: sourceIds,
          derivationNote: issueHypothesisId
            ? `課題仮説(${issueHypothesisId})からAIでロジックモデルを生成`
            : "AIによるロジックモデル自動生成",
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

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
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

  // 課題仮説コンテキストを取得（R1-1）
  let hypothesisContext = "";
  if (issueHypothesisId) {
    const hyp = await queryOne<{
      title: string;
      description: string | null;
      root_cause: string | null;
      proposed_measures: string[] | null;
    }>(
      `SELECT title, description, root_cause, proposed_measures
       FROM issue_hypotheses WHERE id = $1`,
      [issueHypothesisId],
    );
    if (hyp) {
      const parts = [`【課題仮説】${hyp.title}`];
      if (hyp.description) parts.push(`課題概要: ${hyp.description}`);
      if (hyp.root_cause) parts.push(`根本原因: ${hyp.root_cause}`);
      if (hyp.proposed_measures && hyp.proposed_measures.length > 0)
        parts.push(`提案施策: ${hyp.proposed_measures.join("、")}`);
      hypothesisContext = "\n\n" + parts.join("\n");
    }
  }

  const kpiText =
    kpis.length > 0
      ? "\nKPI:\n" + kpis.map((k) => `- ${k.label}: 目標 ${k.target}${k.unit}`).join("\n")
      : "";

  const knowledgeContext = await getKnowledgeContext(projectId);
  const knowledgePart = knowledgeContext ? `${knowledgeContext}\n\n` : "";

  const userPrompt = `${knowledgePart}政策名: ${title}
概要: ${description || "（未記入）"}${hypothesisContext}${kpiText}

上記の政策についてロジックモデルをJSON形式で生成してください。`;

  const anthropic = new Anthropic({ apiKey });
  const encoder = new TextEncoder();
  let fullText = "";

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const claudeStream = anthropic.messages.stream({
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
            await saveLogicModel(projectId, title, parsed, issueHypothesisId);
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
