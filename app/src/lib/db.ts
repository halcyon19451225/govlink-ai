import { Pool, type PoolClient, type QueryResultRow } from 'pg'

let pool: Pool | null = null

function getPool(): Pool {
  if (pool) return pool
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL が設定されていません')
  }
  pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30_000,
    // ⚠ **Aurora Serverless v2 を min 0 ACU で運用しているため、休止からの復帰に
    //    十数秒かかる。** 5 秒では復帰を待ちきれず、休止後の最初のリクエストが
    //    「接続できない」で落ちる。サーバーコンポーネントならページ全体が
    //    描画エラーになり、利用者には原因の分からないエラー画面が出る。
    //
    //    実際 2026-09-07 に /public/[slug] がこれで落ちていた。数秒後に API を
    //    叩いたときには DB が起きていて成功したため、ページ固有の不具合に見えていた。
    //    scripts/run-migration.mjs と scripts/inspect-tenants.mjs は最初から
    //    60_000 を指定していて、コメントに理由も書いてある。**アプリ本体だけが
    //    5_000 のまま取り残されていた。**
    //
    //    利用者を30秒待たせるのは本来望ましくない。恒久的にはこちらで直すこと:
    //      ・Aurora の最小容量を 0 ACU より大きくする（休止させない）
    //      ・あるいは接続を保つ仕組み（RDS Proxy 等）を挟む
    //    ここは、そうするまでの「エラー画面よりは待たせる方がまし」という判断。
    connectionTimeoutMillis: 30_000,
  })
  return pool
}

export async function query<T extends QueryResultRow = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
): Promise<T[]> {
  const client = await getPool().connect()
  try {
    const result = await client.query<T>(sql, params)
    return result.rows
  } finally {
    client.release()
  }
}

export async function queryOne<T extends QueryResultRow = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
): Promise<T | null> {
  const rows = await query<T>(sql, params)
  return rows[0] ?? null
}

export async function transaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

export const PgErrorCode = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  NOT_NULL_VIOLATION: '23502',
  CHECK_VIOLATION: '23514',
} as const

interface PgError extends Error {
  code: string
}

export function isPgError(error: unknown): error is PgError {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof (error as PgError).code === 'string'
  )
}
