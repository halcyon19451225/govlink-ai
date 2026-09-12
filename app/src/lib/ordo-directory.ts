/**
 * Ordo の組織台帳（正本）への問い合わせ。
 *
 * Coe は Ordo ID（Cognito）を認証に使っているが、**誰がどの自治体に属し、
 * Coe を使ってよいか**を知っているのは Ordo 側の台帳だけ。招待された利用者は
 * Cognito には存在しても Coe の user_roles には存在しないため、そのままでは
 * fail closed で弾かれる（正しい挙動だが、招待の意味が無い）。
 * ここはその橋渡しで、sub を渡して所属・契約・属性を受け取る。
 *
 * 呼ぶ先: GET {Ordo}/api/directory/resolve?sub=...&product=Coe
 *         ヘッダ x-license-key（サーバー間専用。ブラウザからは呼べない）
 *
 * ⚠ 鍵は sub のみ。メールアドレスでは引かない・引けない。
 *   メール照合は 2026-09-06 に認可の穴として塞いだ（lib/auth.ts の注記参照）。
 */

export type OrdoResolved = {
  found: boolean;
  allowed: boolean;
  reason?: string;
  checkedAt: string;
  organization?: { id: string; orgCode: string | null; name: string | null; municipalityCode: string | null };
  contract?: { product: string; plan: string | null; active: boolean; licenseUntil: string | null };
  isOrgAdmin?: boolean;
  me?: {
    memberId: string;
    code: string;
    name: string | null;
    kana: string | null;
    email: string | null;
    extension: string | null;
    employment: string;
    department: { id: string; code: string | null; name: string; path: string[] } | null;
    position: { id: string; name: string; rank: number | null; isManager: boolean } | null;
    site: { id: string; name: string } | null;
  };
};

const RESOLVE_URL =
  process.env.ORDO_DIRECTORY_RESOLVE_URL ??
  (process.env.ORDO_LICENSE_API_URL
    ? process.env.ORDO_LICENSE_API_URL.replace(/\/api\/license\/?$/, "/api/directory/resolve")
    : "https://main.d1mi97peszaux0.amplifyapp.com/api/directory/resolve");

/** ログインの待ち時間に直接乗るので、Ordo の応答は短く見切る。 */
const TIMEOUT_MS = 5_000;

/**
 * sub から Ordo 台帳を引く。
 *
 * 返り値の `null` は **「Ordo に到達できなかった」**（判断保留）。
 * 「台帳にいない」は `{ found: false }` で返る。呼び出し側はこの2つを必ず区別すること。
 * 混同すると、Ordo の一時障害が全利用者の権限剥奪になる。
 */
export async function resolveOrdoMember(sub: string, product = "Coe"): Promise<OrdoResolved | null> {
  const key = process.env.LICENSE_API_KEY;
  if (!key) {
    console.warn("[ordo] LICENSE_API_KEY が未設定のため組織台帳を照会できません");
    return null;
  }
  const url = `${RESOLVE_URL}?sub=${encodeURIComponent(sub)}&product=${encodeURIComponent(product)}`;
  try {
    const res = await fetch(url, {
      cache: "no-store",
      headers: { "x-license-key": key },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[ordo] directory/resolve が ${res.status} を返しました`);
      return null;
    }
    return (await res.json()) as OrdoResolved;
  } catch (e) {
    console.warn("[ordo] directory/resolve の呼び出しに失敗しました:", e);
    return null;
  }
}
