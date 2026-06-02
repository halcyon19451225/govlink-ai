export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import { uploadToStorage } from "@/lib/supabase-storage";

const ORDO_ADMIN_EMAIL = "ordoservice.com@gmail.com";

function getFileType(filename: string): string {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  const map: Record<string, string> = { pdf: "pdf", docx: "docx", doc: "docx", txt: "txt", xlsx: "xlsx" };
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
  const file = form.get("file") as File | null;

  if (!title || !file) {
    return NextResponse.json({ data: null, error: "タイトルとファイルは必須です" }, { status: 400 });
  }

  const fileType = getFileType(file.name);
  const idRes = await query<{ id: string }>(
    `INSERT INTO knowledge_documents
       (tier, title, description, file_name, s3_key, file_size_bytes, file_type, status, uploaded_by)
     VALUES (1, $1, $2, $3, 'tmp', $4, $5, 'pending', $6)
     RETURNING id`,
    [title, description, file.name, file.size, fileType, session.user?.userRoleId ?? null],
  );
  const docId = idRes[0]?.id;
  if (!docId) {
    return NextResponse.json({ data: null, error: "ドキュメント作成に失敗しました" }, { status: 500 });
  }

  const ext = file.name.toLowerCase().split(".").pop() ?? "bin";
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

  return NextResponse.json({ data: { documentId: docId, status: "pending" }, error: null }, { status: 201 });
}
