import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { checkLimit, incrementAiUsage } from "@/lib/plan-limits";
import { query } from "@/lib/db";

const bodySchema = z.object({
  projectId: z.string().uuid("projectId が不正です"),
});

const SYSTEM_PROMPT = `あなたはEBPM（証拠に基づく政策立案）の専門家です。
以下の政策データを分析して、改善提案を生成してください。
以下の観点で各1〜3件の提案をJSONで返してください:
{
  "suggestions": [{
    "suggestion_type": "kpi_adjustment"|"evidence_gap"|"schedule_risk"|"efficiency"|"best_practice",
    "title": string,
    "body": string,
    "priority": "high"|"medium"|"low"
  }]
}

観点:
1. kpi_adjustment: KPI目標値や指標の見直し提案
2. evidence_gap: エビデンスが不足している因果関係
3. schedule_risk: スケジュール上のリスク
4. efficiency: 効率化・コスト削減の余地
5. best_practice: 他自治体の成功事例との比較

日本語で具体的かつ実践的な提案をしてください。
必ずJSONのみを返し、前置きや説明文は不要です。`;

interface SuggestionItem {
  suggestion_type: string;
  title: string;
  body: string;
  priority: string;
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
    return NextResponse.json({ data: null, error: "ANTHROPIC_API_KEY が設定されていません" }, { status: 500 });
  }

  let raw: unknown;
  try { raw = await req.json(); } catch {
    return NextResponse.json({ data: null, error: "リクエスト本文が不正です" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: parsed.error.issues[0]?.message ?? "入力が不正です" },
      { status: 400 },
    );
  }

  const { projectId } = parsed.data;

  // プロジェクトの全データを収集
  const [projectRows, kpis, evidences, scheduleRows, schedTaskRows] = await Promise.all([
    query<{ title: string; description: string; status: string }>(
      "SELECT title, description, status FROM projects WHERE id = $1",
      [projectId],
    ),
    query<{ label: string; target: number; current: number; unit: string }>(
      "SELECT label, target::float AS target, current::float AS current, unit FROM kpis WHERE project_id = $1",
      [projectId],
    ),
    query<{ title: string; evidence_type: string; strength: number; description: string | null }>(
      "SELECT title, evidence_type, strength, description FROM evidences WHERE project_id = $1",
      [projectId],
    ),
    query<{ total: number; completed: number }>(
      `SELECT COUNT(id)::int AS total, COUNT(completed_at)::int AS completed
       FROM schedule_tasks WHERE project_id = $1`,
      [projectId],
    ),
    query<{ title: string; due_date: string | null; completed_at: string | null }>(
      `SELECT title, to_char(due_date,'YYYY-MM-DD') AS due_date, completed_at::text
       FROM schedule_tasks WHERE project_id = $1 ORDER BY due_date NULLS LAST LIMIT 10`,
      [projectId],
    ),
  ]);

  const project = projectRows[0];
  if (!project) {
    return NextResponse.json({ data: null, error: "プロジェクトが見つかりません" }, { status: 404 });
  }

  const sched = scheduleRows[0] ?? { total: 0, completed: 0 };

  const userContent = `
政策名: ${project.title}
概要: ${project.description ?? "なし"}
ステータス: ${project.status}

【KPI一覧】
${kpis.map((k) => `- ${k.label}: 目標${k.target}${k.unit} / 現在${k.current}${k.unit} (達成率 ${k.target > 0 ? Math.round((k.current / k.target) * 100) : 0}%)`).join("\n") || "KPIなし"}

【エビデンス一覧】
${evidences.map((e) => `- [${e.evidence_type}★${e.strength}] ${e.title}: ${e.description ?? ""}`).join("\n") || "エビデンスなし"}

【スケジュール進捗】
全タスク: ${sched.total}件 / 完了: ${sched.completed}件
直近タスク:
${schedTaskRows.map((t) => `- ${t.title} (期限: ${t.due_date ?? "未設定"}) ${t.completed_at ? "✓完了" : "未完"}`).join("\n") || "タスクなし"}
`.trim();

  const anthropic = new Anthropic({ apiKey });

  // Streaming不要: JSON形式のレスポンスを通常のAPI呼び出しで取得
  let fullText: string;
  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userContent }],
    });
    fullText = message.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("");
  } catch (err) {
    return NextResponse.json(
      { data: null, error: err instanceof Error ? err.message : "Claude API の呼び出しに失敗しました" },
      { status: 502 },
    );
  }

  // Markdownコードフェンス（```json ... ```）を除去して JSON 部分だけ抽出
  const stripped = fullText
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  const jsonMatch = stripped.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error("[suggest-improvements] JSON not found in response:", fullText.slice(0, 300));
    return NextResponse.json(
      { data: null, error: "AIレスポンスからJSONを抽出できませんでした" },
      { status: 500 },
    );
  }

  let suggestions: SuggestionItem[];
  try {
    const parsedJson = JSON.parse(jsonMatch[0]) as { suggestions?: SuggestionItem[] };
    suggestions = parsedJson.suggestions ?? [];
  } catch (parseErr) {
    console.error("[suggest-improvements] JSON parse error:", parseErr);
    console.error("[suggest-improvements] raw text:", jsonMatch[0].slice(0, 300));
    return NextResponse.json(
      { data: null, error: "AIレスポンスのJSONパースに失敗しました" },
      { status: 500 },
    );
  }

  // DB に保存して生成されたレコードをそのまま返す
  const saved: Array<SuggestionItem & { id: string; created_at: string }> = [];
  for (const s of suggestions) {
    const rows = await query<{ id: string; created_at: string }>(
      `INSERT INTO policy_suggestions
         (project_id, suggestion_type, title, body, priority, ai_generated)
       VALUES ($1, $2, $3, $4, $5, true)
       RETURNING id, created_at::text`,
      [projectId, s.suggestion_type, s.title, s.body, s.priority],
    );
    const row = rows[0];
    if (row) {
      saved.push({ ...s, id: row.id, created_at: row.created_at });
    }
  }

  return NextResponse.json({ data: saved, error: null });
}
