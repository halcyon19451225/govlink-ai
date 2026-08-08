export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getS3 } from "@/lib/storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";

const s3 = getS3();

const bodySchema = z.object({
  projectId: z.string().uuid("project_id が不正です"),
  scheduleTaskId: z.string().uuid().nullable().optional(),
  title: z.string().min(1, "タイトルは必須です"),
  documentType: z.enum(["advisory_report", "meeting_minutes", "survey_report", "plan", "other"]),
  fileName: z.string().min(1, "ファイル名は必須です"),
  fileSize: z.number().int().positive().optional(),
  contentType: z.string().min(1, "コンテンツタイプは必須です"),
});

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }

  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json({ data: null, error: "project_id は必須です" }, { status: 400 });
  }

  const rows = await query<{
    id: string;
    schedule_task_id: string | null;
    title: string;
    document_type: string;
    s3_key: string;
    file_name: string;
    file_size: number | null;
    ai_summary: string | null;
    uploaded_at: string;
    uploaded_by: string | null;
  }>(
    `SELECT id, schedule_task_id, title, document_type, s3_key, file_name,
            file_size, ai_summary, uploaded_at::text, uploaded_by
     FROM documents
     WHERE project_id = $1
     ORDER BY uploaded_at DESC`,
    [projectId],
  );

  return NextResponse.json({ data: rows, error: null });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }

  const bucket = process.env.S3_BUCKET_NAME;
  if (!bucket) {
    return NextResponse.json({ data: null, error: "S3_BUCKET_NAME が設定されていません" }, { status: 500 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ data: null, error: "リクエスト本文が不正です" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: parsed.error.issues[0]?.message ?? "入力が不正です" },
      { status: 400 },
    );
  }

  const { projectId, scheduleTaskId, title, documentType, fileName, fileSize, contentType } =
    parsed.data;

  const uploadedBy = session.user?.email ?? null;
  const s3Key = `documents/${projectId}/${Date.now()}_${fileName}`;

  const rows = await query<{ id: string }>(
    `INSERT INTO documents
       (project_id, schedule_task_id, title, document_type, s3_key, file_name, file_size, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [projectId, scheduleTaskId ?? null, title, documentType, s3Key, fileName, fileSize ?? null, uploadedBy],
  );

  const row = rows[0];
  if (!row) {
    return NextResponse.json({ data: null, error: "DB への登録に失敗しました" }, { status: 500 });
  }

  const presignedUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: bucket, Key: s3Key, ContentType: contentType }),
    { expiresIn: 300 },
  );

  return NextResponse.json({ data: { id: row.id, presignedUrl, s3Key }, error: null }, { status: 201 });
}
