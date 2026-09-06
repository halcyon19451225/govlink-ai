export const dynamic = "force-dynamic";
export const maxDuration = 120;

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { requireProjectAccess } from "@/lib/tenant";
import { query, queryOne } from "@/lib/db";
import { isBridgeConfigured, bridgeUpsertEvents, bridgeUpsertTasks } from "@/lib/libera/bridge";
import { resolveSubByEmail } from "@/lib/libera/cognito";
import {
  buildReportTasks,
  buildScheduleEvents,
  buildScheduleTasks,
  type CheckpointInput,
  type ScheduleTaskInput,
} from "@/lib/libera/payload";
import { sanitizeTargets } from "@/lib/report/types";

type Params = { params: { id: string } };

/**
 * Libera連携（S3 — D②段2＋C①タスク通知）
 * GET  … 設定状態・送信先一覧・直近の送信ログ
 * POST … action:
 *   add_target    {email, display_name?} … メール→Cognito subを解決して送信先に追加
 *   remove_target {target_id}
 *   push_schedule {}                     … タスク＋チェックポイントを全送信先の
 *                                          Liberaカレンダー（予定）とタスクへ冪等送信
 *   notify_report {request_id}           … 実績報告依頼の回答URLをLiberaタスクとして通知
 * すべての送信は libera_bridge_logs に記録（成功・失敗とも）。
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  // テナント境界。URL の project id が自分の自治体のものか確認する
  // （claude/coe-tenant-isolation.md A-4）。拒否は 404 で、存在を漏らさない
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  if (!session) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }
  const [targets, logs] = await Promise.all([
    query(
      `SELECT id, email, libera_sub, display_name, created_at::text AS created_at
       FROM libera_bridge_targets WHERE project_id = $1 ORDER BY created_at`,
      [params.id],
    ),
    query(
      `SELECT operation, ok, detail, created_at::text AS created_at
       FROM libera_bridge_logs WHERE project_id = $1 ORDER BY created_at DESC LIMIT 10`,
      [params.id],
    ),
  ]);
  return NextResponse.json({
    data: { configured: isBridgeConfigured(), targets, logs },
    error: null,
  });
}

const postSchema = z.object({
  action: z.enum(["add_target", "remove_target", "push_schedule", "notify_report"]),
  email: z.string().email().optional(),
  display_name: z.string().max(120).optional(),
  target_id: z.string().uuid().optional(),
  request_id: z.string().uuid().optional(),
});

async function log(projectId: string, operation: string, ok: boolean, detail: string, by: string) {
  await query(
    `INSERT INTO libera_bridge_logs (project_id, operation, ok, detail, created_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [projectId, operation, ok, detail.slice(0, 500), by],
  );
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  // テナント境界。URL の project id が自分の自治体のものか確認する
  // （claude/coe-tenant-isolation.md A-4）。拒否は 404 で、存在を漏らさない
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  if (!session) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }
  const by = session.user?.email ?? "unknown";

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ data: null, error: "リクエスト本文が不正です" }, { status: 400 });
  }
  const parsed = postSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ data: null, error: "入力が不正です" }, { status: 400 });
  }
  const d = parsed.data;

  // ── 送信先の追加（メール→sub解決）─────────────────
  if (d.action === "add_target") {
    if (!d.email) {
      return NextResponse.json({ data: null, error: "メールアドレスを入力してください" }, { status: 400 });
    }
    const sub = await resolveSubByEmail(d.email);
    if (!sub) {
      return NextResponse.json(
        { data: null, error: "このメールアドレスのユーザーが見つかりません（Coe/Liberaに登録済みのアカウントを指定してください）" },
        { status: 404 },
      );
    }
    const row = await queryOne(
      `INSERT INTO libera_bridge_targets (project_id, email, libera_sub, display_name, created_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (project_id, email) DO UPDATE SET libera_sub = EXCLUDED.libera_sub,
         display_name = COALESCE(EXCLUDED.display_name, libera_bridge_targets.display_name)
       RETURNING id, email, libera_sub, display_name, created_at::text AS created_at`,
      [params.id, d.email.trim().toLowerCase(), sub, d.display_name?.trim() || null, by],
    );
    return NextResponse.json({ data: row, error: null });
  }

  if (d.action === "remove_target") {
    if (!d.target_id) {
      return NextResponse.json({ data: null, error: "target_id が必要です" }, { status: 400 });
    }
    await query(`DELETE FROM libera_bridge_targets WHERE id = $1 AND project_id = $2`, [
      d.target_id,
      params.id,
    ]);
    return NextResponse.json({ data: { id: d.target_id }, error: null });
  }

  // ── 送信系 ───────────────────────────────────
  if (!isBridgeConfigured()) {
    return NextResponse.json(
      { data: null, error: "Libera連携が未設定です（LIBERA_BRIDGE_URL / LIBERA_BRIDGE_KEY）" },
      { status: 400 },
    );
  }
  const targets = await query<{ libera_sub: string; email: string }>(
    `SELECT libera_sub, email FROM libera_bridge_targets WHERE project_id = $1 ORDER BY created_at`,
    [params.id],
  );
  if (targets.length === 0) {
    return NextResponse.json({ data: null, error: "送信先が未登録です（メールアドレスで追加してください）" }, { status: 400 });
  }

  if (d.action === "push_schedule") {
    const [project, tasks, checkpoints] = await Promise.all([
      queryOne<{ title: string }>(`SELECT title FROM projects WHERE id = $1`, [params.id]),
      query<ScheduleTaskInput>(
        `SELECT st.id, st.title, to_char(st.due_date, 'YYYY-MM-DD') AS due_date,
                st.owner_department, md.title AS measure_title,
                (st.completed_at IS NOT NULL) AS completed
         FROM schedule_tasks st
         LEFT JOIN measure_designs md ON md.id = st.measure_design_id
         WHERE st.project_id = $1 AND st.due_date IS NOT NULL
         ORDER BY st.due_date LIMIT 300`,
        [params.id],
      ),
      query<CheckpointInput>(
        `SELECT id, name, phase, to_char(scheduled_date, 'YYYY-MM-DD') AS scheduled_date,
                (status = 'completed') AS completed
         FROM project_pdca_checkpoints
         WHERE project_id = $1 AND scheduled_date IS NOT NULL AND status <> 'skipped'
         ORDER BY scheduled_date LIMIT 100`,
        [params.id],
      ),
    ]);
    if (!project) {
      return NextResponse.json({ data: null, error: "プロジェクトが見つかりません" }, { status: 404 });
    }

    let events = 0;
    let liberaTasks = 0;
    for (const t of targets) {
      // sourceId はタスクUUID起点のため宛先ごとに同一 — Libera側レコードIDは
      // coe_<sourceId> で宛先ごとに同じIDになってしまうと衝突する。
      // → 宛先subの先頭8文字を sourceId に混ぜて宛先別に分離する（決定的・冪等は維持）
      const suffix = t.libera_sub.replace(/-/g, "").slice(0, 8);
      const evs = buildScheduleEvents(t.libera_sub, tasks, checkpoints, project.title).map((e) => ({
        ...e,
        sourceId: `${e.sourceId}-${suffix}`.slice(0, 80),
      }));
      const tks = buildScheduleTasks(t.libera_sub, tasks, project.title).map((e) => ({
        ...e,
        sourceId: `${e.sourceId}-${suffix}`.slice(0, 80),
      }));
      const r1 = await bridgeUpsertEvents(evs);
      const r2 = await bridgeUpsertTasks(tks);
      if (!r1.ok || !r2.ok) {
        const err = r1.error ?? r2.error ?? "送信に失敗しました";
        await log(params.id, "push_schedule", false, `宛先 ${t.email}: ${err}`, by);
        return NextResponse.json({ data: null, error: `送信に失敗しました（${t.email}）: ${err}` }, { status: 502 });
      }
      events += r1.upserted ?? 0;
      liberaTasks += r2.upserted ?? 0;
    }
    const detail = `宛先${targets.length}人 / 予定${events}件・タスク${liberaTasks}件を送信`;
    await log(params.id, "push_schedule", true, detail, by);
    return NextResponse.json({ data: { detail }, error: null });
  }

  // notify_report — 実績報告依頼の回答URLをLiberaタスクとして通知
  if (!d.request_id) {
    return NextResponse.json({ data: null, error: "request_id が必要です" }, { status: 400 });
  }
  const request = await queryOne<{
    id: string;
    title: string;
    due_date: string | null;
    status: string;
    targets: unknown;
  }>(
    `SELECT id, title, to_char(due_date, 'YYYY-MM-DD') AS due_date, status, targets
     FROM report_requests WHERE id = $1 AND project_id = $2`,
    [d.request_id, params.id],
  );
  if (!request) {
    return NextResponse.json({ data: null, error: "依頼が見つかりません" }, { status: 404 });
  }
  if (request.status !== "sent") {
    return NextResponse.json({ data: null, error: "送信済み（受付中）の依頼のみ通知できます" }, { status: 409 });
  }
  const responses = await query<{ target_key: string; token: string; status: string }>(
    `SELECT target_key, token, status FROM report_responses WHERE request_id = $1`,
    [request.id],
  );
  const reqTargets = sanitizeTargets(request.targets);
  const origin = req.nextUrl.origin;
  const pending = responses.filter((r) => r.status === "pending" || r.status === "returned");
  if (pending.length === 0) {
    return NextResponse.json({ data: null, error: "未回答（または差し戻し中）の対象がありません" }, { status: 400 });
  }
  const notifyInput = {
    requestId: request.id,
    requestTitle: request.title,
    dueDate: request.due_date,
    targets: pending.map((r) => ({
      target_key: r.target_key,
      measure_title: reqTargets.find((t) => t.target_key === r.target_key)?.measure_title ?? "対象",
      url: `${origin}/report/${r.token}`,
    })),
  };
  let sent = 0;
  for (const t of targets) {
    const suffix = t.libera_sub.replace(/-/g, "").slice(0, 8);
    const tks = buildReportTasks(t.libera_sub, notifyInput).map((e) => ({
      ...e,
      sourceId: `${e.sourceId}-${suffix}`.slice(0, 80),
    }));
    const r = await bridgeUpsertTasks(tks);
    if (!r.ok) {
      await log(params.id, "notify_report", false, `宛先 ${t.email}: ${r.error ?? "失敗"}`, by);
      return NextResponse.json({ data: null, error: `通知に失敗しました（${t.email}）` }, { status: 502 });
    }
    sent += r.upserted ?? 0;
  }
  const detail = `「${request.title}」未回答${pending.length}件を宛先${targets.length}人へタスク通知（${sent}件）`;
  await log(params.id, "notify_report", true, detail, by);
  return NextResponse.json({ data: { detail }, error: null });
}
