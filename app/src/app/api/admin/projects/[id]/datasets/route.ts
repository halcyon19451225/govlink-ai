export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { uploadToStorage } from "@/lib/storage";

type Params = { params: { id: string } };

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
  const storagePath = `${params.id}/${datasetDefId}/${timestamp}_${safeFileName}`;

  try {
    const bytes = await file.arrayBuffer();
    await uploadToStorage(
      "datasets",
      storagePath,
      Buffer.from(bytes),
      file.type || "application/octet-stream",
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("Storage upload error:", err);
    const msg =
      process.env.NODE_ENV === "production"
        ? "ストレージへのアップロードに失敗しました"
        : `Storageエラー: ${detail}`;
    return NextResponse.json({ data: null, error: msg }, { status: 500 });
  }

  // DB の s3_key 列にはストレージパスを格納（列名はそのまま維持）
  const s3Key = storagePath;

  // uploaded_by は UUID 型のため userRoleId を使う（session.user.id は Google ID 等で非UUID）
  const userId = session.user?.userRoleId ?? null;

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
