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
 * 信頼できる前段ホップの数。
 *
 * X-Forwarded-For の**末尾から数えてこの数だけ捨てた要素**を閲覧者 IP とみなす。
 *
 * 2026-09-07 の本番実測（`claude/coe-rate-limit.md` §6）:
 *   末尾は毎回異なる `64.252.x.x`（AWS の CloudFront オリジン向けレンジ）だった。
 *   つまり Amplify SSR に届く時点でチェーンは
 *
 *     [閲覧者が偽装した値…] , <閲覧者IP: CloudFront が追記> , <CloudFrontのIP: さらに後段が追記>
 *
 *   の形で、**末尾は中間ホップ**。1 を捨てて末尾から 2 番目を採る。
 *
 * ⚠ この値を増減させると、レート制限が「効かない」または「偽装可能」のどちらかに倒れる。
 *   前段の構成（CloudFront + Amplify の内部プロキシ）を変えたときは必ず測り直すこと。
 *   測り方は下の logChainOnce が出すログか、
 *   `node scripts/inspect-rate-limits.mjs` に記録される値を見る。
 */
const TRUSTED_PROXY_HOPS = 1

/**
 * 前段の構成を確かめるための診断ログ。
 *
 * Lambda インスタンスごとに **1 回だけ** 出す。毎回出すとログが膨らみ、
 * 出さないと構成が変わったときに黙って壊れる。その折衷。
 * 出力先は Amplify の SSR ログ（CloudWatch Logs /aws/amplify/<appId>）。
 */
let chainLogged = false
function logChainOnce(xff: string | null, derived: string | null): void {
  if (chainLogged) return
  chainLogged = true
  console.warn(
    `[rate-limit] X-Forwarded-For の構成: raw="${xff ?? '(なし)'}" ` +
      `hops=${TRUSTED_PROXY_HOPS} derived=${derived ?? '(取得できず)'}`,
  )
}

/**
 * クライアント IP を取り出す。
 *
 * ⚠ **先頭を採ってはいけない。** 閲覧者が X-Forwarded-For を付けて送れば、
 *   その値が先頭に入る。先頭を採るとヘッダを 1 つ足すだけで制限を回避できる。
 *
 * ⚠ **末尾も採ってはいけない。** 2026-09-07 の実測で、末尾は CloudFront の
 *   オリジン向け IP（毎リクエスト変化）だった。末尾を採ると
 *   **リクエストごとに別バケットになり、制限が一切効かないうえに
 *   `rate_limits` の行が無限に増える**。実際そうなっていた。
 *
 *   採るのは「末尾から TRUSTED_PROXY_HOPS 個を捨てた要素」。
 */
export function clientIpFrom(headers: Headers): string | null {
  const xff = headers.get('x-forwarded-for')
  let derived: string | null = null

  if (xff) {
    const parts = xff
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    // 末尾から TRUSTED_PROXY_HOPS 個を捨てた位置。
    // チェーンが想定より短いときは、残っている中で最も後ろ（＝最も信頼できる）を採る。
    const index = Math.max(0, parts.length - 1 - TRUSTED_PROXY_HOPS)
    const candidate = parts[index]
    if (candidate && isIpLike(candidate)) derived = candidate
  }

  if (!derived) {
    const real = headers.get('x-real-ip')?.trim()
    if (real && isIpLike(real)) derived = real
  }

  logChainOnce(xff, derived)
  return derived
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
