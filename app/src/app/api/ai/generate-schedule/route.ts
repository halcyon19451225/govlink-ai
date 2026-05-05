export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { checkLimit, incrementAiUsage } from "@/lib/plan-limits";
import { transaction } from "@/lib/db";

const kpiSchema = z.object({
  label: z.string(),
  target: z.union([z.number(), z.string()]).transform(Number).optional(),
  unit: z.string().default(""),
});

const bodySchema = z.object({
  projectId: z.string().uuid("プロジェクト ID が不正です"),
  title: z.string().min(1, "政策名は必須です"),
  description: z.string().default(""),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "開始日は YYYY-MM-DD 形式で入力してください"),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "終了日は YYYY-MM-DD 形式で入力してください"),
  kpis: z.array(kpiSchema).default([]),
});

const SYSTEM_PROMPT = `あなたは日本の地方自治体の政策プランナーです。
以下の政策情報と計画期間をもとに、実務的なスケジュールをJSON形式で生成してください。
4つのフェーズ（preparation=準備期, implementation=実施期, evaluation=評価期, reporting=報告期）に分けてください。
各フェーズに3〜5つのタスクを含めてください。
諮問機関への諮問・答申、会議開催、報告書作成などの行政実務に必要なタスクを含めてください。
各タスクにdocument_required（資料が必要か）とdocument_deadline（資料期限）を設定してください。
マークダウンのコードブロックは使わず、JSONのみを出力してください。

返却JSON形式:
{
  "phases": [{
    "phase": "preparation" | "implementation" | "evaluation" | "reporting",
    "title": string,
    "start_date": "YYYY-MM-DD",
    "end_date": "YYYY-MM-DD",
    "tasks": [{
      "title": string,
      "due_date": "YYYY-MM-DD",
      "document_required": boolean,
      "document_deadline": "YYYY-MM-DD" | null
    }]
  }]
}`;

interface TaskJson {
  title: string;
  due_date: string;
  document_required: boolean;
  document_deadline: string | null;
}

interface PhaseJson {
  phase: "preparation" | "implementation" | "evaluation" | "reporting";
  title: string;
  start_date: string;
  end_date: string;
  tasks: TaskJson[];
}

interface ScheduleJson {
  phases: PhaseJson[];
}

function extractJson(text: string): string {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (m?.[1]) return m[1].trim();
  return text.trim();
}

function validateSchedule(obj: unknown): obj is ScheduleJson {
  if (typeof obj !== "object" || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return Array.isArray(o.phases) && o.phases.length > 0;
}

async function saveSchedule(projectId: string, schedule: ScheduleJson): Promise<void> {
  await transaction(async (client) => {
    // 既存スケジュールを削除して再生成
    await client.query("DELETE FROM project_schedules WHERE project_id = $1", [projectId]);

    for (const phase of schedule.phases) {
      const schedResult = await client.query<{ id: string }>(
        `INSERT INTO project_schedules
           (project_id, phase, title, start_date, end_date, created_by_ai)
         VALUES ($1, $2, $3, $4, $5, true)
         RETURNING id`,
        [projectId, phase.phase, phase.title, phase.start_date, phase.end_date],
      );
      if (!schedResult.rows[0]) throw new Error("スケジュールの保存に失敗しました");
      const scheduleId = schedResult.rows[0].id;

      for (const task of phase.tasks) {
        await client.query(
          `INSERT INTO schedule_tasks
             (schedule_id, project_id, title, due_date, document_required, document_deadline)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            scheduleId,
            projectId,
            task.title,
            task.due_date || null,
            task.document_required,
            task.document_deadline || null,
          ],
        );
      }
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
    return NextResponse.json({ data: null, error: "リクエストの形式が正しくありません" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => i.message).join("、");
    return NextResponse.json({ data: null, error: message }, { status: 400 });
  }

  const { projectId, title, description, startDate, endDate, kpis } = parsed.data;

  const kpiText =
    kpis.length > 0
      ? "\nKPI:\n" + kpis.map((k) => `- ${k.label}${k.unit ? `（単位: ${k.unit}）` : ""}`).join("\n")
      : "";

  const userPrompt = `政策名: ${title}
概要: ${description || "（未記入）"}
計画期間: ${startDate} 〜 ${endDate}${kpiText}

上記の政策について実務的なスケジュールをJSON形式で生成してください。`;

  const anthropic = new Anthropic({ apiKey });
  const encoder = new TextEncoder();
  let fullText = "";

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const claudeStream = anthropic.messages.stream({
          model: "claude-sonnet-4-6",
          max_tokens: 4096,
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

        try {
          const jsonText = extractJson(fullText);
          const obj = JSON.parse(jsonText) as unknown;
          if (validateSchedule(obj)) {
            await saveSchedule(projectId, obj);
          } else {
            console.error("スケジュール JSON の構造が不正です");
          }
        } catch (saveErr) {
          console.error("スケジュールの保存に失敗しました:", saveErr);
        }
      } catch (err) {
        console.error("Claude streaming error:", err);
        controller.enqueue(encoder.encode("\n__ERROR__: 生成中にエラーが発生しました"));
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
