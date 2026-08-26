export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { aiStreamMessage } from "@/lib/ai/gateway";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { checkLimit, incrementAiUsage } from "@/lib/plan-limits";
import { query, transaction } from "@/lib/db";

/**
 * AIスケジュール生成（S1 D①で強化）
 *
 * v1: 政策名・概要・KPIラベルだけから汎用スケジュールを生成
 * S1: **実データを入力に接続** — 確定済み施策のG区画（マイルストーン・担当課）・
 *     実験設計D区画（実施期間・主要評価項目）・PDCAチェックポイント（評価の期日）から
 *     計画全体の年間工程表を一括生成（施策→タスク群→担当・期日）。
 *     タスクは measure_design_id で施策に紐付き、進捗ボードの施策別表示の軸になる。
 */

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
以下の政策情報・施策・PDCAチェックポイントをもとに、計画全体の実務的な年間工程表をJSON形式で生成してください。
4つのフェーズ（preparation=準備期, implementation=実施期, evaluation=評価期, reporting=報告期）に分けてください。

【タスクの作り方】
- 施策が与えられている場合は、**施策ごとにその実行タスク群**（準備・周知・実施開始・中間確認・実績とりまとめ等）を作り、
  各タスクに measure_index（施策の番号）と owner（担当課 — 施策の担当課をそのまま使う）を設定する。
  施策のマイルストーン（期日つき）はタスクとして必ず含める。実験設計がある施策は測定・判定のタスクも入れる。
- 諮問機関への諮問・答申、会議開催、報告書作成などの行政実務タスクも含める（これらは measure_index: null）。
- PDCAチェックポイントの期日が与えられている場合は、その**準備タスク**（実績データの整理・評価シートの準備など）を
  期日の2〜4週間前に置く。チェックポイント自体はタスクにしない（別に管理されている）。
- 各タスクにdocument_required（資料が必要か）とdocument_deadline（資料期限）を設定する。
- 期日はすべて計画期間内に収める。与えられた実データに無い施策・組織名を创作しない。

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
      "document_deadline": "YYYY-MM-DD" | null,
      "owner": string | null,
      "measure_index": number | null
    }]
  }]
}`;

interface TaskJson {
  title: string;
  due_date: string;
  document_required: boolean;
  document_deadline: string | null;
  owner?: string | null;
  measure_index?: number | null;
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

interface MeasureInput {
  id: string;
  title: string;
  owner_department: string | null;
  milestones: { label: string; due?: string }[];
  experiment: { design?: string; duration?: string; primary_outcome?: string } | null;
  period_start: string | null;
  period_end: string | null;
}

async function saveSchedule(
  projectId: string,
  schedule: ScheduleJson,
  measures: MeasureInput[],
): Promise<void> {
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
        // measure_index（1始まり）→ 施策ID。範囲外・不正は紐付けなし
        const mi = typeof task.measure_index === "number" ? Math.floor(task.measure_index) : null;
        const measure = mi != null && mi >= 1 && mi <= measures.length ? measures[mi - 1] : null;
        const owner =
          typeof task.owner === "string" && task.owner.trim()
            ? task.owner.trim().slice(0, 120)
            : measure?.owner_department ?? null;
        await client.query(
          `INSERT INTO schedule_tasks
             (schedule_id, project_id, title, due_date, document_required, document_deadline,
              measure_design_id, owner_department)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            scheduleId,
            projectId,
            task.title,
            task.due_date || null,
            task.document_required,
            task.document_deadline || null,
            measure?.id ?? null,
            owner,
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
    return NextResponse.json({ data: null, error: "リクエストの形式が正しくありません" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => i.message).join("、");
    return NextResponse.json({ data: null, error: message }, { status: 400 });
  }

  const { projectId, title, description, startDate, endDate, kpis } = parsed.data;

  // ── 実データの収集（S1 — 確定済み施策のG区画・D区画・チェックポイント）──
  const [measureRows, checkpoints] = await Promise.all([
    query<{
      id: string;
      title: string;
      owner_department: string | null;
      milestones: unknown;
      experiment: unknown;
      period_start: string | null;
      period_end: string | null;
    }>(
      `SELECT id, title, owner_department, milestones, experiment,
              to_char(period_start, 'YYYY-MM-DD') AS period_start,
              to_char(period_end, 'YYYY-MM-DD') AS period_end
       FROM measure_designs
       WHERE project_id = $1 AND status = 'confirmed'
       ORDER BY sort_order, created_at LIMIT 20`,
      [projectId],
    ),
    query<{ name: string; phase: string; scheduled_date: string | null }>(
      `SELECT name, phase, to_char(scheduled_date, 'YYYY-MM-DD') AS scheduled_date
       FROM project_pdca_checkpoints
       WHERE project_id = $1 AND scheduled_date IS NOT NULL
       ORDER BY scheduled_date LIMIT 30`,
      [projectId],
    ),
  ]);

  const measures: MeasureInput[] = measureRows.map((m) => ({
    id: m.id,
    title: m.title,
    owner_department: m.owner_department,
    milestones: Array.isArray(m.milestones)
      ? (m.milestones as { label?: unknown; due?: unknown }[])
          .filter((x) => x && typeof x === "object" && typeof x.label === "string")
          .map((x) => ({ label: String(x.label), ...(typeof x.due === "string" ? { due: x.due } : {}) }))
      : [],
    experiment:
      m.experiment && typeof m.experiment === "object"
        ? (m.experiment as MeasureInput["experiment"])
        : null,
    period_start: m.period_start,
    period_end: m.period_end,
  }));

  const kpiText =
    kpis.length > 0
      ? "\nKPI:\n" + kpis.map((k) => `- ${k.label}${k.unit ? `（単位: ${k.unit}）` : ""}`).join("\n")
      : "";

  const measureText =
    measures.length > 0
      ? "\n確定済み施策（measure_index はこの番号を使う）:\n" +
        measures
          .map((m, i) => {
            const ms =
              m.milestones.length > 0
                ? ` / マイルストーン: ${m.milestones.map((x) => `${x.label}${x.due ? `(${x.due})` : ""}`).join("、")}`
                : "";
            const ex = m.experiment
              ? ` / 実験設計: ${m.experiment.design ?? "あり"}${m.experiment.duration ? `・期間${m.experiment.duration}` : ""}${m.experiment.primary_outcome ? `・主要評価:${m.experiment.primary_outcome}` : ""}`
              : "";
            const period =
              m.period_start || m.period_end ? ` / 実施期間: ${m.period_start ?? "—"}〜${m.period_end ?? "—"}` : "";
            return `${i + 1}. ${m.title} / 担当: ${m.owner_department ?? "未定"}${period}${ms}${ex}`;
          })
          .join("\n")
      : "";

  const checkpointText =
    checkpoints.length > 0
      ? "\nPDCAチェックポイント（評価の期日 — 準備タスクを2〜4週間前に置く）:\n" +
        checkpoints.map((c) => `- ${c.scheduled_date} [${c.phase}] ${c.name}`).join("\n")
      : "";

  const userPrompt = `政策名: ${title}
概要: ${description || "（未記入）"}
計画期間: ${startDate} 〜 ${endDate}${kpiText}${measureText}${checkpointText}

上記の政策について、計画全体の実務的な年間工程表をJSON形式で生成してください。`;

  const encoder = new TextEncoder();
  let fullText = "";

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const claudeStream = aiStreamMessage({ taskType: "generation.schedule" }, {
          model: "claude-sonnet-4-6",
          max_tokens: 8192,
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
            await saveSchedule(projectId, obj, measures);
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
