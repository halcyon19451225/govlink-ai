export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { authOptions } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";

type Params = { params: { id: string } };

const s3 = new S3Client({ region: process.env.AWS_REGION ?? "ap-northeast-1" });

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }

  const rows = await query(
    `SELECT pd.*, dd.display_name
     FROM project_datasets pd
     JOIN dataset_definitions dd ON dd.id = pd.dataset_def_id
     WHERE pd.project_id = $1
     ORDER BY pd.uploaded_at DESC`,
    [params.id],
  );

  return NextResponse.json({ data: rows, error: null });
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ data: null, error: "フォームデータの解析に失敗しました" }, { status: 400 });
  }

  const file = formData.get("file");
  const datasetDefId = formData.get("dataset_def_id");
  const surveyYearRaw = formData.get("survey_year");

  if (!(file instanceof File)) {
    return NextResponse.json({ data: null, error: "ファイルが必要です" }, { status: 400 });
  }
  if (typeof datasetDefId !== "string" || !datasetDefId) {
    return NextResponse.json({ data: null, error: "dataset_def_id が必要です" }, { status: 400 });
  }

  const surveyYear =
    typeof surveyYearRaw === "string" && surveyYearRaw
      ? parseInt(surveyYearRaw, 10)
      : null;

  const timestamp = Date.now();
  const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const s3Key = `datasets/${params.id}/${datasetDefId}/${timestamp}_${safeFileName}`;
  const bucket = process.env.S3_BUCKET_NAME;

  if (!bucket) {
    return NextResponse.json({ data: null, error: "S3_BUCKET_NAME が未設定です" }, { status: 500 });
  }

  try {
    const bytes = await file.arrayBuffer();
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: s3Key,
        Body: Buffer.from(bytes),
        ContentType: file.type || "application/octet-stream",
      }),
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("S3 upload error:", err);
    const msg =
      process.env.NODE_ENV === "production"
        ? "S3へのアップロードに失敗しました"
        : `S3エラー: ${detail}`;
    return NextResponse.json({ data: null, error: msg }, { status: 500 });
  }

  const userId = session.user?.id ?? null;

  const row = await queryOne<{ id: string; s3_key: string }>(
    `INSERT INTO project_datasets
       (project_id, dataset_def_id, file_name, s3_key, file_size_bytes,
        uploaded_by, survey_year, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
     RETURNING id, s3_key`,
    [
      params.id,
      datasetDefId,
      file.name,
      s3Key,
      file.size,
      userId,
      surveyYear,
    ],
  );

  if (!row) {
    return NextResponse.json({ data: null, error: "DB登録に失敗しました" }, { status: 500 });
  }

  return NextResponse.json({ data: { id: row.id, s3_key: row.s3_key }, error: null }, { status: 201 });
}
