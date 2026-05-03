/**
 * app/src/lib/db.ts
 *
 * PostgreSQL 接続プール
 * - 接続文字列は DATABASE_URL 環境変数から取得（zod で検証）
 * - CLAUDE.md 規約: 環境変数は zod 検証、型アサーション禁止
 * - 本番環境では DATABASE_URL を Secrets Manager から ECS タスク定義に注入する
 */

import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { z } from 'zod';

// ── 環境変数スキーマ定義 ──────────────────────────────────────────
const envSchema = z.object({
  DATABASE_URL: z
    .string({ error: '環境変数 DATABASE_URL が設定されていません' })
    .url({ message: 'DATABASE_URL は有効な URL 形式である必要があります' })
    .startsWith('postgresql://', {
      message: 'DATABASE_URL は postgresql:// で始まる必要があります',
    }),
  DATABASE_MAX_CONNECTIONS: z.coerce
    .number({ error: 'DATABASE_MAX_CONNECTIONS は数値である必要があります' })
    .int()
    .positive()
    .default(10),
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
});

// 環境変数を検証（失敗時は起動を中断）
const parseResult = envSchema.safeParse(process.env);
if (!parseResult.success) {
  const messages = parseResult.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  throw new Error(`環境変数の検証に失敗しました:\n${messages}`);
}

const env = parseResult.data;

// ── 接続プール シングルトン ────────────────────────────────────────
// Next.js の開発モードではホットリロードで Pool が重複生成されるため
// globalThis にキャッシュする
declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
}

function createPool(): Pool {
  return new Pool({
    connectionString: env.DATABASE_URL,
    max: env.DATABASE_MAX_CONNECTIONS,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ssl: env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : false,
  });
}

export const pool: Pool =
  globalThis.__pgPool ?? (globalThis.__pgPool = createPool());

// 開発モード以外ではキャッシュしない（globalThis への汚染を防ぐ）
if (env.NODE_ENV !== 'development') {
  globalThis.__pgPool = undefined;
}

// ── 型安全なクエリヘルパー ────────────────────────────────────────

/**
 * 単一のクエリを実行し、行の配列を返す
 * @example
 * const rows = await query<Municipality>('SELECT * FROM municipalities WHERE slug = $1', [slug]);
 */
export async function query<T extends QueryResultRow = Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const result = await pool.query<T>(text, params);
  return result.rows;
}

/**
 * 単一の行を返す。行が存在しない場合は null を返す
 * @example
 * const project = await queryOne<Project>('SELECT * FROM projects WHERE id = $1', [id]);
 */
export async function queryOne<T extends QueryResultRow = Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/**
 * トランザクション内で複数クエリを実行する
 * エラー時は自動でロールバックされる
 * @example
 * const result = await transaction(async (client) => {
 *   await client.query('INSERT INTO projects ...', [...]);
 *   await client.query('INSERT INTO kpis ...', [...]);
 *   return { success: true };
 * });
 */
export async function transaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
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

/** PostgreSQL エラーコード定数 */
export const PgErrorCode = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  NOT_NULL_VIOLATION: '23502',
  CHECK_VIOLATION: '23514',
} as const;

interface PgError extends Error {
  code: string;
}

/** PostgreSQL ネイティブエラーかどうかを判定する型ガード */
export function isPgError(error: unknown): error is PgError {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof (error as PgError).code === 'string'
  );
}
