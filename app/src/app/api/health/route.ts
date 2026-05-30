import { query } from '@/lib/db'
import { NextResponse } from 'next/server'

export async function GET() {
  try {
    await query('SELECT 1')
    return NextResponse.json({ status: 'ok', timestamp: new Date().toISOString() })
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラー'
    return NextResponse.json(
      { status: 'error', message, timestamp: new Date().toISOString() },
      { status: 503 },
    )
  }
}
