export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { invalidateRoutingCache } from "@/lib/ai/gateway";
import {
  AI_TASK_TYPES,
  AI_ROUTING_MODES,
  IMPLEMENTED_ROUTING_MODES,
  isAiTaskType,
} from "@/lib/ai/taskTypes";

/**
 * AIゲートウェイのルーティング設定（タスク別ダイヤル）— X1
 *
 * GET  … 全タスクの設定＋語彙（ラベル・実装済みモード）を返す
 * PUT  … 1タスクの mode / ordo_weight / note を更新
 *
 * 認可は2経路（Ordo運営画面の段階移行に対応）:
 *  - Ordo管理者としてのログインセッション（現行のordo-admin画面）
 *  - 共有鍵ヘッダ x-ai-admin-key = env AI_ADMIN_API_KEY
 *    （X5でOrdoWebsite（別コードベース）のサーバーから叩く。
 *      LICENSE_API_KEY と同じサーバー間共有鍵方式）
 */

const ORDO_ADMIN_EMAIL = "ordoservice.com@gmail.com";

async function authorize(req: NextRequest): Promise<NextResponse | null> {
  const key = process.env.AI_ADMIN_API_KEY;
  if (key && req.headers.get("x-ai-admin-key") === key) return null;
  const session = await getServerSession(authOptions);
  if (!session || session.user?.email !== ORDO_ADMIN_EMAIL) {
    return NextResponse.json({ data: null, error: "権限がありません" }, { status: 403 });
  }
  return null;
}

export async function GET(req: NextRequest) {
  const deny = await authorize(req);
  if (deny) return deny;

  const rows = await query(
    `SELECT task_type, mode, ordo_weight, note, updated_at::text
     FROM ai_task_routing ORDER BY task_type`,
  );

  return NextResponse.json({
    data: {
      routing: rows,
      task_types: AI_TASK_TYPES,
      modes: AI_ROUTING_MODES,
      implemented_modes: IMPLEMENTED_ROUTING_MODES,
    },
    error: null,
  });
}

const putSchema = z.object({
  task_type: z.string(),
  mode: z.enum(["claude", "shadow", "assist", "primary"]).optional(),
  ordo_weight: z.number().int().min(0).max(100).optional(),
  note: z.string().max(400).nullable().optional(),
});

export async function PUT(req: NextRequest) {
  const deny = await authorize(req);
  if (deny) return deny;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ data: null, error: "リクエスト本文が不正です" }, { status: 400 });
  }
  const parsed = putSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: parsed.error.issues[0]?.message ?? "入力が不正です" },
      { status: 400 },
    );
  }
  if (!isAiTaskType(parsed.data.task_type)) {
    return NextResponse.json(
      { data: null, error: `未知のタスク種別です: ${parsed.data.task_type}` },
      { status: 400 },
    );
  }

  const sets: string[] = ["updated_at = now()"];
  const params: unknown[] = [parsed.data.task_type];
  const add = (col: string, v: unknown) => {
    params.push(v);
    sets.push(`${col} = $${params.length}`);
  };
  if (parsed.data.mode !== undefined) add("mode", parsed.data.mode);
  if (parsed.data.ordo_weight !== undefined) add("ordo_weight", parsed.data.ordo_weight);
  if (parsed.data.note !== undefined) add("note", parsed.data.note);

  const row = await queryOne(
    `INSERT INTO ai_task_routing (task_type) VALUES ($1)
     ON CONFLICT (task_type) DO UPDATE SET ${sets.join(", ")}
     RETURNING task_type, mode, ordo_weight, note, updated_at::text`,
    params,
  );

  invalidateRoutingCache();
  return NextResponse.json({ data: row, error: null });
}
