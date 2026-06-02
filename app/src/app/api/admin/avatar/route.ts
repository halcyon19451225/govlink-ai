export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import { uploadToStorage, getPublicUrl } from "@/lib/supabase-storage";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const MAX_SIZE = 5 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ data: null, error: "フォームデータの解析に失敗しました" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ data: null, error: "ファイルが選択されていません" }, { status: 400 });
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ data: null, error: "JPG・PNG・GIF・WebPのみアップロードできます" }, { status: 400 });
  }

  if (file.size > MAX_SIZE) {
    return NextResponse.json({ data: null, error: "ファイルサイズは5MB以下にしてください" }, { status: 400 });
  }

  const ext = (file.type.split("/")[1] ?? "jpg").replace("jpeg", "jpg");
  const path = `${session.user.id}/profile.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    await uploadToStorage("avatars", path, buffer, file.type);
  } catch (err) {
    console.error("Avatar upload error:", err);
    return NextResponse.json({ data: null, error: "アバターのアップロードに失敗しました" }, { status: 500 });
  }

  const url = getPublicUrl("avatars", path);

  await query(
    "UPDATE user_roles SET avatar_url = $1 WHERE cognito_user_id = $2",
    [url, session.user.id],
  );

  return NextResponse.json({ data: { url }, error: null });
}
