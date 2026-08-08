/**
 * Supabase Storage → S3 移行スクリプト（Supabase REST API 直接呼び出し版・Node 20対応）
 *
 * 実行方法（app/ ディレクトリで）:
 *   node --env-file=.env.local scripts/migrate-storage-to-s3.mjs
 *
 * 必要な環境変数:
 *   NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY  … 移行元
 *   S3_BUCKET_NAME                                        … 移行先バケット
 *   APP_AWS_REGION（省略時 ap-northeast-1）
 *   APP_AWS_ACCESS_KEY_ID / APP_AWS_SECRET_ACCESS_KEY（省略時は既定のAWS資格情報）
 *   DATABASE_URL … avatars の URL 書き換え用（移行先 Aurora を指定すること）
 */
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import pg from "pg";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = process.env.S3_BUCKET_NAME;
const REGION = process.env.APP_AWS_REGION ?? "ap-northeast-1";

if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("Supabase の環境変数が未設定です");
if (!BUCKET) throw new Error("S3_BUCKET_NAME が未設定です");

const authHeaders = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
};

const s3 = new S3Client({
  region: REGION,
  ...(process.env.APP_AWS_ACCESS_KEY_ID && process.env.APP_AWS_SECRET_ACCESS_KEY
    ? { credentials: {
        accessKeyId: process.env.APP_AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.APP_AWS_SECRET_ACCESS_KEY,
      } }
    : {}),
});

/** Supabase Storage のフォルダを1階層リストする */
async function listDir(bucket, prefix, offset, limit) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${bucket}`, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      prefix,
      limit,
      offset,
      sortBy: { column: "name", order: "asc" },
    }),
  });
  if (!res.ok) {
    throw new Error(`list ${bucket}/${prefix}: HTTP ${res.status} ${await res.text()}`);
  }
  return res.json();
}

/** バケットを再帰的にリストして全ファイルパスを返す */
async function listAll(bucket, prefix = "") {
  const files = [];
  let offset = 0;
  const LIMIT = 100;
  for (;;) {
    const data = await listDir(bucket, prefix, offset, LIMIT);
    if (!Array.isArray(data) || data.length === 0) break;
    for (const entry of data) {
      const full = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null || entry.id === undefined) {
        // フォルダ → 再帰
        files.push(...(await listAll(bucket, full)));
      } else {
        files.push(full);
      }
    }
    if (data.length < LIMIT) break;
    offset += LIMIT;
  }
  return files;
}

/** ファイルをダウンロードして { buf, contentType } を返す */
async function download(bucket, path) {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${encoded}`, {
    headers: authHeaders,
  });
  if (!res.ok) {
    throw new Error(`download: HTTP ${res.status} ${await res.text()}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get("content-type") ?? "application/octet-stream";
  return { buf, contentType };
}

let copied = 0;
let failed = 0;

for (const bucket of ["knowledge", "datasets", "avatars"]) {
  console.log(`\n=== ${bucket} ===`);
  let paths = [];
  try {
    paths = await listAll(bucket);
  } catch (e) {
    console.warn(`  スキップ（バケットなし or リスト失敗）: ${e.message}`);
    continue;
  }
  console.log(`  ${paths.length} 件`);
  for (const path of paths) {
    try {
      const { buf, contentType } = await download(bucket, path);
      await s3.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: `${bucket}/${path}`,
        Body: buf,
        ContentType: contentType,
      }));
      copied++;
      console.log(`  ✓ ${bucket}/${path} (${buf.length} bytes)`);
    } catch (e) {
      failed++;
      console.error(`  ✗ ${bucket}/${path}: ${e.message}`);
    }
  }
}

console.log(`\nコピー完了: ${copied} 件 / 失敗: ${failed} 件`);

// ── avatars URL の書き換え ──────────────────────────────────
if (process.env.DATABASE_URL) {
  const oldPrefix = `${SUPABASE_URL}/storage/v1/object/public/avatars/`;
  const newPrefix = `https://${BUCKET}.s3.${REGION}.amazonaws.com/avatars/`;
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  const res = await pool.query(
    `UPDATE user_roles SET avatar_url = replace(avatar_url, $1, $2)
     WHERE avatar_url LIKE $1 || '%'`,
    [oldPrefix, newPrefix],
  );
  console.log(`avatar_url 書き換え: ${res.rowCount} 行`);
  await pool.end();
} else {
  console.log("DATABASE_URL 未設定のため avatar_url の書き換えはスキップしました");
}
