import "server-only";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

/**
 * S3 ベースのアプリストレージ層（Supabase Storage から移行）。
 *
 * 旧 Supabase Storage の「バケット」（knowledge / datasets / avatars）は、
 * 単一 S3 バケット内のプレフィックスとして表現する。
 * 例: uploadToStorage("knowledge", "abc.pdf", ...) → s3://<BUCKET>/knowledge/abc.pdf
 * これにより DB に保存済みの s3_key（パス）はそのまま使える。
 *
 * 認証情報:
 * - Amplify Hosting では AWS_* の環境変数名が予約されているため、
 *   APP_AWS_ACCESS_KEY_ID / APP_AWS_SECRET_ACCESS_KEY / APP_AWS_REGION を使う。
 * - 未設定の場合は SDK の既定の資格情報チェーンにフォールバック（ローカル開発用）。
 */

let _client: S3Client | null = null;

export function getS3(): S3Client {
  if (_client) return _client;
  const region =
    process.env.APP_AWS_REGION ?? process.env.AWS_REGION ?? "ap-northeast-1";
  const accessKeyId = process.env.APP_AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.APP_AWS_SECRET_ACCESS_KEY;
  _client = new S3Client({
    region,
    ...(accessKeyId && secretAccessKey
      ? { credentials: { accessKeyId, secretAccessKey } }
      : {}),
  });
  return _client;
}

function getBucketName(): string {
  const bucket = process.env.S3_BUCKET_NAME;
  if (!bucket) {
    throw new Error("S3_BUCKET_NAME が設定されていません");
  }
  return bucket;
}

function getRegion(): string {
  return process.env.APP_AWS_REGION ?? process.env.AWS_REGION ?? "ap-northeast-1";
}

/** 論理バケット（旧 Supabase バケット名）とパスから S3 キーを組み立てる */
function toKey(bucket: string, path: string): string {
  return `${bucket}/${path}`;
}

/**
 * S3 にファイルをアップロードする。
 * @returns storage path（DB の s3_key 列に保存する値。旧実装と同じくパスを返す）
 */
export async function uploadToStorage(
  bucket: string,
  path: string,
  data: Buffer | Uint8Array,
  contentType: string,
): Promise<string> {
  await getS3().send(
    new PutObjectCommand({
      Bucket: getBucketName(),
      Key: toKey(bucket, path),
      Body: data,
      ContentType: contentType,
    }),
  );
  return path;
}

/**
 * 公開プレフィックス（avatars）のファイル公開 URL を返す。
 */
export function getPublicUrl(bucket: string, path: string): string {
  return `https://${getBucketName()}.s3.${getRegion()}.amazonaws.com/${toKey(bucket, path)}`;
}

/**
 * S3 からファイルをダウンロードして Buffer を返す。
 */
export async function downloadFromStorage(
  bucket: string,
  path: string,
): Promise<Buffer> {
  const res = await getS3().send(
    new GetObjectCommand({
      Bucket: getBucketName(),
      Key: toKey(bucket, path),
    }),
  );
  if (!res.Body) {
    throw new Error("Storage download failed: no data");
  }
  const bytes = await res.Body.transformToByteArray();
  return Buffer.from(bytes);
}

/**
 * S3 からファイルを削除する。
 */
export async function deleteFromStorage(
  bucket: string,
  path: string,
): Promise<void> {
  await getS3().send(
    new DeleteObjectCommand({
      Bucket: getBucketName(),
      Key: toKey(bucket, path),
    }),
  );
}
