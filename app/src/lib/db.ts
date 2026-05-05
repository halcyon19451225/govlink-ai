import { Pool, type PoolClient, type QueryResultRow } from 'pg'

let pool: Pool | null = null

function getPool(): Pool {
  if (pool) return pool

  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL が設定されていません')
  }

  // sslmodeパラメータをURLから除去してssl設定で上書き
  const cleanUrl = connectionString.replace(/[?&]sslmode=[^&]*/g, '')

  pool = new Pool({
    connectionString: cleanUrl,
    ssl: process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : false,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
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
