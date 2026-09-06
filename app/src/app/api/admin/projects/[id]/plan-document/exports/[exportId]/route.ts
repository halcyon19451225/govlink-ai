export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireProjectAccess } from "@/lib/tenant";
import { queryOne } from "@/lib/db";
import { requireModulePermission } from "@/lib/permissions";
import { downloadFromStorage } from "@/lib/storage";

type Params = { params: { id: string; exportId: string } };

const MODULE = "logic_model";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

/** 出力履歴の再ダウンロード（PL2 P③ / PL4 P④）— S3 `plan-documents/` から取得して返す */
export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  // テナント境界。URL の project id が自分の自治体のものか確認する
  // （claude/coe-tenant-isolation.md A-4）。拒否は 404 で、存在を漏らさない
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  const deny = await requireModulePermission(session, params.id, MODULE, "view");
  if (deny) return deny;

  // プロジェクト帰属を JOIN で確認（他プロジェクトの exportId を弾く）
  const exp = await queryOne<{ s3_key: string; file_name: string }>(
    `SELECT e.s3_key, e.file_name
     FROM plan_document_exports e
     JOIN plan_documents d ON d.id = e.plan_document_id
     WHERE e.id = $1 AND d.project_id = $2`,
    [params.exportId, params.id],
  );
  if (!exp) {
    return NextResponse.json({ data: null, error: "出力履歴が見つかりません" }, { status: 404 });
  }

  try {
    const buffer = await downloadFromStorage("plan-documents", exp.s3_key);
    const mime = exp.s3_key.endsWith(".pptx") ? PPTX_MIME : DOCX_MIME;
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": mime,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(exp.file_name)}`,
        "Content-Length": String(buffer.length),
      },
    });
  } catch (e) {
    console.error("計画書docxの再ダウンロードに失敗:", e);
    return NextResponse.json({ data: null, error: "ファイルの取得に失敗しました" }, { status: 500 });
  }
}
