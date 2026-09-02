import "server-only";

/** 様式 docx の返却（S3 へ痕跡を残してからダウンロードさせる — reportDocx と同じ流儀） */

import { NextResponse } from "next/server";
import { uploadToStorage } from "@/lib/storage";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export async function docxResponse(projectId: string, key: string, baseName: string, buffer: Buffer): Promise<NextResponse> {
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  try {
    await uploadToStorage("evaluation-reports", `${projectId}/reflection/${key}_${stamp}.docx`, buffer, DOCX_MIME);
  } catch (e) {
    console.warn(`[plan-reflection/${key}] S3保存に失敗（ダウンロードは継続）:`, e);
  }
  const safe = baseName.replace(/[\\/:*?"<>|\r\n\t]/g, "").trim();
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": DOCX_MIME,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${safe}_${stamp}.docx`)}`,
      "Cache-Control": "no-store",
    },
  });
}
