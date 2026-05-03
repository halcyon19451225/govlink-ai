import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";

const bodySchema = z.object({
  projectId: z.string().uuid("projectId が不正です"),
  reportType: z.enum(["council", "public", "evaluation", "annual"]),
  periodStart: z.string().optional(),
  periodEnd: z.string().optional(),
});

const REPORT_TYPE_LABEL: Record<string, string> = {
  council: "議会報告書",
  public: "住民向け報告",
  evaluation: "評価報告書",
  annual: "年次報告書",
};

const SYSTEM_PROMPTS: Record<string, string> = {
  council: `あなたは日本の地方自治体の政策担当者です。
以下の政策データをもとに、議会への行政報告書を作成してください。
構成:
1. 事業概要（200字）
2. 実施状況（KPI達成状況を表形式で）
3. 主要な成果と課題
4. エビデンスに基づく評価
5. 今後の方針
公式文書として適切な文体で、具体的な数値を含めてください。`,

  public: `あなたは日本の地方自治体の広報担当者です。
以下の政策データをもとに、住民向けの分かりやすい活動報告を作成してください。
専門用語を避け、成果を具体的に伝えてください。
構成:
1. この事業でやったこと（3行以内）
2. 目標に対する現在の状況
3. 住民の皆さんへのメッセージ`,

  evaluation: `あなたはEBPMの専門家です。
以下の政策データをもとに、プログラム評価報告書を作成してください。
構成:
1. 評価の目的と方法
2. プロセス評価結果
3. アウトカム評価結果
4. エビデンスの妥当性評価
5. 総合評価と提言`,

  annual: `あなたは日本の地方自治体の政策担当者です。
以下の政策データをもとに、年次活動報告書を作成してください。
構成:
1. 年度の総括
2. 主要指標の推移と達成状況
3. 実施した取り組みの詳細
4. 課題と来年度の方針`,
};

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
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

  const { projectId, reportType, periodStart, periodEnd } = parsed.data;

  // プロジェクトデータを収集
  const [projectRows, kpis, evidences, posts, schedRows] = await Promise.all([
    query<{ title: string; description: string; status: string; municipality_id: string }>(
      `SELECT p.title, p.description, p.status, p.municipality_id
       FROM projects p WHERE p.id = $1`,
      [projectId],
    ),
    query<{ label: string; target: number; current: number; unit: string }>(
      "SELECT label, target::float AS target, current::float AS current, unit FROM kpis WHERE project_id = $1",
      [projectId],
    ),
    query<{ title: string; evidence_type: string; strength: number }>(
      "SELECT title, evidence_type, strength FROM evidences WHERE project_id = $1",
      [projectId],
    ),
    query<{ type: string; body: string; published_at: string | null }>(
      `SELECT type, body, published_at::text
       FROM posts WHERE project_id = $1 ORDER BY created_at DESC LIMIT 5`,
      [projectId],
    ),
    query<{ total: number; completed: number }>(
      `SELECT COUNT(id)::int AS total, COUNT(completed_at)::int AS completed
       FROM schedule_tasks WHERE project_id = $1`,
      [projectId],
    ),
  ]);

  const project = projectRows[0];
  if (!project) {
    return NextResponse.json({ data: null, error: "プロジェクトが見つかりません" }, { status: 404 });
  }

  const sched = schedRows[0] ?? { total: 0, completed: 0 };
  const periodLabel =
    periodStart && periodEnd ? `${periodStart} 〜 ${periodEnd}` : "全期間";

  const userContent = `
政策名: ${project.title}
概要: ${project.description ?? "なし"}
ステータス: ${project.status}
対象期間: ${periodLabel}

【KPI達成状況】
${kpis.map((k) => `| ${k.label} | 目標: ${k.target}${k.unit} | 現在: ${k.current}${k.unit} | 達成率: ${k.target > 0 ? Math.round((k.current / k.target) * 100) : 0}% |`).join("\n") || "KPIなし"}

【スケジュール進捗】
全タスク ${sched.total}件 / 完了 ${sched.completed}件 (${sched.total > 0 ? Math.round((sched.completed / sched.total) * 100) : 0}%)

【エビデンス】
${evidences.map((e) => `- [${e.evidence_type}★${e.strength}] ${e.title}`).join("\n") || "エビデンスなし"}

【最近の投稿】
${posts.map((p) => `[${p.type}] ${p.body.slice(0, 100)}...`).join("\n") || "投稿なし"}
`.trim();

  const systemPrompt = SYSTEM_PROMPTS[reportType] ?? SYSTEM_PROMPTS["council"] ?? "";
  const reportTitle = `${project.title} ${REPORT_TYPE_LABEL[reportType]} (${periodLabel})`;

  const anthropic = new Anthropic({ apiKey });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let fullText = "";
      try {
        const claudeStream = anthropic.messages.stream({
          model: "claude-sonnet-4-6",
          max_tokens: 3000,
          system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
          messages: [{ role: "user", content: userContent }],
        });

        for await (const chunk of claudeStream) {
          if (
            chunk.type === "content_block_delta" &&
            chunk.delta.type === "text_delta"
          ) {
            fullText += chunk.delta.text;
            controller.enqueue(encoder.encode(chunk.delta.text));
          }
        }

        // レポートを DB に保存
        await query(
          `INSERT INTO reports
             (project_id, municipality_id, report_type, title, content, period_start, period_end)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            projectId,
            project.municipality_id,
            reportType,
            reportTitle,
            fullText,
            periodStart ?? null,
            periodEnd ?? null,
          ],
        );
      } catch (err) {
        controller.enqueue(
          encoder.encode(
            JSON.stringify({ error: err instanceof Error ? err.message : "生成に失敗しました" }),
          ),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new NextResponse(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
