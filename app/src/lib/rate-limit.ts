import { NextResponse } from 'next/server'
import { query } from '@/lib/db'

/**
 * 未認証エンドポイントの回数制限
 *
 * 背景（claude/coe-tenant-isolation.md §10-7）:
 *   リポジトリ全体にレート制限が1つも無かった。未認証で POST を受ける
 *   /api/contact・/api/auth/register・/api/auth/forgot-password は、
 *   1リクエストごとにメールが飛ぶ＝**外部から起動できるメール送信装置**だった。
 *
 * ⚠ **プロセス内の Map で実装してはならない。**
 *   Amplify SSR は Lambda で動くため、メモリはインスタンス間で共有されず、
 *   スケールアウトで素通りし、コールドスタートで消える。
 *   カウンタは DB（migration 065 の rate_limits）に置く。
 *
 * ⚠ **これは総量の抑制であって、能力の除去ではない。**
 *   任意の宛先へ任意の文面を送れる経路は、レート制限では塞げない。
 *   /api/contact の自動返信から本文のエコーを外したのはそのため。
 */

/** 1つの数え方（IP 単位・メールアドレス単位など） */
export type RateLimitSubject = {
  /** 'ip' / 'email' など。バケットキーの一部になる */
  kind: string
  /** 数える対象の値。null / 空なら 'unknown' に丸める */
  value: string | null | undefined
  /** 窓の中で許す回数 */
  limit: number
  /** 窓の幅（秒） */
  windowSeconds: number
}

/** バケットキーが膨らまないよう、値は正規化して長さを切る */
function normalise(value: string | null | undefined): string {
  const v = (value ?? '').trim().toLowerCase()
  if (!v) return 'unknown'
  return v.slice(0, 120)
}

/**
 * クライアント IP を取り出す。
 *
 * ⚠ **X-Forwarded-For は「末尾」を採る。先頭ではない。**
 *   CloudFront（Amplify Hosting の前段）は、閲覧者がすでに X-Forwarded-For を
 *   付けていた場合、**その後ろに実際の閲覧者 IP を追記する**。
 *   したがって先頭の要素は攻撃者が自由に詰められる値であり、
 *   先頭を採るとヘッダを1つ足すだけでレート制限を丸ごと回避できる。
 *   最後の要素だけが、前段が観測した実体である。
 *
 * ⚠ **この前提（Amplify SSR に届く時点で末尾＝閲覧者 IP）は本番で確認すること。**
 *   前段の構成が CloudFront 1段でなければ、末尾は内部ホップの IP になりうる。
 *   確認手順: X-Forwarded-For を偽装して1回叩き、
 *   `node scripts/inspect-rate-limits.mjs` で実際に記録されたキーを見る。
 *   偽装値が入っていれば先頭を採っている（誤り）、自分の IP なら正しい。
 */
export function clientIpFrom(headers: Headers): string | null {
  const xff = headers.get('x-forwarded-for')
  if (xff) {
    const parts = xff
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const last = parts[parts.length - 1]
    if (last && isIpLike(last)) return last
  }
  const real = headers.get('x-real-ip')?.trim()
  if (real && isIpLike(real)) return real
  return null
}

/** IPv4 / IPv6 として妥当な形か。厳密な検証ではなく、キーの汚染を防ぐための足切り */
function isIpLike(value: string): boolean {
  return value.length <= 45 && /^[0-9a-fA-F.:]+$/.test(value)
}

/**
 * 1つのバケットを消費し、その窓での通算回数を返す。
 *
 * 増加と窓のリセットを 1 本の文にまとめている。分けると
 * 「読む → 判断 → 書く」の間に別リクエストが割り込んで数え落とす。
 * ON CONFLICT DO UPDATE は該当行をロックするので、同時実行でも取りこぼさない。
 */
async function consume(bucket: string, windowSeconds: number): Promise<number> {
  const rows = await query<{ count: number }>(
    `INSERT INTO rate_limits (bucket, window_started_at, count, updated_at)
     VALUES ($1, now(), 1, now())
     ON CONFLICT (bucket) DO UPDATE SET
       count = CASE
                 WHEN rate_limits.window_started_at < now() - make_interval(secs => $2::double precision)
                 THEN 1
                 ELSE rate_limits.count + 1
               END,
       window_started_at = CASE
                 WHEN rate_limits.window_started_at < now() - make_interval(secs => $2::double precision)
                 THEN now()
                 ELSE rate_limits.window_started_at
               END,
       updated_at = now()
     RETURNING count`,
    [bucket, windowSeconds],
  )
  return rows[0]?.count ?? 0
}

/** 期限切れ行の掃除。毎回やる必要は無いので低確率で走らせる */
async function sweepOccasionally(): Promise<void> {
  if (Math.random() >= 0.01) return
  try {
    await query(`DELETE FROM rate_limits WHERE window_started_at < now() - INTERVAL '1 day'`)
  } catch (err) {
    // 掃除の失敗は制限の正しさに影響しない。握りつぶしてよい
    console.error('[rate-limit] 期限切れ行の掃除に失敗:', err)
  }
}

const TOO_MANY = (retryAfterSeconds: number) =>
  NextResponse.json(
    { data: null, error: 'リクエストが多すぎます。しばらく待ってから再試行してください' },
    { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
  )

const UNAVAILABLE = () =>
  NextResponse.json(
    { data: null, error: '現在この操作を受け付けられません。しばらく待ってから再試行してください' },
    { status: 503, headers: { 'Retry-After': '60' } },
  )

/**
 * 回数制限を適用する。**通ってよければ null、駄目なら返すべきレスポンス**を返す。
 * 呼び出し側の形は requireProjectAccess（src/lib/tenant.ts）に揃えてある。
 *
 *   const limited = await enforceRateLimit('contact', [
 *     { kind: 'ip', value: clientIpFrom(req.headers), limit: 5, windowSeconds: 3600 },
 *   ])
 *   if (limited) return limited
 *
 * ⚠ **DB が使えないときは fail closed（503）にしている。**
 *   ここで素通りさせると、DB が不調な間だけ制限が消える。
 *   8625022（fail closed）・§10-1（許可リスト方式）と同じ判断。
 *   公開フォームが一時的に受け付けられなくなる代償は承知のうえ。
 *
 * ⚠ 複数の subject を渡したとき、前の subject は先に消費される。
 *   後段で弾かれても前段の回数は戻らない（多少過剰に数える）。
 *   総量を抑えるのが目的なので、この不正確さは許容する。
 */
export async function enforceRateLimit(
  scope: string,
  subjects: RateLimitSubject[],
): Promise<NextResponse | null> {
  for (const subject of subjects) {
    const bucket = `${scope}:${subject.kind}:${normalise(subject.value)}`
    let count: number
    try {
      count = await consume(bucket, subject.windowSeconds)
    } catch (err) {
      console.error(`[rate-limit] 計上に失敗（fail closed で拒否）: ${scope}/${subject.kind}`, err)
      return UNAVAILABLE()
    }
    if (count > subject.limit) {
      console.warn(`[rate-limit] 上限超過: ${scope}/${subject.kind} count=${count} limit=${subject.limit}`)
      return TOO_MANY(subject.windowSeconds)
    }
  }
  await sweepOccasionally()
  return null
}
