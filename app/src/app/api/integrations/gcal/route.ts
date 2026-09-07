export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { google } from "googleapis";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";

const bodySchema = z.object({
  taskIds: z.array(z.string().uuid()).min(1, "タスクIDは1件以上必要です"),
});

interface TaskForExport {
  id: string;
  title: string;
  due_date: string | null;
  document_deadline: string | null;
  gcal_event_id: string | null;
}

function buildCalendarClient() {
  const email = process.env.GCAL_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GCAL_PRIVATE_KEY;
  const calendarId = process.env.GCAL_CALENDAR_ID;

  if (!email || !rawKey || !calendarId) {
    throw new Error("Google Calendar 連携が設定されていません（GCAL_SERVICE_ACCOUNT_EMAIL / GCAL_PRIVATE_KEY / GCAL_CALENDAR_ID）");
  }

  const privateKey = rawKey.replace(/\\n/g, "\n");

  const auth = new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/calendar"],
  });

  return { calendar: google.calendar({ version: "v3", auth }), calendarId };
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
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

  const { taskIds } = parsed.data;

  let calendar: ReturnType<typeof google.calendar>;
  let calendarId: string;
  try {
    ({ calendar, calendarId } = buildCalendarClient());
  } catch (err) {
    const message = err instanceof Error ? err.message : "設定エラー";
    return NextResponse.json({ data: null, error: message }, { status: 500 });
  }

  // ⚠ **taskIds はクライアントが指定する。自分のテナントのタスクに限定する。**
  //   かつては projects / municipalities を経由する条件が無く、他テナントの
  //   schedule_tasks を引いてそのタイトルを **GCAL_CALENDAR_ID の共有カレンダーへ
  //   転記**し、さらにその行に gcal_event_id を書き込めた
  //   （claude/coe-tenant-isolation.md §10）。
  //   件数を返すだけなので直接の読み出しにはならないが、カレンダー側には
  //   他テナントのタスク名が残る。
  const municipalityId = session.user?.municipalityId;
  if (!municipalityId) {
    return NextResponse.json(
      { data: null, error: "所属自治体が特定できません" },
      { status: 403 },
    );
  }

  // DB からタスク情報を取得（自テナントのものだけ）
  const placeholders = taskIds.map((_, i) => `$${i + 1}`).join(",");
  const tasks = await query<TaskForExport>(
    `SELECT t.id, t.title,
            to_char(t.due_date,          'YYYY-MM-DD') AS due_date,
            to_char(t.document_deadline, 'YYYY-MM-DD') AS document_deadline,
            t.gcal_event_id
     FROM schedule_tasks t
     JOIN projects p ON p.id = t.project_id
     WHERE t.id IN (${placeholders})
       AND t.gcal_event_id IS NULL
       AND p.municipality_id = $${taskIds.length + 1}`,
    [...taskIds, municipalityId],
  );

  let exported = 0;

  for (const task of tasks) {
    const dateStr = task.due_date ?? task.document_deadline;
    if (!dateStr) continue;

    try {
      const event = await calendar.events.insert({
        calendarId,
        requestBody: {
          summary: task.title,
          start: { date: dateStr },
          end:   { date: dateStr },
          description: task.document_deadline
            ? `資料期限: ${task.document_deadline}`
            : null,
        },
      });

      const eventId = (event as { data?: { id?: string } }).data?.id;
      if (eventId) {
        // 取得時点で絞ってあるが、更新側にも条件を付ける（二重の防御）
        await query(
          `UPDATE schedule_tasks t SET gcal_event_id = $1
             FROM projects p
            WHERE p.id = t.project_id AND t.id = $2 AND p.municipality_id = $3`,
          [eventId, task.id, municipalityId],
        );
        exported++;
      }
    } catch (err) {
      console.error(`タスク ${task.id} のカレンダー登録に失敗:`, err);
    }
  }

  return NextResponse.json({ data: { exported }, error: null });
}
