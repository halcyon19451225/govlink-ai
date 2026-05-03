import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { z } from 'zod';

// ── 環境変数スキーマ ──────────────────────────────────────────────
const envSchema = z.object({
  // 本番環境では IAM 接続を使うため DATABASE_URL は optional
  DATABASE_URL: z
    .string()
    .url({ message: 'DATABASE_URL は有効な URL 形式である必要があります' })
    .startsWith('postgresql://', {
      message: 'DATABASE_URL は postgresql:// で始まる必要があります',
    })
    .optional(),
  DATABASE_MAX_CONNECTIONS: z.coerce
    .number()
    .int()
    .positive()
    .default(10),
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
});

const parseResult = envSchema.safeParse(process.env);
if (!parseResult.success) {
  const messages = parseResult.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  throw new Error(`環境変数の検証に失敗しました:\n${messages}`);
}

const env = parseResult.data;

// ── 本番 RDS 接続情報 ─────────────────────────────────────────────
const RDS_HOSTNAME =
  'govlink-db.cluster-cbgussy88a25.ap-northeast-1.rds.amazonaws.com';
const RDS_PORT = 5432;
const RDS_USER = 'postgres';
const RDS_REGION = 'ap-northeast-1';
const RDS_DATABASE = 'govlink';

// ── IAM トークンキャッシュ ────────────────────────────────────────
// IAM 認証トークンの有効期限は 15 分。2 分前にリフレッシュする。
let _tokenCache: { token: string; expiresAt: number } | null = null;

async function getIamAuthToken(): Promise<string> {
  const now = Date.now();
  const refreshThreshold = 2 * 60 * 1000; // トークン期限 2 分前

  if (_tokenCache && _tokenCache.expiresAt > now + refreshThreshold) {
    return _tokenCache.token;
  }

  const { Signer } = await import('@aws-sdk/rds-signer');
  const signer = new Signer({
    hostname: RDS_HOSTNAME,
    port: RDS_PORT,
    username: RDS_USER,
    region: RDS_REGION,
  });

  const token = await signer.getAuthToken();
  _tokenCache = { token, expiresAt: now + 15 * 60 * 1000 };
  return token;
}

// ── プールシングルトン管理 ────────────────────────────────────────
// Next.js 開発モードのホットリロードおよび Lambda のウォームスタートで
// プールが重複生成されないよう globalThis にキャッシュする。
declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __pgPoolTokenExpiry: number | undefined;
}

/**
 * 接続プールを返す。
 * - development/test : DATABASE_URL をそのまま使用
 * - production       : RDS IAM トークンを動的生成してパスワードとして使用。
 *                      トークン期限 2 分前に自動でプールを再生成する。
 */
async function getPool(): Promise<Pool> {
  const now = Date.now();
  const refreshThreshold = 2 * 60 * 1000;

  if (env.NODE_ENV !== 'production') {
    // ── 開発・テスト環境 ──────────────────────────────────────────
    if (!env.DATABASE_URL) {
      throw new Error('開発環境では DATABASE_URL 環境変数が必要です');
    }
    if (!globalThis.__pgPool) {
      globalThis.__pgPool = new Pool({
        connectionString: env.DATABASE_URL,
        max: env.DATABASE_MAX_CONNECTIONS,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000,
        ssl: false,
      });
    }
    return globalThis.__pgPool;
  }

  // ── 本番環境: IAM トークン認証 ──────────────────────────────────
  const tokenExpiry = globalThis.__pgPoolTokenExpiry ?? 0;
  const tokenStillValid = tokenExpiry > now + refreshThreshold;

  if (globalThis.__pgPool && tokenStillValid) {
    return globalThis.__pgPool;
  }

  // 期限切れ: 古いプールをドレインして新しいプールを作成
  if (globalThis.__pgPool) {
    const stalePool = globalThis.__pgPool;
    globalThis.__pgPool = undefined;
    stalePool.end().catch((err: unknown) => {
      console.warn('[db] old pool end error (ignored):', err);
    });
  }

  const token = await getIamAuthToken();

  globalThis.__pgPool = new Pool({
    host: RDS_HOSTNAME,
    port: RDS_PORT,
    user: RDS_USER,
    password: token,
    database: RDS_DATABASE,
    ssl: { rejectUnauthorized: true },
    max: env.DATABASE_MAX_CONNECTIONS,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  globalThis.__pgPoolTokenExpiry = now + 15 * 60 * 1000;

  return globalThis.__pgPool;
}

// ── 型安全なクエリヘルパー ────────────────────────────────────────

/**
 * 単一クエリを実行し行の配列を返す
 */
export async function query<T extends QueryResultRow = Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const p = await getPool();
  const result = await p.query<T>(text, params);
  return result.rows;
}

/**
 * 単一行を返す。存在しない場合は null
 */
export async function queryOne<T extends QueryResultRow = Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/**
 * トランザクション内で複数クエリを実行する。エラー時は自動ロールバック。
 */
export async function transaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const p = await getPool();
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// ── DB エラー型ガード ─────────────────────────────────────────────

export const PgErrorCode = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  NOT_NULL_VIOLATION: '23502',
  CHECK_VIOLATION: '23514',
} as const;

interface PgError extends Error {
  code: string;
}

export function isPgError(error: unknown): error is PgError {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof (error as PgError).code === 'string'
  );
}
