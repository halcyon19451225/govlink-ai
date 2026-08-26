export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { buildIcsCalendar, type IcsEventInput } from "@/lib/schedule/ics";

type Params = { params: { token: string } };

/**
 * ICSカレンダーフィード（S1 D②段1）— 認証はトークン能力方式
 * GET /api/public/schedule-feed/<token>.ics
 * - スケジュールタスク＋PDCAチェックポイントを iCalendar 形式で配信
 * - トークンは schedule_feed_tokens（発行・失効はスケジュール画面の「カレンダー連携」）
 * - 失効済み・不明トークンは404（存在を明かさない）
 * - Google/Outlook/Libera いずれのカレンダーでも「URLで追加（購読）」できる
 */
export async function GET(_req: NextRequest, { params }: Params) {
  // URL末尾の .ics を許容（購読クライアントの互換性が上がる）
  const token = params.token.replace(/\.ics$/i, "");
  if (!token || token.length > 200) {
    return NextResponse.json({ data: null, error: "not found" }, { status: 404 });
  }

  const feed = await queryOne<{ project_id: string; title: string }>(
    `SELECT t.project_id, p.title
     FROM schedule_feed_tokens t
     JOIN projects p ON p.id = t.project_id
     WHERE t.token = $1 AND t.revoked_at IS NULL`,
    [token],
  );
  if (!feed) {
    return NextResponse.json({ data: null, error: "not found" }, { status: 404 });
  }

  const [tasks, checkpoints, latest] = await Promise.all([
    query<{
      id: string;
      title: string;
      due_date: string;
      owner_department: string | null;
      document_required: boolean;
      document_deadline: string | null;
      completed: boolean;
      measure_title: string | null;
    }>(
      `SELECT st.id, st.title,
              to_char(st.due_date, 'YYYY-MM-DD') AS due_date,
              st.owner_department, st.document_required,
              to_char(st.document_deadline, 'YYYY-MM-DD') AS document_deadline,
              (st.completed_at IS NOT NULL) AS completed,
              md.title AS measure_title
       FROM schedule_tasks st
       LEFT JOIN measure_designs md ON md.id = st.measure_design_id
       WHERE st.project_id = $1 AND st.due_date IS NOT NULL
       ORDER BY st.due_date LIMIT 500`,
      [feed.project_id],
    ),
    query<{ id: string; name: string; phase: string; scheduled_date: string; completed: boolean }>(
      `SELECT id, name, phase,
              to_char(scheduled_date, 'YYYY-MM-DD') AS scheduled_date,
              (status = 'completed') AS completed
       FROM project_pdca_checkpoints
       WHERE project_id = $1 AND scheduled_date IS NOT NULL AND status <> 'skipped'
       ORDER BY scheduled_date LIMIT 200`,
      [feed.project_id],
    ),
    // DTSTAMP: データの最終更新に追随した決定的な値（同一データ→同一出力）
    queryOne<{ ts: string | null }>(
      `SELECT to_char(GREATEST(
                COALESCE((SELECT max(created_at) FROM schedule_tasks WHERE project_id = $1), 'epoch'::timestamptz),
                COALESCE((SELECT max(completed_at) FROM schedule_tasks WHERE project_id = $1), 'epoch'::timestamptz),
                COALESCE((SELECT max(created_at) FROM project_pdca_checkpoints WHERE project_id = $1), 'epoch'::timestamptz)
              ) AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISS"Z"') AS ts`,
      [feed.project_id],
    ),
  ]);

  const events: IcsEventInput[] = [
    ...tasks.map((t) => ({
      uid: `task-${t.id}`,
      date: t.due_date,
      summary: `${t.completed ? "✓ " : ""}【Coe】${t.title}`,
      description: [
        t.measure_title ? `施策: ${t.measure_title}` : null,
        t.owner_department ? `担当: ${t.owner_department}` : null,
        t.document_required ? `資料が必要${t.document_deadline ? `（期限 ${t.document_deadline}）` : ""}` : null,
        `プロジェクト: ${feed.title}`,
      ]
        .filter(Boolean)
        .join("\n"),
      completed: t.completed,
      category: "Coeタスク",
    })),
    ...checkpoints.map((c) => ({
      uid: `checkpoint-${c.id}`,
      date: c.scheduled_date,
      summary: `${c.completed ? "✓ " : ""}【Coe/${c.phase}】${c.name}`,
      description: `PDCAチェックポイント（${c.phase}工程）\nプロジェクト: ${feed.title}`,
      completed: c.completed,
      category: "PDCAチェックポイント",
    })),
  ];

  const ics = buildIcsCalendar(`Coe: ${feed.title}`, events, latest?.ts ?? "19700101T000000Z");
  return new NextResponse(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent("coe-schedule.ics")}`,
      "Cache-Control": "no-cache",
    },
  });
}
