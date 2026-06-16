export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import { uploadToStorage } from "@/lib/supabase-storage";
import {
  MAX_FILE_SIZE_BYTES,
  ALLOWED_FILE_TYPES,
  ALLOWED_MIME,
  formatBytes,
} from "@/lib/knowledge-config";

const ORDO_ADMIN_EMAIL = "ordoservice.com@gmail.com";

function getFileExt(filename: string): string {
  return filename.toLowerCase().split(".").pop() ?? "";
}

function getFileType(ext: string): string {
  const map: Record<string, string> = { pdf: "pdf", docx: "docx", txt: "txt" };
  return map[ext] ?? "other";
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.email !== ORDO_ADMIN_EMAIL) {
    return NextResponse.json({ data: null, error: "権限がありません" }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ data: null, error: "リクエストの形式が不正です" }, { status: 400 });
  }

  const title = (form.get("title") as string | null)?.trim();
  const description = (form.get("description") as string | null)?.trim() || null;
  const categoryId = (form.get("category_id") as string | null)?.trim();
  const file = form.get("file") as File | null;

  // tagIds: カンマ区切り文字列またはJSON配列
  const tagIdsRaw = form.get("tagIds") as string | null;
  let tagIds: string[] = [];
  if (tagIdsRaw) {
    try {
      const parsed = JSON.parse(tagIdsRaw) as unknown;
      tagIds = Array.isArray(parsed) ? (parsed as string[]) : tagIdsRaw.split(",").map((s) => s.trim()).filter(Boolean);
    } catch {
      tagIds = tagIdsRaw.split(",").map((s) => s.trim()).filter(Boolean);
    }
  }

  // 必須チェック
  if (!title || !file) {
    return NextResponse.json({ data: null, error: "タイトルとファイルは必須です" }, { status: 400 });
  }
  if (!categoryId) {
    return NextResponse.json({ data: null, error: "カテゴリーを選択してください" }, { status: 400 });
  }
  if (tagIds.length === 0) {
    return NextResponse.json({ data: null, error: "PDCA工程タグを1つ以上選択してください" }, { status: 400 });
  }

  // 拡張子・MIME検証
  const ext = getFileExt(file.name);
  if (!(ALLOWED_FILE_TYPES as readonly string[]).includes(ext)) {
    return NextResponse.json(
      { data: null, error: "対応形式はPDF・Word・テキストのみです" },
      { status: 400 },
    );
  }
  const mime = file.type || "";
  if (mime && !(ALLOWED_MIME as readonly string[]).includes(mime)) {
    return NextResponse.json(
      { data: null, error: "対応形式はPDF・Word・テキストのみです" },
      { status: 400 },
    );
  }

  // サイズ検証
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json(
      {
        data: null,
        error: `ファイルサイズが上限(20MB)を超えています（現在: ${formatBytes(file.size)}）`,
      },
      { status: 400 },
    );
  }

  // INSERT ドキュメント
  const idRes = await query<{ id: string }>(
    `INSERT INTO knowledge_documents
       (tier, category_id, title, description, file_name, s3_key,
        file_size_bytes, file_type, status,
        processing_step, processing_progress, uploaded_by)
     VALUES (1, $1, $2, $3, $4, 'tmp', $5, $6, 'pending', 'upload', 0, $7)
     RETURNING id`,
    [
      categoryId,
      title,
      description,
      file.name,
      file.size,
      getFileType(ext),
      session.user?.userRoleId ?? null,
    ],
  );
  const docId = idRes[0]?.id;
  if (!docId) {
    return NextResponse.json({ data: null, error: "ドキュメント作成に失敗しました" }, { status: 500 });
  }

  // Supabase Storage へ保存
  const storagePath = `tier1/${docId}.${ext}`;
  const arrayBuffer = await file.arrayBuffer();
  try {
    await uploadToStorage(
      "knowledge",
      storagePath,
      Buffer.from(arrayBuffer),
      file.type || "application/octet-stream",
    );
  } catch (err) {
    console.error("Knowledge upload error:", err);
    await query(`UPDATE knowledge_documents SET status = 'error' WHERE id = $1`, [docId]);
    return NextResponse.json({ data: null, error: "ファイルのアップロードに失敗しました" }, { status: 500 });
  }

  await query(
    `UPDATE knowledge_documents SET s3_key = $1, updated_at = NOW() WHERE id = $2`,
    [storagePath, docId],
  );

  // タグ保存
  if (tagIds.length > 0) {
    const tagValues = tagIds.map((_, i) => `($1, $${i + 2})`).join(", ");
    await query(
      `INSERT INTO knowledge_document_tags (document_id, tag_id) VALUES ${tagValues} ON CONFLICT DO NOTHING`,
      [docId, ...tagIds],
    );
  }

  return NextResponse.json({ data: { documentId: docId, status: "pending" }, error: null }, { status: 201 });
}
