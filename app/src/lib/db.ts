import { Pool, type PoolClient, type QueryResultRow } from 'pg'
import { Signer } from '@aws-sdk/rds-signer'

let pool: Pool | null = null
let tokenExpiry: number = 0

async function getIamToken(): Promise<string> {
  const signer = new Signer({
    hostname: 'govlink-db.cluster-cbgussy88a25.ap-northeast-1.rds.amazonaws.com',
    port: 5432,
    region: 'ap-northeast-1',
    username: 'postgres',
  })
  return signer.getAuthToken()
}

async function createPool(): Promise<Pool> {
  if (process.env.NODE_ENV === 'production') {
    const password = await getIamToken()
    tokenExpiry = Date.now() + 14 * 60 * 1000

    return new Pool({
      host: 'govlink-db.cluster-cbgussy88a25.ap-northeast-1.rds.amazonaws.com',
      port: 5432,
      database: 'govlink',
      user: 'postgres',
      password,
      ssl: { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    })
  }

  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL が設定されていません')
  return new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
  })
}

async function getPool(): Promise<Pool> {
  if (pool && Date.now() < tokenExpiry) return pool

  if (pool) {
    await pool.end().catch(() => {})
    pool = null
  }

  pool = await createPool()
  return pool
}

export async function query<T extends QueryResultRow = Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const p = await getPool()
  const client = await p.connect()
  try {
    const result = await client.query<T>(text, params)
    return result.rows
  } finally {
    client.release()
  }
}

export async function queryOne<T extends QueryResultRow = Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<T | null> {
  const rows = await query<T>(text, params)
  return rows[0] ?? null
}

export async function transaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const p = await getPool()
  const client = await p.connect()
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
