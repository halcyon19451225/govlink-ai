import { NextResponse } from "next/server";
import { notFound } from "next/navigation";
import type { Session } from "next-auth";
import { queryOne } from "@/lib/db";

/**
 * テナント境界（自治体）のガード
 *
 * 背景（2026-09-06・claude/coe-tenant-isolation.md）:
 *   Coe は認証は全面的に効いていたが、**認可（テナント境界）が projects 系に
 *   1件も実装されていなかった**。api/admin/projects/** の 93 本すべてが
 *   URL の UUID を無検証で SQL に渡しており、他自治体の政策を読むことも
 *   （UPDATE / DELETE で）書き換えることもできた。
 *   ダッシュボードが全自治体の政策を一覧表示しており、その UUID を配っていた。
 *
 *   自治体直属テーブル（users / resources / org-units / members / knowledge /
 *   templates）は一貫して `WHERE municipality_id = $1` で守られていた。
 *   抜けていたのは **projects 経由でテナントに属するリソース群**（kpis /
 *   project_goals / logic_models / issue_hypotheses / documents / evidences /
 *   schedule_tasks / …）である。個別に直すと必ず抜けが再発するので、
 *   入口を1つに絞ってここに集約する。
 *
 * 使い方:
 *   API ルート:
 *     const session = await getServerSession(authOptions);
 *     const denied = await requireProjectAccess(session, params.id);
 *     if (denied) return denied;
 *
 *   サーバーコンポーネント（ページ）:
 *     const session = await getServerSession(authOptions);
 *     await assertProjectAccess(session, params.id);   // 不一致なら notFound()
 *
 * ⚠ 拒否は **404** を返す。403 だと「その UUID の政策は存在する」ことが漏れ、
 *   総当たりで他テナントの政策の存在を数えられてしまう。
 */

/** UUID かどうか。DB に投げる前に弾く（不正な文字列は 22P02 で 500 になるため） */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TenantVerdict = "ok" | "unauthenticated" | "denied";

/**
 * project が session の自治体に属するかを判定する。
 * 存在しない project も "denied"（存在の有無を呼び出し側に区別させない）。
 */
export async function checkProjectAccess(
  session: Session | null,
  projectId: string | undefined | null,
): Promise<TenantVerdict> {
  const municipalityId = session?.user?.municipalityId;
  if (!session?.user || !municipalityId) return "unauthenticated";
  if (!projectId || !UUID_RE.test(projectId)) return "denied";

  const row = await queryOne<{ municipality_id: string }>(
    "SELECT municipality_id FROM projects WHERE id = $1",
    [projectId],
  );

  // 存在しない場合も denied。呼び出し側から見て「他テナントの政策」と区別が付かない
  if (!row) return "denied";
  return row.municipality_id === municipalityId ? "ok" : "denied";
}

/**
 * API ルート用。拒否すべきときだけ NextResponse を返す（requireModulePermission と同じ形）。
 * 通ってよいときは null。
 */
export async function requireProjectAccess(
  session: Session | null,
  projectId: string | undefined | null,
): Promise<NextResponse | null> {
  const verdict = await checkProjectAccess(session, projectId);
  if (verdict === "ok") return null;

  if (verdict === "unauthenticated") {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }

  // 他テナントの政策・存在しない政策はどちらも 404（存在を漏らさない）
  console.warn(
    `[tenant] 拒否: userRoleId=${session?.user?.userRoleId ?? "-"} ` +
      `municipalityId=${session?.user?.municipalityId ?? "-"} が ` +
      `project=${projectId ?? "-"} にアクセスしようとしました。`,
  );
  return NextResponse.json({ data: null, error: "見つかりません" }, { status: 404 });
}

/**
 * サーバーコンポーネント用。不一致なら notFound() を投げる。
 *
 * ⚠ layout.tsx に置くだけでは不十分。App Router は layout と page を並行して
 *   描画するため、layout が notFound() を投げても page のデータ取得は走る。
 *   表示はされないが、副作用のある処理は実行されうる。**各ページの入口でも呼ぶこと。**
 */
export async function assertProjectAccess(
  session: Session | null,
  projectId: string | undefined | null,
): Promise<void> {
  const verdict = await checkProjectAccess(session, projectId);
  if (verdict === "ok") return;

  if (verdict === "denied") {
    console.warn(
      `[tenant] 拒否: userRoleId=${session?.user?.userRoleId ?? "-"} ` +
        `municipalityId=${session?.user?.municipalityId ?? "-"} が ` +
        `project=${projectId ?? "-"} を開こうとしました。`,
    );
  }
  notFound();
}

/**
 * project の子テーブルの行を、その行の id から辿ってテナント確認する。
 *
 * `api/admin/kpi-reports/[id]` のように、URL が project ではなく**子リソースの id**を
 * 指す API 用（claude/coe-tenant-isolation.md A-6）。
 * 対象テーブルは列挙で固定する（呼び出し側から任意のテーブル名を渡せないようにするため）。
 */
const CHILD_TABLES = {
  kpi_reports:       "kpi_reports",
  schedule_tasks:    "schedule_tasks",
  documents:         "documents",
  project_schedules: "project_schedules",
} as const;

export type ChildTable = keyof typeof CHILD_TABLES;

export async function requireChildRowAccess(
  session: Session | null,
  table: ChildTable,
  rowId: string | undefined | null,
): Promise<NextResponse | null> {
  const municipalityId = session?.user?.municipalityId;
  if (!session?.user || !municipalityId) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }

  const notFoundRes = NextResponse.json(
    { data: null, error: "見つかりません" },
    { status: 404 },
  );

  if (!rowId || !UUID_RE.test(rowId)) return notFoundRes;

  // テーブル名は上の列挙から取る（文字列連結だが、外部入力は $1 のみ）
  const t = CHILD_TABLES[table];
  const row = await queryOne<{ municipality_id: string }>(
    `SELECT p.municipality_id
       FROM ${t} c
       JOIN projects p ON p.id = c.project_id
      WHERE c.id = $1`,
    [rowId],
  );

  if (!row || row.municipality_id !== municipalityId) {
    console.warn(
      `[tenant] 拒否: municipalityId=${municipalityId} が ` +
        `${t}.id=${rowId ?? "-"} にアクセスしようとしました。`,
    );
    return notFoundRes;
  }
  return null;
}
