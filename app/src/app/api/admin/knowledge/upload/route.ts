export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";

const s3 = new S3Client({ region: process.env.AWS_REGION ?? "ap-northeast-1" });
const BUCKET = process.env.S3_BUCKET_NAME ?? "";

function getFileType(filename: string): string {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  const map: Record<string, string> = { pdf: "pdf", docx: "docx", doc: "docx", txt: "txt", xlsx: "xlsx" };
  return map[ext] ?? "other";
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });

  const municipalityId = session.user?.municipalityId;
  if (!municipalityId) return NextResponse.json({ data: null, error: "自治体情報が取得できません" }, { status: 400 });

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
       (tier, municipality_id, title, description, file_name, s3_key, file_size_bytes, file_type, status, uploaded_by)
     VALUES (2, $1, $2, $3, $4, 'tmp', $5, $6, 'pending', $7)
     RETURNING id`,
    [municipalityId, title, description, file.name, file.size, fileType, session.user?.userRoleId ?? null],
  );
  const docId = idRes[0]?.id;
  if (!docId) return NextResponse.json({ data: null, error: "ドキュメント作成に失敗しました" }, { status: 500 });

  const ext = file.name.toLowerCase().split(".").pop() ?? "bin";
  const s3Key = `knowledge/tier2/${municipalityId}/${docId}.${ext}`;

  const arrayBuffer = await file.arrayBuffer();
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: s3Key,
    Body: Buffer.from(arrayBuffer),
    ContentType: file.type || "application/octet-stream",
  }));

  await query(
    `UPDATE knowledge_documents SET s3_key = $1, updated_at = NOW() WHERE id = $2`,
    [s3Key, docId],
  );

  return NextResponse.json({ data: { documentId: docId, status: "pending" }, error: null }, { status: 201 });
}
